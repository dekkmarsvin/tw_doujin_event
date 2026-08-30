# 資料 inventory

本站實際持有哪些資料、寫在哪一欄、由什麼動作寫入、保存多久。**這份文件只記事實**；保存期限、排程與帳號刪除依序由 [ADR-0018](../adr/0018-retention-is-the-circles-choice.md)、[ADR-0021](../adr/0021-credentials-expire-and-are-purged-records-are-kept.md)、[ADR-0022](../adr/0022-expiry-runs-in-a-separate-cron-worker.md)、[ADR-0027](../adr/0027-personal-data-lifecycle-and-account-deletion.md) 與 [ADR-0033](../adr/0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md) 決定。

**schema 權威**：[`db/identity-runtime-schema.ts`](../../db/identity-runtime-schema.ts)（runtime tables 由 `ensureTables()` 於首次請求建立；既有資料庫用同檔案的 additive column migrations 升級。表名與數量直接以該檔為準，不在本文複製一個會漂移的計數）
**寫入端**：[`app/circle-portal-handlers.ts`](../../app/circle-portal-handlers.ts)、[`db/identity-repository.ts`](../../db/identity-repository.ts)、[`functions/`](../../functions)
**行為契約**：[社團自助控制面](./circle-portal.md)、[地圖貢獻控制面](./map-contributions.md)。權限、可編輯範圍、狀態機與來源邊界只寫在契約，本文不重複。
**外部對照**：[性質相近的服務如何公開自己的資料收集](../research/data-collection-policies-in-comparable-projects.md)

## 三件要先知道的事

1. **production 已公開並可能持有真實個人資料。** 正式入口 <https://map.kotoban.top/circle> 可公開到達；本 inventory 描述的是現行 production 實際可能累積的資料，不得再以過去的 Access 閘控假設資料庫為空。preview 仍受 Access 保護且使用隔離資源（[ADR-0029](../adr/0029-public-production-gated-preview.md)）。
2. **有效期不等於保存期。** 下表的 TTL 常數決定的是「這筆還算不算數」，保存期決定的是「這一列還在不在」。兩者不同源：有效期寫在 `app/circle-portal-handlers.ts`，保存期寫在 [`db/retention-purge.ts`](../../db/retention-purge.ts) 的 `RETENTION_WINDOWS`，或（社團自述內容）寫在資料列自己身上。
3. **憑證與到期內容會被清除，必要決策紀錄會保留。** 每天 03:17 UTC 由獨立的排程 Worker（[`workers/retention-purge/`](../../workers/retention-purge)）刪除過期憑證、到期社團自述與地圖草稿／原始檔；`accounts`、`circle_claims`、`audit_log` 不設期限，地圖審閱 metadata 依 ADR-0033 保留。分類的標準見 [ADR-0021](../adr/0021-credentials-expire-and-are-purged-records-are-kept.md)：**這筆資料過了今天還有沒有用**。

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

## 保存期（現行常數）

[`db/retention-purge.ts`](../../db/retention-purge.ts) 的 `RETENTION_WINDOWS`，值的理由見 [ADR-0021](../adr/0021-credentials-expire-and-are-purged-records-are-kept.md)。

| 常數 | 值 | 從什麼時候起算 |
|---|---|---|
| `loginTokens` | 24 小時 | 建立時。**必須大於速率限制的一小時視窗**——計數的依據就是這張表，提早刪會把限制打穿，`purgeExpiredRecords()` 開頭直接拋錯擋住這個設定 |
| `sessions` | 7 天 | 到期或撤銷，取先發生者 |
| `previewMailSink` | 7 天 | 建立時。preview 限定，且是全站唯一存有信件內文的地方 |
| `mapDraftInactivity` | 180 天 | `draft`／`changes_requested` 最後一次活動；`submitted` 不套用此時鐘 |
| `mapDecisionRaw` | 30 天 | `approved`／`rejected`／`exported`／`withdrawn` 的決定時間；只刪原始檔，metadata 保留 |

社團自述內容的期限不在這張表裡——它由社團自選並寫在資料列上，Worker 只負責執行（[ADR-0018](../adr/0018-retention-is-the-circles-choice.md)）。

## 資料類別

每一列的欄位是從程式碼讀出來的事實；**保存期**與**到期處置**取自 [ADR-0018](../adr/0018-retention-is-the-circles-choice.md) 與 [ADR-0021](../adr/0021-credentials-expire-and-are-purged-records-are-kept.md)，**owner 一律是專案維運者**（ADR-0021：這不是分工表，是「出事時找誰」的答案），因此不逐列重複。

### `accounts` — 社團帳號

| 欄位 | 內容 | 備註 |
|---|---|---|
| `id` | 配發識別碼 | |
| `email` | **明文電子郵件** | 唯一索引；經 `normalizeEmail()` 正規化 |
| `created_at`、`last_login_at` | 時間戳 | |
| `disabled_at` | 停用時間 | 管理者可停用非管理者帳號；寫入後立即撤銷 sessions，並阻止再次登入 |
| `deletion_started_at` | 自助刪除開始時間 | 先原子封鎖新寫入並撤銷其他 sessions，再刪除私人 R2 物件；發起刪除的 session 只可重試刪除 route |

**目的**：讓社團以 email 一次性連結登入並維護自己的公開資料。
**保存期**：不設期限。 **到期處置**：登入中的非管理者可輸入完整 email 自助刪除（[ADR-0027](../adr/0027-personal-data-lifecycle-and-account-deletion.md)）。帳號、tokens、sessions 與 claims 一併刪除；仍由該帳號擁有的補充資料從資料列與公開文件移除，擁有者名額釋放。管理者須先由另一位管理者移出名單。

### `admins` — 管理者名單

`email`（明文）、`added_by`、`added_at`。名單為空時由 `ADMIN_EMAILS` 重新灌入。**這是唯一有實際刪除路徑的表**（`removeAdmin()`）。

**目的**：撤下社團補充資料、審核認領。 **保存期**：不設期限。 **到期處置**：移除即刪除資料列（已實作）。

### `login_tokens` — 一次性登入連結

| 欄位 | 內容 |
|---|---|
| `token_hash` | token 的 SHA-256（明文 token 只出現在寄出的信裡） |
| `email` | **明文電子郵件** |
| `expires_at` | 建立後 15 分鐘 |
| `consumed_at` | 兌換時間 |
| `request_ip_hash` | **加 pepper 的 IP 雜湊**（見下） |

**目的**：驗證申請者控制該信箱；`email` 與 `request_ip_hash` 同時是速率上限的計數鍵。
**保存期**：建立後 24 小時。 **到期處置**：由排程 Worker **刪除資料列**。**不是「用完即刪」**——速率限制數的就是這張表，兌換後立刻刪會讓額度跟著歸零。該次索取的紀錄不因此消失：`auth.link_requested` 已把 IP 雜湊與 email 雜湊寫進 `audit_log`。

### `sessions` — 登入工作階段

`account_id`、`created_at`、`expires_at`（30 天）、`last_seen_at`、`revoked_at`。

瀏覽器端對應 cookie **`__Host-ff47_session`**，值為 `sessionId.HMAC`，`Max-Age` 同 30 天。登出寫入 `revoked_at` 並以 `Max-Age=0` 清 cookie，該列留到保存期滿。

**目的**：維持登入狀態。 **保存期**：到期或撤銷後 7 天。 **到期處置**：由排程 Worker **刪除資料列**。過期的 session 沒有事後價值——它連 IP 欄位都沒有，最後登入時間記在 `accounts.last_login_at`。

### `circle_claims` — 認領與其證據

| 欄位 | 內容 |
|---|---|
| `account_id`、`event_id`、`circle_id` | 關聯鍵 |
| `circle_name_key`、`circle_name_at_claim`、`source_row_at_claim` | 認領當時的稽核快照。[ADR-0010](../adr/0010-circle-identity-is-an-allocated-serial.md)／[ADR-0013](../adr/0013-drop-the-legacy-circle-id-compatibility-path.md) 後已不再是修復機制 |
| `method`、`target_url`、`evidence_url`、`evidence_note` | **社團提供的證據**，含自由文字 |
| `challenge_token_hash`、`challenge_expires_at`、`challenge_attempts` | 驗證碼狀態，24 小時 |
| `status`、`verified_at`、`reviewed_by`、`reviewed_at` | 審核結果，`reviewed_by` 是**管理者身分** |

**目的**：證明某帳號是某社團本人。 **保存期**：不設期限。 **到期處置**：隨帳號刪除；partial unique index 的擁有者名額同步釋放。已轉移給別人的社團不會因前任刪帳號而移除現任內容。

### `circle_overrides` — 社團自填的補充資料

| 欄位 | 內容 |
|---|---|
| `fields_json` | 社團自填內容（販售資訊、筆名、連結、縮圖、標籤）。上限見[社團自助控制面契約](./circle-portal.md#欄位上限) |
| `previous_fields_json` | **前一版內容，保留一份** |
| `revision`、`created_at`、`updated_at`、`updated_by` | 版本與作者 |
| `status`、`takedown_reason`、`takendown_by`、`takendown_at` | 管理者撤下紀錄 |
| `post_event_hidden` | 活動後退出旗標 |
| `retention_choice`、`retention_expires_at` | 保存期限：社團自選 `keep`／`purge`，NULL 為尚未表態；到期時間自活動結束起算並存在列上（[ADR-0018](../adr/0018-retention-is-the-circles-choice.md)） |
| `hosted_thumbnail_key` | 目前代管縮圖的 R2 object key；公開 URL 仍在 `fields_json`，這欄只供更換與刪除生命週期使用 |

**目的**：讓社團在主辦攤位資料之外供應自己的即時內容。**撤下與活動後退出都是改欄位，不是刪列**——內容立刻離開公開文件，但仍留在資料庫。 **保存期**：由社團自選，選了 `purge` 的列在活動結束滿 90 天時由排程 Worker **刪除資料列**；未表態與選 `keep` 的列不設期限。社團**隨時可自行刪除**，不必等期限。 **處置**：刪除，公開文件同步失去該筆；`audit_log` 只留下刪除發生過與是誰做的。 **owner**：社團本人。

### R2 代管代表圖

選擇檔案只上傳草稿物件，不改寫 `circle_overrides` 或 `overrides_doc`；一般的單一編輯流程會保留目前已發布的代表圖與最新一張未確認草稿，再次上傳會取代前一張草稿。確認儲存時會驗證 object key 確實屬於該活動與社團，發布新圖後刪除舊圖與當時可見的其他未引用草稿。社團不確認的草稿會在後續上傳、儲存、自助刪除、刪除帳號、管理者撤下、保存期限清除或 preview reset 時掃描對應 prefix／bucket 並移除；它不進入公開 overlay。

同一社團若在多個分頁並行上傳或清理，R2 與 D1 之間沒有跨服務交易鎖，短時間內可能多留草稿，或讓其中一個分頁需要重新上傳。這不會發布未確認的物件；下一次上述生命週期動作會再次掃描。若產品要提供多分頁無衝突保證，需另以可序列化的 staged pointer 協調，不能把目前的 prefix 掃描描述成強一致上限。

### `map_contributor_grants` — 地圖貢獻授權

`account_id`、授權者／時間，以及撤銷或停權者／時間。有效角色是撤銷與停權時間都為 NULL 的列；管理者可再次授權同一帳號。

**目的**：讓管理者明確控制誰可整理主辦官方配置證據。**保存期**：帳號存在期間不設期限；刪除帳號時刪除資料列。授權、撤銷與停權另寫入 `audit_log`。

### `map_drafts` 與 `map_draft_revisions` — 私人地圖草稿

`map_drafts` 保存活動、period、場館空間、owner、狀態、目前 revision、活動／決定時間、內部 transition token 與清除 claim。`map_draft_revisions` 保存每版私人 JSON、作者與建立時間。每次修改新增 revision；落後版本不得覆寫。partial unique index 保證同一 `event_id + period_key + venue_space_id` 最多一份仍有效的 `approved`／`exported`；核准替代稿時，同一 D1 batch 會先把明確指定的既有稿轉為 `withdrawn`。

**目的**：允許平行整理與可重現審閱，不直接改寫公開快照。**保存期**：`draft` 180 天無活動後整份刪除；`changes_requested` 180 天無活動後刪除 revisions 並將 owner 去識別化；`submitted` 審閱前不自動刪除。已審內容的後續處置見下兩類。

### `map_draft_reviews` — 地圖審閱紀錄

`draft_id`、revision、前後狀態、actor role／account、note 與時間。提交也記為狀態轉換；審閱列不可改寫。

**目的**：回答哪一版何時被提交、要求修改、核准、拒絕或匯出。**保存期**：不設期限；帳號刪除或 `changes_requested` 到期時將 actor 去識別化。

### `map_draft_comments` — 地圖審閱留言

`draft_id`、留言當下的 revision、author role／account、留言內容，以及可選的 `target_kind` / `target_ref`。帶 target 的留言是「只改這一個元素」的請求，`target_ref` 用草稿自己的寫法定位（攤位用代碼、非一般攤位區用 id）。只存文字，不含原始圖位元組。

與 `map_draft_reviews` 分表：後者被保存期限與帳號刪除當成稽核來源，維持一次狀態轉換一列；自由留言混入會讓「這列要保存多久」取決於它是哪一種列。

讀取面不回傳 `author_account_id`——草稿上的參與者彼此之間只以角色識別。留言會更新 `map_drafts.last_activity_at`，因此討論中的草稿不會被當成已棄置而清除。

**目的**：讓審閱端累積留言，並對特定攤位或區域提出局部修改請求。**保存期**：隨草稿。草稿被刪除時一併刪除；`changes_requested` 到期匿名化時比照審閱 note，將 author 去識別化並保留內容；帳號刪除時全站留言的 author 去識別化，未送審草稿的留言隨草稿刪除。

### `map_draft_files` 與私人 R2 原始檔

D1 保存草稿 revision、私人 object key、官方來源 URL、文件日期、頁碼、SHA-256、MIME、容量、尺寸／頁數、上傳者／時間、審閱結果與原始檔刪除時間。JPEG、PNG、WebP 與 PDF bytes 位於獨立的 `MAP_CONTRIBUTIONS` R2 bucket；該 bucket 沒有公開網域，只能經 owner／管理者權限檢查讀取。

**目的**：保留 layout 可追溯的主辦官方證據。**保存期**：未提交或被要求修改的檔案隨草稿 180 天期限處理；`approved`／`rejected`／`exported`／`withdrawn` 決定 30 天後刪除原始 bytes 並清空 object key，永久保留來源 metadata 與審閱結果。帳號刪除時，從未提交的檔案立即刪除；已審檔案的上傳者去識別化。

### `map_draft_exports` — event-data 候選匯出

保存已核准 draft revision 的 `target_path`、候選 JSON、語意差異 JSON、SHA-256、建立者與時間；同一 draft revision 最多一份，重試回傳原列。候選只供管理者下載並建立 event-data repository 的可審查變更，不是公開資料 endpoint。

**目的**：固定審閱者核准的精確幾何與匯出內容，避免下載時重新計算而漂移。**保存期**：不設期限；帳號刪除時將建立者去識別化。公開地圖仍只來自 event-data repository 的 reviewed snapshot 與 pin。

### `overrides_doc` — 公開的 overlay 文件

`event_id`、`revision`、`json`（實際對外送出的文件）、`updated_at`、`phase`。由 `rebuildOverridesDoc()` 從 live overrides 重建；`phase` 進 ETag，讓活動階段改變時快取不會提供已撤回的內容。

**目的**：`/data/events/:eventId/overrides.json` 的來源。**內容是公開的**，但它是上面兩張表的衍生物，處置隨之。

### `audit_log` — 稽核記錄

`at`、`actor_account_id`、`actor_role`、`action`、`subject_type`、`subject_id`、`detail_json`、`ip_hash`、`shredded_at`。

目前寫入的 action，依主體分組：

- 登入：`auth.link_requested`、`auth.session_created`、`auth.signed_out`
- 認領：`claim.created`、`claim.auto_verified`、`claim.verify_conflict`、`claim.challenge_failed`、`claim.admin_approve`／`claim.admin_reject`／`claim.admin_revoke`
- 社團自填內容：`override.updated`、`override.retention`、`override.post_event_visibility`、`override.takendown`、`override.deleted`（社團自助刪除，留下是哪個帳號做的、不留內容）、`override.purged`（到期清除，`actor_role` 為 `system`，`detail_json` 只有 `eventId`）
- 管理者名冊：`admin.added`、`admin.removed`
- 帳號：`account.disabled`、`account.deleted`（刪除完成後只留下已塗銷紀錄）
- 地圖貢獻：`map_contributor.grant`／`map_contributor.revoke`／`map_contributor.suspend`、`map_draft.created`、`map_draft.submitted`、`map_draft.commented`、`map_draft.changes_requested`／`map_draft.reject`／`map_draft.approve`、`map_draft.exported`、`map_draft.purged`、`map_draft.content_purged`、`map_draft.raw_purged`
- 排程清除：`retention.purged`（由排程 Worker 寫入，`actor_role` 為 `system`）

兩點值得單獨記下：

- `auth.link_requested` 的 `subject_id` 是以 `HASH_PEPPER` 為金鑰、帶 `audit-email-v1` domain separation 的 HMAC；不存明文，也不是可直接字典比對的無金鑰 SHA-256。
- `shredded_at` 非 NULL 代表該列已塗銷，不應再當成原始稽核內容解讀。

**保存期**：action 與時間不設期限，**永不刪列**；`ip_hash` 只保留 90 天。 **到期處置**：帳號刪除時把可連結的 account／email 主體改為固定值、清空 actor、IP 與自由內容，並寫入 `shredded_at`。仍保留「何時發生哪個動作」。

### `preview_mail_sink` — 僅 preview

`email`、`subject`、`text`、`created_at`。只有 preview 環境以 `PREVIEW_MAIL_SINK=d1` 明確選用時才寫入，收件人限 `PREVIEW_TEST_RECIPIENTS` 的 `.test` 假地址。production 有空表但沒有路由寫得進去。

**保存期**：7 天，全站最短。 **到期處置**：由排程 Worker **刪除資料列**。期限最短的理由是它存的是登入信全文（含連結），而 preview 的沙盒收件人是真實的個人信箱；測試不需要昨天的信。preview 環境的 Worker 另行部署為 `tw-catalog-retention-purge-preview`。

preview 清除端點會先刪除隔離 preview 的公開縮圖與私人地圖貢獻 R2 bucket 內全部物件，再由 `clearPreviewData()` 清空除 `admins` 外的所有 runtime tables，**保留 admins**。它只在 preview 可達，且與排程清除無關。

## IP 的處理

原始 IP 取自 `cf-connecting-ip`，缺少時退回 `x-forwarded-for`。**不以原始值儲存**：存的是 `SHA-256(HASH_PEPPER ‖ IP)`，寫入 `login_tokens.request_ip_hash` 與 `audit_log.ip_hash`。

pepper 是固定值，不輪替。`login_tokens` 的值隨該列在 24 小時內刪除；`audit_log.ip_hash` 由排程 Worker 在 90 天後清為 `NULL`，稽核 action 本身不刪除。

**例外**：Turnstile siteverify 會把**原始 IP** 送給 Cloudflare（見下）。

## 第三方

| 對象 | 收到什麼 | 何時 |
|---|---|---|
| **Mailgun**（`api.mailgun.net`） | 收件人**明文 email**、主旨、內文（含一次性登入連結） | 每次索取登入連結 |
| **Cloudflare Turnstile**（`challenges.cloudflare.com`） | 瀏覽器載入 widget；伺服器 siteverify 送 token 與**原始 IP** | 每次索取登入連結（[ADR-0016](../adr/0016-human-verification-guards-the-mailer.md)） |
| **Cloudflare**（Pages／Workers／D1／R2） | 平台本身，承載全部上述資料、代管縮圖與私人地圖來源檔 | 全時 |
| **Cloudflare Access** | preview 的維護者身分與 CI service token | 存取 `*.tw-catalog.pages.dev` preview deployment 時；production 正式網域不使用（[ADR-0029](../adr/0029-public-production-gated-preview.md)） |

認領證據抓取（`fetchEvidence()`）由 Worker 主動連向社團自己登錄的 URL，**對該主機揭露的是本站，不是使用者**。

Turnstile 是**閱讀端以外唯一的第三方腳本**，且只載入在 `/circle*`——`public/_headers` 為該路徑單獨覆寫 CSP，站台其餘部分的 `script-src` 仍只有 `'self'`。

## 閱讀端不在本表範圍

一般參觀者不登入、不建立任何伺服器端紀錄。瀏覽器端只有兩個 `localStorage` 鍵：規劃資料（`event-map-planning-v1`，見[收藏與走訪規劃契約](./planning.md#儲存與版本)）與介面字級偏好。沒有 cookie 或分析工具。代管縮圖由本站圖片網域載入；社團選用外部網址時則由設定的圖片主機直接載入。

規劃資料只留在使用者裝置，是刻意的隱私姿態，不是本站持有的資料——見 [ADR-0002](../adr/0002-planning-data-stays-on-device.md)。

## 已經有的機制

驗收條件要求「cleanup／expiry 行為有可執行機制與 tests，不只存在於文件」。這一節記的是它現在由什麼東西兌現。

- **排程清除**：[`db/retention-purge.ts`](../../db/retention-purge.ts) 的 `purgeExpiredRecords()`，由 [`workers/retention-purge/`](../../workers/retention-purge) 每天 03:17 UTC 觸發，刪除過期的 `login_tokens`、`sessions`、`preview_mail_sink`、到期社團自述與地圖草稿／原始檔，並清除超過 90 天的 `audit_log.ip_hash`。每次執行寫一列 `retention.purged`，包含沒處理到東西的那些。
- **它不會建立 schema。** 這個模組先讀 `sqlite_master`，表不在就跳過，不呼叫 `ensureTables()`。理由寫在模組頂端：**能建立資料庫的清除程式，就是能讓資料庫復活的清除程式。**
- **社團自助刪除**：`deleteOverride()`，走[既有的擁有權鏈](../adr/0020-self-service-deletion-reuses-the-existing-ownership-chain.md)（登入 → 已驗證的認領），不發放任何持有即授權的編輯連結。刪除後 `overrides_doc` 同步重建並遞增 revision，`audit_log` 留下 `override.deleted`——是哪個帳號做的，不留內容。
- **帳號自助刪除與 audit 塗銷**：handler 先刪除從未提交的私人地圖來源檔，再由 `deleteAccount()` 以同一個 D1 batch 刪除帳號關聯資料、釋放認領、移除仍由它擁有的補充資料與未提交地圖草稿、更新公開文件，並將已審地圖 actor 與 audit 個資去識別化。`account.deleted` 本身以已塗銷列記錄。
- **管理者停用帳號**：`disableAccount()` 寫入 `disabled_at` 並撤銷 live sessions；讀取端既有檢查阻止再次登入。

## 尚未納入政策正文

preview mail sink 只接受保留的 `.test` 地址，人工 preview 信則交給 Mailgun sandbox；政策正文仍只描述正式服務。兩者的隔離與 7 天清除由部署契約與測試把關，不把測試環境細節重複成一般使用者告知。

已定案而**不再**列於此的：既有資料類別的保存期與到期處置（[ADR-0018](../adr/0018-retention-is-the-circles-choice.md)、[ADR-0021](../adr/0021-credentials-expire-and-are-purged-records-are-kept.md)、[ADR-0033](../adr/0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md)）、清除機制（[ADR-0022](../adr/0022-expiry-runs-in-a-separate-cron-worker.md)）、每一類的 owner（ADR-0021：專案維運者）、政策文件的位置與變更通知方式（[ADR-0023](../adr/0023-the-privacy-notice-ships-without-professional-review.md)，告知第十節）。
