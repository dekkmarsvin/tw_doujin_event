// Asserts the built Pages artifact, not the source that produced it: what
// ships, what must never ship with it, and that the two entries stay separate.
//
// Deliberately about `dist/`. A regex over a component's source proves only
// that a string is present in a file, and breaks on a rename that changes no
// behaviour; the bundle is what a reader actually downloads.
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

const assetsIn = (html) => [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);

test("builds the staged application as a Cloudflare Pages SPA", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>場刊 Map｜同人展逛攤地圖<\/title>/i);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /\/assets\/index-[^"']+\.js/);

  const publicAssets = (await readTextAssets(new URL("../dist/", import.meta.url))).join("\n");
  assert.match(publicAssets, /\/data\/events\//);

  // The catalog ships as a fetched snapshot, never inlined into the bundle.
  const bundle = (await readTextAssets(new URL("../dist/assets/", import.meta.url))).join("\n");
  assert.doesNotMatch(bundle, /BASE_BOOTHS|V_W_BOOTHS|FF47_OFFICIAL_NAME_BOOTHS/);
  assert.doesNotMatch(bundle, /"sourceRow":|完整品項與庫存請以現場公告為準/);

  // Measure only what the reader actually loads. The control surfaces are
  // separate entries sharing dist/assets/, so a total would let reader bloat
  // hide behind a shrinking portal — and vice versa.
  const readerAssets = assetsIn(html);
  assert.ok(readerAssets.some((path) => path.endsWith(".js")), "index.html must reference a script");
  const readerBytes = (await Promise.all(readerAssets.map(async (path) =>
    Buffer.byteLength(await readFile(new URL(`../dist${path}`, import.meta.url), "utf8"), "utf8")))).reduce((total, size) => total + size, 0);
  assert.ok(readerBytes < 900_000, `reader bundle grew to ${readerBytes} bytes; keep event data in the catalog snapshot.`);

  const catalog = JSON.parse(await readFile(new URL("../dist/data/events/sample/circles.json", import.meta.url), "utf8"));
  const sourceCatalog = JSON.parse(await readFile(new URL("../fixtures/events/sample/circles.json", import.meta.url), "utf8"));
  assert.equal(catalog.schema, "circle-catalog/3");
  assert.equal(catalog.eventId, "sample");
  assert.deepEqual(catalog.circles, sourceCatalog.circles);
  assert.deepEqual(catalog.placements, sourceCatalog.placements);
  assert.equal(catalog.circles.length, 2);
  for (const retired of ["booths", "templates", "officialSupplementKeys"]) assert.equal(Object.hasOwn(catalog, retired), false);

  const snapshot = JSON.parse(await readFile(new URL("../dist/data/events/sample/map.json", import.meta.url), "utf8"));
  const sourceSnapshot = JSON.parse(await readFile(new URL("../fixtures/events/sample/map.json", import.meta.url), "utf8"));
  assert.equal(snapshot.eventId, "sample");
  assert.ok(Number.isSafeInteger(snapshot.revision) && snapshot.revision > 0);
  assert.equal(snapshot.revision, sourceSnapshot.revision);
  assert.equal(snapshot.layout.rows.reduce((total, row) => total + row.slots.length, 0), 2);
  assert.equal(snapshot.layout.pillars.length, 0);
  assert.equal(snapshot.layout.accessPoints.length, 0);
  assert.equal(snapshot.layout.landmarks.length, 0);

  // The reading path is static (ADR-0008): no advanced-mode Worker entry, no
  // server bundle, no redirect rules in front of the edge.
  await assert.rejects(readFile(new URL("../dist/_worker.js", import.meta.url), "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(new URL("../dist/server/index.js", import.meta.url), "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(new URL("../dist/_redirects", import.meta.url), "utf8"), { code: "ENOENT" });
  assert.match(await readFile(new URL("../dist/404.html", import.meta.url), "utf8"), /找不到這個頁面/);
});

/**
 * The reader must not carry the control surfaces' code, and must still point a
 * circle at theirs.
 *
 * Checks content, not filenames: Rollup names a shared chunk after some module
 * inside it, so a name match proves nothing about what rode along.
 */
test("keeps the reader separate from the control surfaces but linked to them", async () => {
  const dist = (path) => new URL(`../dist/${path}`, import.meta.url);
  const html = await readFile(dist("index.html"), "utf8");
  const readerAssets = assetsIn(html);

  for (const entry of ["circle.html", "organizer.html"]) {
    const entryAssets = assetsIn(await readFile(dist(entry), "utf8"));
    assert.ok(entryAssets.some((path) => !readerAssets.includes(path)), `${entry} must have its own entry chunk`);
  }

  const readerJs = (await Promise.all(readerAssets.filter((path) => path.endsWith(".js"))
    .map((path) => readFile(dist(path.slice(1)), "utf8")))).join("\n");
  assert.doesNotMatch(readerJs, /\/api\/auth\/|\/api\/claims|\/api\/admin\/|\/api\/organizer\//, "the reader must not carry write endpoints");
  assert.doesNotMatch(readerJs, /寄出登入連結|認領社團|__Host-ff47_session/);

  // Entry separation is a code boundary, not concealment: a circle who only
  // ever sees the reader still needs a way in (ADR-0043).
  assert.match(readerJs, /\/circle/, "the reader must link circles to their portal");
});
