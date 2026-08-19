# 資料 inventory

本站實際持有哪些資料、寫在哪一欄、由什麼動作寫入、有效多久。**這份文件只記事實**，保存期限與到期處置屬於 [#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30) 的營運決策，尚未定案的一律標為**待決**，不猜、不預填。

**schema 權威**：[`db/identity-runtime-schema.ts`](../../db/identity-runtime-schema.ts)（9 張表由 `ensureTables()` 於首次請求建立，本專案沒有 migration 路徑）
**寫入端**：[`app/circle-portal-handlers.ts`](../../app/circle-portal-handlers.ts)、[`db/identity-repository.ts`](../../db/identity-repository.ts)、[`functions/`](../../functions)
**行為契約**：[社團自助控制面](./circle-portal.md)。認領、可編輯範圍、退出與管理者規則只寫在那裡，本文不重複。
**外部對照**：[性質相近的服務如何公開自己的資料收集](../research/data-collection-policies-in-comparable-projects.md)

## 三件要先知道的事

1. **目前沒有任何真實個人資料。** FF47 期間全站在 Access 閘控內、含社團端（[ADR-0011](../adr/0011-ff47-is-not-a-public-launch.md)），沒有真實社團到得了 `/circle`。這份 inventory 描述的是**閘控解除當天就會開始累積**的東西。
2. **有效期不等於保存期。** 三個 TTL 常數決定的是「這筆還算不算數」，不是「這一列還在不在」。過期的 token 與 session 目前**永遠留在資料庫裡**。
3. **本站目前沒有任何依到期時間清除列的機制。** 全部 `DELETE FROM` 只有兩處：`removeAdmin()` 刪單一管理者，以及 preview 專用的 `clearPreviewData()`。

## 有效期與速率上限（現行常數）

| 常數 | 值 | 管什麼 |
|---|---|---|
| `LOGIN_TOKEN_TTL_MS` | 15 分鐘 | 登入連結多久失效 |
| `SESSION_TTL_MS` | 30 天 | session 與 cookie `Max-Age` |
| `CHALLENGE_TTL_MS` | 24 小時 | 認領驗證碼多久失效 |
| `ADMIN_FRESH_SESSION_MS` | 24 小時 | 管理者動作要求的 session 新鮮度 |
| `loginPerEmailPerHour` | 5 | 同一 email 每小時可索取的登入連結 |
| `loginPerIpPerHour` | 20 | 同一 IP 雜湊每小時可索取的登入連結 |
| `claimsPerAccountPerDay` | 3 | 每帳號每日認領次數 |
| `challengeAttemptsPerClaim` | 10 | 單筆認領的驗證碼嘗試次數 |

## 資料類別

每一列的**保存期**與**到期處置**都待決；purpose 與 owner 之外的欄位是從程式碼讀出來的事實。

### `accounts` — 社團帳號

| 欄位 | 內容 | 備註 |
|---|---|---|
| `id` | 配發識別碼 | |
| `email` | **明文電子郵件** | 唯一索引；經 `normalizeEmail()` 正規化 |
| `created_at`、`last_login_at` | 時間戳 | |
| `disabled_at` | 停用時間 | **從未被寫入。** 讀取端（`upsertAccount`、`getSession`）會擋停用帳號，但沒有任何路徑設定它——等於目前無法停用帳號 |

**目的**：讓社團以 email 一次性連結登入並維護自己的公開資料。
**保存期**：待決。 **到期處置**：待決。 **owner**：待決。

### `admins` — 管理者名單

`email`（明文）、`added_by`、`added_at`。名單為空時由 `ADMIN_EMAILS` 重新灌入。**這是唯一有實際刪除路徑的表**（`removeAdmin()`）。

**目的**：撤下社團補充資料、審核認領。 **保存期／處置／owner**：待決。

### `login_tokens` — 一次性登入連結

| 欄位 | 內容 |
|---|---|
| `token_hash` | token 的 SHA-256（明文 token 只出現在寄出的信裡） |
| `email` | **明文電子郵件** |
| `expires_at` | 建立後 15 分鐘 |
| `consumed_at` | 兌換時間 |
| `request_ip_hash` | **加 pepper 的 IP 雜湊**（見下） |

**目的**：驗證申請者控制該信箱；`email` 與 `request_ip_hash` 同時是速率上限的計數鍵。
**現況**：**用過或過期的列不會被刪除。** 保存期／處置／owner 待決。

### `sessions` — 登入工作階段

`account_id`、`created_at`、`expires_at`（30 天）、`last_seen_at`、`revoked_at`。

瀏覽器端對應 cookie **`__Host-ff47_session`**，值為 `sessionId.HMAC`，`Max-Age` 同 30 天。登出寫入 `revoked_at` 並以 `Max-Age=0` 清 cookie，**列保留**。

**目的**：維持登入狀態。 **保存期／處置／owner**：待決。

### `circle_claims` — 認領與其證據

| 欄位 | 內容 |
|---|---|
| `account_id`、`event_id`、`circle_id` | 關聯鍵 |
| `circle_name_key`、`circle_name_at_claim`、`source_row_at_claim` | 認領當時的稽核快照。[ADR-0010](../adr/0010-circle-identity-is-an-allocated-serial.md)／[ADR-0013](../adr/0013-drop-the-legacy-circle-id-compatibility-path.md) 後已不再是修復機制 |
| `method`、`target_url`、`evidence_url`、`evidence_note` | **社團提供的證據**，含自由文字 |
| `challenge_token_hash`、`challenge_expires_at`、`challenge_attempts` | 驗證碼狀態，24 小時 |
| `status`、`verified_at`、`reviewed_by`、`reviewed_at` | 審核結果，`reviewed_by` 是**管理者身分** |

**目的**：證明某帳號是某社團本人。 **沒有刪除路徑**——`setClaimStatus()` 只改狀態。 **保存期／處置／owner**：待決。

### `circle_overrides` — 社團自填的補充資料

| 欄位 | 內容 |
|---|---|
| `fields_json` | 社團自填內容（販售資訊、筆名、連結、縮圖、標籤）。上限見[社團自助控制面契約](./circle-portal.md#欄位上限) |
| `previous_fields_json` | **前一版內容，保留一份** |
| `revision`、`created_at`、`updated_at`、`updated_by` | 版本與作者 |
| `status`、`takedown_reason`、`takendown_by`、`takendown_at` | 管理者撤下紀錄 |
| `post_event_hidden` | 活動後退出旗標 |

**目的**：讓社團供應比公開整理更即時的內容。**撤下與活動後退出都是改欄位，不是刪列**——內容立刻離開公開文件，但仍留在資料庫。 **保存期／處置／owner**：待決。

### `overrides_doc` — 公開的 overlay 文件

`event_id`、`revision`、`json`（實際對外送出的文件）、`updated_at`、`phase`。由 `rebuildOverridesDoc()` 從 live overrides 重建；`phase` 進 ETag，讓活動階段改變時快取不會提供已撤回的內容。

**目的**：`/data/events/:eventId/overrides.json` 的來源。**內容是公開的**，但它是上面兩張表的衍生物，處置隨之。

### `audit_log` — 稽核記錄

`at`、`actor_account_id`、`actor_role`、`action`、`subject_type`、`subject_id`、`detail_json`、`ip_hash`。

目前寫入九種 action：`auth.link_requested`、`auth.session_created`、`auth.signed_out`、`claim.challenge_failed`、`override.updated`、`override.post_event_visibility`、`override.takendown`、`admin.added`、`admin.removed`。

兩點值得單獨記下：

- `auth.link_requested` 的 `subject_id` 是 **email 的純 SHA-256**（`sha256Hex(email)`），**沒有加 pepper**——與 `ip_hash` 的處理不同，強度也不同。
- **沒有任何刪除路徑。** 研究文件指出 pretix 是唯一處理「稽核 vs 刪除權」衝突的參考實作：紀錄永不刪除，只塗掉個資並標記 `shredded`。

**保存期／處置／owner**：待決。

### `preview_mail_sink` — 僅 preview

`email`、`subject`、`text`、`created_at`。只有 preview 環境以 `PREVIEW_MAIL_SINK=d1` 明確選用時才寫入，收件人限 `PREVIEW_TEST_RECIPIENTS` 的 `.test` 假地址。production 有空表但沒有路由寫得進去。

`clearPreviewData()` 會清空 `login_tokens`、`sessions`、`circle_claims`、`circle_overrides`、`overrides_doc`、`audit_log`、`preview_mail_sink`、`accounts` 八張表，**保留 admins**。這是全站唯一的批次刪除，且只在 preview 可達。

## IP 的處理

原始 IP 取自 `cf-connecting-ip`，缺少時退回 `x-forwarded-for`。**不以原始值儲存**：存的是 `SHA-256(HASH_PEPPER ‖ IP)`，寫入 `login_tokens.request_ip_hash` 與 `audit_log.ip_hash`。

pepper 是**固定值**，不輪替。研究文件指出這個姿態沒有現成對照可抄：Codeberg／Wikimedia／Mastodon 的期限是給原始 IP 的，Plausible 用當日輪替鹽讓這個類別根本不存在，本站介於兩者之間。

**例外**：Turnstile siteverify 會把**原始 IP** 送給 Cloudflare（見下）。

## 第三方

| 對象 | 收到什麼 | 何時 |
|---|---|---|
| **Mailgun**（`api.mailgun.net`） | 收件人**明文 email**、主旨、內文（含一次性登入連結） | 每次索取登入連結 |
| **Cloudflare Turnstile**（`challenges.cloudflare.com`） | 瀏覽器載入 widget；伺服器 siteverify 送 token 與**原始 IP** | 每次索取登入連結（[ADR-0016](../adr/0016-human-verification-guards-the-mailer.md)） |
| **Cloudflare**（Pages／Workers／D1） | 平台本身，承載全部上述資料 | 全時 |
| **Cloudflare Access** | 維護者身分 | 閘控期間；解除後消失（[ADR-0015](../adr/0015-access-lifts-when-no-third-party-bytes-remain.md)） |

認領證據抓取（`fetchEvidence()`）由 Worker 主動連向社團自己登錄的 URL，**對該主機揭露的是本站，不是使用者**。

Turnstile 是**閱讀端以外唯一的第三方腳本**，且只載入在 `/circle*`——`public/_headers` 為該路徑單獨覆寫 CSP，站台其餘部分的 `script-src` 仍只有 `'self'`。

## 閱讀端不在本表範圍

一般參觀者不登入、不建立任何伺服器端紀錄。瀏覽器端只有兩個 `localStorage` 鍵：規劃資料（`event-map-planning-v1`，見[收藏與走訪規劃契約](./planning.md#儲存與版本)）與介面字級偏好。**沒有 cookie、沒有分析工具、沒有第三方請求**（縮圖依 [ADR-0017](../adr/0017-thumbnails-are-self-hosted-with-external-urls-kept.md) 改為自行代管後，允許清單主機的請求也會消失）。

規劃資料只留在使用者裝置，是刻意的隱私姿態，不是本站持有的資料——見 [ADR-0002](../adr/0002-planning-data-stays-on-device.md)。

## 目前沒有的機制

這一節存在的理由是：驗收條件要求「cleanup／expiry 行為有可執行機制與 tests，不只存在於文件」，而這件事目前是**從零開始**，不是補強既有機制。

- 沒有依 `expires_at` 清除 `login_tokens` 或 `sessions` 的排程或請求時清理。
- 沒有寫入 `accounts.disabled_at` 的路徑——帳號無法停用。
- 沒有刪除帳號、認領或補充資料的使用者可及路徑。管理者撤下改的是狀態欄位。
- 沒有匿名化程序。
- 唯一的批次刪除 `clearPreviewData()` 只在 preview 可達。

## 待決事項

每一項都要有結論才能關閉 [#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30)。**本文不預設答案。**

1. **八個資料類別各自的保存期**：`accounts`、`admins`、`login_tokens`、`sessions`、`circle_claims`、`circle_overrides`、`overrides_doc`、`audit_log`。研究文件指出「Indefinitely」是表裡一個正當的值，只要寫出來。
2. **到期處置**：刪除、匿名化，或保留。`audit_log` 需要單獨決定——它與刪除權直接衝突。
3. **帳號刪除**：誰能提出、刪除範圍涵蓋哪幾張表、既有的認領與補充資料怎麼處置。
4. **`accounts.disabled_at` 是否要有寫入路徑**，或該欄位移除。
5. **IP 雜湊的姿態**：維持固定 pepper、改輪替鹽，或為雜湊本身設保存期。
6. **`auth.link_requested` 的 email 雜湊是否比照 IP 加 pepper。**
7. **政策文件的位置、版本與變更通知方式。** 研究文件記錄了兩種可執行機制：Codeberg 以 git log 當變更史、Zulip 以版本號強制重新同意。
8. **每一類的 owner。**
9. **preview 資料是否納入政策文本。** 研究指出所有參考對象都只談正式服務。

決定之後，保存期與處置要回填本表，並依驗收條件補上可執行機制與測試。
