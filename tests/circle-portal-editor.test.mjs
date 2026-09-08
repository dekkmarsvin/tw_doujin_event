import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Source-level invariants for the circle editor, in the same spirit as
 * `tests/circle-media-degradation.test.mjs`: the repo has no DOM harness, so
 * "the buttons came back as 38px blocks" and "the draft was never written"
 * cannot be observed directly.
 *
 * Each case below is a regression that shipped once in this file's own
 * history. They share a shape — a change that looks local, made somewhere the
 * consequence is invisible: one selector that quietly outranks four others,
 * one guard that reads a value from an unrelated request.
 */

const source = async (path) => readFile(new URL(`../app/circle-portal/${path}`, import.meta.url), "utf8");

test("the card's block-button rule stays weaker than the variants below it", async () => {
  const css = await source("portal.module.css");

  // `.card button:not(.previewFrame *)` is (0,2,1): `:not()` costs whatever its
  // argument costs. That outranks `.fieldMode button` and `.extraValues button`
  // at (0,1,1), which have nothing but source order on their side, so every
  // compact control in the editor reverted to the 38px dark block.
  assert.doesNotMatch(css, /:not\(\.previewFrame \*\)/);
  for (const rule of [
    /\.card button:not\(:where\(\.previewFrame \*, \.inlineButton\)\) \{/,
    /\.card button:not\(:where\(\.previewFrame \*, \.inlineButton\)\):hover/,
    /\.card button:not\(:where\(\.previewFrame \*, \.inlineButton\)\):focus-visible/,
    /\.card button:not\(:where\(\.previewFrame \*, \.inlineButton\)\):disabled/,
  ]) {
    assert.match(css, rule);
  }

  // The variants have to keep coming after the base rule: at equal specificity
  // the later one wins, and moving either would undo the line above.
  const base = css.indexOf(".card button:not(");
  for (const variant of [".fieldMode button {", ".extraValues button {"]) {
    assert.ok(css.indexOf(variant) > base, `${variant} must follow the base button rule`);
  }
});

test("the audit list keeps its own layout instead of the chip row's", async () => {
  const css = await source("portal.module.css");

  // `.extraValues` was added by appending it to `.auditList`'s selector list,
  // which handed the audit list a flex row: the map contribution history lost
  // its indent, its 10px type and its one-item-per-line reading order.
  assert.match(css, /\.auditList \{ display: grid; gap: 6px; margin: 10px 0 0; padding-left: 20px; font-size: 10px;/);
  assert.match(css, /^\.extraValues \{ display: flex;/m);
});

test("the draft is kept as soon as the record loads, not when the preview answers", async () => {
  const app = await source("portal-app.tsx");

  // `previewOverride` is a second request whose failure is swallowed on
  // purpose — the editor works without a preview. Gating the draft write on
  // its result made one failed preview silently disable the whole autosave.
  assert.match(app, /if \(!hydrated\) return;\s*\r?\n\s*if \(!draftDiffersFromSaved\) forgetStoredDraft/);
  const effect = app.slice(app.indexOf("if (!hydrated) return;"));
  const deps = effect.slice(effect.indexOf("}, ["), effect.indexOf("]);") + 3);
  assert.doesNotMatch(deps, /baseRecords/);

  // And only when the record actually arrived. Hydrating on the failure path
  // leaves `savedFields` empty, every comparison then reads as "same as the
  // server", and the next render deletes the draft the author still has.
  assert.equal(app.match(/setHydrated\(true\)/g)?.length, 1);
  assert.match(app, /\.catch\(\(\) => setFields\(\{\}\)\);/);
});

test("the post-event question is two outcomes, and staying public is the default", async () => {
  const app = await source("portal-app.tsx");

  // The options name what the circle decides, not the mechanism underneath, and
  // `hidden` starts false so the answer that changes nothing is preselected.
  assert.match(app, /\{ value: false, title: "繼續公開" \}, \{ value: true, title: "不再公開" \}/);
  assert.match(app, /const \[hidden, setHidden\] = useState\(false\);/);
  assert.match(app, /checked=\{hidden === option\.value\}/);

  // A failed write puts the radio back rather than leaving the page claiming a
  // decision the server never took.
  assert.match(app, /\.catch\(\(error: unknown\) => \{ setHidden\(!option\.value\);/);

  // The retention question is gone from the editor, so neither the draft nor
  // the save carries an answer to it any more.
  assert.doesNotMatch(app, /CircleRetentionChoice/);
  assert.match(app, /writeStoredDraft\(claim\.circleId, \{ fields, listInputs, stagedThumbnailKey, savedAt:/);
});

test("field state is described by what shows, not by inherit/replace/clear", async () => {
  const app = await source("portal-app.tsx");

  // inherit/replace/clear stay in the contract, the code and D1; the editor
  // says what a reader would see instead (#197). The state text carries its own
  // 「目前」, so the row no longer prefixes one.
  assert.match(app, /const FIELD_MODE_LABEL = \{ inherit: "目前顯示場刊資料", replace: "目前顯示你填寫的內容", clear: "目前不顯示" \}/);
  assert.match(app, /inheritAction = "使用場刊資料"/);
  assert.match(app, /onClick=\{onClear\}>不顯示<\/button>/);
  assert.doesNotMatch(app, /目前：<b>/);
  for (const modelWord of [/沿用場刊/, /社團自填/, /清除此欄/, /補充資料/]) {
    assert.doesNotMatch(app.slice(0, app.indexOf("function AdminPanel")), modelWord);
  }
});

test("deleting is collapsed, and its button says the same words as the summary", async () => {
  const app = await source("portal-app.tsx");

  // One irreversible action, reached on purpose: `<details>` keeps it closed
  // until asked for, while staying findable by the browser's own page search.
  assert.match(app, /\{saved && <details className=\{styles\.danger\}>/);
  assert.match(app, /<summary>刪除資料<\/summary>/);
  assert.doesNotMatch(app, /<details className=\{styles\.danger\} open>/);
});

test("the rating field is a checkbox group, because a circle can sell both", async () => {
  const app = await source("portal-app.tsx");

  // `ageRatings` describes what is on the table, and "全年齡 and R18" is an
  // ordinary answer. A single-select does not merely narrow the form: picking
  // one value replaces the array, so the next edit deletes the other value
  // silently (ADR-0051 decision 1, #193).
  assert.match(app, /const MULTI_CHOICE_FIELD_KEYS = \["creatorTypes", "ageRatings"\] as const/);
  assert.match(app, /if \(isMultiChoiceField\(key\)\) return <fieldset className=\{styles\.choiceGroup\}>/);

  // The single-select branch replaces the whole array, so nothing that can hold
  // more than one true value may fall through to it.
  const single = app.slice(app.indexOf("if (key in CHOICE_FIELD_OPTIONS)"));
  assert.match(single, /setChoice\(choiceKey, event\.target\.value\)/);
  assert.match(app, /const setChoice = \(key: ChoiceFieldKey, value: string\) => setFields\(\(current\) => \(\{ \.\.\.current, \[key\]: value \? \[value\] : \[\] \}\)\);/);
});

test("the age rating group carries no explanation beyond its own checkboxes", async () => {
  const app = await source("portal-app.tsx");

  // A checkbox group already says "tick as many as apply"; a paragraph
  // restating it is copy the reader has to get past to reach the options
  // (ADR-0024). The reason the field is multi-valued belongs to the code
  // comment above MULTI_CHOICE_FIELD_KEYS, which is where it now lives.
  assert.doesNotMatch(app, /MULTI_CHOICE_HINT/);
  assert.doesNotMatch(app, /不是一個社團只能有一種分級/);
});

test("only a load the reader asked for moves the refresh button", async () => {
  const app = await source("portal-app.tsx");

  // The queue polls every 30 seconds and on every return to the tab. Those
  // used to run the same `refresh` the button ran, so the label flipped to
  // 「更新中…」 twice a minute on its own: motion on a control nobody pressed,
  // reporting nothing that could be acted on.
  assert.match(app, /const refresh = useCallback\(\(announce: boolean\) => \{/);
  assert.match(app, /if \(announce\) setLoading\(true\);/);
  assert.match(app, /if \(document\.visibilityState === "visible"\) refresh\(false\);/);
  assert.match(app, /window\.setTimeout\(\(\) => refresh\(true\), 0\)/);
  assert.match(app, /onClick=\{\(\) => refresh\(true\)\}/);
  // A decision reloads the queue down the same silent path.
  assert.match(app, /\.then\(\(\) => refresh\(false\)\)/);
});

test("the step-up lock is stated once, above the forms it turns off", async () => {
  const app = await source("portal-app.tsx");
  const stepUp = await source("admin-step-up.tsx");
  const mapPanel = await source("map-contribution-panel.tsx");
  const client = await readFile(new URL("../app/circle-editor-client.ts", import.meta.url), "utf8");

  // Admin writes are refused once the session passes the 24 hour step-up
  // window. That refusal used to land in a status line at the foot of the
  // panel, several controls below whatever produced it. One session state
  // locks every form in the panel, so it is said once at the top, with the
  // sign-in that clears it — repeating it under each form would be the same
  // sentence four times. Recognised by the server's code, not its wording.
  assert.match(client, /error\.body\?\.code === "admin_session_stale"/);
  assert.match(stepUp, /if \(!adminSessionStale\(error\)\) return false;/);
  assert.match(stepUp, /管理功能被鎖定，需要重新登入。/);

  // The banner is the first thing in each admin card, and there is exactly one
  // of it per card.
  for (const [name, panel] of [["portal-app.tsx", app], ["map-contribution-panel.tsx", mapPanel]]) {
    assert.equal(panel.split("<AdminStepUpBanner />").length - 1, 1, `${name} states the lock once`);
    assert.match(panel, /styles\.admin\}`} id="(admin|map-review)">\r?\n    <AdminStepUpBanner \/>/, `${name} states it first`);
  }

  // Nothing routes a step-up refusal into a form's own line, and every gated
  // control reads the one flag.
  assert.doesNotMatch(app, /AdminStepUpNotice|stepUpHint|stepUpTarget/);
  assert.doesNotMatch(mapPanel, /AdminStepUpNotice|stepUpHint|stepUpTarget/);
  assert.ok(app.split("disabled={blocked").length - 1 >= 5, "each gated control reads the lock");

  // Ordinary failures still belong to the form that produced them: an error
  // about 核准 is not an error about 停用帳號.
  for (const state of ["claimStatus", "takedownStatus", "rosterStatus", "disableStatus"]) {
    assert.match(app, new RegExp(`const \\[${state}, set`), `${state} must be its own line`);
  }
});

test("the picture is the only thing the upload asks for", async () => {
  const app = await source("portal-app.tsx");

  // A circle uploading its own artwork has no other page to cite, so neither
  // credit field gates the picker or the save (ADR-0053). Both are still
  // checked when filled: a stated source that is not a URL helps nobody.
  assert.doesNotMatch(app, /請先填寫下面的「圖片出處頁面」/);
  assert.doesNotMatch(app, /代表圖需要填寫出處頁面/);
  assert.doesNotMatch(app, /代表圖需要填寫來源標示/);
  assert.match(app, /圖片出處頁面（選填）/);
  assert.match(app, /來源標示（選填/);
  assert.match(app, /JPEG、PNG、WebP，最大 5 MB/);
  assert.match(app, /thumbnail\?\.sourceUrl\?\.trim\(\) && linkUrlProblem\(thumbnail\.sourceUrl\)/);
});
