# 主辦單位工作區契約

主辦單位在獨立入口 `/organizer` 建立候選活動、匯入攤位資料、畫地圖、驗證、預覽並送審。它產生的是**候選內容**，不是公開資料：公開場刊仍只來自 data repository 的 reviewed snapshot 與 pin。

**實作**：[`app/organizer/`](../../app/organizer)、[`app/organizer-client.ts`](../../app/organizer-client.ts)、[`app/organizer-event.ts`](../../app/organizer-event.ts)、[`app/organizer-import.ts`](../../app/organizer-import.ts)、[`app/organizer-workbook.ts`](../../app/organizer-workbook.ts)、[`app/event-authoring-scope.ts`](../../app/event-authoring-scope.ts)、[`app/publication-bundle-assembler.ts`](../../app/publication-bundle-assembler.ts)、[`app/github-publication.ts`](../../app/github-publication.ts)、[`app/circle-portal-handlers.ts`](../../app/circle-portal-handlers.ts)、[`db/identity-repository.ts`](../../db/identity-repository.ts)、[`functions/api/organizer/`](../../functions/api/organizer)、[`functions/api/admin/organizer/`](../../functions/api/admin/organizer)
**測試**：`tests/organizer-handlers.test.mjs`、`tests/organizer-repository.test.mjs`、`tests/organizer-entry.test.mjs`、`tests/organizer-import.test.mjs`、`tests/event-authoring-scope.test.mjs`、`tests/publication-bundle.test.mjs`、`tests/github-publication.test.mjs`、`tests/multi-space-event-map.test.mjs`
**決策**：[ADR-0046](../adr/0046-approved-organizer-publications-may-merge-app-owned-pull-requests.md)、[ADR-0038](../adr/0038-authoring-moves-to-the-control-surface-local-stays-as-backup.md)、[ADR-0039](../adr/0039-one-data-repo-for-events-and-references.md)、[ADR-0044](../adr/0044-an-accepted-circle-list-is-not-yet-catalogable.md)

> **實作狀態（2026-08-31）**：建立 → 匯入 → 地圖 → 驗證 → 預覽 → 送審 → 核准已在 Web UI 完成，不需要修改程式、操作 Git 或執行 CLI。**發布尚未啟用**：核准只建立一筆 `queued` 發布工作，沒有任何東西寫進 data 或 main repository（見[發布邊界](#發布邊界)）。

## 入口與登入

- 入口是 `/organizer`，`noindex, nofollow`，不出現在公開導覽，也**不與 `/circle` 或閱讀端共用 bundle**。
- 登入沿用[社團自助控制面](./circle-portal.md)的 email 一次性連結與 session cookie；`POST /api/auth/request-link` 以 `audience: "organizer"` 決定信件與登入連結指向 `/organizer`。Turnstile、速率上限與 session 規則只寫在該契約，本文不重複。
- **帳號本身沒有 Organizer 權限。** 能看到工作區的條件是持有任一候選活動的 grant，或是全域管理者。
- 工作區是桌機介面。視窗過窄時顯示「請改用桌機」，不提供縮小版的地圖編輯。

## 邀請制，不能自助開活動

- 候選活動只能由**全域管理者**以 `POST /api/admin/organizer/events` 建立，必須提供暫定名稱與 Owner email，並要求 fresh session。
- 建立成功即寄出 Organizer 邀請信；受邀者以該連結登入後自動接受待處理邀請並取得 grant。
- Owner 可邀請或撤銷 Editor；**只有全域管理者可以增減 Owner**。撤銷對尚未登入者同樣有效——撤掉 grant 或撤掉尚未接受的邀請，任一成立即算成功。
- 邀請會鑄造真正的登入連結，因此受三道獨立預算限制：每小時每收件匣 3 封**他人寄來的**邀請、每小時每邀請人 10 封，另沿用每 IP 每小時 20 封登入連結的上限。收件匣預算刻意不與本人自助索取的登入連結共用計數器，否則邀請人可以花光對方的額度把人鎖在帳號外。

## 候選活動的狀態

```text
draft → submitted → approved → publishing → published
          ↓                       ↓
   changes_requested            failed
```

- `draft` 與 `changes_requested` 可編輯；其餘狀態一律不可寫入。
- 每一次寫入都要帶 `expectedVersion`，成功後 `current_version` 遞增並留下一筆 immutable revision。版本落後回 409 並指出目前版本，不靜默覆寫。
- `eventId` 在**首次送審時鎖定**，之後不得改成別的值；未送審前可以修改。它在候選之間唯一（partial unique index）。**候選 eventId 與已發布活動同名的檢查目前不存在**；兩條管線靠 `candidate_id` 分離（見[與地圖貢獻流程的邊界](#與地圖貢獻流程的邊界)）。

## 草稿內容

`organizer-event-draft/1`，欄位與驗證規則以 [`app/organizer-event.ts`](../../app/organizer-event.ts) 為準：

| 區塊 | 內容 | 規則 |
|---|---|---|
| `event` | `id`、`name`、`days[]` | `id` 只允許小寫英數與連字號；每個活動日需要 id、名稱與 `YYYY-MM-DD` 日期，id 不得重複 |
| `venue.assignments` | `venueId`、`venueSpaceId`、`areaIds[]`、`mapTemplate` | 至少一個場館空間；`venueSpaceId` 不得重複，`areaIds` 不得為空 |
| `officialSource` | `label`、`url` | 來源說明必填；網址若填寫必須是 HTTPS |

## 攤位匯入

- **原始檔只在瀏覽器裡解析與雜湊。** `readOrganizerWorkbook()` 讀 CSV 或 XLSX、列出工作表、保留實體列號；沒有任何 API 接受這個 File。
- `PUT /api/organizer/events/:candidateId/imports` 只收主辦確認過的**正規化資料列**與來源 metadata（檔名、工作表、原始檔 SHA-256、來源說明、欄位 mapping）。
- 每一列的 `dayId`、`venueSpaceId` 與 `areaId` 必須落在草稿已宣告的集合內；同一活動日 × 場館空間 × 攤位代碼不得重複（大小寫不敏感）。
- `identityGroup` 只能是 `stable:<stableKey>` 或 `null`。**名稱相同不構成同一社團**，與[社團目錄契約](./circle-catalog.md)的 linkage 規則一致。
- 匯入是**取代**語意：一次請求就是這個候選活動的完整攤位表。新來源寫入時，前一份標記 `replaced_at`，其資料列不再是有效匯入。
- 兩道上限，回不同的狀態碼：**超過 20,000 列**在最初的參數檢查就回 `400`；**正規化後超過 8 MiB** 回 `413`。兩者各有自己的錯誤訊息，都在寫入之前拒絕，不會留下半套匯入。
- **分批不是這兩道上限的解法**——取代語意表示後一批會丟棄前一批。實際可行的是縮短欄位內容，或先確認匯入範圍是否真的屬於同一場活動。
- 稽核只留版本、列數與原始檔 SHA-256。**私人 workbook 的檔名與工作表名不寫進 `audit_log`**——來源可追溯靠 hash，檔名會比它描述的匯入列活得更久。

## 地圖

- 每一個「活動日 × venue-space」各一份地圖草稿，沿用既有的 `MapLayoutEditor` 與 template 辨識器。
- 候選地圖的 scope 由 [`resolveCandidateAuthoringScope()`](../../app/event-authoring-scope.ts) 從草稿與匯入列推導：`allowedBoothCodes` 與 `requiredBoothCodes` 都是該 scope 實際匯入的攤位代碼。
- **候選地圖沒有公開檔案位址**（`targetPath: null`）。已發布活動的 authoring scope 才有 `targetPath`，單一場館空間是 `map.json`，多場館空間是 `maps/<periodKey>/<venueSpaceId>.json`。

## 驗證、預覽與送審

- `POST …/validate` 回傳 `issues[]`，每筆帶 `severity`、`step`（`event`／`venue`／`import`／`map`／`preview`）、`code`，必要時帶 `row` 或 `target`。缺任何一份「活動日 × venue-space」地圖是 error，不是 warning。
- `POST …/preview` 回傳 `organizer-reader-preview/1`：草稿、匯入的配置與每份地圖 layout，供 Reader 樣式預覽。它不寫入任何資料。
- `POST …/submit` 只有 Owner 可以呼叫，且要求 fresh session。送審會固定一份 `organizer-submission-snapshot/1`（草稿、匯入來源 metadata、全部資料列與每份地圖內容），以其 SHA-256 作為 approval hash。
- **validate、preview 與 submit 讀同一份 bytes**：候選、匯入與每份地圖各只讀一次，所以送審固定的內容與剛才驗證過的內容不可能不同。
- `POST /api/admin/organizer/events/:candidateId/review` 由全域管理者以 fresh session 核准或要求修改。核准前重跑驗證；找不到該 revision 的 immutable snapshot 就拒絕。
- **管理者可以核准自己送出的 revision**，但稽核會記下 `selfApproval`、actor、snapshot hash、版本與時間。

## 發布邊界

核准會建立一筆 `queued` 發布工作，記錄 candidate、版本、snapshot 與 approval hash。**目前它不會前進。** 三處各自 fail closed：

1. `ORGANIZER_PUBLICATION_MODE` 預設 `disabled`；管理者的重試路徑在 disabled 時回 503。
2. `POST /api/integrations/github/webhook` 在非 `github` 模式或缺 secret 時回 503。
3. 即使模式打開，`onDelivery` 目前直接 throw，delivery 記為未處理並可用同一個 delivery id 重試。

已經在位的只有純函式邊界：

- [`publicationPathAllowed()`](../../app/publication-bundle-assembler.ts) 的路徑 allowlist——data repository 只接受 `events/<eventId>/` 底下的 `event`／`official-booths`／`circle-identity-groups`／`map`／`map-manifest`／`reference-selection`、`maps/<day>/<space>.json` 與 `NOTICE`，加上 `references/**.json`；main repository 只接受 `data/published-events.json`、兩份 identity 檔與該活動的 pin。`.github/**` 與任何跳脫路徑一律拒絕。
- webhook 的 HMAC 驗證與以 delivery id 去重。

ADR-0046 §3 的 head SHA pin、PR ownership、required checks 與 publication lease 條件要在 GitHub App 安裝與兩個 repository ruleset 經 API 實測之後才會接上。在那之前，核准後的候選停在 `approved`。

## 與地圖貢獻流程的邊界

`map_drafts` 由 organizer 與公開[地圖貢獻控制面](./map-contributions.md)共用，而候選活動的 `event_id` 可能正是某個已發布活動的 id。**唯一能分開兩條管線的是 `candidate_id`**：

- organizer 的地圖草稿 `candidate_id` 非 NULL，且只能經 `/api/organizer/**` 讀寫。
- 公開地圖貢獻流程的每一句 SQL 都要求 `candidate_id IS NULL`。

少了這個條件，同時具備 organizer 與 `map_contributor` 身分的人可以把候選地圖送進公開審閱並匯出成正式地圖。這是程式邊界，不是慣例；回歸測試涵蓋這個身分組合。

## 驗收條件

- 未登入或無 grant 的帳號拿不到任何候選活動；不存在的候選與無權限的候選都回 404，不區分。
- 任何寫入帶錯 `expectedVersion` 一律 409，且回應指出目前版本。
- 送審與核准是兩次獨立動作，各自要求 fresh session；核准自己送出的 revision 會在稽核留下 `selfApproval`。
- 匯入 API 拒絕未宣告的活動日、場館空間或展區，並在錯誤訊息指出來源列號。
- `ORGANIZER_PUBLICATION_MODE` 未設定時，核准後的候選停在 `approved`，且 webhook 回 503。
- 公開 bundle 不含 organizer 介面與寫入 route，由 `tests/rendered-html.test.mjs` 把關。
