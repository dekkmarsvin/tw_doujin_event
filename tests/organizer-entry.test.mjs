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
 * They remain source-level assertions, which #205 is where they get replaced
 * by browser journeys; this only stops them rotting in the meantime.
 */
async function organizerSource() {
  const directory = new URL("../app/organizer/", import.meta.url);
  const entries = (await readdir(directory)).filter((name) => name.endsWith(".ts") || name.endsWith(".tsx")).sort();
  const files = await Promise.all(entries.map((name) => readFile(new URL(name, directory), "utf8")));
  return files.join("\n");
}

test("organizer authoring ships as an unlinked, noindex Pages entry", async () => {
  const [config, html, reader, organizerMain] = await Promise.all([
    readFile(new URL("../vite.pages.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../organizer.html", import.meta.url), "utf8"),
    readFile(new URL("../app/event-map-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../organizer-main.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(config, /organizer:\s*resolve\([^\n]+"organizer\.html"\)/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(html, /src="\/organizer-main\.tsx"/);
  assert.doesNotMatch(reader, /href=["']\/organizer|前往主辦單位後台/);
  assert.match(organizerMain, /OrganizerApp/);
});

test("organizer login uses its audience and narrow screens never mount authoring controls", async () => {
  const [app, client] = await Promise.all([
    organizerSource(),
    readFile(new URL("../app/organizer-client.ts", import.meta.url), "utf8"),
  ]);

  assert.match(app, /requestLoginLink\([^\n]+"organizer"\)/);
  assert.match(app, /請改用桌機/);
  assert.match(app, /matchMedia\("\(min-width: 1040px\)"\)/);
  assert.match(app, /isDesktop\s*\?\s*<OrganizerWorkspace/);
  assert.match(client, /\/api\/organizer\/events/);
});

test("venue authoring uses human selections, immediate creation, and no-division guidance", async () => {
  const app = await organizerSource();
  assert.match(app, /場館與使用空間/);
  assert.match(app, /建立新場館/);
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

  assert.match(app, /function GuidedTaskStation/);
  assert.match(app, /identity_source:/);
  assert.match(app, /onClick=\{onShowAll\}/);
  assert.match(app, /已完成 \{completed\}\/3/);
  assert.match(app, /function ReadinessRail/);
  assert.match(app, /readiness\.completed/);
  assert.match(app, /儲存並切換/);
  assert.match(app, />放棄</);
  assert.match(app, />取消</);
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
  // The confirmation itself, not the call that produces it: #220 moved this
  // result out of the shared notice and next to the button that earned it.
  assert.match(app, /"已儲存。"/);
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
  assert.match(app, /onLeave=\{\(\) => \{ setDirty\(false\); setSelectedId\(null\); \}\}/);
});

test("booth import shows a worked example, groups each mapping field, and fixes bad rows in place", async () => {
  const [app, css] = await Promise.all([
    organizerSource(),
    readFile(new URL("../app/organizer/organizer.module.css", import.meta.url), "utf8"),
  ]);

  // An empty panel is replaced by the file this event actually needs.
  assert.match(app, /\{!sheet && <div className=\{styles\.sample\}>/);
  assert.match(app, /下載範例 CSV/);
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