import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, server: { middlewareMode: true }, environments: { ssr: {} }, logLevel: "silent" });
const { organizerIssueMessage } = await vite.environments.ssr.runner.import("/app/organizer/organizer-shared.ts");
after(() => vite.close());

const catalog = { venues: [{ id: "expo", name: "花博公園爭艷館", spaces: [{ id: "hall-a", venueId: "expo", name: "全館", defaultAreaMode: "none" }] }] };
const draft = {
  schema: "organizer-event-draft/1",
  event: { id: "pf45-rf14", name: "PF45 x RF14", days: [{ id: "1", label: "第一日", date: "2026-11-07" }] },
  venue: { assignments: [{ venueId: "expo", venueSpaceId: "hall-a", areaIds: ["A"], mapTemplate: "TAIWAN_GENERIC_V1" }] },
  officialSource: { label: "主辦提供", url: "https://organizer.example/pf45" },
};

/* #223: the map validator serves the organizer workspace and the contribution
 * panel, and knows neither. Its own sentence was showing up in 待修正清單 while
 * 檢查與預覽 wrote a far better one from the same problem -- both on screen at
 * once. The wording now has one home, and the two shapes the workspace carries
 * a problem in have to arrive at the same sentence. */
test("one sentence per problem, whichever shape the workspace is holding it in", () => {
  const validatorWording = "缺少本活動日的 3 個主辦攤位代碼。";
  const card = { step: "map", code: "missing_booth", message: validatorWording, target: "1/hall-a", boothCodes: ["A01", "A02", "A03"] };
  const sidebar = { section: "map", code: "missing_booth", message: validatorWording, target: "1/hall-a", count: 3 };
  assert.equal(organizerIssueMessage(card, catalog, draft), organizerIssueMessage(sidebar, catalog, draft));
  assert.match(organizerIssueMessage(sidebar, catalog, draft), /匯入資料有 3 個攤位代碼未出現在這份地圖。/);
  assert.notEqual(organizerIssueMessage(sidebar, catalog, draft), validatorWording);

  const unknown = { section: "map", code: "unknown_booth", message: "含有 2 個主辦攤位資料未出現的代碼。", target: "1/hall-a", count: 2 };
  assert.match(organizerIssueMessage(unknown, catalog, draft), /地圖有 2 個攤位代碼未出現在同一天、同一場地的匯入資料。/);

  // A response that carried neither still says what happened rather than
  // printing a bare undefined at the reader.
  assert.match(organizerIssueMessage({ step: "map", code: "missing_booth", message: validatorWording }, catalog, draft), /部分/);
});

// One code, two steps. The import step raises missing_booth for a source row
// with no booth code at all, which is a different problem with a different
// repair -- keying the map wording on the code alone silently relabels it.
test("the same code from a different step keeps its own meaning", () => {
  const importIssue = { step: "import", code: "missing_booth", message: "第 2 列缺少攤位代碼。" };
  assert.equal(organizerIssueMessage(importIssue, catalog, draft), importIssue.message);
  const blocker = { section: "import", code: "missing_booth", message: "第 2 列缺少攤位代碼。", count: 1 };
  assert.equal(organizerIssueMessage(blocker, catalog, draft), blocker.message);
});

test("a code the workspace has nothing better to say about keeps the module's sentence", () => {
  const overlap = { step: "map", code: "overlap", message: "有 2 組攤位矩形重疊。", target: "1/hall-a" };
  assert.equal(organizerIssueMessage(overlap, catalog, draft), overlap.message);
});
