// staged-data: portal
// Exercise the real Pages runtime and D1, including its seed adoption. A Vite
// SSR-only test cannot catch differences in the Functions bundler's imports.
import assert from "node:assert/strict";
import { ADMIN, clearMail, signIn } from "./support/portal.mjs";
import { start } from "./support/journey.mjs";

const journey = await start("portal-organizer-references");
try {
  await clearMail();
  let staleReads = 0;
  const page = await signIn(journey, ADMIN, "organizer", {
    routes: async (page) => {
      await page.addInitScript((email) => localStorage.setItem(`organizer.resumeCandidate:${email}`, "removed-candidate"), ADMIN);
      await page.route("**/api/organizer/events/removed-candidate", (route) => {
        staleReads += 1;
        return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found", message: "找不到活動。" }) });
      });
    },
  });
  await page.getByRole("button", { name: "建立新活動", exact: true }).click();
  await page.getByLabel("暫定名稱", { exact: true }).fill("分類目錄驗收");
  await page.getByLabel("負責人 Email", { exact: true }).fill(ADMIN);
  await page.getByRole("button", { name: "建立並邀請", exact: true }).click();
  await page.getByLabel("活動代碼", { exact: false }).fill(`references-${Date.now()}`);
  assert.equal(staleReads, 0, "a removed remembered candidate is checked against the event list before reading it");
  assert.equal(await page.getByText("找不到活動。", { exact: true }).count(), 0);
  await page.getByLabel(/^來源名稱/).fill("測試主辦提供");
  await page.getByLabel(/^官方公告網址/).fill("https://organizer.example/event");
  await page.getByRole("button", { name: "建立主辦單位", exact: true }).click();
  await page.getByLabel("主辦名稱", { exact: true }).fill("測試主辦");
  await page.getByLabel("主辦官方網址", { exact: true }).fill("http://organizer.example/");
  await page.getByRole("button", { name: "建立並選取", exact: true }).click();
  await page.getByRole("alert").getByText("請填寫主辦名稱與有效的 HTTPS 官方來源網址。").waitFor();
  await journey.capture(page, "references-invalid-source");
  await page.getByLabel("主辦官方網址", { exact: true }).fill("https://organizer.example/");
  await page.getByRole("button", { name: "建立並選取", exact: true }).click();
  await page.getByRole("combobox", { name: "主辦單位 1", exact: true }).waitFor();
  await page.getByRole("button", { name: "建立分類目錄", exact: true }).click();
  await page.getByLabel("分類目錄名稱", { exact: true }).fill("作品分類");
  await page.getByLabel("分類官方來源網址", { exact: true }).fill("https://organizer.example/categories");
  await page.getByLabel("分類名稱 1", { exact: true }).fill("原創作品");
  await page.getByLabel("分類說明 1（選填）", { exact: true }).fill("原創的作品");
  await page.getByRole("button", { name: "新增分類", exact: true }).click();
  await page.getByLabel("分類名稱 2", { exact: true }).fill("二次創作");
  await page.getByRole("button", { name: "建立並選取", exact: true }).click();
  await page.getByText("原創作品、二次創作", { exact: true }).waitFor();
  await page.getByRole("button", { name: "儲存並繼續", exact: true }).click();
  await page.getByRole("heading", { name: "活動日期", exact: true }).waitFor();
  assert.equal(await page.getByRole("group", { name: "這個表單尚待完成的項目" }).count(), 0, "an untouched next task does not inherit attempted validation");
  assert.equal(await page.getByText("已儲存。", { exact: true }).count(), 0, "the previous task's success does not appear on the next task");
  await page.getByRole("button", { name: "1 活動名稱與來源 已完成", exact: true }).click();
  await page.reload();
  await page.getByRole("combobox", { name: "主辦單位 1", exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "主辦單位 1", exact: true }).locator("option:checked").textContent(), "測試主辦");
  assert.equal(await page.getByRole("combobox", { name: "主辦分類目錄", exact: true }).locator("option:checked").textContent(), "作品分類（2 個分類）");
  await journey.capture(page, "references-persisted");
  await page.getByRole("combobox", { name: "主辦角色 1", exact: true }).selectOption("partner");
  await page.getByRole("button", { name: "儲存並繼續", exact: true }).click();
  await page.getByText("請指定恰好一個主辦單位；其餘可設為協辦或合作夥伴。", { exact: true }).waitFor();
  await page.getByText("請指定恰好一個主辦單位；其餘可設為協辦或合作夥伴。", { exact: true }).scrollIntoViewIfNeeded();
  await journey.capture(page, "references-lead-validation");
  await page.getByRole("combobox", { name: "主辦角色 1", exact: true }).selectOption("lead");
  await page.getByRole("button", { name: "儲存並繼續", exact: true }).click();
  await page.getByRole("button", { name: "建立第一個活動日", exact: true }).click();
  // #221: the first date is asked for rather than assumed, so the step does
  // not pass until someone answers it.
  await page.getByLabel("第一天日期", { exact: true }).fill("2026-11-07");
  await page.getByRole("button", { name: "儲存並繼續", exact: true }).click();
  // #298: 場館／使用空間／展區 are near-synonyms in everyday Chinese, so the step
  // that asks for all three opens with two published events answering it.
  // 展區 belongs to the event, not to the building.
  const layers = page.getByRole("group", { name: "場館、使用空間、展區的填寫依據" });
  await layers.getByText("A–K 區、L–W 區", { exact: true }).waitFor();
  await layers.getByText("沒有分區", { exact: true }).waitFor();
  await journey.capture(page, "venue-layer-examples");
  // #219: an organizer usually has one official address, and 「全館」 rarely has
  // a page of its own, so the space URL is optional and the form names what it
  // would inherit instead of leaving it implied. The required fields answer
  // inline, under the field, rather than through the browser's own bubble.
  await page.getByRole("button", { name: "建立新場館", exact: true }).first().click();
  await page.getByRole("button", { name: "建立並選取", exact: true }).click();
  await page.getByText("請填寫場館名稱。", { exact: true }).waitFor();
  await page.getByText("請填寫場館官方網址。", { exact: true }).waitFor();
  await page.getByText("請填寫使用空間名稱。", { exact: true }).waitFor();
  await journey.capture(page, "venue-creator-inline-errors");
  await page.getByLabel(/^場館名稱/).fill("三重體育館");
  await page.getByLabel(/^場館官方網址/).fill("https://venue.example/sanchong");
  await page.getByLabel(/^使用空間名稱/).fill("全館");
  await page.getByText("留空沿用場館網址：https://venue.example/sanchong", { exact: true }).waitFor();
  await journey.capture(page, "venue-creator-inherited-url");
  await page.getByRole("button", { name: "建立並選取", exact: true }).click();
  await page.getByRole("combobox", { name: /^場館/ }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: /^場館/ }).locator("option:checked").textContent(), "三重體育館");
  // Put the step back where the rest of this journey expects it.
  await page.getByRole("button", { name: "移除此空間", exact: true }).click();
  await page.getByRole("button", { name: "新增使用空間", exact: true }).click();
  // #222: a new row is empty, and saving stays refused until both choices are
  // made. The venue used to be picked for the owner and the space along with
  // it, so 請選擇場館 was an option the list could never show as chosen.
  assert.equal(await page.getByRole("combobox", { name: /^場館/ }).locator("option:checked").textContent(), "請選擇場館");
  assert.equal(await page.getByRole("button", { name: "完成基本設定", exact: true }).isDisabled(), true);
  // Scoped, because 準備進度 lists the same blocker: an unscoped match races the
  // rail, which is fed by an effect and so lands a render later.
  await page.getByRole("group", { name: "這個表單尚待完成的項目" })
    .getByText("使用空間 1：尚未選擇場館，請從清單選擇或建立新場館。", { exact: true }).waitFor();
  await journey.capture(page, "references-venue-unselected");
  // The dialog covers the panel that names the pending row, so a refused
  // 儲存並切換 used to read as nothing happening at all.
  await page.getByRole("button", { name: "查看全部項目", exact: true }).click();
  const unsaved = page.getByRole("dialog", { name: "尚有未儲存變更" });
  await unsaved.getByRole("button", { name: "儲存並切換", exact: true }).click();
  await unsaved.getByText("沒有儲存成功。請按「取消」回到表單，照上面列出的說明處理後再試一次。", { exact: true }).waitFor();
  await journey.capture(page, "references-venue-save-refused");
  await unsaved.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("combobox", { name: /^場館/ }).selectOption("taipei-expo-park-zhengyan-hall");
  // Choosing a venue does not choose a space either.
  assert.equal(await page.getByRole("combobox", { name: /^使用空間/ }).locator("option:checked").textContent(), "請選擇使用空間");
  assert.equal(await page.getByRole("button", { name: "完成基本設定", exact: true }).isDisabled(), true);
  await page.getByRole("combobox", { name: /^使用空間/ }).selectOption("zhengyan-exhibition-area");
  await page.getByRole("button", { name: "完成基本設定", exact: true }).click();
  const sections = page.getByRole("group", { name: "活動項目" });
  await sections.getByRole("button", { name: /^活動/ }).click();
  await page.getByLabel("活動名稱", { exact: true }).fill("  分類目錄驗收  ");
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await page.getByText("已儲存。", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("活動名稱", { exact: true }).inputValue(), "分類目錄驗收", "saved canonical input is adopted without remounting away the success");
  await page.getByLabel("活動名稱", { exact: true }).fill("分類目錄驗收更新");
  assert.equal(await page.getByText("已儲存。", { exact: true }).count(), 0, "editing clears the earlier save result");
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await page.getByText("已儲存。", { exact: true }).waitFor();
  await journey.capture(page, "binder-save-feedback");

  await sections.getByRole("button", { name: /^場館與使用空間/ }).click();
  await page.getByLabel("攤位名單有另外區分展區嗎？", { exact: true }).selectOption("none");
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await page.getByText("已儲存。", { exact: true }).waitFor();
  await sections.getByRole("button", { name: /^攤位匯入/ }).click();
  await page.getByLabel("來源檔案", { exact: true }).setInputFiles({ name: "feedback.csv", mimeType: "text/csv", buffer: Buffer.from("攤位,社團\nA01,驗收社團\n") });
  await page.getByLabel("攤位代碼", { exact: true }).selectOption("0");
  await page.getByLabel("社團名稱", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "預覽對應結果", exact: true }).click();
  await page.getByText("無分區（1 列）", { exact: true }).waitFor();
  await page.getByRole("button", { name: "確認並儲存 1 列", exact: true }).click();
  const importSaved = page.getByText("匯入資料已儲存；原始檔沒有上傳。", { exact: true });
  await importSaved.waitFor();
  await page.getByRole("region", { name: "已儲存的攤位清單" }).getByRole("cell", { name: "無分區", exact: true }).waitFor();
  await journey.capture(page, "import-save-feedback");
  await page.getByLabel("攤位代碼格式", { exact: true }).selectOption("delimited");
  assert.equal(await importSaved.count(), 0, "changing mapping clears the previous import success");
  await page.getByRole("button", { name: "確認並儲存 1 列", exact: true }).click();
  await importSaved.waitFor();
  // #221: one navigation. The numbered strip above the panel is gone; the
  // readiness rail was always carrying the same six sections.
  await page.getByRole("group", { name: "活動項目" }).getByRole("button", { name: /^檢查與預覽/ }).click();
  await page.getByRole("button", { name: "執行檢查", exact: true }).click();
  await page.getByText("檢查完成。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "建立預覽", exact: true }).click();
  await page.getByText("預覽已產生。", { exact: true }).waitFor();
  assert.equal(await page.getByText("檢查完成。", { exact: true }).count(), 0, "preview replaces the previous check feedback");
  await page.getByText("爭艷館展區・花博公園爭艷館", { exact: true }).waitFor();
  await page.getByText("原創作品、二次創作", { exact: true }).waitFor();
  await journey.capture(page, "references-canonical-preview");
  await journey.finish();
} catch (error) { await journey.abort(error); }
