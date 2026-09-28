import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * The remaining copy guard covers surfaces not all opened by the media
 * journeys. Empty frames, centered pictureless details and portrait geometry
 * run in reader-thumbnails; narrow preview layout runs in portal-circle-claim.
 */

const source = async (path) => readFile(new URL(`../app/${path}`, import.meta.url), "utf8");

test("no reader-facing copy still promises the retired thumbnail index", async () => {
  for (const path of ["display-filter-controls.tsx", "event-workspace-panels.tsx"]) {
    assert.doesNotMatch(await source(path), /縮圖索引/, `${path} still advertises the retired index`);
  }
});
