import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Remaining source-level media guards. browser/reader-thumbnails.mjs now
 * measures the result card's column count with and without a picture; it does
 * not yet prove every empty-container and geometry condition below. See
 * the assertion-level mapping kept with PR #344:
 * https://github.com/dekkmarsvin/tw_doujin_event/blob/4704e27ebd0ff88a6680356204b4306cf5314af8/docs/design/source-assertion-cleanup.md
 *
 * What it guards is specific. ADR-0012 retired the reviewed thumbnail index, so
 * the common case flipped: a circle with a picture used to be ordinary and is
 * now rare. Every media block therefore has to be conditional on the picture
 * existing. A block rendered unconditionally would have been invisible before —
 * 262 circles filled it — and would now leave an empty frame on almost every
 * card, every detail panel and every booth on the map.
 *
 * The three information densities are one circle record shown at three sizes
 * (PRODUCT principle 6), so each one is checked separately: they degrade in
 * different layouts and a fix to one does not carry to the others.
 */

const source = async (path) => readFile(new URL(`../app/${path}`, import.meta.url), "utf8");

test("a pictureless result card does not mount an empty media element", async () => {
  const panels = await source("event-workspace-panels.tsx");

  // Counting rendered grid columns does not prove an empty bordered span is
  // absent. Keep this guard until that distinct condition is observed too.
  assert.match(panels, /\{mediaCount > 0 && thumbnail && <span className=\{styles\.resultMedia\}>/);
});

test("the detail panel drops the gallery column instead of leaving it empty", async () => {
  const panels = await source("event-workspace-panels.tsx");

  // The gallery returns null on an empty list, so both densities that mount it
  // — full details and the compact map sidebar — render nothing at all.
  assert.match(panels, /const activeMedia = media\[Math\.min\(activeIndex, media\.length - 1\)\];\s*\r?\n\s*if \(!activeMedia\) return null;/);
  assert.match(panels, /record\.circle\.media\.length > 0 \? styles\.detailsWithMedia : ""/);

  // Without media the body is a single centred column rather than a widowed
  // half of a two-column grid.
  const css = await source("event-workspace-panels.module.css");
  assert.match(css, /\.fullDetails\.detailsWithMedia \{ display:grid;/);
  assert.match(css, /\.fullDetails:not\(\.detailsWithMedia\)>\.detailBody \{/);
});

test("the detail panel splits on the space it is in, not the window", async () => {
  // The portal's preview column is ~400px wide at every viewport size, so the
  // 660px two-column minimum pushed the body column outside the clipped frame
  // as soon as a circle uploaded a picture. The viewport media query cannot see
  // that; the container query can.
  const css = await source("event-workspace-panels.module.css");
  assert.match(css, /@container [(]max-width:700px[)] [{][\s\S]*?[.]fullDetails,[.]fullDetails[.]detailsWithMedia [{] height:auto; display:block; [}]/);

  const portal = await readFile(new URL("../app/circle-portal/portal.module.css", import.meta.url), "utf8");
  assert.match(portal, /\.previewFrame \{[^}]*container-type: inline-size;/);
});

test("a tall picture stays inside the side panel's picture band", async () => {
  // A grid item's automatic minimum size is its min-content height, so a
  // portrait upload out-voted the gallery's own height and spilled over the
  // 16:8 band — cropped, in the density where the picture is smallest.
  const css = await source("event-workspace-panels.module.css");
  assert.match(css, /[.]galleryOpen img,[.]galleryFrame>img [{] width:100%; height:100%; min-height:0;/);
});

test("no reader-facing copy still promises the retired thumbnail index", async () => {
  for (const path of ["display-filter-controls.tsx", "event-workspace-panels.tsx"]) {
    assert.doesNotMatch(await source(path), /縮圖索引/, `${path} still advertises the retired index`);
  }
});
