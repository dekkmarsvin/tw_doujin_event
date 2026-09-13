// staged-data: portal
//
// Replaces the source invariants in `tests/circle-portal-editor.test.mjs` with
// the errand a circle actually runs: prove who you are, claim your circle, fill
// in what the catalogue got wrong, and see it published. Reading the TSX for a
// hook name cannot tell you whether any of that works end to end; this is the
// only place the whole chain is exercised as a person walks it.
//
// What deliberately stays in `tests/circle-portal-route.test.mjs`: enumeration
// resistance, the order Turnstile and CSRF are checked, rejected writes not
// reaching the database, claim ownership and uniqueness races, retention and
// deletion, and every token invariant. A browser cannot prove a negative about
// the database, and pretending otherwise would trade real coverage for a
// slower, flakier version of it.
//
// Login links are rate limited to five an hour per address, which is itself one
// of those guarded invariants — so this journey signs each account in exactly
// once and reuses the session rather than logging in again.
import assert from "node:assert/strict";
import { ADMIN, CIRCLE, clearMail, signIn } from "./support/portal.mjs";
import { base, start } from "./support/journey.mjs";

const CIRCLE_NAME = "北風畫室";
const CIRCLE_ID = "c-900001";
const PEN_NAME = "驗收用筆名";
// The label text also names this field's inherit/clear buttons, so the input is
// addressed by its own id rather than by a label match that has three answers.
const penField = (page) => page.locator(`input[id^="pen-"]`);

const journey = await start("portal-circle-claim");
try {
  await clearMail();

  // 1. A circle proves who it is with a one-time link, and lands unclaimed.
  const circle = await signIn(journey, CIRCLE, "circle");
  assert.match(await circle.locator("body").innerText(), new RegExp(CIRCLE), "the signed-in account is named");
  await journey.capture(circle, "portal-signed-in");

  // 2. Finding and claiming the circle. The fixture circle carries no links to
  //    verify against, so this is the manual-review path an admin has to answer.
  await circle.locator('input[placeholder="輸入至少 2 個字"]').fill(CIRCLE_NAME.slice(0, 2));
  await circle.getByRole("button", { name: new RegExp(CIRCLE_NAME) }).click();
  await circle.getByRole("button", { name: "送出認領", exact: true }).click();
  const mine = circle.locator("body");
  await circle.getByRole("button", { name: "撤回", exact: true }).waitFor();
  assert.match(await mine.innerText(), /審核中/, "a submitted claim is pending, not granted");
  // Until an admin says yes there is nothing to edit: a claim that let a
  // stranger write immediately is the failure this step exists for.
  assert.equal(await circle.getByRole("button", { name: "預覽並送出", exact: true }).count(), 0, "a pending claim cannot edit yet");
  await journey.capture(circle, "portal-claim-pending");

  // 3. The admin is a different person with a different inbox.
  const admin = await signIn(journey, ADMIN, "circle");
  const queue = admin.getByRole("button", { name: "核准", exact: true });
  await queue.waitFor();
  assert.match(await admin.locator("body").innerText(), new RegExp(CIRCLE_ID), "the queue names the circle under review");
  await queue.first().click();
  await admin.waitForTimeout(600);
  await journey.capture(admin, "portal-claim-approved");
  await admin.close();

  // 4. The same session, reloaded: approval reaches the circle without a
  //    second login, which is also all the rate limit allows.
  await circle.reload();
  await circle.getByRole("button", { name: "預覽並送出", exact: true }).waitFor();
  assert.match(await mine.innerText(), /已通過/, "the approved claim is granted");

  // 5. Filling in what only the circle knows, and reviewing it before it is
  //    public. The review is not a modal dialog: it replaces the preview column
  //    and makes the form inert, so what has to hold is that the form really is
  //    out of reach and that leaving the review puts the reader back where they
  //    were — a keyboard user who looks and cancels must not be dropped at the
  //    top of a long form.
  await penField(circle).fill(PEN_NAME);
  const submit = circle.getByRole("button", { name: "預覽並送出", exact: true });
  await submit.focus();
  await submit.click();

  // The column relabels itself the moment the review opens, but its contents
  // wait on a server-side preview; the confirm button is the first thing that
  // exists only once that has arrived.
  const review = circle.locator('aside[aria-label="儲存前確認"]');
  const confirm = review.getByRole("button", { name: "確認儲存", exact: true });
  await confirm.waitFor();
  assert.match(await review.innerText(), new RegExp(PEN_NAME), "the circle sees what it is about to publish");
  assert.ok(await circle.locator("[inert]").count() > 0, "the form behind the review is inert");
  await journey.capture(circle, "portal-review-open");

  // The panel offers the same way back in its heading and beside the confirm.
  await review.getByRole("button", { name: "返回修改", exact: true }).first().click();
  await circle.locator('aside[aria-label="即時公開預覽"]').waitFor();
  // Focus is restored on the next frame, so this waits for it rather than
  // reading it in the same tick; a control that never regains focus still fails.
  await circle.waitForFunction(() => document.activeElement?.textContent?.trim() === "預覽並送出", null, { timeout: 5000 })
    .catch(() => { throw new Error("leaving the review did not return focus to the control that opened it"); });
  assert.equal(await penField(circle).inputValue(), PEN_NAME, "backing out of the review keeps the draft");

  // 6. Saving for real.
  await submit.click();
  await confirm.waitFor();
  await confirm.click();
  await circle.locator('aside[aria-label="即時公開預覽"]').waitFor();
  await journey.capture(circle, "portal-saved");

  // 7. What was saved survives a reload — the reader's copy is not a local draft.
  await circle.reload();
  await penField(circle).waitFor();
  // The editor mounts before the saved override has been fetched, so an empty
  // field here means "not yet", and only staying empty means "not saved".
  await circle.waitForFunction((expected) => document.querySelector('input[id^="pen-"]')?.value === expected, PEN_NAME, { timeout: 10000 })
    .catch(() => { throw new Error(`the saved pen name did not come back from the server (field held "${""}")`); });
  await circle.close();

  // 8. And it reaches the public overlay every reader downloads.
  const published = await fetch(new URL("/data/events/sample/overrides.json", base));
  assert.ok(published.ok, `the public overlay answered ${published.status}`);
  const payload = await published.json();
  const override = payload.overrides?.find((item) => item.circleId === CIRCLE_ID);
  assert.ok(override, "the saved circle appears in the public overlay");
  assert.equal(override.fields.pen, PEN_NAME, "and carries what the circle wrote");
  // The overlay is what every anonymous reader downloads, so it must not carry
  // who wrote it.
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(CIRCLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the public overlay never names the account that wrote it");

  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
