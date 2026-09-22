import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

/** The organizer workspace as one body of source.
 *
 * These assertions name behaviour, not file boundaries, and #224 split the
 * workspace across several files. Reading the directory keeps them pointed at
 * the behaviour: a `doesNotMatch` now covers every panel rather than whichever
 * file the code used to live in, and the next split does not silently drop an
 * assertion by moving the line it matched.
 *
 * Browser-covered entry, navigation and feedback assertions have been removed
 * individually. The remaining guards do not yet have equivalent behavioural
 * coverage; see docs/design/source-assertion-cleanup.md for that boundary.
 */
async function organizerSource() {
  const directory = new URL("../app/organizer/", import.meta.url);
  const entries = (await readdir(directory)).filter((name) => name.endsWith(".ts") || name.endsWith(".tsx")).sort();
  const files = await Promise.all(entries.map((name) => readFile(new URL(name, directory), "utf8")));
  return files.join("\n");
}

// portal-organizer-entry opens the built entry and checks noindex; the
// public-artifact test also checks its separate entry chunk. Keep this guard:
// fetching the reader HTML alone does not inspect its client-rendered links.
test("the reader does not advertise the organizer workspace", async () => {
  const reader = await readFile(new URL("../app/event-map-app.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(reader, /href=["']\/organizer|前往主辦單位後台/);
});

test("the organizer login form requests its own audience", async () => {
  const app = await organizerSource();
  // The browser journey mints its login link through an API helper, so it
  // does not exercise the audience sent by this form.
  assert.match(app, /requestLoginLink\([^\n]+"organizer"\)/);
});

test("venue authoring uses human selections, immediate creation, and no-division guidance", async () => {
  const app = await organizerSource();
  assert.match(app, /找不到空間？立即新增/);
  assert.match(app, /無分區/);
  // #225: ALL is a stored value; the organizer never needs to know it exists.
  assert.doesNotMatch(app, /（ALL）|使用 ALL|套用 ALL/);
  assert.match(app, /尚未儲存/);
  assert.match(app, /onDraftStateChange=.*setLiveDraft/);
  assert.match(app, /liveSection=\{activeLiveSection\}/);
  assert.match(app, /需先儲存/);
  assert.match(app, /organizerIssueMessage/);
  assert.doesNotMatch(app, /<label>場館 ID|<label>場館空間 ID|placeholder="taipei-expo"|placeholder="expo-dome"/);
  // The row's remove button starts level with the selects it removes.
  const venueCss = await readFile(new URL("../app/organizer/organizer.module.css", import.meta.url), "utf8");
  assert.match(venueCss, /\.venueCard > \.dangerText \{ margin-top: 22px; \}/);
});

test("organizer ships the ADR-0047 guided station, binder readiness, and the shared light design language", async () => {
  const [app, client, css] = await Promise.all([
    organizerSource(),
    readFile(new URL("../app/organizer-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/organizer/organizer.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(app, /identity_source:/);
  assert.match(app, /onClick=\{onShowAll\}/);
  assert.match(app, /已完成 \{completed\}\/3/);
  assert.match(app, /function ReadinessRail/);
  assert.match(app, /readiness\.completed/);
  assert.match(app, />放棄</);
  assert.doesNotMatch(app, /window\.confirm/);
  assert.match(client, /workspace\/complete-onboarding/);
  assert.match(client, /saveOrganizerWorkspacePreference/);
  assert.match(css, /--paper:\s*#f8f7f2/);
  assert.match(css, /--ink:\s*#202a35/);
  assert.match(css, /color-scheme:\s*light/);
  assert.doesNotMatch(css, /color-scheme:\s*dark|gradient\(/);
  // A row of labelled fields lines its buttons up with the controls.
  const referencePanel = await readFile(new URL("../app/organizer/organizer-reference-panel.tsx", import.meta.url), "utf8");
  assert.match(css, /\.fieldRow \{ align-items: end; \}/);
  assert.match(referencePanel, /\$\{styles\.row\} \$\{styles\.fieldRow\}/);
});

test("a successful draft save synchronizes its revision before follow-up navigation", async () => {
  const app = await organizerSource();
  const saveStart = app.indexOf("result = await saveOrganizerEvent");
  const versionSynced = app.indexOf("setExpectedVersion(result.version)", saveStart);
  const detailReloaded = app.indexOf("await onChanged()", versionSynced);
  const followUp = app.indexOf("if (after) await after(result.version)", detailReloaded);

  assert.ok(saveStart >= 0, "draft save call is missing");
  assert.ok(versionSynced > saveStart, "saved revision is not synchronized locally");
  assert.ok(detailReloaded > versionSynced, "detail reload must follow local revision synchronization");
  assert.ok(followUp > detailReloaded, "onboarding or navigation callback must run after reload");
});

test("organizer save counters stay internal when no revision diff is available", async () => {
  const app = await organizerSource();

  assert.doesNotMatch(app, /目前是第 \{expectedVersion\} 版|版本紀錄|送出第 \{detail\.event\.version\} 版審閱|儲存為第 \$\{selected\.mapRevision \+ 1\} 版/);
});

test("organizer reuses the event source for imports and labels every activity-day field", async () => {
  const app = await organizerSource();

  assert.doesNotMatch(app, /<label>來源說明<input/);
  assert.match(app, /const sourceLabel = detail\.draft\.officialSource\.label;/);
  assert.match(app, /sourceDescription: sourceLabel/);
  assert.match(app, /<label>代碼<input/);
  assert.match(app, /<label>名稱<input/);
  // #221: the date is labelled by the day it belongs to （第一天）, because that
  // is the question being asked; the id and name it does not ask about moved
  // behind a disclosure and are still labelled there.
  assert.ok(app.includes("天`}日期"), "the date field is labelled by its own day");
  assert.doesNotMatch(app, /<label>日期<input/);
  assert.match(app, />自由編輯<\/text>/);
  assert.doesNotMatch(app, /描摹/);
});

test("an explicit save-and-leave selection is not replaced by list refresh", async () => {
  const app = await organizerSource();
  assert.match(app, /const selectionInitialized = useRef\(false\)/);
  assert.match(app, /selectionInitialized\.current\s*=\s*true/);
  assert.match(app, /current === null \? null/);
  assert.match(app, /onLeave=\{\(\) => \{ setNotice\(IDLE\); setDirty\(false\); setSelectedId\(null\); \}\}/);
});

test("booth import shows a worked example, groups each mapping field, and fixes bad rows in place", async () => {
  const [app, css] = await Promise.all([
    organizerSource(),
    readFile(new URL("../app/organizer/organizer.module.css", import.meta.url), "utf8"),
  ]);

  // An empty panel is replaced by the file this event actually needs.
  // #221 3.3: the sample used to disappear the moment a file was picked, which
  // is exactly when its columns are being matched against the real ones. It is
  // now open before a file and collapsible after, never absent.
  assert.ok(app.includes("{!sheet ? <div className={styles.sample}>"), "the sample opens before a file is chosen");
  assert.ok(app.includes("<summary>查看填寫範例／下載範本</summary>"), "and stays reachable afterwards");
  // Two downloads: a blank sheet to fill in and a worked example to read are
  // different needs.
  assert.match(app, /下載空白 CSV/);
  assert.match(app, /下載填寫範例/);
  assert.match(app, /URL\.createObjectURL/);
  assert.match(app, /buildOrganizerImportSample/);

  // Each mapping field is one group, not two cells of a table.
  assert.match(app, /<fieldset className=\{styles\.mappingField\}>\r?\n\s*<legend>\{label\}<\/legend>/);
  assert.match(app, /<label className=\{styles\.subLabel\}>來源欄位/);
  assert.match(app, /<label className=\{styles\.subLabel\}>固定值/);
  assert.match(css, /\.mappingField \{[^}]*display: block/);
  // Every card in a mapping row starts its title and its value on the same
  // line: the legend is floated instead of straddling the fieldset border, and
  // the read-only card repeats the grouped shape rather than inventing one.
  assert.match(css, /\.mappingField > legend \{[^}]*float: left/);
  assert.match(css, /\.mappingField \.subLabel select[^{]*\{[^}]*font-size: 12px/);
  assert.match(app, /<fieldset className=\{`\$\{styles\.derivedField\} \$\{styles\.mappingField\}`\}>/);
  assert.match(app, /<div className=\{styles\.subLabel\}>固定值<strong>無分區<\/strong><\/div>/);
  // A hint belongs under the control it is about, not in the next grid cell.
  assert.match(app, /<small>支援空白、逗號、頓號、分號與斜線。<\/small>/);
  assert.doesNotMatch(app, /<p>支援空白、逗號、頓號、分號與斜線。<\/p>/);
  assert.match(css, /@media \(max-width: 1230px\)[\s\S]*\.mappingGrid \{ grid-template-columns: repeat\(2/);

  // The activity day is a fixed value set, so it is picked, not typed.
  assert.match(app, /select\("活動日", day, setDay, "活動日代碼", dayOptions\)/);
  assert.doesNotMatch(app, /select\("活動日", day, setDay, "活動日代碼"\)/);
  assert.match(app, /const dayOptions = days\.map/);
  // The area code is a fact of the source file, so it stays free text.
  assert.match(app, /select\("展區", area, setArea, "展區代碼"\)/);
  assert.match(app, /無分區/);

  // A rejected row is visible, correctable and removable rather than absent.
  assert.match(app, /待修正 \{result\.rejected\.length\} 列/);
  assert.match(app, /填好標記的欄位，這一列就會移到可匯入。/);
  assert.match(app, /可匯入 \{result\.rows\.length\} 列/);
  assert.match(app, /已移除 \{excluded\.length\} 列/);
  assert.match(app, /略過全部待修正的列/);
  assert.match(app, />移除<\/button>/);
  assert.match(app, />復原<\/button>/);
  assert.match(app, /清除所有手動修改/);
  assert.match(app, /excludedRows/);

  // Corrections are keyed by source row, so they cannot outlive the file,
  // sheet or header row that gives a row number its meaning.
  assert.match(app, /const forgetPreview = \(\) => \{ setPreviewRequested\(false\); setOverrides\(\{\}\); setExcluded\(\[\]\); \};/);
  assert.equal(app.match(/forgetPreview\(\);/gu).length, 3, "the file, worksheet and header row inputs must each forget the corrections");

  // A row keyed by its booth code would remount its input mid-edit.
  assert.doesNotMatch(app, /key=\{`\$\{row\.sourceRow\}-\$\{row\.boothCode\}`\}/);
});

// #225: each of these failed the Removal Test -- the organizer does not act
// differently for having read them -- and three described things that are not
// true of this workspace at all.
test("the workspace stops saying things the organizer cannot act on", async () => {
  const app = await organizerSource();

  // The import panel's whole guarantee is that the file never leaves the
  // browser, so 尚未上傳 promised the one thing that guarantee rules out.
  assert.doesNotMatch(app, /尚未上傳/);
  assert.match(app, /個工作表。`/);

  // The organizer is never asked to type an identifier, so saying they need
  // not type one introduces the idea in order to dismiss it.
  assert.doesNotMatch(app, /不需自行輸入|內部 ID/);

  // An empty list cannot be opened from, and someone without permission to
  // create activities is waiting for an invitation, not for a button.
  assert.match(app, /還沒有活動/);
  assert.match(app, /收到主辦邀請後，活動會出現在左側。/);

  // 移除 has one documented use, breaking a duplicated booth's tie, so it
  // belongs on the rows an issue names rather than on 170 correct ones.
  assert.ok(app.includes("flagged.has(row.sourceRow)"), "移除 is conditional on the row being named by an issue");
});
// #221: behaviour contracts, not copy. Each of these was two things
// contradicting each other on one screen.
test("the workspace carries one navigation, one progress count, and counts only what is stored", async () => {
  const app = await organizerSource();

  // One navigation. The numbered strip above the panel repeated every section,
  // state and next step the rail already had, kept in step by hand.
  assert.ok(!app.includes("className={styles.steps}"), "the numbered strip is gone");

  // The guided station stands alone: a six-section rail beside three basic
  // settings answers work nobody has reached, in a second progress vocabulary.
  assert.ok(app.includes("{guided ? <div className={styles.guidedOnly}>"), "no rail beside the guided station");

  // N/3 counts what is stored. Typing a valid value is not a finished step,
  // and the list below already says 尚未儲存 for the one being edited.
  assert.ok(app.includes("organizerGuidedDraftIssues(detail.draft, item, detail.venueCatalog)"), "progress reads the saved draft");
  // The rail still reads the live draft, but for a different question: what is
  // outstanding right now, unsaved edits included. That is not progress.
  assert.ok(app.includes("liveDraft && liveDirty ? organizerGuidedDraftIssues"), "outstanding items still follow the screen");

  // 儲存並繼續 checks the task it stands on and refuses to advance; 儲存並離開
  // and the leave dialog pass through, because a half-finished draft is a
  // legitimate thing to store and come back to.
  assert.ok(app.includes("void save(onSaved, true)"), "the primary save requires the task");
  assert.ok(app.includes("void save(onSecondarySaved)"), "leaving does not");

  // Re-importing replaces the stored list, so the preview says so before it
  // is confirmed rather than behind another dialog.
  assert.match(app, /這次匯入會取代目前已儲存的/);
});
// #221 4.4／4.5 與 Phase 5: the rail reports what is wrong, and every empty
// state names a job rather than a condition.
test("the rail reports problems, not unstarted work, and empty states name an action", async () => {
  const app = await organizerSource();

  // A section nobody has started is neutral; the complete list of blocking
  // issues belongs to 檢查與預覽, where it is asked for.
  assert.ok(app.includes('section.state === "needs_attention"'), "the rail filters to sections with a problem");
  assert.match(app, /還沒開始的工作看上面的下一步/);

  // A map with no booth list to draw against sends the reader to the section
  // that has the only useful action.
  assert.ok(app.includes('onSection("import")'), "the map prerequisite is a button, not a sentence");
  assert.match(app, /才知道這張地圖要畫哪些攤位/);

  // 檢查與預覽 says which of the three situations the reader is in.
  assert.match(app, /這一版已通過檢查/);
  assert.match(app, /這一版還沒檢查/);
  assert.match(app, /尚未加入攤位名單/);
});
// #298: 場館／使用空間／展區 are near-synonyms in everyday Chinese, and the
// glossary that tells them apart is written for developers. The explanation
// uses published events rather than a drawing: no asset to maintain, and the
// reader recognises them.
test("the three venue layers are explained by real published events", async () => {
  const app = await organizerSource();

  // The load-bearing pair: the same hall with two different answers. A single
  // example teaches the shape but not that 展區 belongs to the event.
  assert.match(app, /花博公園爭艷館/);
  assert.match(app, /三重綜合體育館/);

  // The mistake this exists to prevent, said outright.
  assert.match(app, /，不是展區。/);

});
