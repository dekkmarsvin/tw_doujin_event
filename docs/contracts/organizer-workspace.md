# 主辦單位工作區契約

主辦單位在獨立入口 `/organizer` 建立候選活動、匯入攤位資料、畫地圖、驗證、預覽並送審。它產生的是**候選內容**，不是公開資料：公開場刊仍只來自 data repository 的 reviewed snapshot 與 pin。

**實作**：[`app/organizer/`](../../app/organizer)、[`app/organizer-client.ts`](../../app/organizer-client.ts)、[`app/organizer-event.ts`](../../app/organizer-event.ts)、[`app/organizer-workspace.ts`](../../app/organizer-workspace.ts)、[`app/organizer-import.ts`](../../app/organizer-import.ts)、[`app/organizer-workbook.ts`](../../app/organizer-workbook.ts)、[`app/event-authoring-scope.ts`](../../app/event-authoring-scope.ts)、[`app/publication-bundle-assembler.ts`](../../app/publication-bundle-assembler.ts)、[`app/github-app-token.ts`](../../app/github-app-token.ts)、[`app/github-installation-probe.ts`](../../app/github-installation-probe.ts)、[`app/github-publication.ts`](../../app/github-publication.ts)、[`app/github-remote-auditor.ts`](../../app/github-remote-auditor.ts)、[`app/circle-portal-handlers.ts`](../../app/circle-portal-handlers.ts)、[`db/identity-repository.ts`](../../db/identity-repository.ts)、[`functions/api/organizer/`](../../functions/api/organizer)、[`functions/api/admin/organizer/`](../../functions/api/admin/organizer)、[`functions/api/admin/integrations/github/probe.ts`](../../functions/api/admin/integrations/github/probe.ts)
**測試**：`tests/organizer-workspace.test.mjs`、`tests/organizer-handlers.test.mjs`、`tests/organizer-repository.test.mjs`、`tests/organizer-reopen.test.mjs`、`tests/github-remote-auditor.test.mjs`、`tests/organizer-entry.test.mjs`、`tests/modal-focus.test.mjs`、`tests/organizer-import.test.mjs`、`tests/event-authoring-scope.test.mjs`、`tests/publication-bundle.test.mjs`、`tests/github-publication.test.mjs`、`tests/github-app-token.test.mjs`、`tests/github-installation-probe.test.mjs`、`tests/multi-space-event-map.test.mjs`
**決策**：[ADR-0047](../adr/0047-organizer-onboarding-opens-into-a-resumable-workspace.md)、[ADR-0046](../adr/0046-approved-organizer-publications-may-merge-app-owned-pull-requests.md)、[ADR-0058](../adr/0058-publication-is-enforced-by-the-app-not-the-ruleset.md)、[ADR-0038](../adr/0038-authoring-moves-to-the-control-surface-local-stays-as-backup.md)、[ADR-0039](../adr/0039-one-data-repo-for-events-and-references.md)、[ADR-0044](../adr/0044-an-accepted-circle-list-is-not-yet-catalogable.md)

> **實作狀態（2026-09-14）**：建立 → 匯入 → 地圖 → 驗證 → 預覽 → 送審已有 Web UI。#212 加入核准與 job 的原子建立、可恢復 executor 核心及發布 UX；#248 封入完整 references，#244 提供 snapshot → repository artifacts 純產檔。**正式發布仍未啟用**：production driver、durable dispatch 與真實 smoke 尚未接線；缺少 dispatch 或模式 disabled 時，核准 API 回 503 並保留 submitted（見[發布邊界](#發布邊界)）。

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
- 六區共用 [`app/organizer-workspace.ts`](../../app/organizer-workspace.ts) 的 prerequisite evaluator。活動與場館來自草稿 validation；匯入要求至少一列且沒有 import error；地圖要求匯入已完成、完整 day × venue-space coverage，且每份已保存地圖必須通過與正式 validation 相同的攤位覆蓋、未知攤位、重疊與幾何規則（未知攤位在候選活動是 warning，不擋住地圖區；理由見下方[地圖](#地圖)）；驗證只在沒有 error 且 `last_validated_version` 等於目前 candidate version 時完成；只有 published 才把送審與發布區段標為完成。

## 邀請制，不能自助開活動

- 候選活動只能由**全域管理者**以 `POST /api/admin/organizer/events` 建立，必須提供暫定名稱與 Owner email，並要求 fresh session。
- 建立成功即寄出 Organizer 邀請信；受邀者以該連結登入後自動接受待處理邀請並取得 grant。
- **管理者把自己填成負責人時，owner grant 在建立活動的同一個 transaction 內直接成立**，該筆邀請同時標記為建立時即接受，不必先收信。管理者本來就是唯一能增減 Owner 的角色，繞一圈收信不增加任何保證，卻讓建立者停在 `admin` 事件角色、看不到 Owner 專屬的送審控制項。稽核寫的是 `organizer_event.owner_granted_on_create`，與接受邀請分開。信照常寄出（那是一條可用的登入連結），寄信預算與寄送失敗的處理都不變；負責人填別人時行為完全不變，仍由對方收信登入後取得 grant。送審與核准的 fresh session 要求不因此放寬。
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
- `eventId` 在**首次送審時鎖定**，之後不得改成別的值；未送審前可以修改。它在候選之間唯一（partial unique index）。首次發布是 CREATE：核准 handler 對目前 published event resolver 預檢，executor 的 preparing_data 再透過 driver 檢查 published collection；同名以 `event_id_collision` 拒絕。amendment 由 #190 的明確 baseline 流程處理，不 silent overwrite 或自動轉換。兩條地圖管線仍靠 `candidate_id` 分離。

## 草稿內容

`organizer-event-draft/1`，欄位與驗證規則以 [`app/organizer-event.ts`](../../app/organizer-event.ts) 為準：

| 區塊 | 內容 | 規則 |
|---|---|---|
| `event` | `id`、`name`、`days[]` | `id` 只允許小寫英數與連字號；每個活動日需要 id、名稱與 `YYYY-MM-DD` 日期，id 不得重複 |
| `venue.assignments` | `venueId`、`venueSpaceId`、`areaMode`、`areaIds[]`、`mapTemplate` | 至少一個場館空間；`venueSpaceId` 不得重複且必須屬於所選場館；`areaMode` 為 `imported` 或 `none`；`none` 必須且只能保存 `areaIds: ["ALL"]` |
| `officialSource` | `label`、`url` | 來源說明與 HTTPS 網址均必填 |

新增活動日時，表單預設第一日為作者當地的今天，之後每一日為最後一個有日期的活動日加一天；新活動日的 id 取最小尚未使用的序號。這是可覆寫的預設值，不是驗證規則。

`venueId` 與 `venueSpaceId` 是系統保存的 stable ID，介面不要求主辦輸入。主辦先從共用場館目錄選擇場館，再從該場館的使用空間下拉選擇；找不到時可以立即建立新場館與第一個使用空間，或在既有場館立即新增使用空間。每筆目錄資料都要求官方 HTTPS 來源，建立與 audit 在同一個 D1 transaction；新資料只是候選控制面的來源記錄，不會因此自動成為已發布 reference pin。

`areaIds` **不在場館表單手填**。`areaMode` 是每場活動自己的選擇，場館目錄的 `defaultAreaMode` 只提供新增 assignment 時的預設。`imported` 的展區是攤位名單事實，由匯入推導；`none` 代表這場活動在該使用空間沒有分區，匯入不用對應展區欄，系統固定保存 `ALL`。有匯入資料後，prerequisite 以 `missing_space_import` 指出未被檔案涵蓋的使用空間。

`mapTemplate` 的值域是 `listMapTemplateOptions()`，介面以下拉選單呈現並預覽這個選擇的後果（能否自動辨識配置圖、存檔時依什麼檢查）。草稿裡不在清單內的既有值會原樣保留為額外選項，不被靜默改寫。

## 主辦與分類目錄

活動設定的 `references` 保存 `organizerAssignments[]`（organizerId／lead、co-organizer、partner）與 `categoryCatalog`（id／organizerId／revision）。必須恰好一位 lead，單位不可重複；分類目錄屬於已選單位且至少含一個有效分類。建立及選取共用 Reader 分類驗證，分類名稱不可使用其保留名稱「全部類別」。未選可以儲存未完成草稿，但 validate／submit 會阻擋；明確選入的錯誤 reference 在 save 即拒絕。

`POST /api/organizer/events/:candidateId/references` 接受 expectedVersion、kind、名稱、HTTPS 官方來源；分類目錄另含所屬主辦與分類 label／選填 description。Owner／Editor／Admin 可在 draft／changes_requested 建立，舊版本或已鎖定狀態拒絕；建立與 audit 原子完成，候選內容不因目錄建立而前進版本。使用者選取後以原本的草稿 save 套用。沒有原地修改既有 reference 的 API；不提供猜測分類或 stable ID 輸入欄。

`organizer_reference_records` 保存 canonical public_reference_json 與 source_captured_at。場館／空間正常建立在同交易固定 canonical 記錄；seed adoption 依 [ADR-0061](../adr/0061-organizer-snapshot-pins-complete-reference-records.md) 的已核對來源與時間，只補缺少記錄，既有 metadata 不一致時不強行採用。控制面名稱「全館」與公開名稱「爭艷館展區」分開保存。

validate／preview／submit 共用 selected-reference resolver。`organizer-reader-preview/1.references` 是所選 canonical 公開記錄，介面呈現主辦、分類與正式場館名稱；選單仍使用原本 venueCatalog 的友善名稱。公開 schema／檔案選取 parser 與 CLI 共用 `app/reference-selection.mjs`。

## 攤位匯入

- **原始檔只在瀏覽器裡解析與雜湊。** `readOrganizerWorkbook()` 讀 CSV 或 XLSX、列出工作表、保留實體列號；沒有任何 API 接受這個 File。
- `PUT /api/organizer/events/:candidateId/imports` 只收主辦確認過的**正規化攤位群組**與來源 metadata（檔名、工作表、原始檔 SHA-256、來源說明、欄位 mapping）。
- 每個群組的 `dayId`、`venueSpaceId` 與 `areaId` 必須落在草稿已宣告的集合內；`areaMode: none` 的列會被正規化為 `ALL`，不讀來源檔的展區值；同一活動日 × 場館空間 × 攤位代碼不得重複（大小寫不敏感）。
- 每個群組保存 `codes[]`、社團名稱與原來源列；一團多攤不需要填主辦內部編號。重複驗證逐個代碼進行，同群組內重複也整批拒絕；API 要求非空的字串陣列，各碼不超過 80 字元，現有 20,000 群組與 8 MiB 上限不變。
- 欄位 mapping 保存 `boothCodeMode`：預設 `single` 不拆碼；`delimited` 以空白、逗號（含全形）、頓號、分號（含全形）或斜線拆分；`fixed-width` 使用主辦明確確認的 `boothCodeWidth`（1–80 字元）。寬度只提出候選值、不自動套用；不可整除或包含分隔符號時，指出來源列並擋住儲存。`single` 遇可能連寫的代碼，於 mapping／預覽即提示。
- 預覽顯示群組列數、展開代碼總數與各列的全部代碼；已儲存清單提供社團／代碼／內部編號搜尋、活動日與使用空間篩選、依第一個攤位代碼自然排序及每頁 100 列的分頁。唯讀清單在候選鎖定時仍可檢視；逐列編輯、拆分／合併與地圖雙向對照分別由 #214／#215 承接。
- D1 以新增的 nullable `codes_json` 保存群組，舊 `booth_code` 欄保留為相容投影（新寫入為群組第一碼）。舊資料未有 `codes_json` 時讀成 `[booth_code]`，**不猜拆舊合併代碼**，不改寫任何既有 approval snapshot。新送審使用 `organizer-submission-snapshot/3` 並保存 `codes[]`；舊 `/1` snapshot 原 bytes 與 hash 不變。舊版匯入寫入格式會被 API 拒絕，重新載入 UI 後使用新版群組格式。
- authoring scope 與地圖覆蓋驗證攤平 `codes[]`；Reader preview 的 placement 仍一碼一筆，同群組每碼帶相同社團名稱。正式已發布活動的讀取／身分投影不變。metadata mapping 與新 snapshot 均可追溯主辦確認的拆碼選擇。
- **預覽可以逐列修正。** 缺值或攤位重複的列會列在「待修正」，直接在預覽裡補上活動日、使用空間、展區、攤位代碼、社團名稱或主辦內部編號；也可以移除個別列，或一次略過全部待修正的列。活動日與使用空間只能從活動已宣告的清單選，展區與攤位代碼是來源檔的事實，維持自由輸入。補上主辦內部編號會一併重算該列的 `identityGroup`。
- 移除的列**既不匯入也不再回報問題**，而且不佔用攤位位置：同一攤位的重複因此可能由移除另一列解除。修正與移除以來源列號為鍵，換檔案、換工作表或改標題列時一律清空——那三個動作會改變列號指的是哪一列。
- 還有待修正的列時不能儲存；要嘛補完，要嘛移除。這只擋住這一步，未宣告的活動日、使用空間或展區在 API 端仍然照樣拒絕。
- **展區由這次匯入決定。** 預覽會列出這次要匯入的每個場館空間出現的展區與列數（含手動補正，不含已移除的列）；主辦按下確認時，介面先把這些展區寫進草稿（一次正常的 `expectedVersion` 儲存），再以新版本送出匯入。API 端「未宣告的展區一律拒絕」的規則不變——被宣告的來源換成同一份檔案。
- 展區的推導與匯入一樣是**取代**語意：草稿裡有、但這次匯入沒有提到的分區空間會被清空展區——包含整批被移除的那些列所屬的空間；無分區空間仍固定為 `ALL`。prerequisite 的 `missing_space_import` 會指出沒有任何匯入列的使用空間。預覽會先以場館與使用空間名稱提醒哪些空間沒出現在檔案裡。
- 保存匯入後若再移除活動日、移除使用空間、切換展區方式或改變已宣告展區，validate、preview 與 submit 都會逐列反查既有匯入資料並要求重新匯入；舊列不會以 orphan space 或過期展區進入送審 snapshot。相同原因的列會聚合成一個帶影響列數與代表來源列的 issue，回應最多列出 100 組再加一筆省略摘要，避免 20,000 列名單放大成 20,000 個 blocker。
- 檔案裡出現草稿沒有的場館空間，或展區代碼不是英數字、底線與連字號（它會進公開網址）時，預覽直接擋下儲存並指出要修的是來源檔還是場館設定。
- 主辦內部編號只供主辦自用核對，UI 不承諾跨活動識別。`identityGroup` 只能是 `stable:<stableKey>` 或 `null`。**名稱相同不構成同一社團**，與[社團目錄契約](./circle-catalog.md)的 linkage 規則一致。
- 匯入是**取代**語意：一次請求就是這個候選活動的完整攤位表。新來源寫入時，前一份標記 `replaced_at`，其資料列不再是有效匯入。
- 兩道上限，回不同的狀態碼：**超過 20,000 列**在最初的參數檢查就回 `400`；**正規化後超過 8 MiB** 回 `413`。兩者各有自己的錯誤訊息，都在寫入之前拒絕，不會留下半套匯入。
- **分批不是這兩道上限的解法**——取代語意表示後一批會丟棄前一批。實際可行的是縮短欄位內容，或先確認匯入範圍是否真的屬於同一場活動。
- 稽核只留版本、列數與原始檔 SHA-256。**私人 workbook 的檔名與工作表名不寫進 `audit_log`**——來源可追溯靠 hash，檔名會比它描述的匯入列活得更久。
- **hash 證明的是來源檔，不是每一列。** 預覽裡的手動補正與移除不改變 hash，也不逐列留下紀錄；可追溯的是「這份檔案，加上主辦在這一版所做的修正」。最終資料列本身由送審 snapshot 固定（見[驗證、預覽與送審](#驗證預覽與送審)），要核對某一版實際匯入了什麼，看的是那份 snapshot 而不是 hash。

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

- 地圖檢查保留完整 `boothCodes`，檢查與預覽以活動日與場館空間標示每項問題；攤位差異顯示比對的匯入檔名、工作表與該範圍列數，可展開全部代碼，缺少的攤位另顯示社團名稱與來源列號。提示分別引導檢查地圖與匯入欄位，未知攤位維持 warning，缺少攤位維持 error。

- `POST …/validate` 回傳 `issues[]`，每筆帶 `severity`、`step`（`event`／`venue`／`import`／`map`／`preview`）、`code`，必要時帶 `row` 或 `target`。缺任何一份「活動日 × venue-space」地圖是 error，不是 warning。成功時只把 workspace 的 `last_validated_version` 記為目前版本；不增加 candidate version，也不建立內容 revision。任何後續內容寫入使版本前進後，這個完成狀態自然失效；若版本在 validation 與 marker 寫入之間前進，API 回 409 並要求重新驗證，不會對舊版回報成功。
- `POST …/preview` 回傳 `organizer-reader-preview/1`：草稿、匯入的配置與每份地圖 layout，供 Reader 樣式預覽。它不寫入任何資料。
- `POST …/submit` 只有 Owner 可以呼叫，且要求 fresh session。新送審固定 `organizer-submission-snapshot/3`：草稿、完整 reference selection、各 reference 的 path／原始 JSON bytes／SHA-256、匯入來源 metadata、`codes[]` 攤位群組與地圖內容；`contentUpdatedAt` 取該 candidate version 的 immutable revision.created_at。既有 `/1`、`/2` snapshot bytes/hash 保持不變。產檔只能使用 snapshot，不可回讀 live catalog 或推測舊 snapshot 缺少的公開資料。
- **validate、preview 與 submit 讀同一份 bytes**：候選、匯入與每份地圖各只讀一次，所以送審固定的內容與剛才驗證過的內容不可能不同。
- `POST /api/admin/organizer/events/:candidateId/review` 由全域管理者以 fresh session 核准或要求修改。核准前重跑驗證；找不到該 revision 的 immutable snapshot 就拒絕。
- **管理者可以核准自己送出的 revision**，但稽核會記下 `selfApproval`、actor、snapshot hash、版本與時間。

## 發布邊界

核心實作：[`organizer-publication.ts`](../../app/organizer-publication.ts)、[`organizer-publication-presentation.ts`](../../app/organizer-publication-presentation.ts)、[`publication-rollout.ts`](../../app/publication-rollout.ts)、[`github-remote-auditor.ts`](../../app/github-remote-auditor.ts)。測試：`tests/organizer-repository.test.mjs`、`tests/organizer-handlers.test.mjs`、`tests/organizer-reopen.test.mjs`、`tests/github-remote-auditor.test.mjs`、`tests/organizer-publication-presentation.test.mjs`。決策：[ADR-0057](../adr/0057-approval-starts-create-publication.md)、[ADR-0058](../adr/0058-publication-is-enforced-by-the-app-not-the-ruleset.md)、[ADR-0059](../adr/0059-failed-publication-requires-explicit-reopen.md)。

依 ADR-0057，UI 動作為「核准並發布」。已啟用且有 durable dispatch adapter 時，同一 D1 transaction 記錄核准、建立唯一 `queued/preparing_data` job、把 candidate 改為 publishing，再交給 dispatcher；不需要第二次人工發布。dispatch 失敗記錄 `dispatch_failed`，內容保持核准與鎖定，可由 Owner 或 Admin 重試。

`app/organizer-publication.ts` 每次 delivery 至多執行一個 transition，持有有時限的全域 lease。snapshot id、版本、hash 與 snapshot bytes 必須相符。driver 以 job/step/hash 作為 reconciliation key，副作用前必須再次確認 lease；pending 保留步驟。已保存的 PR、head SHA、merge SHA 與 workflow id 不能被新的 checkpoint 改寫。

步驟為 preparing_data → waiting_data_checks → merging_data → preparing_main → waiting_main_checks → merging_main → waiting_deployment → verifying_production → completed。失敗保留原 step、failure_code、error、retryable 與 metadata。Main 需要 data merge SHA，deployment 需要 main merge SHA；productionVerified 必須明確為 true 才能完成。此 boolean 是 **driver 的 blocking Pages smoke 結果**，目前沒有 production adapter 實作，不能把測試 driver 當成真實 smoke。

driver 第一次 remote mutation 前必須先以目前 job、candidate version、approval 與 lease CAS 寫入 sticky `remote_write_intent_at`，再在每個 mutation 前 assert lease；錯誤、timeout、空 remote audit 與 retry 都不清除它。這個欄位只表示遠端結果可能未知，不代替已確認的 PR／SHA／workflow checkpoint，因此有 intent 的 failed candidate 不能被 reopen。

同版本核准重送沿用相同 snapshot/hash 的既有 job，不重寫核准、不重複 dispatch；不一致回報 `approval_mismatch`。相同 snapshot/hash 的既有 queued job 可在 submitted 核准時沿用。nullish metadata 表示未提供更新，保留已保存的 checkpoint。

lease 過期後，只允許仍持有原 token 與原 step 的 executor 寫入 failed/retryable；不能推進步驟，也不能覆寫新 lease 持有者。失敗記錄遭 fence 拒絕時向 dispatcher 拋出失敗，不把該 delivery 當成成功。

`POST /api/organizer/publications/:jobId/retry` 先驗證登入再查詢 job，與既有 admin route 共用 Owner／Admin fresh-session 檢查，Editor 無權重試。只恢復同一 failed/retryable job 與 snapshot，不建立另一筆 job；不可重試的 collision/hash failure 顯示具體下一步，不表示內容退件。

只有明確的 Owner／Admin 動作可以把「目前版本、已核准、狀態為 `failed`」的候選退回 `changes_requested`：`POST /api/organizer/events/:candidateId/reopen` 需要 fresh session、`expectedVersion` 與必填退回理由。它不受 publication mode disabled 影響，但會先取得既有 global lease，查核固定 data/main repository 中 `organizer/{jobId}/data` 與 `/main` 的分支，以及包含 closed／merged 的完整 PR 分頁；任何 branch、PR、403、網路錯誤、格式錯誤或不完整分頁都拒絕。七個 remote checkpoint 與 `remote_write_intent_at` 都必須為 NULL，且 audit 與提交交易間 lease token 仍有效。

成功退回會遞增 candidate version、保留 `eventId` 鎖定與舊 snapshot／review／job，新增 immutable revision 與含理由的 `changes_requested` review，並令舊 job `retryable = 0`。舊 job 仍會在頁面顯示為上一版本的歷史發布紀錄，不能再 retry；新的版本回到一般編輯、驗證與送審流程。Owner／Admin 以外的 Editor 沒有此動作。

**`queued` 停留超過 15 分鐘就是失敗。** 只有 dispatch 會讓 job 離開 `queued`，而 retry 只接受 `failed`，所以 dispatch 從未發生的 job 原本會永遠卡住。超過這個逾時值後，下一次讀取活動列表或任一候選活動時，系統把該 job 改為 `failed` + `queued_timeout` + retryable，step 原封不動，candidate 一併轉為 `failed`。接手的是上一段那條既有恢復路徑——同一筆 job、同一份 snapshot——不另外提供「手動啟動 queued job」的入口，否則就出現第二條產生 publication 的路徑。等待 CI 的狀態是 `publishing` 而不是 `queued`，不受這個逾時影響；lease 仍未過期的 job 留給持有者，不在這裡改寫。

**逾時的 job 不一定從未開始，所以失敗訊息看 checkpoint 而不是 step。** retry 會把 job 放回 `queued` 並保留原 step，因此同一個逾時有兩種來源：從未被 dispatch 的 job，以及重試後 dispatch 又沒發生、先前 checkpoint 都還在的 job。判準是這份工作有沒有留下任何 checkpoint。`preparing_data` 是新工作唯一能通過的第一步，而 `missing_checkpoint` 不允許它在缺 `data_pr_number` 與 `data_head_sha` 的情況下前進；其後每一步在它完成前都到不了，`preparing_main` 起另有 `missing_data_commit` 把關。因此七個 checkpoint 欄位全空就代表這份工作什麼都還沒碰到。（並非每個步驟都宣告 required checkpoint——`waiting_data_checks`、`waiting_main_checks` 與 `verifying_production` 沒有——但新建的工作過不到那裡。）pending 的 delivery 會寫下 metadata 卻不推進 step，所以這個判準量的是「有沒有東西跑過」，不是「有沒有階段完成」；區分從未被 dispatch 的工作與遠端產物已經釘住的工作，要的正是前者。**step 不能拿來判斷**：核准流程建立的 job 落在 `preparing_data`，舊的建立路徑落在 `assemble`，而 retry 保留上次失敗的那一步，同一個名字同時涵蓋兩種情形。只有從未完成任何階段的才說發布沒有開始；其餘沿用既有 retryable 措辭，因為 UI 四階段對它已經顯示出已完成的階段，說「沒有開始」會與同一畫面互相矛盾。

UI 四階段保留已完成進度，raw error 與 step 放在「技術詳細資訊」。每五秒重新讀取進行中的工作與活動列表狀態，不重疊請求；讀取失敗立即標示目前為上次讀取的進度，401 停止輪詢並提供重新登入入口，其他錯誤連續三次後停止，提供手動重新讀取。送審與發布只有 published 才算完成，不能在 approved/queued 顯示 6/6。同源、同瀏覽器帳號的上次 candidate 保存於 localStorage，讀寫被封鎖時仍可在記憶體中操作；登入後仍以伺服器授權清單確認可達性，各協作者的區段仍由 D1 保存。

目前 production gate：

1. `ORGANIZER_PUBLICATION_MODE` 預設 disabled；尚未提供 dispatcher，即使改成 github 也不能核准或 retry。
2. `POST /api/integrations/github/webhook` 仍未連接 executor，非 github 或缺 secret 回 503，否則 processing fail closed，不能宣稱已完成 GitHub publication。
3. `POST /api/admin/integrations/github/probe` 只接受同源 JSON `{}` 且要求 fresh-admin session；伺服器以固定 metadata:read scope 呼叫 GitHub App mint，必須得到精確 `201`，再以 installation token 讀取同一 repository metadata，GET 必須是精確 `200` 且 JSON `full_name` 完全相符才回 `{"ok":true}`。失敗只回固定 503 code；正式啟用仍須在已部署 runtime 實測。

GitHub App token provider 使用 WebCrypto RS256 簽署 App JWT（`iat = now - 60s`、`exp = iat + 600s`），接受 PKCS#8 與 PKCS#1 RSA private key。每個 provider／job 只有一份記憶體 cache；token 剩餘 60 秒內更新，進行中的 mint 共用同一個 pending promise。請求遭遇 `401` 時，每個 request 最多 invalidate 並重試一次，而且只有被拒絕的 token 仍是目前 cache 才能 invalidate；`403` 不刷新 token。缺少 App ID、installation ID 或 private key，以及 import/sign/fetch/JSON 例外，都轉成固定 `PublicationFailure`，不保存或回傳 raw exception、request body、Authorization、key、JWT 或 token。

`app/publication-rollout.ts` 的 ruleset 評估器**不是 gate**：依 [ADR-0058](../adr/0058-publication-is-enforced-by-the-app-not-the-ruleset.md) §3 它是維運報告，不阻擋任何 publication 步驟，也不是開啟 `ORGANIZER_PUBLICATION_MODE` 的必要條件。它目前的判定仍是 active 不足以通過、必須要求 PR、所有指定 checks、已確認 App id 且無 App bypass；該判定要到 #227 的程式改動落地才改變。它沒有 runtime caller。

### 核准 snapshot 產檔

`app/publication-artifacts.ts` 只消費完整 snapshot/3 與其核准 hash。資料產生不讀即時 catalog、時鐘或網路：內容時間取 contentUpdatedAt；活動結束取最後日期台灣時間 23:59:59；活動與逐日攤位表網址皆取已核准 officialSource.url。地圖保留每個 day × venue-space 的內容，單一範圍產生 map.json，多範圍產生完整 manifest。現行公開格式要求同活動模板一致、展區由使用空間唯一持有；不相容 snapshot 明確拒絕，不取第一個空間猜值。

`buildPublicationDataStage` 要求固定 data base commit、活動目錄不存在的觀測，以及每個 selected reference 的既有 bytes 或明確 null。缺失觀測不可當不存在；語意相同的 JSON 保留既有 bytes 並不加入寫入清單，不同或損壞拒絕。`buildPublicationMainStage` 要求實際 data merge commit／檔案 bytes 與固定 main base 資料；事件內容必須與 snapshot 產物完全相同，reference 可只有 JSON 格式差異，pin 的 hash 一律取實際 bytes。

main 清單保留原 events 順序追加；已存在活動或 pin 拒絕 CREATE。沿用同一份 event-local identity 配號器追加 allocations／evidence，不因同名猜 linkage，不動既有活動 pin；身分群組使用 codes[]，只有 snapshot 的 stableKey 能合併多個官方群組。完整產物再經 publication allowlist。這些純函式不建立或合併 PR，production driver 仍由 #245 接線。

既有純函式邊界保留：

- [`publicationPathAllowed()`](../../app/publication-bundle-assembler.ts) 的路徑 allowlist——data repository 只接受 `events/<eventId>/` 底下的 `event`／`official-booths`／`circle-identity-groups`／`map`／`map-manifest`／`reference-selection`、`maps/<day>/<space>.json` 與 `NOTICE`，加上 `references/**.json`；main repository 只接受 `data/published-events.json`、兩份 identity 檔與該活動的 pin。`.github/**` 與任何跳脫路徑一律拒絕。
- webhook 的 HMAC 驗證與以 delivery id 去重。

ADR-0046 §3 的 GitHub App ownership、required checks、allowlist、expected SHA merge、data → main → deployment 與 production origin smoke 仍須由 production driver 接線並實測。既有 approved/queued（包括 ch-20）保留原 snapshot/job，不做一次性資料修正，也不會被自動發布；超過 `queued` 逾時的那幾筆由上述機制轉成 failed + retryable，恢復仍是重試原 job，不要求 Organizer 再按一次 Publish。

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
- 預覽裡移除的列不會被匯入，也不會產生待修正項目；被它解除的攤位重複不再回報。
- 手動補正過的列仍要通過與其他列相同的檢查：未宣告的活動日、場館空間或展區照樣被匯入 API 拒絕，介面上的修正不是繞過那道檢查的路。
- `ORGANIZER_PUBLICATION_MODE` 未設定時，核准後的候選停在 `approved`，且 webhook 回 503。
- 只有 Owner／Admin 以 fresh session、目前版本與非空理由可退回 `failed` 候選；系統先以 global lease 查核固定遠端分支與完整 PR 分頁，任何遠端紀錄或不確定性都拒絕，成功後保留 eventId／歷史並令舊 job 不可重試。
- 退回期間若 lease 過期或版本 CAS 失敗，不新增 revision、review 或 audit；sticky `remote_write_intent_at` 與任一 confirmed checkpoint 也會阻止退回。
- 停在 `queued` 超過 15 分鐘的發布工作，在活動列表與活動頁都顯示為失敗且可重試，重試的是原本那一筆 job；沒有任何介面可以手動啟動一筆 `queued` job。
- 逾時失敗的訊息只有在該 job 一個 checkpoint 都沒有時才說發布沒有開始；已經留下 checkpoint 的工作沿用既有 retryable 措辭，不與四階段清單上的進度互相矛盾。這條對核准流程建立的 job（`preparing_data`）與舊建立路徑（`assemble`）都成立。
- 公開 bundle 不含 organizer 介面與寫入 route，由 `tests/public-artifact.test.mjs` 把關。
- 新候選活動預設進入引導；跨登入可恢復每位協作者自己的位置；完成 onboarding、切換區段或執行驗證都不會產生候選內容 revision。
- workspace preference 與完成 onboarding 的最終 SQL 寫入會再次檢查 active grant；權限在請求途中被撤銷時不會留下流程狀態變更，對外仍回 404。
