import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { parseOrganizerEventDraft, validateOrganizerEventDraft } = await environment.runner.import("/app/organizer-event.ts");
const { organizerGuidedTaskIssues } = await environment.runner.import("/app/organizer-workspace.ts");
after(async () => { await vite.close(); });

const input = (event) => ({
  schema: "organizer-event-draft/1",
  event: { id: "next-event", name: "下一場活動", days: [{ id: "1", label: "第一天", date: "2026-11-07" }], ...event },
  venue: { assignments: [] },
  officialSource: { label: "主辦公告", url: "https://organizer.example/" },
});
const aliasIssues = (aliases) => validateOrganizerEventDraft(parseOrganizerEventDraft(input({ aliases })))
  .filter((issue) => issue.target?.startsWith("event.aliases"))
  .map(({ code, row, target }) => ({ code, row, target }));

// ADR-0068: every draft saved before aliases existed must serialize exactly as
// it did, or an amendment could no longer match its approved baseline.
test("a draft without aliases carries no aliases key", () => {
  const plain = parseOrganizerEventDraft(input({}));
  assert.equal(Object.hasOwn(plain.event, "aliases"), false);
  assert.equal(JSON.stringify(parseOrganizerEventDraft(input({ aliases: [] }))), JSON.stringify(plain));
  assert.equal(JSON.stringify(parseOrganizerEventDraft(input({ aliases: ["", "   "] }))), JSON.stringify(plain));
});

test("aliases keep their order and drop rows left blank", () => {
  assert.deepEqual(parseOrganizerEventDraft(input({ aliases: ["  ＦＦ４７ ", "", "開拓動漫祭 47"] })).event.aliases, ["FF47", "開拓動漫祭 47"]);
  assert.equal(parseOrganizerEventDraft(input({ aliases: "FF47" })), null);
});

test("alias problems name the row they belong to", () => {
  assert.deepEqual(aliasIssues(["FF47", "ff47"]), [{ code: "duplicate_alias", row: 2, target: "event.aliases.1" }]);
  assert.deepEqual(aliasIssues(["下一場活動"]), [{ code: "duplicate_alias", row: 1, target: "event.aliases.0" }]);
  assert.deepEqual(aliasIssues(["x".repeat(41)]), [{ code: "invalid_alias", row: 1, target: "event.aliases.0" }]);
  assert.deepEqual(aliasIssues(["a", "b", "c", "d", "e", "f"]).map(({ code }) => code), ["too_many_aliases"]);
  assert.deepEqual(aliasIssues(["FF47", "x".repeat(40)]), []);
});

test("alias problems belong to the identity task", () => {
  const draft = parseOrganizerEventDraft(input({ aliases: ["FF47", "FF47"] }));
  assert.ok(organizerGuidedTaskIssues(draft, "identity_source").some((issue) => issue.code === "duplicate_alias"));
  assert.ok(!organizerGuidedTaskIssues(draft, "days").some((issue) => issue.code === "duplicate_alias"));
});
