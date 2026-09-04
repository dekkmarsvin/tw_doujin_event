# 主辦單位工作區契約

主辦單位在獨立入口 `/organizer` 建立候選活動、匯入攤位資料、畫地圖、驗證、預覽並送審。它產生的是**候選內容**，不是公開資料：公開場刊仍只來自 data repository 的 reviewed snapshot 與 pin。

**實作**：[`app/organizer/`](../../app/organizer)、[`app/organizer-client.ts`](../../app/organizer-client.ts)、[`app/organizer-event.ts`](../../app/organizer-event.ts)、[`app/organizer-workspace.ts`](../../app/organizer-workspace.ts)、[`app/organizer-import.ts`](../../app/organizer-import.ts)、[`app/organizer-workbook.ts`](../../app/organizer-workbook.ts)、[`app/event-authoring-scope.ts`](../../app/event-authoring-scope.ts)、[`app/publication-bundle-assembler.ts`](../../app/publication-bundle-assembler.ts)、[`app/github-publication.ts`](../../app/github-publication.ts)、[`app/circle-portal-handlers.ts`](../../app/circle-portal-handlers.ts)、[`db/identity-repository.ts`](../../db/identity-repository.ts)、[`functions/api/organizer/`](../../functions/api/organizer)、[`functions/api/admin/organizer/`](../../functions/api/admin/organizer)
**測試**：`tests/organizer-workspace.test.mjs`、`tests/organizer-handlers.test.mjs`、`tests/organizer-repository.test.mjs`、`tests/organizer-entry.test.mjs`、`tests/modal-focus.test.mjs`、`tests/organizer-import.test.mjs`、`tests/event-authoring-scope.test.mjs`、`tests/publication-bundle.test.mjs`、`tests/github-publication.test.mjs`、`tests/multi-space-event-map.test.mjs`
**決策**：[ADR-0047](../adr/0047-organizer-onboarding-opens-into-a-resumable-workspace.md)、[ADR-0046](../adr/0046-approved-organizer-publications-may-merge-app-owned-pull-requests.md)、[ADR-0038](../adr/0038-authoring-moves-to-the-control-surface-local-stays-as-backup.md)、[ADR-0039](../adr/0039-one-data-repo-for-events-and-references.md)、[ADR-0044](../adr/0044-an-accepted-circle-list-is-not-yet-catalogable.md)

> **實作狀態（2026-08-31）**：建立 → 匯入 → 地圖 → 驗證 → 預覽 → 送審 → 核准已在 Web UI 完成，不需要修改程式、操作 Git 或執行 CLI。**發布尚未啟用**：核准只建立一筆 `queued` 發布工作，沒有任何東西寫進 data 或 main repository（見[發布邊界](#發布邊界)）。

## 入口與登入

- 入口是 `/organizer`，`noindex, nofollow`，不出現在公開導覽，也**不與 `/circle` 或閱讀端共用 bundle**。
- 登入沿用[社團自助控制面](./circle-portal.md)的 email 一次性連結與 session cookie；`POST /api/auth/request-link` 以 `audience: "organizer"` 決定信件與登入連結指向 `/organizer`。Turnstile、速率上限與 session 規則只寫在該契約，本文不重複。
- **帳號本身沒有 Organizer 權限。** 能看到工作區的條件是持有任一候選活動的 grant，或是全域管理者。
- 工作區是桌機介面。視窗過窄時顯示「請改用桌機」，不提供縮小版的地圖編輯。
- 左側活動列表可以收合，收合後把寬度讓給工作區。收合狀態不保存，重新登入回到展開。

## 引導式任務站與活動建置冊

- 新候選活動先進入三項真實資料任務：活動識別與官方來源、活動日期、場館與使用空間。任務進度直接篩選 `validateOrganizerEventDraft()` 的 issue，不另有一套 Wizard 驗證。
- 三項基礎設定通過後，`POST /api/organizer/events/:candidateId/workspace/complete-onboarding` 以 `expectedVersion` 再次檢查已保存草稿，成功後永久進入活動建置冊。成功回應遺失後可用任何舊版本重送，仍會冪等回傳既有 binder 狀態；後續資料錯誤只顯示為需要處理，不會退回引導。
- 「查看全部項目」不完成 onboarding；它只暫時打開六個區段。每位協作者的上次引導任務與建置冊區段由 `PATCH …/workspace` 分別保存，跨登入恢復且不互相覆蓋。
- workspace 偏好與 onboarding 狀態不屬於候選內容：更新它們不增加 `current_version`，也不建立活動 revision。ADR-0047 上線前已存在、沒有 workspace state 的候選一律從建置冊開啟。
- 表單有未儲存變更時，切換活動、引導任務或建置冊區段會提供「儲存並切換／放棄／取消」；離開瀏覽器頁面則使用瀏覽器既有的未儲存變更確認。對話框沿用全站 shared modal focus lifecycle。Revision 一旦儲存成功，畫面會先同步新版本再執行引導或離開動作；後續動作失敗不會讓下一次儲存沿用舊版本。「儲存並離開」後保持未選取活動，不會因清單刷新自動重開第一筆。
- 建置冊直接開放活動、場館與使用空間、攤位匯入、地圖、驗證與預覽、送審與發布六區。Readiness 顯示完成區段數、具名阻擋項與建議下一步，不顯示百分比；`blocked` 只代表缺少技術前置資料，區段本身仍可開啟查看。活動或場館表單有未儲存變更時，Readiness 以目前表單內容即時顯示「尚未儲存」，不沿用上一版結果。
- 六區共用 [`app/organizer-workspace.ts`](../../app/organizer-workspace.ts) 的 prerequisite evaluator。活動與場館來自草稿 validation；匯入要求至少一列且沒有 import error；地圖要求匯入已完成、完整 day × venue-space coverage，且每份已保存地圖必須通過與正式 validation 相同的攤位覆蓋、未知攤位、重疊與幾何規則（未知攤位在候選活動是 warning，不擋住地圖區；理由見下方[地圖](#地圖)）；驗證只在沒有 error 且 `last_validated_version` 等於目前 candidate version 時完成；送審後 review 才完成。

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
| `venue.assignments` | `venueId`、`venueSpaceId`、`areaMode`、`areaIds[]`、`mapTemplate` | 至少一個場館空間；`venueSpaceId` 不得重複且必須屬於所選場館；`areaMode` 為 `imported` 或 `none`；`none` 必須且只能保存 `areaIds: ["ALL"]` |
| `officialSource` | `label`、`url` | 來源說明必填；網址若填寫必須是 HTTPS |

新增活動日時，表單預設第一日為作者當地的今天，之後每一日為最後一個有日期的活動日加一天；新活動日的 id 取最小尚未使用的序號。這是可覆寫的預設值，不是驗證規則。

`venueId` 與 `venueSpaceId` 是系統保存的 stable ID，介面不要求主辦輸入。主辦先從共用場館目錄選擇場館，再從該場館的使用空間下拉選擇；找不到時可以立即建立新場館與第一個使用空間，或在既有場館立即新增使用空間。每筆目錄資料都要求官方 HTTPS 來源，建立與 audit 在同一個 D1 transaction；新資料只是候選控制面的來源記錄，不會因此自動成為已發布 reference pin。

`areaIds` **不在場館表單手填**。`areaMode` 是每場活動自己的選擇，場館目錄的 `defaultAreaMode` 只提供新增 assignment 時的預設。`imported` 的展區是攤位名單事實，由匯入推導；`none` 代表這場活動在該使用空間沒有分區，匯入不用對應展區欄，系統固定保存 `ALL`。有匯入資料後，prerequisite 以 `missing_space_import` 指出未被檔案涵蓋的使用空間。

`mapTemplate` 的值域是 `listMapTemplateOptions()`，介面以下拉選單呈現並預覽這個選擇的後果（能否自動辨識配置圖、存檔時依什麼檢查）。草稿裡不在清單內的既有值會原樣保留為額外選項，不被靜默改寫。

## 攤位匯入

- **原始檔只在瀏覽器裡解析與雜湊。** `readOrganizerWorkbook()` 讀 CSV 或 XLSX、列出工作表、保留實體列號；沒有任何 API 接受這個 File。
- `PUT /api/organizer/events/:candidateId/imports` 只收主辦確認過的**正規化資料列**與來源 metadata（檔名、工作表、原始檔 SHA-256、來源說明、欄位 mapping）。
- 每一列的 `dayId`、`venueSpaceId` 與 `areaId` 必須落在草稿已宣告的集合內；`areaMode: none` 的列會被正規化為 `ALL`，不讀來源檔的展區值；同一活動日 × 場館空間 × 攤位代碼不得重複（大小寫不敏感）。
- **展區由這份檔案決定。** 預覽會列出檔案裡每個場館空間出現的展區與列數；主辦按下確認時，介面先把這些展區寫進草稿（一次正常的 `expectedVersion` 儲存），再以新版本送出匯入。API 端「未宣告的展區一律拒絕」的規則不變——被宣告的來源換成同一份檔案。
- 展區的推導與匯入一樣是**取代**語意：草稿裡有、但這份檔案沒有提到的分區空間會被清空展區；無分區空間仍固定為 `ALL`。prerequisite 的 `missing_space_import` 會指出沒有任何匯入列的使用空間。預覽會先以場館與使用空間名稱提醒哪些空間沒出現在檔案裡。
- 保存匯入後若再移除活動日、移除使用空間、切換展區方式或改變已宣告展區，validate、preview 與 submit 都會逐列反查既有匯入資料並要求重新匯入；舊列不會以 orphan space 或過期展區進入送審 snapshot。相同原因的列會聚合成一個帶影響列數與代表來源列的 issue，回應最多列出 100 組再加一筆省略摘要，避免 20,000 列名單放大成 20,000 個 blocker。
- 檔案裡出現草稿沒有的場館空間，或展區代碼不是英數字、底線與連字號（它會進公開網址）時，預覽直接擋下儲存並指出要修的是來源檔還是場館設定。
- `identityGroup` 只能是 `stable:<stableKey>` 或 `null`。**名稱相同不構成同一社團**，與[社團目錄契約](./circle-catalog.md)的 linkage 規則一致。
- 匯入是**取代**語意：一次請求就是這個候選活動的完整攤位表。新來源寫入時，前一份標記 `replaced_at`，其資料列不再是有效匯入。
- 兩道上限，回不同的狀態碼：**超過 20,000 列**在最初的參數檢查就回 `400`；**正規化後超過 8 MiB** 回 `413`。兩者各有自己的錯誤訊息，都在寫入之前拒絕，不會留下半套匯入。
- **分批不是這兩道上限的解法**——取代語意表示後一批會丟棄前一批。實際可行的是縮短欄位內容，或先確認匯入範圍是否真的屬於同一場活動。
- 稽核只留版本、列數與原始檔 SHA-256。**私人 workbook 的檔名與工作表名不寫進 `audit_log`**——來源可追溯靠 hash，檔名會比它描述的匯入列活得更久。

## 地圖

- 每一個「活動日 × venue-space」各一份地圖草稿，沿用既有的 `MapLayoutEditor` 與 template 辨識器。
- **「儲存地圖變更」只儲存，不關閉編輯器。** 一張地圖要畫很多輪，關閉是另一個決定，由「關閉編輯器」負責。儲存後編輯器沿用同一份 layout 繼續編輯，並改為更新剛才存下的那份地圖：第一次儲存之後的每一次儲存都是更新，不會再建立第二份。有未儲存變更時關閉才會出現「儲存並關閉／放棄／取消」。已保存的地圖沒有新變更時儲存鍵停用，旁邊沿用草稿表單同一組「尚有未儲存變更／目前沒有未儲存的變更」；還沒建立的地圖一律可以儲存。停用不只是版面整潔：每次儲存都讓 candidate 前進一個版本並寫入一份 revision，沒有變更的儲存會在歷史留下一步空紀錄。
- **配置圖跟著地圖存下來。** 一份地圖草稿有一張目前的配置圖，經 `PUT /api/organizer/events/:candidateId/maps/:draftId/background` 存進私人 bucket `MAP_CONTRIBUTIONS`，由 `GET` 同一個位址讀回，兩者都限協作者且回應 `private, no-store`。物件位址由草稿自己的 id 決定（`organizer-map-backgrounds/<candidateId>/<draftId>`），因此**沒有任何 D1 資料列指向它**：再上傳一次就是覆蓋同一個位址，草稿被保存期限清除時也照同一組 id 刪除，不需要先讀 metadata。只接受 JPEG／PNG／WebP，上限 10 MB，容器檢查與貢獻來源檔共用同一份 [`prepareMapImageFile()`](../../app/map-contribution-files.ts)。
- **上傳配置圖不推進版本。** 配置圖是描圖用的底圖，不是送審內容，所以它不增加 candidate version、不寫 map revision，只留一筆 `organizer_event.map_background_updated` 稽核。儲存鍵的停用條件因此不受影響。
- **會清掉畫面內容的動作都先問。** 空白畫布（畫面上有內容時）、切換地圖分頁、從同場館空間複製、切換使用空間（有未儲存變更時），以及已經有配置圖時再次上傳，都要先確認再執行。
- **編輯畫布的 100% 是整張地圖看得完**，不是把地圖拉滿畫布寬度；倍率由畫布實際可用空間與地圖比例算出，最高 400%。畫布高度來自編輯器版面而非固定值，右側屬性欄自行捲動，不把地圖擠成需要捲動才看得完。這條同樣適用於[地圖貢獻控制面](./map-contributions.md)嵌入的同一個編輯器。
- 候選地圖的 scope 由 [`resolveCandidateAuthoringScope()`](../../app/event-authoring-scope.ts) 從草稿與匯入列推導：`allowedBoothCodes` 與 `requiredBoothCodes` 都是該 scope 實際匯入的攤位代碼。
- **候選活動的地圖可以含沒有社團的攤位格。** 配置圖畫的是整個場地，包含沒賣掉的攤位，而那些格子沒有任何匯入列可以指認。已發布活動有 reviewed snapshot 透過 `existingBoothCodes` 認領這些格子，所以在那裡出現的陌生代碼是打錯字，仍然是 error；候選活動的第一份地圖沒有 snapshot 可依靠，因此 `unknown_booth` 降為 warning，代碼照樣列出來給人看。這是 `allowsUnallocatedBooths` 這個 scope 欄位唯一的用途。`missing_booth`、`overlap` 與幾何錯誤不受影響。
- **候選地圖沒有公開檔案位址**（`targetPath: null`）。已發布活動的 authoring scope 才有 `targetPath`，只有一組「活動日 × 場館空間」時是 `map.json`，多組時是 `maps/<periodKey>/<venueSpaceId>.json`。

## 驗證、預覽與送審

- `POST …/validate` 回傳 `issues[]`，每筆帶 `severity`、`step`（`event`／`venue`／`import`／`map`／`preview`）、`code`，必要時帶 `row` 或 `target`。缺任何一份「活動日 × venue-space」地圖是 error，不是 warning。成功時只把 workspace 的 `last_validated_version` 記為目前版本；不增加 candidate version，也不建立內容 revision。任何後續內容寫入使版本前進後，這個完成狀態自然失效；若版本在 validation 與 marker 寫入之間前進，API 回 409 並要求重新驗證，不會對舊版回報成功。
- `POST …/preview` 回傳 `organizer-reader-preview/1`：草稿、匯入的配置與每份地圖 layout，供 Reader 樣式預覽。它不寫入任何資料。
- `POST …/submit` 只有 Owner 可以呼叫，且要求 fresh session。送審會固定一份 `organizer-submission-snapshot/1`（草稿、所選場館與使用空間的完整名稱／官方來源記錄、匯入來源 metadata、全部資料列與每份地圖內容），以其 SHA-256 作為 approval hash。這使候選 review 不會隱性讀取日後新增的 catalog 狀態；發布仍必須把 snapshot 內的來源記錄轉成 data repository 中經 review 的 reference records、selection 與 commit/hash pin，不能直接把 D1 catalog 當成公開 reference data。
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
- 公開 bundle 不含 organizer 介面與寫入 route，由 `tests/public-artifact.test.mjs` 把關。
- 新候選活動預設進入引導；跨登入可恢復每位協作者自己的位置；完成 onboarding、切換區段或執行驗證都不會產生候選內容 revision。
- workspace preference 與完成 onboarding 的最終 SQL 寫入會再次檢查 active grant；權限在請求途中被撤銷時不會留下流程狀態變更，對外仍回 404。
