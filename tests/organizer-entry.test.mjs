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

test("organizer ships the ADR-0047 guided station, binder readiness, and the shared light design language", async () => {
  const [app, client, css] = await Promise.all([
    readFile(new URL("../app/organizer/organizer-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/organizer-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/organizer/organizer.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(app, /引導式任務站/);
  assert.match(app, /活動識別與來源/);
  assert.match(app, /查看全部任務/);
  assert.match(app, /已完成 \{completed\}\/3/);
  assert.match(app, /建置狀態/);
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

test("an explicit save-and-leave selection is not replaced by list refresh", async () => {
  const app = await readFile(new URL("../app/organizer/organizer-app.tsx", import.meta.url), "utf8");
  assert.match(app, /const selectionInitialized = useRef\(false\)/);
  assert.match(app, /selectionInitialized\.current\s*=\s*true/);
  assert.match(app, /current === null \? null/);
  assert.match(app, /onLeave=\{\(\) => \{ setDirty\(false\); setSelectedId\(null\); \}\}/);
});
