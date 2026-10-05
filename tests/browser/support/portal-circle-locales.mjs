import assert from "node:assert/strict";
import { CIRCLE, capturedLoginLink } from "./portal.mjs";
import { base } from "./journey.mjs";
import { png } from "./png.mjs";

const ID = "c-900002", NAME = "南星工房";
const copy = {
  en: { account: "Account", claim: "Submit claim", withdraw: "Withdraw", edit: `Edit: ${NAME}`, preview: "Preview and submit", confirm: "Confirm and save", allAges: "All ages", uploaded: "Item list uploaded. Save to publish it.", add: "Add item list image", consent: "I confirm these images are suitable for readers of all ages.", earlier: "Move item list page 2 earlier", remove: /^Remove item list page/, public: "View public page", share: "Promotional text", review: "Review before saving", back: "Back to editing" },
  ja: { account: "アカウント", claim: "管理申請を送信", withdraw: "取り下げる", edit: `編集：${NAME}`, preview: "プレビューして送信", confirm: "確認して保存", allAges: "全年齢", uploaded: "お品書きをアップロードしました。保存すると公開されます。", add: "お品書き画像を追加", consent: "これらの画像が全年齢の読者に適した内容であることを確認しました。", earlier: "お品書き2枚目を前へ移動", remove: /^お品書き\d+枚目を削除/, public: "公開ページを見る", share: "告知文", review: "保存前の確認", back: "編集に戻る" },
};

// Uses the normal form, local D1 mail sink and Pages API. Only the external
// widget is controlled; its options and stale callbacks are observable here.
async function localizedSignIn(journey, locale) {
  const page = await journey.page({ url: `${base}/circle?event=sample&circle=${ID}&lang=${locale}`, locale: "zh-TW",
    viewport: locale === "en" ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    routes: async p => {
      await p.addInitScript(() => {
        window.__widgets = [];
        window.turnstile = {
          render(target, options) { target.textContent = "Local test verification"; window.__widgets.push(options); return String(window.__widgets.length); },
          remove() {},
        };
      });
    },
  });
  const email = page.getByRole("textbox", { name: "Email", exact: true });
  await email.fill(CIRCLE);
  await page.waitForFunction(() => window.__widgets.length > 0);
  await page.evaluate(() => window.__widgets.at(-1).callback("local-dummy-token"));
  if (locale === "en") {
    const first = await page.evaluate(() => window.__widgets.length - 1);
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("ja");
    assert.equal(await email.inputValue(), CIRCLE, "language changes preserve the sign-in email");
    await page.waitForFunction(() => window.__widgets.at(-1).language === "ja");
    await page.evaluate(index => window.__widgets[index].callback("stale-token"), first);
    assert.equal(await page.getByRole("button", { name: "ログインリンクを送信", exact: true }).isDisabled(), true, "a removed widget cannot restore its token");
    await page.getByRole("combobox", { name: "表示言語", exact: true }).selectOption("en");
    await page.waitForFunction(() => window.__widgets.at(-1).language === "en");
    await page.evaluate(() => window.__widgets.at(-1).callback("local-dummy-token"));
  }
  const request = page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/request-link");
  await page.getByRole("button", { name: locale === "en" ? "Send sign-in link" : "ログインリンクを送信", exact: true }).click();
  const answer = await request;
  assert.equal(answer.status(), 202);
  assert.equal(answer.request().postDataJSON().locale, locale);
  assert.equal(answer.request().postDataJSON().circleId, ID);
  await journey.capture(page, `portal-login-${locale}`);
  const link = await capturedLoginLink(CIRCLE);
  const target = new URL(link);
  assert.equal(target.searchParams.get("lang"), locale);
  assert.equal(target.searchParams.get("circle"), ID);
  assert.equal(target.searchParams.get("event"), "sample");
  const writes = [];
  page.on("request", r => { if (new URL(r.url()).pathname === "/api/account/notification-preferences" && r.method() === "PUT") writes.push(r.postDataJSON()); });
  const preferenceRead = page.waitForResponse(r => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/account/notification-preferences");
  await page.goto(link);
  await page.getByRole("banner").getByRole("button", { name: copy[locale].account, exact: true }).waitFor();
  const prefs = await (await preferenceRead).json();
  assert.equal(prefs.locale, "zh-Hant", "a link's locale must not overwrite the existing notification preference");
  assert.equal(writes.length, 0);
  return page;
}

export async function verifyCircleLocales(journey, admin) {
  const en = await localizedSignIn(journey, "en");
  assert.equal(await en.locator("#portal-search").inputValue(), NAME);
  await en.getByRole("button", { name: copy.en.claim, exact: true }).click();
  await en.getByRole("button", { name: copy.en.withdraw, exact: true }).waitFor();
  await journey.capture(en, "portal-claim-en");

  const ja = await localizedSignIn(journey, "ja");
  await ja.getByRole("button", { name: copy.ja.withdraw, exact: true }).click();
  await ja.getByRole("button", { name: copy.ja.claim, exact: true }).click();
  await ja.getByRole("button", { name: copy.ja.withdraw, exact: true }).waitFor();
  await journey.capture(ja, "portal-claim-ja");
  await admin.goto(`${base}/admin?section=circles&view=claims&event=sample`);
  const row = admin.locator("#admin li", { hasText: ID });
  await row.getByRole("button", { name: "核准", exact: true }).click();
  await row.waitFor({ state: "hidden" });

  for (const [locale, page] of [["en", en], ["ja", ja]]) {
    const text = copy[locale];
    await page.reload();
    const editor = page.locator(`#circle-editor-${ID}`);
    await editor.getByRole("heading", { name: text.edit, exact: true }).waitFor();
    await editor.locator("fieldset[disabled]").first().waitFor({ state: "hidden" });
    const pen = editor.locator(`input[id="pen-${ID}"]`);
    const original = `原文の筆名 ${locale}`;
    await pen.fill(original);
    await editor.locator(`textarea[id="sale-${ID}"]`).fill("新刊は原文のまま / unmodified user content");
    await editor.getByRole("checkbox", { name: text.allAges, exact: true }).check();
    await editor.locator(`input[id="specialTags-${ID}"]`).fill("自由原文タグ");
    await editor.getByRole("checkbox", { name: text.consent, exact: true }).check();
    for (let index = 0; index < 2; index++) {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/circle/${ID}/catalog-image`);
      await editor.getByLabel(text.add, { exact: true }).setInputFiles({ name: `page-${index}.png`, mimeType: "image/png", buffer: png(500 + index, 600) });
      assert.equal((await response).status(), 200, "the real local image endpoint accepts prepared bytes");
      await editor.getByText(text.uploaded, { exact: true }).waitFor();
    }
    await editor.getByRole("button", { name: text.earlier, exact: true }).click();
    await page.waitForFunction(id => JSON.parse(localStorage.getItem(`circle-portal-draft:${id}`))?.fields.catalogImages?.length === 2, ID);
    const before = await page.evaluate(id => localStorage.getItem(`circle-portal-draft:${id}`), ID);
    const other = locale === "en" ? "ja" : "en";
    await page.getByRole("banner").getByRole("combobox").filter({ has: page.locator('option[value="en"]') }).selectOption(other);
    assert.equal(await pen.inputValue(), original);
    assert.equal(await page.evaluate(id => localStorage.getItem(`circle-portal-draft:${id}`), ID), before, "locale switching preserves draft bytes and image order");
    await page.getByRole("banner").getByRole("combobox").filter({ has: page.locator('option[value="en"]') }).selectOption(locale);
    await journey.capture(page, `portal-editor-${locale}`);
    // Local R2 returns http addresses; the production HTTPS-only save rule is
    // kept. Staging/order are verified above, then remove the staged pages.
    while (await editor.getByRole("button", { name: text.remove }).count()) await editor.getByRole("button", { name: text.remove }).first().click();
    let rejectPreview = true;
    await page.route(`**/api/circle/${ID}/preview**`, route => rejectPreview ? route.fulfill({ status: 400, json: { code: "invalid_fields", error: "保留欄位錯誤 detail-527" } }) : route.continue());
    await editor.getByRole("button", { name: text.preview, exact: true }).click();
    await editor.getByText(/detail-527/).waitFor();
    assert.equal(await pen.inputValue(), original, "a server refusal preserves the draft and its specific field error");
    rejectPreview = false;
    await editor.getByRole("button", { name: text.preview, exact: true }).click();
    const review = editor.getByRole("complementary", { name: text.review });
    await review.getByRole("button", { name: text.confirm, exact: true }).waitFor();
    assert.match(await review.innerText(), new RegExp(original));
    await journey.capture(page, `portal-review-${locale}`);
    const saved = page.waitForResponse(r => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/circle/${ID}/overrides`);
    await review.getByRole("button", { name: text.confirm, exact: true }).click();
    const result = await saved;
    assert.equal(result.status(), 200);
    const fields = result.request().postDataJSON().fields;
    assert.deepEqual(fields.ageRatings, ["全年齡"]);
    assert.deepEqual(fields.specialTags, ["自由原文タグ"]);
    assert.equal(fields.pen, original);
    const link = editor.getByRole("link", { name: text.public, exact: true });
    await link.waitFor();
    assert.equal(new URL(await link.getAttribute("href")).searchParams.get("lang"), locale);
    assert.match(await editor.getByRole("textbox", { name: text.share, exact: true }).inputValue(), new RegExp(`lang=${locale}`));
    const publicPage = await journey.page({ url: await link.getAttribute("href"), viewport: { width: 390, height: 844 } });
    await publicPage.getByText(original, { exact: true }).waitFor();
    await journey.capture(publicPage, `portal-public-result-${locale}`);
    await publicPage.close();
    const deletion = locale === "en" ? "Delete content" : "情報を削除";
    const deleteButton = editor.getByRole("button", { name: deletion, exact: true });
    assert.equal(await deleteButton.isVisible(), false, "the irreversible action stays collapsed by default");
    await editor.locator("summary").filter({ hasText: deletion }).click();
    assert.equal(await deleteButton.isVisible(), true);
    assert.equal(await deleteButton.isDisabled(), true, "deletion still requires the circle ID");
    await page.close();
  }
}
