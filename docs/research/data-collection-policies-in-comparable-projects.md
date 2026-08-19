# 性質相近的服務與開源專案如何公開自己的資料收集

- 紀錄日期：2026-08-19
- 調查方式：**逐頁抓取線上原文**（隱私政策頁、專案文件、repo 內檔案與原始碼）
- 目的：為 [#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30) 提供外部事實基礎——別人「怎麼寫」「寫在哪」「有沒有可執行機制」

> **本文不下法律結論，也不建議本站該採用什麼政策。** issue #30 明文寫「本 issue 不自行撰寫法律結論」。最後一節只列出**本站有、參考對象裡找不到對應寫法**的資料類別，那是缺口清單，不是提案。

---

## 先讀：三個調查限制

**一、每一項都標註來源連結與查證日期。** 全部條目都在 2026-08-19 實際抓取原文。抓不到、頁面沒寫的，一律寫「未找到」，不用訓練記憶補。

**二、可信度分兩級。**

- `原文已讀` — 直接抓到該頁或該檔案並讀過內容。
- `未找到` — 有找過、找不到；文中會寫出找了什麼。

本文**沒有**任何「二手檢索」等級的條目；達不到 `原文已讀` 的一律降成 `未找到`。這一點與 [`doujin-service-landscape.md`](./doujin-service-landscape.md) 不同，該文有大量未經驗證的二手條目。

**三、「保存期限」與「有效期限」是兩件事。** 很多服務寫了 token／session 的**有效期**（過期即失效），卻沒寫該筆紀錄的**保存期**（列還在不在資料庫）。本文分開記錄；混為一談會讓比較失真。

---

## 對象總表

| # | 對象 | 類型 | 政策放在哪 | 有逐項保存期限？ | 可信度 |
|---|---|---|---|---|---|
| 1 | [コミックマーケット準備会](https://www.comiket.co.jp/info-c/PIP/PrivacyPolicy.html) | 同人展主辦 | 官網獨立頁 | 否 | 原文已讀 |
| 2 | [Circle.ms](https://docs.circle.ms/footer/privacypolicy.html) | Web カタログ 營運者 | 官網獨立頁 | 否 | 原文已讀 |
| 3 | [pixiv](https://policies.pixiv.net/ja/privacy_policy.html) | 創作平台（含 BOOTH 母集團） | 獨立政策站 | 否 | 原文已讀 |
| 4 | [Fantia](https://fantia.co.jp/privacy-policy/) | 同人／創作者支援 | 官網獨立頁 | 否 | 原文已讀 |
| 5 | [CWT 台灣同人誌販售會](https://www.comicworld.com.tw/Home/PrivacyPolicy) | 台灣同人展主辦 | 官網獨立頁 | 否 | 原文已讀 |
| 6 | [FF 開拓動漫祭](https://www.f-2.com.tw/) | 台灣同人展主辦 | — | — | **未找到政策** |
| 7 | [Mastodon](https://github.com/mastodon/mastodon/blob/main/config/templates/privacy-policy.md) | 開源社群平台 | **repo 內 markdown 範本** | 是（2 項） | 原文已讀 |
| 8 | [Discourse](https://github.com/discourse/discourse/blob/main/config/locales/server.en.yml) | 開源論壇 | **repo 內 locale 範本** + 站台設定 | 範本留空白；**設定有預設值** | 原文已讀 |
| 9 | [Zulip](https://github.com/zulip/zulip/tree/main/templates/corporate/policies) | 開源協作平台 | **repo 內 markdown**，含歷史版本檔 | 否 | 原文已讀 |
| 10 | [pretix](https://docs.pretix.eu/trust/privacy/gdpr/) | 開源售票／活動 | 文件站（獨立 docs repo） | 否，但**有可執行的刪除器** | 原文已讀 |
| 11 | [pretalx](https://docs.pretalx.org/legal/) | 開源議程徵稿 | **repo 內 `doc/legal/`** | 否 | 原文已讀 |
| 12 | [Indico](https://learn.getindico.io/privacy/) | 開源活動管理（CERN） | 文件站 + **產品內建欄位** | **是，由活動主辦逐欄位設定** | 原文已讀 |
| 13 | [OpenStreetMap Foundation](https://osmfoundation.org/wiki/Privacy_Policy) | 社群地圖 | wiki 頁（有版本史） | 部分（180 天） | 原文已讀 |
| 14 | [Wikimedia Foundation](https://foundation.wikimedia.org/wiki/Legal:Data_retention_guidelines) | 社群百科 | wiki 頁（有版本史） | **是，逐類別表格** | 原文已讀 |
| 15 | [Codeberg e.V.](https://codeberg.org/Codeberg/org/src/branch/main/PrivacyPolicy.md) | 非營利程式碼託管 | **git repo 內 markdown** | **是，逐類別列出** | 原文已讀 |
| 16 | [Plausible Analytics](https://plausible.io/data-policy) | 開源分析 | 官網獨立頁 | 否，但**明說不存 IP** | 原文已讀 |
| 17 | [Mozilla Glean](https://mozilla.github.io/glean/book/reference/yaml/metrics.html) | 開源遙測框架 | **repo 內 `metrics.yaml`，建置時驗證** | 是（`expires` 逐項必填） | 原文已讀 |

---

## 一、同人／展會相關服務

這一組的共同特徵非常一致：**收集項目寫得細、目的寫得長、保存期限一律不寫。**

### 1. コミックマーケット準備会

來源：<https://www.comiket.co.jp/info-c/PIP/PrivacyPolicy.html>（2026-08-19 查）

- **收集類別**：刊行物與郵寄物上使用的姓名、網站登錄的電子郵件位址、網站瀏覽行為（Google Analytics、YouTube、Google カスタム検索）。網域範圍明列 `comiket.co.jp` 與 `cmksp.jp`。
- **目的**：分五條，包含即賣會營運相關的資訊處理、對參加社團的連絡與協力依頼、活動相關連絡、刊登姓名之刊行物的通知，以及其他附帶用途。
- **保存期限**：**未找到**。政策全文沒有任何具體期間。
- **刪除／退出**：以**郵寄**方式向「個人情報担当」窓口提出，另有獨立的開示手続頁說明程序。
- **第三方**：明列「共同利用」，並列出 Google、Meta、X、LINE、はてな、ニコニコ 等外部服務。
- **版本**：制定 2005-05-28，改定 2006-09-30、2012-07-31，頁面最終更新 2025-06-01。**有改定日期序列，但沒有逐版差異紀錄。**

> 值得注意：本站的直接對照組是 Web カタログ 的社團編輯端（見 [`comike-webcatalog-circle-editing.md`](./comike-webcatalog-circle-editing.md)），但**準備会的隱私政策完全沒有提到社團自助編輯所產生的資料**——編輯紀錄、退出勾選、稽核紀錄一律不在文字裡。該研究文 §4 記到的「活動後不公開，但保留學術・研究目的的限定公開」寫在**編輯頁的條文**上，不在隱私政策裡。

### 2. Circle.ms（Web カタログ 的營運公司）

來源：<https://docs.circle.ms/footer/privacypolicy.html>（2026-08-19 查）

- **收集類別**：「住所、氏名、電話番号、メールアドレス、生年月日、IPアドレス等」，另有 cookie 與自動取得的 log。**IP 位址是明列項目**。
- **目的**：服務登錄與利用、服務資訊提供、活動申込處理、訂單確認與配送、問題防止與解決、商品開發與廣告用的統計作成、問い合わせ對應。
- **保存期限**：**未找到**。頁面沒有任何具體期間。（檢索摘要曾出現「電子帳簿保存法 10 年」的說法，但**該敘述不在此政策原文中**，故不採納。）
- **刪除／退出**：寄 `privacy@circle.ms`；本人確認完成後「合理的な期間内に」處理。**「合理的期間」是唯一的時間敘述，且是處理時效不是保存期限。**
- **第三方**：法令要求、委託處理業者、決済金融機關、以及**活動主辦方（限於該申込相關資料）**。
- **版本**：最終更新 2020-07-09，並聲明變更「予告なく」（不預告）。

### 3. pixiv

來源：<https://policies.pixiv.net/ja/privacy_policy.html>（2026-08-19 查）

- **收集類別**：分成使用者、活動投稿者、應徵者、從業員等多組，分別列舉。使用者組包含帳號資訊、端末資訊、**IP 位址**、決済資訊。
- **目的**：服務營運與認證、決済與不正防止、個人化與服務改善、行銷與廣告、活動運營、採用與人事。
- **保存期限**：只有一句原則性敘述——保存「利用目的の達成に必要な期間又は法令等に定める期間」。**沒有任何具體天數或年數。**
- **刪除／退出**：填寫指定申請書 + 本人確認文件，郵寄或線上表單（`/ja/privacy/contact_form.html`）；明說不接受到公司當面申請，郵寄文件不退還。
- **版本**：列出完整改定日期序列（2025-03-05、2024-05-28、2023-08-31、2023-06-13、2022-07-28 等，可回溯至 2018）。**改定日清單是這組裡最完整的。**

### 4. Fantia

來源：<https://fantia.co.jp/privacy-policy/>（2026-08-19 查）

- **收集類別**：姓名、住所、連絡先、生年月日、職業、本人確認書類、決済資訊（由第三方處理）、端末識別子、**IP 位址**、瀏覽器資訊、利用 log 與行動履歴、cookie 與廣告 ID。
- **保存期限**：**未找到**具體期間。政策只寫文件於「規定の保管期限経過後、適正に処分」——**引用了一個沒有公開的內部保管期限**。
- **刪除／開示**：需開示請求書 + 官方身分證件影本 + **每件 500 日圓手数料（郵便定額小為替）**；窗口為「個人情報お問合せ受付係」與 `info@fantia.co.jp`。**是本次唯一對請求收費的對象。**
- **版本**：改定日 令和6年3月31日（2024-03-31）。

### 5. CWT 台灣同人誌販售會

來源：<https://www.comicworld.com.tw/Home/PrivacyPolicy>、<https://www.comicworld.com.tw/Home/TermsOfService>（2026-08-19 查）

- **收集類別**：姓名、電子郵件、連絡方式；以及自動記錄的 **IP 位址、瀏覽器種類、使用時間、瀏覽與點選紀錄**；互動功能（服務信箱、問卷）留存的填答內容。服務條款另提及電話、地址、金融帳戶、身分證字號與證件照片。
- **目的**：提供網站服務與功能、內部改善（明說僅供內部參考）、統計分析與研究（明說以彙總、不可識別的形式）。
- **保存期限**：**未找到**。兩份文件都沒有期間敘述。
- **刪除／更正**：兩條路徑——寄 `cwt@comicworld.com.tw` 並附「登記之聯絡人姓名、電話及聯絡地址」；或於網站「會員專區」自行更正。**「會員專區自助更正」是這組裡唯一寫出的自助機制。**
- **cookie**：明說會寫入，並指引使用者自行把瀏覽器隱私層級調高，同時警告部分功能會失效。
- **版本**：**未找到**最後更新日期，也沒有版本號。

### 6. FF 開拓動漫祭

來源：<https://www.f-2.com.tw/>（2026-08-19 查）

**未找到**任何隱私權政策、個人資料告知或服務條款頁。首頁與頁尾的連結為：最新消息、關於我們、活動資訊、社團報名、常見問答、聯絡我們、[歷史站台](https://archive.f-2.com.tw/)。檢索 `開拓動漫祭 f-2.com.tw 個人資料 隱私權政策 保存期間` 也沒有命中政策頁。

這是一個對 #30 有意義的**負面事實**：與本站規模與地域最接近的主辦方，公開的個資告知文本無從引用，因此**本地慣例不能作為對照基準**。

---

## 二、開源專案：政策放進 repo 的四種做法

### 7. Mastodon — 政策是 repo 裡的 markdown 範本

來源：<https://github.com/mastodon/mastodon/blob/main/config/templates/privacy-policy.md>（2026-08-19 查）

政策文字以 `config/templates/privacy-policy.md` 存在原始碼樹中，站台管理者可覆寫；覆寫後的內容由 [`PrivacyPolicy` API entity](https://docs.joinmastodon.org/entities/PrivacyPolicy/) 對外提供。

章節結構：收集什麼／用來做什麼／如何保護／**保存政策**／cookie／是否對外揭露／兒少。

**保存期限（範本預設值，逐字）：**

> Retain server logs containing the IP address of all requests to this server, in so far as such logs are kept, no more than 90 days.

> Retain the IP addresses associated with registered users no more than 12 months.

**刪除**：「You may irreversibly delete your account at any time.」另可請求並下載自己內容的封存檔。

**最值得記下的一點是它的已知缺陷。** 公開 issue [mastodon/mastodon#19774](https://github.com/mastodon/mastodon/issues/19774)「Default privacy policy shouldn't make claims that are unlikely to be true」指出：範本裡的 90 天／12 個月是**文字承諾**，但一個剛裝好的站台的實際設定並不會落實它，結果是大量站台在宣稱自己做不到的事。**「政策寫了、機制沒做」在開源圈已經是被公開追蹤的失敗模式。**

### 8. Discourse — 範本留空白，數字放在有預設值的設定裡

來源：`config/locales/server.en.yml` 的 `privacy_topic` 鍵、`config/site_settings.yml`（2026-08-19 查）

政策範本以 seeded topic 形式放在 locale 檔中，開頭第一行就寫明它是範本：

> \## [Forum Admin, please find below an example starting template for a privacy policy that you should customise to your site.]

保存政策一節**刻意留成填空**：

> Retain server logs containing the IP address of all requests to this server no more than [NUMBER OF DAYS] days.

結尾同樣是填空：「This document is CC-BY-SA. It was last updated [INSERT LAST UPDATE DATE HERE].」——**政策文本本身標了授權條款，且把「最後更新日」當成必填欄位而不是選填。**

Mastodon 把數字寫死在範本、Discourse 把數字留空，是同一個問題的兩種相反解法。Discourse 的數字改放在**帶預設值的站台設定**裡：

| 設定 | 預設值 | 說明（原文） |
|---|---|---|
| `email_token_valid_hours` | 48 | Forgot password / activate account tokens are valid for (n) hours |
| `maximum_session_age` | 1440（小時，即 60 天） | User will remain logged in for n hours since last visit |
| `delete_email_logs_after_days` | 90 | Delete email logs after (N) days. 0 to keep indefinitely |
| `delete_rejected_email_after_days` | 90 | — |
| `purge_unactivated_users_grace_period_days` | 14 | Grace period before a user who has not activated their account is deleted |
| `clean_up_unused_staged_users_after_days` | 365 | Number of days before an unused staged user (without any posts) is removed |
| `purge_deleted_uploads_grace_period_days` | 30 | — |
| `search_query_log_max_retention_days` | 365 | Maximum amount of time to keep search queries, in days |
| `delete_drafts_older_than_n_days` | 180 | — |
| `clean_up_inactive_users_after_days` | 0（預設關閉） | — |

**這些設定有對應的排程 job 與測試**：`app/jobs/scheduled/clean_up_email_logs.rb` 與 `spec/jobs/clean_up_email_logs_spec.rb`；`delete_rejected_email_after_days` 另有專屬 validator 與 `spec/lib/validators/delete_rejected_email_after_days_spec.rb`。

註記兩個設計取向：多數設定以 **`0` 表示「永不清除」**，讓「無限保存」成為明示的值而非未定義狀態；上限一律設為 `36500`（100 年），亦即上限存在但形同無限。

### 9. Zulip — 政策是 git 檔案，版本號會強制使用者重新同意

來源：<https://github.com/zulip/zulip/tree/main/templates/corporate/policies>、<https://zulip.readthedocs.io/en/stable/production/settings.html>、<https://zulip.com/policies/privacy>（2026-08-19 查）

`templates/corporate/policies/` 下的實際檔案清單：

```
age-of-consent.md  index.md  missing.md  privacy-before-2022.md
privacy.md  rules.md  sidebar_index.md  subprocessors.md
terms-before-2022.md  terms.md
```

三件事值得記：

**一、舊版本以檔案形式留在 repo。** `privacy-before-2022.md`、`terms-before-2022.md` 不是被刪掉的歷史，是仍在服務的頁面。

**二、自架站台以目錄注入自己的政策。** `POLICIES_DIRECTORY` 預設值是 `zerver/policies_absent`（刻意指向不存在的目錄，等於預設不提供政策）；文件建議自架者放 `/etc/zulip/policies`，「so that your policies are naturally backed up with the server's other configuration」，並明說要寫清楚是誰在營運，以免被誤認為 Zulip Cloud 的政策。

**三、版本號是可執行的變更通知機制。** `zproject/default_settings.py` 的註解逐字：

> Version number for ToS. Change this if you want to force every user to click through to re-accept terms of service before using Zulip again on the web.

實作上，`zerver/views/home.py` 比較 `int(settings.TERMS_OF_SERVICE_VERSION.split(".")[0]) > user_profile.major_tos_version()`，**主版號一升，所有使用者下次登入被擋下重新同意**；同意行為寫進 audit log（`USER_TERMS_OF_SERVICE_VERSION_CHANGED`）。另有 `TERMS_OF_SERVICE_MESSAGE` 讓營運者解釋這次為什麼要重新同意。

政策內容本身反而是最弱的一項：保存期限只寫「as long as you have an open account with us or as otherwise necessary to provide you with our Services」，沒有具體天數。刪除走 `privacy@zulip.com` 或支援表單，目標 45 天內回覆；並明說**已送給他人的訊息無法刪除，只會改掛在「Deleted User」名下**。最後更新 2022-01-01，變更史直接連到 GitHub commit history。

### 10. pretix — 沒寫保存期限，但把刪除做成可執行的元件

來源：<https://docs.pretix.eu/trust/privacy/gdpr/>、<https://docs.pretix.eu/dev/development/api/shredder.html>、[`src/pretix/base/shredder.py`](https://github.com/pretix/pretix/blob/master/src/pretix/base/shredder.py)（2026-08-19 查）

**資料最小化寫成一句可驗證的事實**：「in its most simple configuration, pretix will only store the email address entered by the customer and nothing else」，其餘欄位皆為主辦方可選開啟。

**Data shredder** 是本次調查中最接近「可執行刪除機制」的實作。`src/pretix/base/shredder.py` 內建的 shredder 逐項是一份**事實上的資料 inventory**：

| identifier | verbose_name |
|---|---|
| `phone_numbers` | Phone numbers |
| `order_emails` | Emails |
| `waiting_list` | Waiting list |
| `attendee_info` | Attendee info |
| `invoice_addresses` | Invoice addresses |
| `question_answers` | Question answers |
| `invoices` | Invoices |
| `cachedtickets` | Cached ticket files |
| `payment_info` | Payment information |

四個設計細節：

- **先匯出、才准刪。** 開發文件要求 `generate_files()` 先把要銷毀的資料輸出成檔案；UI 上要拿到匯出檔之後才會給出 shred URL。
- **稽核紀錄不刪，只塗掉個資。** 開發文件逐字：「You should never delete `LogEntry` objects, but you might modify them to remove personal data」，並要求設定 `LogEntry.shredded = True`「to show that this is no longer original log data」。**這是本次唯一一個明確處理「稽核紀錄 vs 刪除權」衝突的寫法：保留列、標記已塗改。**
- **前置條件寫在程式裡。** `shred_constraints()` 要求活動已結束（多場次則取最晚日期）且售票頁已下線，否則回傳說明字串擋下操作。
- **有測試。** `src/tests/base/test_shredders.py`、`src/tests/api/test_shredders.py`、`src/tests/control/test_shredders.py`。

**保存期限**：**未找到**。pretix 沒有「N 天後自動刪除」，刪除是主辦方手動觸發的動作。文件也承認稅務稽核需求會讓部分資料留在歷史紀錄裡。

### 11. pretalx — 政策文件與程式碼同一個 repo

來源：<https://docs.pretalx.org/legal/>、<https://docs.pretalx.org/legal/gdpr/>（2026-08-19 查）

`Legal & Policies` 一節（授權、安全、GDPR、cookie、瀏覽器支援、發布週期）就住在 `pretalx/pretalx` 的 `doc/legal/index.rst`，頁尾的 “Edit this page” 直接指向該檔案。**政策文件與程式碼共用同一個 PR 流程與同一份 git 歷史。**

- **收集**：預設只有「speaker names and email addresses」，其餘欄位由主辦方選配。
- **刪除**：「Deleting an event scrubs all data」；使用者自行刪除帳號時「personal data is removed and only non-identifying data is retained」。
- **保存期限**：**未找到**。
- **角色**：明寫主辦方是 controller、pretalx Hosted 是 processor（GDPR 第 28 條），且無論自架或託管，主辦方都是 controller。
- 另有一個值得注意的產品慣例：**每一場活動有自己的隱私頁**，網址形如 `pretalx.com/<event>/privacy`（例：<https://pretalx.com/sotm2022/privacy>）。政策是活動層級的物件，不是站台層級的單一文件。

### 12. Indico — 保存期限是**產品欄位**，由排程任務執行

來源：<https://learn.getindico.io/privacy/>、<https://getindico.io/indico/release/2022/06/10/indico-3-2-news.html>、`indico/modules/events/registration/`（2026-08-19 查）

Indico 3.2 起，活動管理介面有獨立的 **Privacy 分頁**，主辦方在此指定 data controller、設定隱私告知（外部連結或直接輸入文字，可多筆），並決定參加者名單的可見範圍（全部／無／僅同意者）。

**保存期限被建模成資料庫欄位**，兩個層級：

- **整份報名表**：`RegistrationForm.retention_period`（migration `20220406_1431_88eb87ee0d3e`）。到期後整筆報名連同資料一併刪除。
- **單一欄位**：`RegistrationFormField.retention_period`（migration `20220315_1520_5123f24eb41e`）。到期只刪該欄位的值。

期限**以活動結束日為起算點**，單位是週（`TimeDeltaField(..., units=('weeks',))`）。

三個機制細節：

- **必填個資欄位不准設保存期限**，由 DB CheckConstraint `retention_period_allowed_fields` 強制：只有一般欄位、或 `personal_data_type` 不屬於 required 集合的個資欄位才能設。**「哪些欄位是核心資料、不可單獨過期」寫成資料庫約束，不只是介面提示。**
- **執行者是兩個 celery 週期任務**：`registration_fields_retention_period`（每日 03:00）與 `registration_retention_period`（每日 03:30）。條件即 `Event.end_dt + retention_period <= today`。
- **刪除留下痕跡**：欄位資料被寫回該欄位型別的預設值而非 `NULL`，並把 `is_purged` 設為 `True`，讓介面能區分「沒填」與「已清除」。檔案型欄位會實際刪檔。
- 站台層級另有 `maximum_data_retention` 設定，由 `DataRetentionPeriodValidator` 檢查——**站台可以規定「主辦方設的期限不得超過 N 週」，也可以規定必須設**。

**測試**：**未找到**。2026-08-19 以 GitHub code search 在 `indico/indico` 查 `retention_period` 限於 `*_test.py`、以及查 `delete_registrations`，皆無命中測試檔；同目錄有 `privacy_test.py`，但內容是參加者名單可見性，不是保存期限。

---

## 三、保存期限寫得最具體的三份

### 13. Wikimedia Foundation — 逐類別的保存期限表

來源：<https://foundation.wikimedia.org/wiki/Legal:Data_retention_guidelines>（2026-08-19 查；頁面 last edited 2026-02-20，wiki 有完整 view history）

隱私政策與**保存期限指引是兩份分開的文件**，後者的主體是一張表，欄位為：資料類別／來源／例子／**最長保存期**。抓到的幾列：

| 類別 | 例子 | 最長保存期（原文） |
|---|---|---|
| 自動收集的非公開個人資訊 | 訪客 IP 位址、user-agent | "After at most 90 days, it will be deleted, aggregated, or de-identified" |
| 帳號設定 | 電子郵件位址 | "Until user deletes/changes the account setting" |
| 自動收集的非個人資訊（MediaWiki 活動 log） | — | "Indefinitely" |
| 自動收集的非個人資訊（EventLogging） | — | "After at most 90 days, it will be deleted, aggregated, or de-identified" |
| 讀者瀏覽的頁面 | — | "After at most 90 days, if retained at all, then only in aggregate form" |

三個可借用的體例特徵：**（一）** 保存期限獨立成一份文件，隱私政策只負責原則；**（二）** 「Indefinitely」是表格裡一個正當的值，不是空白；**（三）** 到期不一定等於刪除，寫成「deleted, aggregated, or de-identified」三選一。

### 14. Codeberg e.V. — 政策就是 git repo 裡的一個 markdown 檔

來源：<https://codeberg.org/Codeberg/org/src/branch/main/PrivacyPolicy.md>（2026-08-19 查）

`Codeberg/org` repo 根目錄下的 `PrivacyPolicy.md`。六節：General Information／Contact／Data Processing Reasons & Legal Basis／Data Handling by Association Bodies & Third Parties／**Data Retention**／Data Subject Rights。

資料類別與目的成對列出（平台使用者與協會會員分開）：帳號資料（使用者名稱、email、姓名）對應帳號提供；git commit 中的作者資訊對應著作權與授權關係的重建；付款資訊對應捐款處理；技術 metadata 對應平台服務與濫用防治。

**保存期限逐項（原文）：**

- "Account details are stored until the deletion of the account."
- "Membership details & payment records are stored for up to 10 years after..."（協會會員身分結束後，法定義務）
- "Technical metadata like IP addresses are not stored for more than 7 days..."
- "Personal data may exist in encrypted backups for up to 1 year."（且還原備份時若已超過保存期，受影響的個資會被清除）

**「備份也算一個保存期限項目」是本次唯一有寫的對象。**

**權利行使**：`privacy@codeberg.org`，指名資料保護負責人；「If you make a request, we have one month to respond to you.」

**變更紀錄就是 git log。** 該檔案的 commit 歷史可直接讀出政策的演進，例如 2026-01-13 `Add name of our current data protection officer`、2025-10-02 `revert "Add note about date of introduction of the new privacy policy" — Its in effect 🎉`。**政策沒有另外寫「變更通知」章節；版本控制本身就是那個機制。**

### 15. OpenStreetMap Foundation — 刪除帳號等於改名，不等於消失

來源：<https://osmfoundation.org/wiki/Privacy_Policy>（2026-08-19 查；wiki 頁，last edited 2026-01-25，有 View history）

- **收集類別**：貢獻資料（user ID、登入名稱、時間戳、編輯 metadata、changeset 留言）、帳號資訊（email、home location）、會員資料（法人會員的姓名與住址、付款資訊）、活動報名資料、自動收集（IP、瀏覽器與裝置、OS、造訪時間）、GPS 軌跡（可選公開或私有）、通訊內容（訊息、論壇、郵件列表）、使用者自願填寫的個人資料。
- **目的**：把所有貢獻歸屬到帳號、就資料來源連絡貢獻者、偵測 spam 與破壞、促進貢獻者之間的聯繫、彙總分析以改善服務。
- **保存期限**：Piwik 的 IP「shortened to two bytes」且詳細使用資訊保存 **180 天**；付款資料依法令要求保存。其餘類別**未找到**期限。
- **刪除**：這是最值得記的一段——**刪除帳號的結果依有無貢獻而不同**。無貢獻者的紀錄可移除；有貢獻者的帳號會被**改名為 `user_<USERID>`**，編輯內容保留，日記條目移除，email 則以非公開形式保留供連絡之用。**「匿名化而非刪除」在這裡是明文的、且理由（貢獻的可歸屬性）寫在政策裡。**
- **窗口**：`privacy@osmfoundation.org`。

### 16. Plausible Analytics — 用設計消滅一個資料類別

來源：<https://plausible.io/data-policy>（2026-08-19 查；頁面標示 last updated March 2026，並註明該次僅為釐清、無實質變更）

Plausible 的做法不是「IP 保存 N 天」，而是**根本不存 IP**。頁面明列收集項（頁面 URL 的 host 與 path、referer、瀏覽器版本、OS、裝置類型、國家／地區／城市），並明列**不收集**項（cookie、IP 位址、持久識別碼、完整 User-Agent——後者取出瀏覽器與 OS 後即丟棄）。

當日訪客識別以雜湊產生，逐字：

> `hash(daily_salt + website_domain + ip_address + user_agent)`

**salt 每 24 小時輪替並刪除**，因此同一訪客跨日無法被關聯。

對本站的意義只在體例上：**當某個資料類別的處理方式是「單向雜湊 + 定期輪替鹽」時，政策的寫法是描述那個機制本身，而不是給一個保存天數。** 保存期限在這裡被機制取代了。

### 17. Mozilla Glean — 資料 inventory 是 repo 裡的檔案，建置時驗證

來源：<https://mozilla.github.io/glean/book/reference/yaml/metrics.html>（2026-08-19 查）

嚴格說 Glean 管的是遙測指標而非帳號資料，因此**不是政策文本的參考對象**；列入是因為它是本次唯一找到的「**資料 inventory 作為 repo 內檔案並由工具鏈強制**」的完整例子。

每一個收集項在 `metrics.yaml` 中必須宣告：

| 欄位 | 內容 |
|---|---|
| `data_reviews` | 指向資料收集審查**回覆**的 URI 清單——每一項收集都要能連到一次審查 |
| `notification_emails` | 該項目出事或需要找負責人時通知誰（等同 owner） |
| `expires` | ISO 日期／主版號／`never`／`expired`——**「永不過期」是一個要明寫的值** |
| `lifetime` | `ping`／`application`／`user` |
| `data_sensitivity` | `technical`／`interaction`／`stored_content`／`highly_sensitive` |

`glean_parser` 在**建置時**依 JSON schema 驗證，linter 另檢查過期日與描述長度。亦即：**新增一項收集卻沒填 owner、審查連結或到期日，build 會失敗。**

---

## 橫向比較

### 保存期限的四種寫法

| 寫法 | 採用者 | 樣子 |
|---|---|---|
| **不寫** | Comiket、Circle.ms、pixiv、Fantia、CWT、pretix、pretalx、Zulip | 無敘述，或「必要期間」「規定の保管期限」這類指向未公開內部規則的句子 |
| **逐類別具體天數** | Wikimedia、Codeberg、Mastodon 範本、OSMF（部分） | 90 天／7 天／180 天／12 個月／10 年，逐項列出 |
| **由營運者設定，產品給預設值** | Discourse、Indico | 政策文本留空白或交由主辦方填，數字在設定與資料庫欄位裡 |
| **以機制取代期限** | Plausible | 不存該類資料；或以「單向雜湊 + 24 小時輪替鹽」描述 |

### 政策放在哪、怎麼標版本

| 位置 | 採用者 | 變更史 |
|---|---|---|
| 官網獨立頁 | Comiket、Circle.ms、pixiv、Fantia、CWT、Plausible | 改定日期清單（pixiv 最完整）；CWT **未找到**任何日期 |
| wiki 頁 | Wikimedia、OSMF | MediaWiki 的 View history 即逐版差異 |
| **git repo 內 markdown** | Codeberg、Zulip、Mastodon、Discourse、pretalx | **git log 即變更史**；Zulip 另把舊版本留成 `*-before-2022.md` 檔案 |
| 產品內建欄位 | Indico | 主辦方逐活動填寫，隨活動走 |
| 建置時驗證的宣告檔 | Glean | 每項變更都要過 schema 與 linter |

### 政策與程式碼的關係（僅開源對象）

| 專案 | 政策檔在 repo？ | 有可執行的清除機制？ | 有測試？ |
|---|---|---|---|
| Mastodon | 是（範本） | **未找到**（issue #19774 明指範本承諾與實際設定不符） | 未找到 |
| Discourse | 是（locale 範本，數字留空） | 是（排程 job + 站台設定） | **是**（`spec/jobs/clean_up_email_logs_spec.rb` 等） |
| Zulip | 是（含歷史版本檔） | 未找到期限型清除；**有版本升級強制重新同意的機制** | — |
| pretix | 文件在獨立 docs repo | **是**（data shredder，含前置條件與 log 塗改規則） | **是**（三個 test 檔） |
| pretalx | **是**（`doc/legal/`） | 是（刪活動即清資料、刪帳號保留非識別資料） | 未查 |
| Indico | 否（文件站） | **是**（DB 欄位 + CheckConstraint + 兩個 celery 週期任務） | **未找到** |
| Codeberg | **是**（`PrivacyPolicy.md`） | 未查 | 未查 |
| Glean | **是**（`metrics.yaml` 為 inventory） | 到期由 `expires` 宣告，建置時檢查 | schema 驗證即檢查 |

---

## 與本站的對照缺口

以下純粹是**清單**：本站已在處理、但在上述對象的公開文本裡**找不到可直接對照的寫法**的資料類別。不含建議。

本站現況取自 [`db/identity-runtime-schema.ts`](../../db/identity-runtime-schema.ts) 的實際 table 定義與 [`app/circle-portal-handlers.ts`](../../app/circle-portal-handlers.ts) 的常數（2026-08-19 讀）：`accounts`、`admins`、`login_tokens`、`sessions`、`circle_claims`、`circle_overrides`、`overrides_doc`、`audit_log`、`preview_mail_sink`；`LOGIN_TOKEN_TTL_MS` 15 分鐘、`SESSION_TTL_MS` 30 天、`CHALLENGE_TTL_MS` 24 小時。

| 本站資料 | 參考對象裡最近的對應 | 缺口 |
|---|---|---|
| `login_tokens`（一次性登入 token 的 hash、email、`request_ip_hash`） | Discourse `email_token_valid_hours = 48` 是**有效期**設定 | **沒有任何對象公開寫過一次性登入 token 的「紀錄保存期」**——只有有效期。token 用掉或過期後那一列還留多久，本次查證的文本裡都沒有寫法可抄 |
| `sessions` | Discourse `maximum_session_age = 1440` 小時（有效期） | 同上：session 失效後的**列保存期**無對照 |
| `request_ip_hash` / `audit_log.ip_hash`（雜湊後的 IP） | Codeberg「IP 不超過 7 天」、Wikimedia「最多 90 天」、Mastodon 範本「90 天／12 個月」都是**原始 IP**；Plausible 是**當日輪替鹽的雜湊且不存** | 本站是**固定鹽的雜湊、長期保存**，介於兩者之間。**沒有對象為「雜湊後但不輪替鹽的 IP」寫過保存期限**——它既不像原始 IP 那樣被列進表，也不像 Plausible 那樣被機制消滅 |
| `circle_claims`（含 `challenge_token_hash`、`evidence_url`、`evidence_note`、`reviewed_by`） | pretix 的 shredder 有 `attendee_info`／`question_answers`；Indico 有逐欄位保存期限 | **認領「證據」這個類別沒有對照**。Comiket 的社團編輯端有等價流程，但其隱私政策完全沒提。審核者身分（`reviewed_by`）的保存也沒有對象寫過 |
| `circle_overrides.previous_fields_json`（社團自填內容的前一版） | Zulip 把舊版**政策**留成檔案；OSMF 保留編輯內容但改名作者 | **沒有對象寫過「使用者自填內容的歷史版本」的保存期限**。OSMF 最接近，但它保留的是公開的地圖編輯，理由（貢獻可歸屬性）與本站的 overlay 歷史不同 |
| `circle_overrides` 的下架欄位（`takedown_reason`、`takendown_by`、`takendown_at`）與活動後 `post_event_hidden` | Comiket 編輯頁的「活動後不公開」勾選（見 [`comike-webcatalog-circle-editing.md`](./comike-webcatalog-circle-editing.md) §4） | Comiket 把它寫在**編輯頁條文**而非隱私政策；**管理者下架後資料如何處置（刪除／匿名化／保留）沒有任何對象寫過** |
| `audit_log`（actor、action、subject、`detail_json`、`ip_hash`） | pretix：`LogEntry` 不刪、塗掉個資、設 `shredded = True` | **這是唯一有對照的一項**，也是本次調查最直接可用的既有寫法 |
| 第三方郵件服務（外送郵件的收件者位址） | Zulip 有 `subprocessors.md`；Circle.ms、pixiv 列「委託先」 | 本站**未找到**對應的公開文本位置。Zulip 的 `subprocessors.md` 是唯一把「處理者清單」獨立成 repo 檔案的做法 |
| `preview_mail_sink`（僅 preview 環境） | — | **沒有對象公開描述過非正式環境的資料存放。** 本次查證的文本一律只談正式服務 |

另有一項與 #30 驗收條件直接相關的觀察：**本站目前沒有任何依到期時間清除列的機制**（`db/identity-repository.ts` 內只有依 email 刪 admin，以及測試用的整表清空）。相對地，Discourse 與 Indico 都把「到期清除」實作成排程任務，pretix 實作成手動觸發但有前置條件的元件，且 Discourse 與 pretix 都有測試。

---

## 未找到與待查證

1. **FF 開拓動漫祭的個資告知文本**。首頁與頁尾未見連結，檢索亦無命中。若實際存在（例如藏在社團報名系統登入後），需要以社團帳號實地確認，屆時另開文件、註明日期，不修改本文。
2. **Circle.ms 的 10 年保存說法**。檢索摘要出現過「電子帳簿保存法 10 年」，但 <https://docs.circle.ms/footer/privacypolicy.html> 原文查無此句。可能來自申込規約或別的頁面，待查。
3. **Comiket サークル参加申込書セット 內的個資條款**。C109 申込書 PDF（<https://www.comiket.co.jp/info-c/C109/C109Appset.pdf>）可能含有比隱私政策更具體的社團資料處理敘述。本次未讀該 PDF。
4. **Indico 保存期限任務的測試**。2026-08-19 以 GitHub code search 未命中；不排除測試以其他命名或在別的目錄。
5. **pretix 文件曾提到的「活動結束滿 60 天」門檻**。搜尋摘要有此說法，但 `shred_constraints()` 現行程式碼只檢查「活動已結束且售票頁已下線」。可能是舊版行為或託管服務的額外規則，待查。
6. **本文未涵蓋的類別**：專門的開源票務／報名系統中，`Open Event`（FOSSASIA）與 `OSEM`（openSUSE）未檢視；台灣其他主辦方（如各校園場、CWT 以外的中小型場）未檢視。以 #30 目前需要的體例參考而言，Wikimedia、Codeberg 與 Indico 三份已足夠，故未為湊數擴充。
