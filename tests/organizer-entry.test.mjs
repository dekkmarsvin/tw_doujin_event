import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
    readFile(new URL("../app/organizer/organizer-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/organizer-client.ts", import.meta.url), "utf8"),
  ]);

  assert.match(app, /requestLoginLink\([^\n]+"organizer"\)/);
  assert.match(app, /請改用桌機/);
  assert.match(app, /matchMedia\("\(min-width: 1040px\)"\)/);
  assert.match(app, /isDesktop\s*\?\s*<OrganizerWorkspace/);
  assert.match(client, /\/api\/organizer\/events/);
});

test("venue authoring uses human selections, immediate creation, and no-division guidance", async () => {
  const app = await readFile(new URL("../app/organizer/organizer-app.tsx", import.meta.url), "utf8");
  assert.match(app, /場館與使用空間/);
  assert.match(app, /建立新場館/);
  assert.match(app, /找不到空間？立即新增/);
  assert.match(app, /無分區（ALL）/);
  assert.match(app, /尚未儲存/);
  assert.match(app, /onDraftStateChange=.*setLiveDraft/);
  assert.match(app, /liveSection=\{activeLiveSection\}/);
  assert.match(app, /需先儲存/);
  assert.match(app, /organizerIssueMessage/);
  assert.doesNotMatch(app, /<label>場館 ID|<label>場館空間 ID|placeholder="taipei-expo"|placeholder="expo-dome"/);
});

test("organizer ships the ADR-0047 guided station, binder readiness, and the shared light design language", async () => {
  const [app, client, css] = await Promise.all([
    readFile(new URL("../app/organizer/organizer-app.tsx", import.meta.url), "utf8"),
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
});

test("a successful draft save synchronizes its revision before follow-up navigation", async () => {
  const app = await readFile(new URL("../app/organizer/organizer-app.tsx", import.meta.url), "utf8");
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
  const app = await readFile(new URL("../app/organizer/organizer-app.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(app, /目前是第 \{expectedVersion\} 版|版本紀錄|送出第 \{detail\.event\.version\} 版審閱|儲存為第 \$\{selected\.mapRevision \+ 1\} 版/);
  assert.match(app, /setNotice\(\{ kind: "ok", message: "已儲存。" \}\)/);
});

test("organizer reuses the event source for imports and labels every activity-day field", async () => {
  const app = await readFile(new URL("../app/organizer/organizer-app.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(app, /<label>來源說明<input/);
  assert.match(app, /const sourceLabel = detail\.draft\.officialSource\.label;/);
  assert.match(app, /sourceDescription: sourceLabel/);
  assert.match(app, /<label>代碼<input/);
  assert.match(app, /<label>名稱<input/);
  assert.match(app, /<label>日期<input/);
  assert.match(app, />自由編輯<\/text>/);
  assert.doesNotMatch(app, /描摹/);
});

test("an explicit save-and-leave selection is not replaced by list refresh", async () => {
  const app = await readFile(new URL("../app/organizer/organizer-app.tsx", import.meta.url), "utf8");
  assert.match(app, /const selectionInitialized = useRef\(false\)/);
  assert.match(app, /selectionInitialized\.current\s*=\s*true/);
  assert.match(app, /current === null \? null/);
  assert.match(app, /onLeave=\{\(\) => \{ setDirty\(false\); setSelectedId\(null\); \}\}/);
});

test("booth import shows a worked example, groups each mapping field, and fixes bad rows in place", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("../app/organizer/organizer-app.tsx", import.meta.url), "utf8"),
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
  assert.match(css, /@media \(max-width: 1230px\)[\s\S]*\.mappingGrid \{ grid-template-columns: repeat\(2/);

  // The activity day is a fixed value set, so it is picked, not typed.
  assert.match(app, /select\("活動日", day, setDay, "活動日代碼", dayOptions\)/);
  assert.doesNotMatch(app, /select\("活動日", day, setDay, "活動日代碼"\)/);
  assert.match(app, /const dayOptions = days\.map/);
  // The area code is a fact of the source file, so it stays free text.
  assert.match(app, /select\("展區", area, setArea, "展區代碼"\)/);
  assert.match(app, /無分區（ALL）/);

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
