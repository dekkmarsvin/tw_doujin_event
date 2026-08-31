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
    "missing_event_id", "missing_source",
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

test("validation completion follows the candidate version and submission completes review", () => {
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
  assert.equal(submitted.completed, 6);
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
