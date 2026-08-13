import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

/**
 * A source-level invariant, not a behavioural test.
 *
 * The defect this guards against was not a bug inside `useModalFocus` — the
 * hook was correct and three dialogs already used it. It was a fourth panel
 * that declared `role="dialog"` and then implemented none of the lifecycle,
 * plus a fifth that had hand-rolled its own copy. Neither shows up in a unit
 * test of the hook, and the repo has no DOM harness to drive real Tab keys
 * through, so the check that actually catches it is structural: anything
 * claiming to be a modal must go through the one implementation.
 *
 * If a DOM test harness is ever added, this should be joined by real focus
 * tests rather than replaced by them — they catch different things.
 */

const APP = new URL("../app/", import.meta.url);

async function tsxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return tsxFiles(url);
    if (!entry.name.endsWith(".tsx")) return [];
    return [{ name: entry.name, source: await readFile(url, "utf8") }];
  }));
  return nested.flat();
}

test("every modal dialog uses the shared focus lifecycle", async () => {
  const files = await tsxFiles(APP);
  const modals = files.filter((file) => file.source.includes('aria-modal="true"'));

  // Guard the guard: if a refactor changes how modals are marked up, this test
  // must fail loudly rather than pass by matching nothing.
  assert.ok(modals.length >= 4, `expected several modal dialogs, found ${modals.length}`);

  // Match the call, not the identifier: an import alone leaves the hook unwired
  // while still containing the word, which is exactly how this check first
  // failed to catch its own regression.
  const unmanaged = modals.filter((file) => !/useModalFocus\s*\(/.test(file.source)).map((file) => file.name);
  assert.deepEqual(unmanaged, [], `these declare aria-modal="true" without useModalFocus: ${unmanaged.join(", ")}`);
});

test("no dialog hand-rolls its own focus trap", async () => {
  const files = await tsxFiles(APP);

  // The duplicated trap read `[...panel.querySelectorAll(...)]` and compared
  // `document.activeElement` against its first and last entries. One copy of
  // that logic belongs in `use-modal-focus.ts`; a second copy in a component
  // is how the two panels drifted apart in the first place.
  const duplicates = files
    .filter((file) => /querySelectorAll<HTMLElement>\(["'`][^"'`]*tabindex/i.test(file.source))
    .map((file) => file.name);

  assert.deepEqual(duplicates, [], `focus-trap logic duplicated outside the hook: ${duplicates.join(", ")}`);
});

test("the shared hook restores focus and closes on Escape", async () => {
  const hook = await readFile(new URL("../app/use-modal-focus.ts", import.meta.url), "utf8");

  // These are the three behaviours the dialogs above delegate. Asserting the
  // hook still contains them keeps the delegation meaningful: the invariant
  // "everyone uses the hook" is worthless if the hook stops doing the work.
  assert.match(hook, /event\.key === "Escape"/, "hook no longer closes on Escape");
  assert.match(hook, /event\.key !== "Tab"/, "hook no longer rings Tab focus");
  assert.match(hook, /opener\?\.focus\(\)/, "hook no longer restores focus to the opener");
});
