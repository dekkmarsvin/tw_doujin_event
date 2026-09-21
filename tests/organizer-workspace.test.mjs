import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  environments: { ssr: {} },
  logLevel: "silent",
});
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const {
  evaluateOrganizerWorkspaceReadiness,
  organizerGuidedTaskIssues,
  organizerOnboardingIssues,
} = await environment.runner.import("/app/organizer-workspace.ts");
after(async () => { await vite.close(); });

const empty = {
  schema: "organizer-event-draft/1",
  event: { id: null, name: "PF 候選活動", days: [] },
  venue: { assignments: [] },
  officialSource: { label: "", url: null },
};

const base = {
  schema: "organizer-event-draft/1",
  event: { id: "pf45-rf14", name: "PF45 x RF14", days: [{ id: "1", label: "第一日", date: "2026-11-07" }] },
  venue: { assignments: [{ venueId: "expo", venueSpaceId: "hall-a", areaIds: ["A"], mapTemplate: "TAIWAN_GENERIC_V1" }] },
  officialSource: { label: "主辦提供", url: "https://organizer.example/pf45" },
};

test("guided tasks partition the existing draft validation without a second rule set", () => {
  assert.deepEqual(organizerGuidedTaskIssues(empty, "identity_source").map((issue) => issue.code), [
    "missing_event_id", "missing_source", "invalid_source_url",
  ]);
  assert.deepEqual(organizerGuidedTaskIssues(empty, "days").map((issue) => issue.code), ["missing_days"]);
  assert.deepEqual(organizerGuidedTaskIssues(empty, "venue").map((issue) => issue.code), ["missing_venue"]);
  assert.deepEqual(organizerOnboardingIssues(base), []);
});

test("readiness names actionable and blocked sections and never invents a percentage", () => {
  const readiness = evaluateOrganizerWorkspaceReadiness({
    draft: base,
    importedRows: 0,
    maps: [],
    currentVersion: 2,
    lastValidatedVersion: null,
    status: "draft",
  });
  assert.equal(readiness.completed, 2);
  assert.equal(readiness.total, 6);
  assert.equal(readiness.suggestedNextSection, "import");
  assert.deepEqual(Object.fromEntries(readiness.sections.map((section) => [section.id, section.state])), {
    event: "complete",
    venue: "complete",
    import: "available",
    map: "blocked",
    validate: "blocked",
    review: "blocked",
  });
  assert.equal(Object.hasOwn(readiness, "percentage"), false);
});

test("validation follows the candidate version and only publication completes review", () => {
  const input = {
    draft: base,
    importedRows: 1,
    maps: [{ periodKey: "1", venueSpaceId: "hall-a" }],
    currentVersion: 4,
    lastValidatedVersion: 4,
    status: "draft",
  };
  const validated = evaluateOrganizerWorkspaceReadiness(input);
  assert.equal(validated.completed, 5);
  assert.equal(validated.suggestedNextSection, "review");
  assert.equal(validated.sections.find((section) => section.id === "validate").state, "complete");

  const changed = evaluateOrganizerWorkspaceReadiness({ ...input, currentVersion: 5 });
  assert.equal(changed.sections.find((section) => section.id === "validate").state, "available");
  assert.equal(changed.completed, 4);

  const submitted = evaluateOrganizerWorkspaceReadiness({ ...input, status: "submitted" });
  assert.equal(submitted.completed, 5);
  for (const status of ["approved", "publishing", "failed"]) {
    assert.equal(evaluateOrganizerWorkspaceReadiness({ ...input, status }).completed, 5);
  }
  assert.equal(evaluateOrganizerWorkspaceReadiness({ ...input, status: "published" }).completed, 6);
});

test("a stored map with formal validation errors still needs attention", () => {
  const readiness = evaluateOrganizerWorkspaceReadiness({
    draft: base,
    importedRows: 1,
    maps: [{ periodKey: "1", venueSpaceId: "hall-a" }],
    validationIssues: [{
      severity: "error",
      step: "map",
      code: "missing_booth",
      target: "1/hall-a",
      message: "地圖缺少必要攤位 A01。",
    }],
    currentVersion: 4,
    lastValidatedVersion: null,
    status: "draft",
  });

  assert.equal(readiness.sections.find((section) => section.id === "map").state, "needs_attention");
  assert.equal(readiness.sections.find((section) => section.id === "validate").state, "blocked");
  assert.equal(readiness.completed, 3);
  assert.equal(readiness.blockers.some((blocker) => blocker.code === "missing_booth"), true);
});

test("a stale persisted import reopens import and blocks maps even when rows and maps still exist", () => {
  const readiness = evaluateOrganizerWorkspaceReadiness({
    draft: base,
    importedRows: 20_000,
    maps: [{ periodKey: "1", venueSpaceId: "hall-a" }],
    validationIssues: [{
      severity: "error",
      step: "import",
      code: "stale_import_area_mode",
      target: "hall-a",
      message: "使用空間已改為無分區，既有匯入資料需要重新匯入以套用 ALL。",
    }],
    currentVersion: 5,
    lastValidatedVersion: 5,
    status: "draft",
  });

  assert.equal(readiness.sections.find((section) => section.id === "import").state, "needs_attention");
  assert.equal(readiness.sections.find((section) => section.id === "map").state, "blocked");
  assert.equal(readiness.sections.find((section) => section.id === "validate").state, "blocked");
  assert.equal(readiness.suggestedNextSection, "import");
  assert.equal(readiness.completed, 2);
});

// #223: the sidebar and the check card describe the same problem, and the
// sidebar used to get the validator's poorer sentence because the structured
// part never reached it. The codes stay behind -- 170 of them per blocker is
// the oversized response the issue cap exists to prevent -- but the count is
// what the wording needs.
test("a booth blocker carries the count the wording needs, never the codes", () => {
  const { blockers } = evaluateOrganizerWorkspaceReadiness({
    draft: base,
    importedRows: 1,
    maps: [{ periodKey: "1", venueSpaceId: "hall-a" }],
    validationIssues: [
      { severity: "error", step: "map", code: "missing_booth", target: "1/hall-a", message: "地圖缺少必要攤位。", boothCodes: ["A01", "A02", "A03"] },
      { severity: "error", step: "event", code: "missing_name", message: "活動名稱為必填。" },
    ],
    currentVersion: 4,
    lastValidatedVersion: null,
    status: "draft",
  });
  const missing = blockers.find((blocker) => blocker.code === "missing_booth");
  assert.equal(missing.count, 3);
  assert.equal("boothCodes" in missing, false);
  // A problem with no codes does not gain an empty count to explain away.
  assert.equal("count" in blockers.find((blocker) => blocker.code === "missing_name"), false);
});
