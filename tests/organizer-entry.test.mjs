import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

// Entry, saved progress, navigation and import resets run through the existing
// portal-organizer journeys. These guards retain the remaining uncovered paths.
async function organizerSource() {
  const directory = new URL("../app/organizer/", import.meta.url);
  const entries = (await readdir(directory)).filter(name => /\.tsx?$/.test(name)).sort();
  return (await Promise.all(entries.map(name => readFile(new URL(name, directory), "utf8")))).join("\n");
}

test("the organizer login form requests its own audience", async () => {
  const app = await organizerSource();
  // The browser journey mints its login link through an API helper, so it
  // does not exercise the audience sent by this form. The form is shared with
  // `/circle`, so both the organizer's uses and the pass-through are checked.
  assert.match(app, /<SignInScreen[^>]*current="organizer"/);
  assert.match(app, /<LoginLinkForm audience="organizer"/);
  const form = await readFile(new URL("../app/portal-sign-in.tsx", import.meta.url), "utf8");
  assert.match(form, /<LoginLinkForm audience=\{current\}/);
  assert.match(form, /requestLoginLink\(email, humanToken, audience,/);
});


test("an explicitly cleared selection survives a later list refresh", async () => {
  const app = await organizerSource();
  // The browser save-and-leave journey refreshes before clearing selection.
  // Keep these guards until a journey refreshes the list after leaving.
  assert.match(app, /const selectionInitialized = useRef\(false\)/);
  assert.match(app, /selectionInitialized\.current\s*=\s*true/);
  assert.match(app, /current === null \? null/);
});


test("leaving permits saving an incomplete draft", async () => {
  const app = await organizerSource();
  // portal-organizer-references checks primary validation; this guard keeps
  // the secondary save independent until that incomplete-draft path is driven.
  assert.ok(app.includes("void save(onSecondarySaved)"), "leaving does not require the task");
});
