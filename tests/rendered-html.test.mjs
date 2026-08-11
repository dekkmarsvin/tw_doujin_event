import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function readTextAssets(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(entries.map(async (entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return readTextAssets(url);
    if (!/\.(?:css|html|js)$/.test(entry.name)) return [];
    return [await readFile(url, "utf8")];
  }));
  return contents.flat();
}

test("builds the FF47 application as a Cloudflare Pages SPA", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>FF47 場刊 MAP｜同人展逛攤地圖<\/title>/i);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\/assets\/index-[^"']+\.js/);

  const publicAssets = (await readTextAssets(new URL("../dist/", import.meta.url))).join("\n");
  assert.match(publicAssets, /\/data\/events\//);
  assert.doesNotMatch(publicAssets, /\/api\/events\/|發布活動地圖|MapAdminImporter/);

  const snapshot = JSON.parse(await readFile(new URL("../dist/data/events/ff47/map.json", import.meta.url), "utf8"));
  const sourceSnapshot = JSON.parse(await readFile(new URL("../public/data/events/ff47/map.json", import.meta.url), "utf8"));
  assert.equal(snapshot.eventId, "ff47");
  assert.ok(Number.isSafeInteger(snapshot.revision) && snapshot.revision > 0);
  assert.equal(snapshot.revision, sourceSnapshot.revision);
  assert.equal(snapshot.layout.rows.reduce((total, row) => total + row.slots.length, 0), 988);
  assert.equal(snapshot.layout.pillars.length, 28);
  assert.equal(snapshot.layout.accessPoints.length, 5);
  assert.equal(snapshot.layout.landmarks.length, 21);

  await assert.rejects(readFile(new URL("../dist/_worker.js", import.meta.url), "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(new URL("../dist/server/index.js", import.meta.url), "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(new URL("../dist/_redirects", import.meta.url), "utf8"), { code: "ENOENT" });
  assert.match(await readFile(new URL("../dist/404.html", import.meta.url), "utf8"), /找不到這個頁面/);
  assert.match(await readFile(new URL("../dist/fonts/geist.css", import.meta.url), "utf8"), /font-family: "Geist"/);
});

test("separates the public static app from the retained editor implementation", async () => {
  const paths = ["event-map-app.tsx", "editor-page.tsx", "map-admin-importer.tsx", "map-layout-editor.tsx", "map-recognition.ts", "accessible-event-map-renderer.tsx", "static-event-map-client.ts", "event-catalog.ts", "event-workspace-panels.tsx"];
  const [app, editorPage, admin, editor, recognizer, renderer, staticClient, eventCatalog, workspacePanels] = await Promise.all(paths.map((path) => readFile(new URL(`../app/${path}`, import.meta.url), "utf8")));
  const appStyles = await readFile(new URL("../app/event-map-app.module.css", import.meta.url), "utf8");
  const workspaceStyles = await readFile(new URL("../app/event-workspace-panels.module.css", import.meta.url), "utf8");
  const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(app, /loadStaticEventMap\(FF47_EVENT_ID\)/);
  assert.match(app, /<AccessibleEventMapRenderer eventName=\{FF47_EVENT\.name\} layout=\{publishedMap\.layout\}/);
  assert.match(app, /showFullDetail/);
  assert.match(app, /fullDetailsPanel/);
  assert.match(app, /展場模式/);
  assert.match(app, /mapRecords/);
  assert.doesNotMatch(app, /LAYOUT_KEY|imageDataUrl|<img\b/);
  assert.match(admin, /data-testid="map-image-input"/);
  assert.match(admin, /發布活動地圖/);
  assert.match(admin, /<MapLayoutEditor/);
  assert.match(admin, /initialMap/);
  assert.match(editor, /新增企業攤/);
  assert.match(editor, /新增舞台/);
  assert.match(editor, /選取地圖元素/);
  assert.match(editor, /縮小編輯地圖/);
  assert.match(editor, /放大編輯地圖/);
  assert.match(editor, /MAX_EDITOR_ZOOM = 4/);
  assert.match(editor, /data-resize-corner/);
  assert.match(editor, /resizeRectFromCorner/);
  assert.match(editor, /snapRectToAdjacentRects/);
  assert.match(editor, /SNAP_THRESHOLD_PX = 8/);
  assert.match(editor, /event\.altKey/);
  assert.match(editor, /className=\{styles\.snapGuide\}/);
  assert.match(editor, /非一般攤位區可拖曳四角調整大小/);
  assert.doesNotMatch(editor, /selectedLandmarkKind !== "other"/);
  assert.match(editor, /區域類型/);
  assert.match(admin, /scaleMapLandmarks/);
  assert.match(editor, /onPointerMove=\{moveDrag\}/);
  assert.match(editor, /Shift \+ 方向鍵/);
  assert.match(eventCatalog, /areaMode: "single"/);
  assert.match(app, /showAreaSwitcher && <fieldset/);
  assert.match(app, /data-text-scale=\{textScale\}/);
  assert.match(app, /網頁字體大小/);
  assert.doesNotMatch(app, /MapAdminImporter|publicationNotice|showAdmin|管理活動地圖|開啟管理地圖/);
  assert.match(editorPage, /loadPublishedEventMap\(FF47_EVENT_ID\)/);
  assert.match(editorPage, /<MapAdminImporter/);
  assert.doesNotMatch(app, /className=\{styles\.mapMeta\}/);
  assert.doesNotMatch(app, /publishedMap && <div className=\{styles\.layoutStatus\}/);
  assert.match(appStyles, /\.topbarActions :global\(\.help\) \{ display:block; \}/);
  assert.match(workspacePanels, /function CircleMediaGallery/);
  assert.match(workspacePanels, /record\.circle\.media/);
  assert.match(workspacePanels, /styles\.placementMeta/);
  assert.match(workspacePanels, /aria-label="圖片幻燈片控制"/);
  assert.doesNotMatch(workspacePanels, /heroCopy|heroMediaHint|heroWithMedia/);
  assert.match(workspaceStyles, /\.fullDetails\.detailsWithMedia \{ display:grid; grid-template-columns:/);
  assert.match(workspaceStyles, /\.fullDetails,\.fullDetails\.detailsWithMedia \{ height:auto; display:block; \}/);
  assert.match(recognizer, /slotCount !== 988/);
  assert.match(renderer, /<svg/);
  assert.match(renderer, /aria-label="場內柱子"/);
  assert.match(renderer, /aria-label="出入口"/);
  assert.doesNotMatch(renderer, /<img\b/);
  assert.match(staticClient, /`\/data\/events\/\$\{encodeURIComponent\(eventId\)\}\/map\.json`/);
  assert.doesNotMatch(staticClient, /force-cache/);
  assert.doesNotMatch(staticClient, /\/api\/|method: "PUT"/);
  assert.match(wrangler, /"pages_build_output_dir": "\.\/dist"/);
  assert.doesNotMatch(wrangler, /d1_databases|r2_buckets|main/);
});
