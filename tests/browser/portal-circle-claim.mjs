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
import { ADMIN, CIRCLE, clearMail, loginLink, signIn } from "./support/portal.mjs";
import { base, PICTURE, start } from "./support/journey.mjs";
import { png } from "./support/png.mjs";

const CIRCLE_NAME = "北風畫室";
const CIRCLE_ID = "c-900001";
const PEN_NAME = "驗收用筆名";
// The label text also names this field's inherit/clear buttons, so the input is
// addressed by its own id rather than by a label match that has three answers.
const penField = (page) => page.locator(`input[id^="pen-"]`);

const journey = await start("portal-circle-claim");
try {
  await clearMail();

  // 1. Enter from the selected reader circle. The emailed link carries the
  // destination even when it is opened in a fresh browser context.
  const entryPage = await journey.mapPage();
  await entryPage.getByRole("link", { name: new RegExp(CIRCLE_NAME) }).first().click();
  await entryPage.getByRole("link", { name: "認領／管理資料" }).click();
  assert.equal(new URL(entryPage.url()).searchParams.get("circle"), CIRCLE_ID);
  await entryPage.getByRole("heading", { name: "登入", exact: true }).waitFor();
  const link = await loginLink(CIRCLE, "circle", { event: "sample", circleId: CIRCLE_ID });
  const circle = await journey.page({ url: link });
  await circle.getByRole("banner").getByRole("button", { name: "帳號", exact: true }).waitFor();
  await entryPage.close();
  assert.match(await circle.locator("body").innerText(), new RegExp(CIRCLE), "the signed-in account is named");
  await journey.capture(circle, "portal-signed-in");

  // 2. Finding and claiming the circle. The fixture circle carries no links to
  //    verify against, so this is the manual-review path an admin has to answer.
  await circle.getByRole("button", { name: "送出認領", exact: true }).waitFor();
  assert.equal(await circle.locator('#portal-search').inputValue(), CIRCLE_NAME, "the exact reader circle is already selected");
  await circle.getByRole("button", { name: "送出認領", exact: true }).click();
  const mine = circle.locator("body");
  await circle.getByRole("button", { name: "撤回", exact: true }).waitFor();
  await circle.getByRole("button", { name: "送出認領", exact: true }).waitFor({ state: "hidden" });
  assert.match(await mine.innerText(), /審核中/, "a submitted claim is pending, not granted");
  // Until an admin says yes there is nothing to edit: a claim that let a
  // stranger write immediately is the failure this step exists for.
  assert.equal(await circle.getByRole("button", { name: "預覽並送出", exact: true }).count(), 0, "a pending claim cannot edit yet");
  await journey.capture(circle, "portal-claim-pending");

  // 3. The admin is a different person with a different inbox.
  const admin = await signIn(journey, ADMIN, "circle");
  await admin.getByRole("banner").getByRole("button", { name: "帳號", exact: true }).click();
  await admin.getByRole("link", { name: "網站管理", exact: true }).click();
  const queue = admin.getByRole("button", { name: "核准", exact: true });
  await queue.waitFor();
  assert.match(await admin.locator("body").innerText(), new RegExp(CIRCLE_ID), "the queue names the circle under review");
  await queue.first().click();
  await admin.waitForTimeout(600);
  await journey.capture(admin, "portal-claim-approved");
  await admin.close();

  // 4. The same session, reloaded: approval reaches the circle without a
  //    second login, which is also all the rate limit allows. Hold the saved
  //    record read open so the editor must keep every control unavailable
  //    until it knows what the server currently holds.
  let overrideReadMode = "delay";
  let releaseOverrideRead;
  const delayedOverrideRead = new Promise((resolve) => { releaseOverrideRead = resolve; });
  let overrideReadCount = 0;
  await circle.route(`**/api/circle/${CIRCLE_ID}/overrides**`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    overrideReadCount += 1;
    if (overrideReadMode === "delay") await delayedOverrideRead;
    if (overrideReadMode === "fail") {
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "測試中的讀取失敗" }) });
    }
    return route.continue();
  });
  await circle.reload();
  await circle.getByRole("heading", { name: `編輯：${CIRCLE_NAME}`, exact: true }).waitFor();
  await circle.getByText("正在載入已儲存內容，完成前無法編輯。", { exact: true }).waitFor();
  const submit = circle.getByRole("button", { name: "預覽並送出", exact: true });
  assert.equal(await penField(circle).isDisabled(), true, "the pen name stays disabled while the saved record is loading");
  assert.equal(await submit.isDisabled(), true, "preview and submit stays disabled while the saved record is loading");
  assert.equal(overrideReadCount, 1, "the delayed read is the first saved-record request");
  await journey.capture(circle, "portal-editor-hydrating");
  overrideReadMode = "pass";
  const hydrationResponse = circle.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "GET" && new URL(response.url()).pathname === `/api/circle/${CIRCLE_ID}/overrides` && response.status() === 200;
  });
  releaseOverrideRead();
  await hydrationResponse;
  await circle.locator('section[aria-busy="false"]').waitFor();
  assert.equal(await penField(circle).isDisabled(), false, "the editor unlocks after the saved record arrives");
  assert.equal(await circle.getByRole("button", { name: "預覽並送出", exact: true }).isDisabled(), false, "preview and submit unlocks after the saved record arrives");
  assert.equal(await circle.getByText("正在載入已儲存內容，完成前無法編輯。", { exact: true }).count(), 0, "the loading message leaves after hydration");
  await circle.getByText("正在準備預覽…", { exact: true }).waitFor({ state: "hidden" });

  // A failed first load leaves the editor protected and offers a retry that
  // really issues another request. The successful retry resumes the same
  // journey, so later assertions still prove the original claim flow.
  overrideReadMode = "fail";
  await circle.reload();
  await circle.getByRole("heading", { name: `編輯：${CIRCLE_NAME}`, exact: true }).waitFor();
  await circle.getByRole("alert").getByText(/無法載入已儲存內容/).waitFor();
  assert.equal(await penField(circle).isDisabled(), true, "a failed saved-record read keeps editing disabled");
  assert.equal(await circle.getByRole("button", { name: "預覽並送出", exact: true }).isDisabled(), true, "a failed saved-record read keeps preview disabled");
  assert.equal(overrideReadCount, 2, "the failed reload made one new saved-record request");
  await journey.capture(circle, "portal-editor-load-error");
  overrideReadMode = "pass";
  const retryResponse = circle.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "GET" && new URL(response.url()).pathname === `/api/circle/${CIRCLE_ID}/overrides` && response.status() === 200;
  });
  await circle.getByRole("button", { name: "重試載入已儲存內容", exact: true }).click();
  await retryResponse;
  await circle.locator('section[aria-busy="false"]').waitFor();
  assert.equal(await submit.isDisabled(), false, "retry unlocks preview and submit after the saved record arrives");
  assert.equal(overrideReadCount, 3, "retry made a fresh saved-record request");
  assert.equal(await circle.getByText("正在載入已儲存內容，完成前無法編輯。", { exact: true }).count(), 0, "the retry leaves the loading state");
  await journey.capture(circle, "portal-editor-hydrated");
  assert.match(await mine.innerText(), /已通過/, "the approved claim is granted");

  // 5. Filling in what only the circle knows, and reviewing it before it is
  //    public. The review is not a modal dialog: it replaces the preview column
  //    and makes the form inert, so what has to hold is that the form really is
  //    out of reach and that leaving the review puts the reader back where they
  //    were — a keyboard user who looks and cancels must not be dropped at the
  //    top of a long form.
  await penField(circle).fill(PEN_NAME);
  for (const rating of ["全年齡", "R15", "R18"]) await circle.getByRole("checkbox", { name: rating, exact: true }).check();
  await circle.locator('input[id^="specialTags-"]').fill("自由題材");
  await submit.focus();
  await submit.click();

  // The column relabels itself the moment the review opens, but its contents
  // wait on a server-side preview; the confirm button is the first thing that
  // exists only once that has arrived.
  const review = circle.locator('aside[aria-label="儲存前確認"]');
  const confirm = review.getByRole("button", { name: "確認儲存", exact: true });
  await confirm.waitFor();
  assert.match(await review.innerText(), new RegExp(PEN_NAME), "the circle sees what it is about to publish");
  assert.match(await review.innerText(), /分級：全年齡、R15、R18/, "preview lists every selected rating");
  assert.equal(await penField(circle).isDisabled(), true, "the actual editor input is locked during review");
  assert.equal(await penField(circle).evaluate(node => Boolean(node.closest("[inert]"))), true, "the editor itself is inert");
  assert.equal(await circle.getByRole("checkbox", { name: "R18", exact: true }).isDisabled(), true);
  await journey.capture(circle, "portal-review-open");

  // The panel offers the same way back in its heading and beside the confirm.
  await review.getByRole("button", { name: "返回修改", exact: true }).first().click();
  await circle.locator('aside[aria-label="即時公開預覽"]').waitFor();
  // Focus is restored on the next frame, so this waits for it rather than
  // reading it in the same tick; a control that never regains focus still fails.
  await circle.waitForFunction(() => document.activeElement?.textContent?.trim() === "預覽並送出", null, { timeout: 5000 })
    .catch(() => { throw new Error("leaving the review did not return focus to the control that opened it"); });
  assert.equal(await penField(circle).inputValue(), PEN_NAME, "backing out of the review keeps the draft");
  assert.equal(await penField(circle).isDisabled(), false, "leaving review restores editing");

  // 6. Saving for real.
  await submit.click();
  await confirm.waitFor();
  await confirm.click();
  await circle.locator('aside[aria-label="即時公開預覽"]').waitFor();
  await journey.capture(circle, "portal-saved");

  // 6b. What a circle does next is take its page somewhere else. The ready-made
  //     post is the official facts and the page's stable address; nothing about
  //     the account, the sign-in or the claim can be in it.
  const pageUrl = new URL(`/events/sample/circles/${CIRCLE_ID}/`, base).toString();
  const share = circle.getByRole("region", { name: "分享公開頁" });
  await share.waitFor();
  const promotion = await share.getByRole("textbox", { name: "宣傳文字" }).inputValue();
  assert.match(promotion, new RegExp(CIRCLE_NAME), "the post names the circle");
  assert.match(promotion, /S01/, "and its booth");
  assert.ok(promotion.endsWith(pageUrl), "and ends with the page's stable address");
  assert.doesNotMatch(promotion, new RegExp(CIRCLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the post never names the account");
  assert.doesNotMatch(promotion, /login=|\/circle\?|\/api\//, "the post carries no sign-in or portal address");
  assert.equal(await share.getByRole("link", { name: "查看公開頁" }).getAttribute("href"), pageUrl);
  await journey.capture(circle, "portal-share");

  // 7. What was saved survives a reload — the reader's copy is not a local draft.
  await circle.reload();
  await penField(circle).waitFor();
  // The editor keeps its controls disabled until the saved override has been
  // fetched, so this waits for the hydrated value rather than a mount-time
  // placeholder.
  await circle.waitForFunction((expected) => document.querySelector('input[id^="pen-"]')?.value === expected, PEN_NAME, { timeout: 10000 })
    .catch(() => { throw new Error(`the saved pen name did not come back from the server (field held "${""}")`); });
  for (const rating of ["全年齡", "R15", "R18"]) assert.equal(await circle.getByRole("checkbox", { name: rating, exact: true }).isChecked(), true);
  assert.equal(await circle.locator('input[id^="specialTags-"]').inputValue(), "自由題材");

  // 7-. An edit gone wrong is walked back beside 預覽並送出, without a reload,
  //     and the walk-back itself can be taken back until the next edit.
  await penField(circle).fill("打錯的筆名");
  await circle.getByRole("button", { name: "還原為已儲存的版本", exact: true }).click();
  assert.equal(await penField(circle).inputValue(), PEN_NAME, "reverting brings back what is saved");
  await circle.getByRole("button", { name: "取消還原", exact: true }).click();
  assert.equal(await penField(circle).inputValue(), "打錯的筆名", "and the revert can be undone");
  await circle.getByRole("button", { name: "還原為已儲存的版本", exact: true }).click();
  assert.equal(await penField(circle).inputValue(), PEN_NAME);

  // 7a. A sale-sheet page: nothing can be chosen before the age confirmation,
  //     a PDF is named rather than refused vaguely, and a print-size image is
  //     resized in the browser and sent as a JPEG within the pixel budget.
  //     Saving it is not exercised here: the local portal hosts images over
  //     http, which the https-only field rule rightly refuses — the route test
  //     covers the save.
  const catalogPicker = circle.getByLabel("新增品書圖片", { exact: true });
  const ageCheck = circle.getByRole("checkbox", { name: "我確認這些圖片適合所有年齡的讀者觀看。" });
  assert.equal(await catalogPicker.isDisabled(), true, "choosing a page waits for the confirmation");
  // Held back, not dead: the press opens no file dialog and lands on the
  // confirmation that is in the way. Forced, because Playwright will not press
  // an aria-disabled control, and that press is what is under test.
  let dialogOpened = false;
  circle.once("filechooser", () => { dialogOpened = true; });
  await circle.locator("label", { hasText: "新增品書圖片" }).click({ force: true });
  await circle.waitForFunction(() => document.activeElement?.getAttribute("type") === "checkbox");
  assert.equal(await ageCheck.evaluate((node) => node === document.activeElement), true, "the press leads to the confirmation");
  assert.equal(dialogOpened, false, "and chooses nothing");
  await ageCheck.check();
  await catalogPicker.setInputFiles({ name: "品書.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  await circle.getByText("PDF 請先匯出成 JPG 或 PNG 再上傳。", { exact: true }).waitFor();
  const staged = circle.waitForResponse((response) => new URL(response.url()).pathname === `/api/circle/${CIRCLE_ID}/catalog-image`);
  await catalogPicker.setInputFiles({ name: "sheet.png", mimeType: "image/png", buffer: png(3000, 2000) });
  const stagedResponse = await staged;
  assert.equal(stagedResponse.status(), 200, "the prepared page is accepted");
  const { image } = await stagedResponse.json();
  assert.ok(image.width * image.height <= 5_000_000 && image.width < 3000, `a 6 MP sheet arrives resized (${image.width}×${image.height})`);
  assert.ok(Math.abs(image.width / image.height - 1.5) < 0.01, "in proportion");
  await circle.getByText("品書已上傳，儲存後公開。", { exact: true }).waitFor();
  await circle.getByText("第 1 張", { exact: true }).waitFor();
  await journey.capture(circle, "portal-catalog-staged");
  // Removing the page again leaves nothing to show, the same as what is saved.
  // The organizer's data has no sale sheet, so the field offers no second way
  // to say that.
  await circle.getByRole("button", { name: "移除第 1 張品書", exact: true }).click();
  assert.equal(await circle.getByRole("group", { name: "品書顯示什麼" }).count(), 0);

  // The review is full-density content inside a narrow desktop column. Use
  // an external picture fixture: local R2 URLs are deliberately not public.
  await circle.route(PICTURE, route => route.fulfill({ contentType: "image/png", body: png(300, 1600) }));
  await circle.getByLabel("外部圖片網址", { exact: true }).fill(PICTURE);
  await circle.getByRole("img", { name: "代表圖預覽", exact: true }).evaluate(image => image.decode());
  const shareImage = circle.getByLabel("分享縮圖", { exact: true });
  await shareImage.selectOption("thumbnail");
  assert.equal(await share.getByRole("img", { name: "分享縮圖預覽" }).getAttribute("src"), PICTURE);
  const beforeSave = await (await fetch(pageUrl)).text();
  assert.match(beforeSave, /property="og:image" content="https:\/\/map.kotoban.top\/share-card.png"/, "draft does not change public metadata");
  await submit.click(); await confirm.waitFor();
  const previewGallery = review.getByRole("group", { name: "社團圖片", exact: true });
  await previewGallery.locator("img").evaluate(image => image.decode());
  const previewBox = await review.boundingBox();
  const mediaBox = await previewGallery.boundingBox();
  const bodyBox = await review.locator('[class*="detailBody"]').boundingBox();
  const pictureBox = await previewGallery.locator("img").boundingBox();
  assert.ok(previewBox.width < 700 && mediaBox.width > 0 && bodyBox.width > 0, "the desktop preview is a narrow container");
  assert.ok(bodyBox.y >= mediaBox.y + mediaBox.height - 1, "narrow-container details stack media above text");
  for (const box of [mediaBox, bodyBox, pictureBox]) assert.ok(box.x >= previewBox.x - 1 && box.x + box.width <= previewBox.x + previewBox.width + 1,
    "the preview contains the text and portrait without clipping");
  await journey.capture(circle, "portal-portrait-review");
  const reviewedShare = review.locator("dl > div", { hasText: "分享縮圖" });
  await reviewedShare.getByRole("img", { name: "儲存後的分享縮圖", exact: true }).waitFor();
  assert.equal(await reviewedShare.count(), 1, "the reviewed share image sits in the row that names it");
  await confirm.click();
  await circle.locator('aside[aria-label="即時公開預覽"]').waitFor();
  const sharedHtml = await (await fetch(pageUrl)).text();
  assert.match(sharedHtml, /property="og:image" content="https:\/\/pictures.test\/circle.png"/, "the anonymous raw HTML uses the saved image");
  assert.doesNotMatch(sharedHtml, /property="og:image:width"/, "unknown image dimensions are not the brand dimensions");
  await circle.reload();
  await circle.waitForFunction(() => document.querySelector('select[id$="-image"]')?.value === "thumbnail");
  await share.scrollIntoViewIfNeeded();
  await journey.capture(circle, "portal-share-image-saved");
  assert.equal(await share.getByRole("img", { name: "分享縮圖預覽", exact: true }).evaluate(node => getComputedStyle(node).objectFit), "cover",
    "the preview crops like the share card, not the whole image");
  const desktopFrame = await share.getByRole("img", { name: "分享縮圖預覽", exact: true }).boundingBox();
  assert.ok(Math.abs(desktopFrame.width / desktopFrame.height - 1200 / 630) < 0.05, "the desktop preview keeps the share-card shape");
  await circle.setViewportSize({ width: 390, height: 844 });
  await share.scrollIntoViewIfNeeded();
  assert.ok(await circle.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "share controls fit a phone");
  const sharePreview = share.getByRole("img", { name: "分享縮圖預覽", exact: true });
  const phoneFrame = await sharePreview.boundingBox();
  assert.ok(Math.abs(phoneFrame.width / phoneFrame.height - 1200 / 630) < 0.05, "the phone preview keeps the share-card shape");
  await journey.capture(circle, "portal-share-image-mobile");
  await circle.setViewportSize({ width: 1280, height: 900 });
  await circle.getByRole("button", { name: "移除圖片", exact: true }).click();
  assert.equal(await shareImage.inputValue(), "brand", "removed image falls back in the preview");
  await submit.click(); await confirm.waitFor(); await confirm.click();
  await circle.locator('aside[aria-label="即時公開預覽"]').waitFor();
  assert.match(await (await fetch(pageUrl)).text(), /property="og:image" content="https:\/\/map.kotoban.top\/share-card.png"/, "removed media cannot survive in the public share image");

  // 7b. The post waits for the official booths. A failed read offers to fetch
  //     them again instead of a post with no dates or booths in it.
  let previewFails = true;
  await circle.route(`**/api/circle/${CIRCLE_ID}/preview**`, (route) => (previewFails
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "測試中的讀取失敗" }) })
    : route.continue()));
  await circle.reload();
  const sharing = circle.getByRole("region", { name: "分享公開頁" });
  await sharing.getByText("無法取得攤位資料，宣傳文字暫時無法產生。").waitFor();
  assert.equal(await sharing.getByRole("button", { name: "複製宣傳文字與連結", exact: true }).isDisabled(), true, "nothing to copy without booths");
  assert.equal(await sharing.getByRole("textbox", { name: "宣傳文字" }).count(), 0, "and no partial post to copy by hand");
  await journey.capture(circle, "portal-share-baseline-failed");
  // Autosave belongs to the hydrated editor, even when its separate preview
  // request fails. A reload must recover the newer unsaved value.
  const unsavedPen = "預覽失敗時仍保留的筆名";
  await penField(circle).fill(unsavedPen);
  await circle.waitForFunction(({ id, pen }) => JSON.parse(localStorage.getItem(`circle-portal-draft:${id}`) ?? "null")?.fields.pen === pen,
    { id: CIRCLE_ID, pen: unsavedPen });
  await circle.reload();
  await sharing.getByText("無法取得攤位資料，宣傳文字暫時無法產生。").waitFor();
  assert.equal(await penField(circle).inputValue(), unsavedPen, "failed preview does not discard the local draft on reload");
  await circle.locator(`#editor-fields-${CIRCLE_ID}`).getByRole("button", { name: "還原為已儲存的版本", exact: true }).click();
  assert.equal(await penField(circle).inputValue(), PEN_NAME, "restoration distinguishes the draft from the saved record");
  previewFails = false;
  await sharing.getByRole("button", { name: "重新取得", exact: true }).click();
  assert.match(await sharing.getByRole("textbox", { name: "宣傳文字" }).inputValue(), /S01/, "the retry brings the booths back");
  assert.equal(await sharing.getByRole("button", { name: "複製宣傳文字與連結", exact: true }).isDisabled(), false);

  // 7c. A browser with no Clipboard API at all falls back to a selected post,
  //     the same as one that refuses the write.
  await circle.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
  await sharing.getByRole("button", { name: "複製宣傳文字與連結", exact: true }).click();
  await sharing.getByText("無法自動複製，文字已選取，請自行複製。", { exact: true }).waitFor();

  // 7d. The first read is still in flight when the author opens a review, and
  //     the review's own read fails. The first answer must still fill the
  //     share panel rather than being dropped as superseded.
  await circle.unroute(`**/api/circle/${CIRCLE_ID}/preview**`);
  let releaseFirstRead;
  const firstRead = new Promise((resolve) => { releaseFirstRead = resolve; });
  let previewReads = 0;
  await circle.route(`**/api/circle/${CIRCLE_ID}/preview**`, async (route) => {
    previewReads += 1;
    if (previewReads === 1) {
      await firstRead;
      return route.continue();
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "測試中的讀取失敗" }) });
  });
  await circle.reload();
  await sharing.getByText("正在準備宣傳文字…", { exact: true }).waitFor();
  await circle.getByRole("button", { name: "預覽並送出", exact: true }).click();
  await circle.getByText("測試中的讀取失敗").first().waitFor();
  assert.equal(previewReads, 2, "the review asked for its own preview while the first read was held");
  releaseFirstRead();
  assert.match(await sharing.getByRole("textbox", { name: "宣傳文字" }).inputValue(), /S01/, "the held first read still supplies the booths");
  await circle.close();

  // 8. And it reaches the public overlay every reader downloads.
  const published = await fetch(new URL("/data/events/sample/overrides.json", base));
  assert.ok(published.ok, `the public overlay answered ${published.status}`);
  const payload = await published.json();
  const override = payload.overrides?.find((item) => item.circleId === CIRCLE_ID);
  assert.ok(override, "the saved circle appears in the public overlay");
  assert.equal(override.fields.pen, PEN_NAME, "and carries what the circle wrote");
  assert.deepEqual(override.fields.ageRatings, ["全年齡", "R15", "R18"]);
  assert.deepEqual(override.fields.specialTags, ["自由題材"]);
  // The overlay is what every anonymous reader downloads, so it must not carry
  // who wrote it.
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(CIRCLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the public overlay never names the account that wrote it");

  // 9. The page a stranger opens from that post, in a fresh browser with no
  //    session: what the circle wrote is there without opening the map.
  const stranger = await journey.page({ url: pageUrl, viewport: { width: 390, height: 844 } });
  await stranger.getByRole("heading", { name: "社團介紹", exact: true }).waitFor();
  const strangerText = await stranger.locator("main").innerText();
  assert.match(strangerText, new RegExp(PEN_NAME), "the public page shows what the circle saved");
  assert.match(strangerText, /由社團填寫 · 最後更新 \d{4}\.\d{2}\.\d{2}/, "with who wrote it and when");
  await journey.capture(stranger, "circle-page-published");
  await stranger.close();

  // Anonymous Reader consumes the saved overlay, applies each rating, and
  // restores the shared R15 condition rather than guessing a highest rating.
  const reader = await journey.mapPage();
  for (const label of ["只看全年齡", "只看 R15", "只看 R18"]) {
    await reader.getByRole("button", { name: /^詳細搜尋/ }).click();
    const search = reader.getByRole("dialog", { name: "詳細搜尋條件" });
    await search.getByRole("button", { name: label, exact: true }).click();
    if (label === "只看 R15") await journey.capture(reader, "reader-r15-search");
    await search.getByRole("button", { name: "套用搜尋", exact: true }).click();
    const result = reader.locator('#desktop-panel-explore a[class*="resultMain"]').filter({ hasText: CIRCLE_NAME }).first();
    await result.waitFor();
    if (label === "只看 R15") {
      await reader.waitForURL(url => url.searchParams.get("r18") === "r15");
      await reader.reload();
      await result.waitFor();
      assert.equal(new URL(reader.url()).searchParams.get("r18"), "r15");
    }
    await result.click();
    const details = reader.locator('aside[aria-label="已選社團詳情"]');
    await details.getByText("分級：全年齡、R15、R18", { exact: true }).waitFor();
    await details.getByRole("button", { name: "關閉攤位詳細資訊", exact: true }).click();
  }
  await journey.capture(reader, "reader-ratings-published");
  await reader.close();

  await journey.finish();
} catch (error) {
  await journey.abort(error);
}
