import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * A source-level invariant, in the same spirit as `tests/modal-focus.test.mjs`
 * and for the same reason: the repo has no DOM harness, so "does the layout
 * break" cannot be observed directly.
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

test("the result card reserves its media column only when there is a picture", async () => {
  const panels = await source("event-workspace-panels.tsx");

  // The 58px column comes from `resultWithMedia`; without the guard the card
  // grid keeps the column and the picture slot renders as an empty bordered box.
  assert.match(panels, /mediaCount > 0 && thumbnail \? styles\.resultWithMedia : ""/);
  assert.match(panels, /\{mediaCount > 0 && thumbnail && <span className=\{styles\.resultMedia\}>/);

  const css = await source("event-workspace-panels.module.css");
  assert.match(css, /\.resultWithMedia \{ grid-template-columns:58px/);
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

test("a booth without a thumbnail is drawn as a plain slot at every zoom", async () => {
  const renderer = await source("accessible-event-map-renderer.tsx");

  // One predicate gates every media-only element. `showMedia` alone is not
  // enough: above the zoom threshold it is true for the whole map, so a slot
  // with no picture must still fall back on `view?.thumbnailUrl`.
  assert.match(renderer, /const hasMedia = !!\(showMedia && view\?\.thumbnailUrl\);/);
  for (const guarded of [/hasMedia \? styles\.mediaSlot : ""/, /\{hasMedia && <image /, /\{hasMedia && <rect className=\{styles\.mediaShade\}/]) {
    assert.match(renderer, guarded);
  }

  // The booth code moves down only when a picture is behind it; a plain slot
  // keeps the centred label it had before the media layer existed.
  assert.match(renderer, /y=\{slot\.rect\.y \+ slot\.rect\.height \* \(hasMedia \? \.88 : \.69\)\}/);

  // The clip paths are per-slot and emitted only for slots that have a picture,
  // so a mostly-pictureless map does not ship 988 unused <clipPath> nodes.
  assert.match(renderer, /slots\[slot\.code\]\?\.thumbnailUrl \? \[<clipPath/);
});

test("no reader-facing copy still promises the retired thumbnail index", async () => {
  for (const path of ["display-filter-controls.tsx", "event-workspace-panels.tsx"]) {
    assert.doesNotMatch(await source(path), /縮圖索引/, `${path} still advertises the retired index`);
  }
});
