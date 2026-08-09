import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the FF47 vector map application", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>FF47 場刊 MAP｜同人展逛攤地圖<\/title>/i);
  assert.match(html, /aria-label="攤位地圖"/);
  assert.match(html, /管理地圖/);
  assert.match(html.replaceAll("<!-- -->", ""), /<b>994<\/b> 個符合條件的社團/);
});

test("separates admin import, server publication, and accessible SVG rendering", async () => {
  const paths = ["event-map-app.tsx", "map-admin-importer.tsx", "map-layout-editor.tsx", "map-recognition.ts", "accessible-event-map-renderer.tsx", "event-map-client.ts", "event-catalog.ts"];
  const [app, admin, editor, recognizer, renderer, client, eventCatalog] = await Promise.all(paths.map((path) => readFile(new URL(`../app/${path}`, import.meta.url), "utf8")));
  const repository = await readFile(new URL("../db/event-maps.ts", import.meta.url), "utf8");
  const repositoryCore = await readFile(new URL("../db/event-map-repository.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/events/[eventId]/map/route.ts", import.meta.url), "utf8");
  assert.match(app, /loadPublishedEventMap\(FF47_EVENT_ID\)/);
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
  assert.match(editor, /onPointerMove=\{moveDrag\}/);
  assert.match(editor, /Shift \+ 方向鍵/);
  assert.match(eventCatalog, /areaMode: "single"/);
  assert.match(app, /showAreaSwitcher && <fieldset/);
  assert.match(app, /data-text-scale=\{textScale\}/);
  assert.match(app, /網頁字體大小/);
  assert.match(recognizer, /slotCount !== 988/);
  assert.match(renderer, /<svg/);
  assert.match(renderer, /aria-label="場內柱子"/);
  assert.match(renderer, /aria-label="出入口"/);
  assert.doesNotMatch(renderer, /<img\b/);
  assert.match(client, /return `\/api\/events\/\$\{encodeURIComponent\(eventId\)\}\/map`/);
  assert.match(repository, /createEventMapRepository/);
  assert.match(repositoryCore, /onConflictDoUpdate/);
  assert.match(repositoryCore, /revision: sql/);
  assert.match(route, /export const GET/);
  assert.match(route, /export const PUT/);
});
