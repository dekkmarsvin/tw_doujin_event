import assert from "node:assert/strict";
import test, { after } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const { OrganizerValidationIssueCard } = await vite.environments.ssr.runner.import("/app/organizer/organizer-app.tsx");
after(() => vite.close());

const detail = {
  draft: { event: { days: [{ id: "1", label: "第一日" }] } },
  venueCatalog: { venues: [{ name: "展覽館", spaces: [{ id: "hall", name: "一樓" }] }] },
  import: {
    source: { fileName: "主辦.xlsx", worksheet: "攤位清單" },
    rows: [
      { dayId: "1", venueSpaceId: "hall", codes: ["A01", "A02"], circleName: "當日社團", sourceRow: 9 },
      { dayId: "2", venueSpaceId: "hall", codes: ["A01", "A02"], circleName: "其他日期社團", sourceRow: 20 },
      { dayId: "1", venueSpaceId: "other", codes: ["A01", "A02"], circleName: "其他空間社團", sourceRow: 30 },
    ],
  },
};
const render = (issue) => renderToStaticMarkup(React.createElement(OrganizerValidationIssueCard, { issue, detail }));

test("missing booths identify the map, source and scoped source row", () => {
  const html = render({ step: "map", code: "missing_booth", severity: "error", target: "1/hall", boothCodes: ["A02"], message: "legacy" });
  for (const text of ["必須修正", "第一日", "展覽館", "一樓", "主辦.xlsx", "攤位清單", "共 1 筆", "A02", "當日社團", "來源第 9 列", "A1 與 A01", "重新執行檢查"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /其他日期社團|其他空間社團|legacy|period/);
});

test("all unknown codes remain inspectable and unallocated booths are explicitly permitted", () => {
  const boothCodes = Array.from({ length: 50 }, (_, i) => `B${String(i + 1).padStart(2, "0")}`);
  const html = render({ step: "map", code: "unknown_booth", severity: "warning", target: "1/hall", boothCodes, message: "legacy" });
  for (const code of boothCodes) assert.ok(html.includes(`<code>${code}</code>`));
  assert.match(html, /查看全部 50 個/);
  assert.match(html, /不影響送審/);
  assert.match(html, /建議確認/);
});

test("import missing_booth retains its own message instead of map repair advice", () => {
  const html = render({ step: "import", code: "missing_booth", severity: "error", message: "第 2 列缺少攤位代碼。" });
  assert.match(html, /第 2 列缺少攤位代碼/);
  assert.doesNotMatch(html, /比對來源|漏畫/);
});
