import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildPrivacyPage, lastUpdatedFrom, renderInline } from "../scripts/build-privacy-page.mjs";

const markdown = await readFile(new URL("../docs/policy/privacy-notice.md", import.meta.url), "utf8");
const page = buildPrivacyPage(markdown);

function textOf(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

/** The same line with its Markdown markers removed — what a reader should see. */
function plainText(line) {
  return line
    .replace(/^\s*#{1,3} /, "")
    .replace(/^> /, "")
    .replace(/^\s*- /, "")
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
    .replace(/<(https?:\/\/[^\s>]+)>/g, "$1")
    .replace(/[`*]/g, "")
    .trim();
}

test("publishes every line of the notice, so nothing can be dropped in translation", () => {
  const rendered = textOf(page);
  const skipped = /^(\s*)$|^---+$|^\|[\s|:-]+\|$/;

  for (const line of markdown.split("\n")) {
    if (skipped.test(line.trim())) continue;

    // Table rows are checked cell by cell: a row rendered into the wrong number
    // of cells still contains the same characters end to end.
    const fragments = line.startsWith("|")
      ? line.replace(/^\||\|$/g, "").split("|").map((cell) => plainText(cell))
      : [plainText(line)];

    for (const fragment of fragments) {
      if (!fragment) continue;
      assert.ok(
        rendered.includes(fragment),
        `the published page is missing text from the notice: ${JSON.stringify(fragment)}`,
      );
    }
  }
});

test("states the date the notice itself states", () => {
  assert.match(page, new RegExp(`最後更新日期：${lastUpdatedFrom(markdown)}`));
  assert.doesNotMatch(page, /最後更新：/);
});

test("carries both contact mailboxes, since the notice is where they reach a person", () => {
  // ADR-0019 splits the two windows and requires the addresses to be somewhere
  // a user can see, not only in the repo.
  assert.ok(page.includes("maintain@kotoban.top"));
  assert.ok(page.includes("circle@kotoban.top"));
});

test("uses minimum-necessary disclosure without defensive disclaimers or build provenance", () => {
  for (const phrase of [
    "未經法律專業人士審閱",
    "非正式法律意見",
    "無法保證絕對的資安防護水準",
    "IP 暴露",
    "docs/policy/privacy-notice.md 於建置時產生",
    "本站不會以任何方式暗示",
    "保留操作紀錄的理由是",
  ]) {
    assert.ok(!page.includes(phrase), `the published notice must not include ${JSON.stringify(phrase)}`);
  }
});

test("claims no research-use exception, because no terms grant one", () => {
  // Removed in #11 and not to reappear in any user-facing surface until there
  // are terms behind it (#30).
  assert.doesNotMatch(page, /研究用途|學術/);
});

test("is a static document: no script, no bundle, nothing to execute", () => {
  // The public reading path is static (ADR-0008) and the overlay owns the free
  // plan's Function budget (#48), so this page must cost neither.
  assert.doesNotMatch(page, /<script/i);
  assert.doesNotMatch(page, /\/assets\//);
});

test("rewrites repo-relative links to somewhere that resolves on the web", () => {
  const rendered = renderInline("見 [ADR-0015](../adr/0015-access-lifts-when-no-third-party-bytes-remain.md)。");
  assert.match(rendered, /href="https:\/\/github\.com\/dekkmarsvin\/tw_doujin_event\/blob\/main\/docs\/adr\/0015-/);
  assert.doesNotMatch(page, /href="\.\.\//, "a relative repo path is a broken link once published");
});

test("renders the constructs the notice uses, and marks up rather than swallows them", () => {
  assert.equal(renderInline("`/circle` 與 **粗體**"), "<code>/circle</code> 與 <strong>粗體</strong>");
  // A code span must not be reinterpreted after the fact — the failure mode of
  // a placeholder round-trip is text that survives with its markup lost.
  assert.equal(renderInline("`**not bold**`"), "<code>**not bold**</code>");
  assert.equal(renderInline("<script>"), "&lt;script&gt;");
  assert.ok(page.includes("<table>"), "the retention tables have to render as tables");
});
