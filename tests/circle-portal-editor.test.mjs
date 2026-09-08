import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Source-level invariants for the circle editor, in the same spirit as
 * `tests/circle-media-degradation.test.mjs`: the repo has no DOM harness, so
 * "the buttons came back as 38px blocks" and "the draft was never written"
 * cannot be observed directly.
 *
 * Each case below is a regression that shipped once in this file's own
 * history. They share a shape — a change that looks local, made somewhere the
 * consequence is invisible: one selector that quietly outranks four others,
 * one guard that reads a value from an unrelated request.
 */

const source = async (path) => readFile(new URL(`../app/circle-portal/${path}`, import.meta.url), "utf8");

test("the card's block-button rule stays weaker than the variants below it", async () => {
  const css = await source("portal.module.css");

  // `.card button:not(.previewFrame *)` is (0,2,1): `:not()` costs whatever its
  // argument costs. That outranks `.fieldMode button` and `.extraValues button`
  // at (0,1,1), which have nothing but source order on their side, so every
  // compact control in the editor reverted to the 38px dark block.
  assert.doesNotMatch(css, /:not\(\.previewFrame \*\)/);
  for (const rule of [
    /\.card button:not\(:where\(\.previewFrame \*, \.inlineButton\)\) \{/,
    /\.card button:not\(:where\(\.previewFrame \*, \.inlineButton\)\):hover/,
    /\.card button:not\(:where\(\.previewFrame \*, \.inlineButton\)\):focus-visible/,
    /\.card button:not\(:where\(\.previewFrame \*, \.inlineButton\)\):disabled/,
  ]) {
    assert.match(css, rule);
  }

  // The variants have to keep coming after the base rule: at equal specificity
  // the later one wins, and moving either would undo the line above.
  const base = css.indexOf(".card button:not(");
  for (const variant of [".fieldMode button {", ".extraValues button {"]) {
    assert.ok(css.indexOf(variant) > base, `${variant} must follow the base button rule`);
  }
});

test("the audit list keeps its own layout instead of the chip row's", async () => {
  const css = await source("portal.module.css");

  // `.extraValues` was added by appending it to `.auditList`'s selector list,
  // which handed the audit list a flex row: the map contribution history lost
  // its indent, its 10px type and its one-item-per-line reading order.
  assert.match(css, /\.auditList \{ display: grid; gap: 6px; margin: 10px 0 0; padding-left: 20px; font-size: 10px;/);
  assert.match(css, /^\.extraValues \{ display: flex;/m);
});

test("the draft is kept as soon as the record loads, not when the preview answers", async () => {
  const app = await source("portal-app.tsx");

  // `previewOverride` is a second request whose failure is swallowed on
  // purpose — the editor works without a preview. Gating the draft write on
  // its result made one failed preview silently disable the whole autosave.
  assert.match(app, /if \(!hydrated\) return;\s*\r?\n\s*if \(!draftDiffersFromSaved\) forgetStoredDraft/);
  const effect = app.slice(app.indexOf("if (!hydrated) return;"));
  const deps = effect.slice(effect.indexOf("}, ["), effect.indexOf("]);") + 3);
  assert.doesNotMatch(deps, /baseRecords/);

  // And only when the record actually arrived. Hydrating on the failure path
  // leaves `savedFields` empty, every comparison then reads as "same as the
  // server", and the next render deletes the draft the author still has.
  assert.equal(app.match(/setHydrated\(true\)/g)?.length, 1);
  assert.match(app, /\.catch\(\(\) => setFields\(\{\}\)\);/);
});

test("the draft carries every unsent answer, including the retention choice", async () => {
  const app = await source("portal-app.tsx");

  // Retention is edited in the form and sent by the same save (ADR-0018), so a
  // draft without it restores the fields and silently reverts the answer.
  assert.match(app, /type StoredDraft = \{[^}]*retention: CircleRetentionChoice \| null;/s);
  assert.match(app, /writeStoredDraft\(claim\.circleId, \{ fields, listInputs, stagedThumbnailKey, retention, savedAt:/);
  assert.match(app, /const draftDiffersFromSaved = .*\|\| retention !== savedRetention;/);

  // Restoring one has to bring the derived date with it, and discarding has to
  // put both back to what the server holds.
  assert.match(app, /setRetention\(activeRetention\);\s*\r?\n\s*setSavedRetention\(result\.retention \?\? null\);/);
  assert.match(app, /setRetentionExpiresAt\(storedRetention\s*\r?\n?\s*\? circleRetentionExpiresAt\(storedRetention, Date\.parse\(event\.eventEndsAt\)\)/);
  assert.match(app, /setRetention\(savedRetention\);\s*\r?\n\s*setRetentionExpiresAt\(savedRetention/);
});

test("the rating field is a checkbox group, because a circle can sell both", async () => {
  const app = await source("portal-app.tsx");

  // `ageRatings` describes what is on the table, and "全年齡 and R18" is an
  // ordinary answer. A single-select does not merely narrow the form: picking
  // one value replaces the array, so the next edit deletes the other value
  // silently (ADR-0051 decision 1, #193).
  assert.match(app, /const MULTI_CHOICE_FIELD_KEYS = \["creatorTypes", "ageRatings"\] as const/);
  assert.match(app, /if \(isMultiChoiceField\(key\)\) return <fieldset className=\{styles\.choiceGroup\}>/);

  // The single-select branch replaces the whole array, so nothing that can hold
  // more than one true value may fall through to it.
  const single = app.slice(app.indexOf("if (key in CHOICE_FIELD_OPTIONS)"));
  assert.match(single, /setChoice\(choiceKey, event\.target\.value\)/);
  assert.match(app, /const setChoice = \(key: ChoiceFieldKey, value: string\) => setFields\(\(current\) => \(\{ \.\.\.current, \[key\]: value \? \[value\] : \[\] \}\)\);/);
});
