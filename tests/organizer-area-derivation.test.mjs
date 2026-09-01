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
const { isOrganizerAreaId, parseOrganizerEventDraft, serializeOrganizerEventDraft, validateOrganizerEventDraft, withOrganizerImportedAreaIds } =
  await environment.runner.import("/app/organizer-event.ts");
const { getOrganizerWorkspacePrerequisiteIssues, organizerGuidedTaskIssues, validateOrganizerImportedRowsAgainstDraft } =
  await environment.runner.import("/app/organizer-workspace.ts");
after(async () => { await vite.close(); });

const draft = (assignments) => ({
  schema: "organizer-event-draft/1",
  event: { id: "pf45-rf14", name: "PF45 x RF14", days: [{ id: "1", label: "第一日", date: "2026-11-07" }] },
  venue: { assignments },
  officialSource: { label: "主辦提供", url: "https://organizer.example/pf45" },
});
const space = (venueSpaceId, areaIds = [], areaMode) => ({ venueId: "expo", venueSpaceId, areaIds, mapTemplate: "TAIWAN_GENERIC_V1", ...(areaMode ? { areaMode } : {}) });
const row = (venueSpaceId, areaId) => ({ venueSpaceId, areaId, boothCode: "A01", circleName: "甲社" });

test("a venue space without areas is not an error before any booth list exists", () => {
  const issues = validateOrganizerEventDraft(draft([space("hall-a")]));
  assert.deepEqual(issues.filter((issue) => issue.step === "venue"), []);
  assert.deepEqual(organizerGuidedTaskIssues(draft([space("hall-a")]), "venue"), []);
});

test("the import derives one sorted area set per venue space and clears the spaces it never covers", () => {
  const next = withOrganizerImportedAreaIds(
    draft([space("hall-a"), space("hall-b", ["OLD"]), space("hall-c", ["STALE"])]),
    [row("hall-a", "B"), row("hall-a", "A"), row("hall-a", "B"), row("hall-b", "ALL")],
  );
  assert.deepEqual(next.venue.assignments.map((assignment) => assignment.areaIds), [["A", "B"], ["ALL"], []]);
});

test("a replacement import that drops a space leaves it reportable rather than looking covered", () => {
  const first = withOrganizerImportedAreaIds(
    draft([space("hall-a"), space("hall-b")]),
    [row("hall-a", "A"), row("hall-b", "ALL")],
  );
  assert.deepEqual(first.venue.assignments.map((assignment) => assignment.areaIds), [["A"], ["ALL"]]);

  const replaced = withOrganizerImportedAreaIds(first, [row("hall-a", "A")]);
  assert.deepEqual(replaced.venue.assignments.map((assignment) => assignment.areaIds), [["A"], []]);
  assert.deepEqual(
    getOrganizerWorkspacePrerequisiteIssues({ draft: replaced, importedRows: 1, maps: [] })
      .filter((issue) => issue.code === "missing_space_import")
      .map((issue) => issue.target),
    ["hall-b"],
  );
});

test("derivation replaces the previous set rather than accumulating stale areas", () => {
  const first = withOrganizerImportedAreaIds(draft([space("hall-a")]), [row("hall-a", "A"), row("hall-a", "B")]);
  const second = withOrganizerImportedAreaIds(first, [row("hall-a", "A")]);
  assert.deepEqual(second.venue.assignments[0].areaIds, ["A"]);
});

test("area ids stay url-safe, so a derived value can still be rejected", () => {
  assert.equal(isOrganizerAreaId("A"), true);
  assert.equal(isOrganizerAreaId("ALL_2"), true);
  assert.equal(isOrganizerAreaId("A 區"), false);
  assert.equal(isOrganizerAreaId(""), false);
  const issues = validateOrganizerEventDraft(draft([space("hall-a", ["A 區"])]));
  assert.deepEqual(issues.filter((issue) => issue.step === "venue").map((issue) => issue.code), ["invalid_area"]);
});

test("a space the booth list never covers becomes an error once rows are imported", () => {
  const input = { draft: draft([space("hall-a", ["A"]), space("hall-b")]), maps: [] };
  assert.deepEqual(
    getOrganizerWorkspacePrerequisiteIssues({ ...input, importedRows: 0 })
      .filter((issue) => issue.code === "missing_space_import"),
    [],
  );
  const afterImport = getOrganizerWorkspacePrerequisiteIssues({ ...input, importedRows: 12 })
    .filter((issue) => issue.code === "missing_space_import");
  assert.deepEqual(afterImport.map((issue) => [issue.step, issue.target]), [["import", "hall-b"]]);
});

test("a no-division assignment keeps ALL but still needs an imported booth row", () => {
  const noDivision = withOrganizerImportedAreaIds(draft([space("whole-hall", [], "none")]), []);
  assert.deepEqual(noDivision.venue.assignments[0].areaIds, ["ALL"]);
  const missing = getOrganizerWorkspacePrerequisiteIssues({
    draft: noDivision,
    importedRows: 1,
    importedVenueSpaceIds: ["another-hall"],
    maps: [],
  });
  assert.deepEqual(missing.filter((issue) => issue.code === "missing_space_import").map((issue) => issue.target), ["whole-hall"]);
  const covered = getOrganizerWorkspacePrerequisiteIssues({
    draft: noDivision,
    importedRows: 1,
    importedVenueSpaceIds: ["whole-hall"],
    maps: [],
  });
  assert.equal(covered.some((issue) => issue.code === "missing_space_import"), false);
});

test("area mode parsing rejects explicit unknown values and enforces the no-division ALL invariant", () => {
  const legacy = draft([space("hall-a", ["A"])]);
  assert.deepEqual(parseOrganizerEventDraft(legacy), legacy);
  assert.equal(serializeOrganizerEventDraft(draft([{ ...space("hall-a", ["A"]), areaMode: "unknown" }])), null);
  assert.equal(serializeOrganizerEventDraft(draft([space("whole-hall", [], "none")])), null);
  assert.deepEqual(
    validateOrganizerEventDraft(draft([space("whole-hall", [], "none")]))
      .filter((issue) => issue.code === "invalid_no_division_areas")
      .map((issue) => issue.step),
    ["venue"],
  );
});

test("persisted import rows are revalidated after day, space, or area-mode edits", () => {
  const divided = draft([space("hall-a", ["A"], "imported")]);
  const stored = [{ sourceRow: 2, dayId: "1", venueSpaceId: "hall-a", areaId: "A" }];
  assert.deepEqual(validateOrganizerImportedRowsAgainstDraft(divided, stored), []);

  const noDivision = draft([space("hall-a", ["ALL"], "none")]);
  assert.deepEqual(
    validateOrganizerImportedRowsAgainstDraft(noDivision, stored).map((issue) => issue.code),
    ["stale_import_area_mode"],
  );
  assert.deepEqual(
    validateOrganizerImportedRowsAgainstDraft(draft([]), stored).map((issue) => issue.code),
    ["stale_import_space"],
  );
  assert.deepEqual(
    validateOrganizerImportedRowsAgainstDraft({ ...divided, event: { ...divided.event, days: [] } }, stored).map((issue) => issue.code),
    ["stale_import_day"],
  );
});
