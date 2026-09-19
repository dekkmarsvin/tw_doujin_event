# 地圖貢獻控制面契約

地圖貢獻讓經管理者授權的維護者，把**活動主辦官方說明頁面中的配置證據**整理成私人草稿。它不新增資料來源：公開快照的基礎仍只來自主辦官方頁面，社團補充則仍只由社團本人自填；工作簿、社群試算表與其他第三方資料不在來源鏈中。

本契約涵蓋 [#72](https://github.com/dekkmarsvin/tw_doujin_event/issues/72) 的角色、私人草稿、檔案與保存機制，[#73](https://github.com/dekkmarsvin/tw_doujin_event/issues/73) 的投稿、審閱、核准替換與 event-data 候選匯出，以及 [#86](https://github.com/dekkmarsvin/tw_doujin_event/issues/86) 拆出的協作能力：審閱留言串、指向單一元素的局部修改請求（[#100](https://github.com/dekkmarsvin/tw_doujin_event/issues/100)）與具名的版本衝突說明（[#101](https://github.com/dekkmarsvin/tw_doujin_event/issues/101)）。政策決策見 [ADR-0033](../adr/0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md)。

**實作**：[`app/map-contribution-files.ts`](../../app/map-contribution-files.ts)、[`app/circle-portal-handlers.ts`](../../app/circle-portal-handlers.ts)、[`db/identity-repository.ts`](../../db/identity-repository.ts)、[`db/retention-purge.ts`](../../db/retention-purge.ts)、[`functions/api/map-contributions/`](../../functions/api/map-contributions)
**測試**：`tests/map-contribution-files.test.mjs`、`tests/map-contribution-handlers.test.mjs`、`tests/map-contribution-repository.test.mjs`、`tests/map-contribution-retention.test.mjs`

> **實作狀態（2026-08-31）**：地圖貢獻 route 目前仍只服務 Pages 設定的單一 `eventId`。[ADR-0043](../adr/0043-the-circle-portal-is-event-agnostic.md) 將社團入口改為通用入口，但沒有決定 `map_contributor` 是否逐活動授權；[#136](https://github.com/dekkmarsvin/tw_doujin_event/issues/136) 也明確不擴張此流程。因此下方單一活動範圍仍是現行契約，未來若要改必須另行定案，不能從社團多活動 ownership 自動類推。

## 與主辦單位工作區共用一張表

`map_drafts` 同時保存本流程的公開貢獻草稿與[主辦單位工作區](./organizer-workspace.md)的候選活動地圖，而候選活動的 `event_id` 可能正是某個已發布活動的 id。**兩條管線只由 `candidate_id` 分開**：

- 本契約涵蓋的每一句查詢與寫入都要求 `candidate_id IS NULL`。
- 候選活動地圖的 `candidate_id` 非 NULL，只能經 `/api/organizer/**` 讀寫，且沒有公開 `targetPath`。

少了這個條件，同時具備 `map_contributor` 與 organizer 身分的人可以把候選地圖送進本流程的審閱並匯出成正式地圖。這是程式邊界，由回歸測試涵蓋。

## 授權邊界

- `map_contributor` 沿用 magic-link 帳號，由具有近期 session 的管理者以 `POST /api/admin/map-contributors` 授予、撤銷或停權。
- 社團認領不會自動取得此角色；停用帳號也不具備投稿能力。
- 撤銷與停權立即阻止建立、修改、上傳與提交，但不刪除已進入審閱流程的紀錄。
- 原始檔只有草稿 owner 與管理者可讀。原始下載一律是 attachment；圖片可經授權 route 預覽，PDF 不提供 inline 預覽。

## 共用畫布放置

Organizer 與地圖貢獻使用同一個 `MapLayoutEditor`。新增工具只切換模式，尚未放置不改草稿；工具顯示按下狀態、畫布游標及操作提示。切換工具或 Escape 取消尚未放置的預覽，`pointercancel` 不建立元素，也不留下復原紀錄。

- 排／排段與單一攤位拖出外框，放開才建立；沿用既有連續描摹與編號。
- 柱子、企業攤、舞台與其他區域可拖出外框，或單擊以預設大小置中放置；靠近畫布邊緣時限制在畫布內。點擊與拖曳以螢幕 3 px 區分，單方向細線不建立矩形。
- 入口／出口以單擊位置建立，預設朝北，可在屬性欄更改。每次設施放置只記一個復原步驟，選取新元素並回到選取模式。

### 私人輔助線與吸附

草稿 envelope 可選填 `authoring: { guides: [{ id, axis, position, locked }] }`；`axis` 為 `x`（垂直）或 `y`（水平），位置採地圖座標。舊稿未帶 authoring 時，介面視為零條輔助線，不改寫舊的 snapshot bytes。每稿最多 256 條，ID 唯一且最多 80 字，位置為有限數字且不得超出畫布；未知欄位與 malformed metadata 拒絕保存。

- 水平／垂直工具以畫布單擊新增；輔助線可選取、拖曳、數字微調、鎖定／解鎖、刪除。鎖定禁止移動，仍可作吸附目標。線條為細虛線，命中區大於可見線寬。
- 新增、移動、鎖定與刪除可復原／重做，和地圖共用同一份歷史。畫布尺寸改動同時縮放輔助線，復原也一併還原。
- 矩形外緣與出入口中心吸附手動線及既有向量元素，8 螢幕 px 內取最小位移，同距離優先手動線。多選移動用整組外框，保留成員相對位置；排段縮放只改所拖角的邊，內部再等分並保持無縫。
- 顯示輔助線與啟用吸附是分開的控制，Alt 暫停目前手勢的吸附。吸附時顯示命中線及其 X／Y 座標；不從圖片偵測邊線，也不為每個攤位自動建立輔助線。

Organizer 與地圖貢獻皆把 authoring 跟隨 map revision 保存、重開，沿用原有角色／狀態與 expected version／revision 檢查；不新增資料表或另一條保存路徑。核准 snapshot 保留私人草稿內容，但 publication／候選匯出僅取 `content.layout`，公開地圖與 Reader 不含輔助線。顯示／吸附開關不推進候選版本。

### 描摹顯示與精準操作

配置圖顯示與否、透明度、描摹模式與微移步進都是個人 UI 偏好：只存在這個瀏覽器（`localStorage` 鍵 `map-editor-display/1`），不進草稿 envelope、不進歷史、不推進候選版本，也不隨草稿送審。讀不到或格式不符的偏好逐欄退回預設（顯示配置圖、透明度 30%、關閉描摹、步進 1），不讓控制項停在沒有對應選項的狀態；瀏覽器不給寫入時只是下次回到預設。

- 配置圖可顯示／隱藏、透明度 0–100% 連續調整並可一鍵重設為 30%。隱藏是改 `visibility` 而非移除，配置圖始終不接受滑鼠事件。沒有配置圖時，這三個控制項為 disabled。
- 描摹模式把攤位、非一般攤位區、柱子與出入口收成外框（去填色），並隱藏格內代碼與排標籤；幾何與命中區不變。
- 選取以獨立的 selection overlay 呈現，視覺線寬不超過 1.5px；原元件邊線維持原寬，不再改成 4px，也不加陰影。resize 把手的可見方塊縮小，命中區維持較大的透明範圍。
- 微移步進提供 0.1／0.5／1／5／10，方向鍵移動一個步進，Shift + 方向鍵為 10 倍，步進顯示在畫布工具列上。
- 編輯倍率最高 800%；放大後 Space + 拖曳或滑鼠中鍵拖曳平移畫布，平移只捲動視野，不修改 layout，也不產生復原步驟。

### 排段整體調整

選取單一攤位後可抓取它所在的排段（彼此貼齊的連續攤位），並以整段外框的 X／Y／寬／高欄位調整；每次修改重新無縫等分該段內部攤位，欄位值限制在畫布內且寬高不得收合為零。修改編號與方向是分開的第二步：讀入現有代碼後才可改代碼前綴、起始／結束編號、補零位數、方向與編號起點，套用時只重寫該段。同一排的其他排段保留自己的代碼、幾何與編號方向；只有整排都在選取範圍內時才改寫該排的 `orientation`。代碼與該段以外的既有代碼衝突時拒絕套用並指出衝突代碼，段內原本的代碼可自由重用。

## 草稿與版本

`eventId + periodKey + venueSpaceId` 是審閱範圍，同一範圍允許多份平行草稿。`periodKey` 一律保存活動定義中的日程 ID；不會與另一個正式 ID 衝突時，相容輸入 `day-<id>` 會先正規化成 `<id>`，多空間 `targetPath` 也只使用正規值。既有 alias 列會在下一次處理該範圍時原子正規化；若資料庫已存在兩份 alias 不同但邏輯範圍相同的有效核准稿，操作回 `409` 並要求人工處理，不再核准第三份。已固化的 legacy export 不改寫其 `targetPath`；live scope 仍存在時，非正規路徑的重試匯出會回 `409`，由管理者人工處理；live scope 日後移除或改名時，既有 immutable export 仍可下載。每份草稿有固定 ID 與單調遞增 revision；修改與提交都必須帶 `expectedRevision`，落後的版本回 `409`，不覆寫較新的內容。

狀態機為：

`draft -> submitted -> changes_requested -> submitted -> approved -> exported`

`rejected` 是終止狀態；`withdrawn` 表示管理者在同一個 D1 batch 中明確以另一份草稿取代既有的 `approved`／`exported` 草稿。資料庫 partial unique index 將 `approved` 與 `exported` 都視為仍有效的核准版本，保證同一範圍最多一份。每個提交與管理決策寫入不可變的 `map_draft_reviews`；D1 batch 以每次操作的 transition token 把狀態更新與紀錄寫入綁在一起，同毫秒重試也不會多留一筆轉換。

提交會重新解析 versioned draft envelope，並以活動定義、官方 placement 與 map template 做伺服器驗證：代碼唯一且已知、目前 period 的 placement 全數有座標、矩形不越界也不重疊，且目前 revision 至少綁定一份聲明為活動官方說明頁面的來源檔。HTTPS 本身不能證明發布者身分，因此核准 API 另要求管理者明確確認目前 revision 的每份來源確為活動官方頁面；核准後，該 revision 的永久 file metadata 會記為 `approved_official_source`。工作中草稿可以尚未覆蓋所有攤位，但不能保存未知欄位或會讓共用 renderer 讀取失敗的 malformed shape。

## 留言、局部修改請求與衝突說明

留言存在獨立的 `map_draft_comments`，不混進 `map_draft_reviews`——後者維持一次狀態轉換一列的純稽核，保存期限與帳號匿名化才不必區分「稽核紀錄」與「使用者自由輸入」。每則留言釘住寫入當下的 `current_revision`，不交給 insert 自己再讀一次，否則 owner 在兩次讀取之間存檔會讓留言列與稽核列指向不同版本。

- **對象是選配的。** 沒有 `targetKind` 就是對整份草稿留言；`slot` 或 `landmark` 加上 `targetRef` 則是局部修改請求。伺服器會確認草稿裡真的有這個元素，沒有就回 `400`——存下一個按了不會動的連結比拒絕更糟。
- **只有「要求修改」可以附帶局部修改請求。** 核准與拒絕都終結草稿，貢獻者從那時起打不開編輯器，指向某個攤位的請求永遠無法被處理。
- **管理者身分留言要求有效登入與管理者角色。** 讀取與寫入共用登入到期時間。管理者對**自己擁有**的草稿留言時算貢獻者，仍需有效授權。
- 留言長度上限 2,000 字元，`targetRef` 120 字元。

版本衝突不回一句籠統的失敗：`PUT`、`submit` 與審閱共用同一個 `409` 形狀，`conflict.cause` 區分 `permission`（授權已撤銷）、`status`（草稿狀態已變更）與版本落後，版本落後另外帶出目前 revision 並顯示為「草稿已更新至版本 N。」，讓貢獻者知道要重新載入哪一版，而不是反覆重試同一份內容。

## Route

| Route | 權限 | 行為 |
|---|---|---|
| `GET /api/map-contributions/drafts` | 有效 contributor | 列出自己的私人草稿 |
| `POST /api/map-contributions/drafts` | 有效 contributor | 建立 revision 1 |
| `GET /api/map-contributions/drafts/:draftId` | owner | 讀取草稿、來源 metadata 與審閱軌跡 |
| `PUT /api/map-contributions/drafts/:draftId` | owner + 有效 contributor | 以 optimistic concurrency 新增 revision |
| `POST /api/map-contributions/drafts/:draftId/submit` | owner + 有效 contributor | 驗證幾何、官方 placement 覆蓋與來源後提交目前 revision |
| `POST /api/map-contributions/drafts/:draftId/comments` | owner + 有效 contributor，或近期管理者 session | 對目前 revision 留言，可指定單一 slot／landmark |
| `POST /api/map-contributions/files` | owner + 有效 contributor | 上傳官方來源檔並綁定目前 revision |
| `GET /api/map-contributions/files/:fileId` | owner 或管理者 | 下載原始檔 |
| `GET /api/map-contributions/files/:fileId/preview` | owner 或管理者 | 預覽圖片；PDF 回 `415` |
| `GET /api/admin/map-contributions?days=N` | 近期管理者 session | 列出超過 N 天仍為 submitted 的草稿 |
| `GET /api/admin/map-contributions/drafts` | 近期管理者 session | 列出已進入審閱流程的草稿 |
| `GET /api/admin/map-contributions/drafts/:draftId` | 管理者 | 讀取審閱資料與共用 renderer 所需 layout |
| `POST /api/admin/map-contributions/drafts/:draftId/review` | 近期管理者 session | 要求修改、拒絕或核准；取代既有核准稿時必須帶其 draftId。`targets[]` 附帶局部修改請求，只有 `changes_requested` 接受 |
| `POST /api/admin/map-contributions/drafts/:draftId/export` | 近期管理者 session | 將核准 revision 固化為候選 JSON、SHA-256 與語意差異，並轉為 exported |

所有 contributor 與管理 route 都只列出、讀取或修改目前 Pages 設定的 `eventId`；共用 D1 中其他活動留下的草稿與來源檔不會進入目前活動的控制面。

## 候選匯出與公開邊界

匯出只在私人 D1 寫入不可變的候選、`targetPath`、SHA-256 與相對於目前 reviewed public snapshot 的語意差異，並提供管理者下載；它不呼叫 GitHub、不寫 event-data repository，也不改變任何匿名公開 endpoint。候選仍須經 event-data repository 的 schema、review 與 pin 流程才能發布。

只有一組「活動日 × venue-space」的活動，`targetPath` 是 `map.json`；有多組的（含**單一場館空間但多個活動日**，例如兩天各自重排的場地）是 `maps/<periodKey>/<venueSpaceId>.json`，並由該活動的 `map-manifest.json` 索引。兩者的路徑由 [`app/event-authoring-scope.ts`](../../app/event-authoring-scope.ts) 與 [`app/event-map-manifest.ts`](../../app/event-map-manifest.ts) 決定，reader、staging、pin 與離線清單都已支援，見[活動地圖契約](./event-map.md)。

## 官方來源檔

接受的保守 upload profile 是 baseline JPEG、非交錯 PNG（宣告像素資料最多 32 MiB）、靜態 WebP，以及使用 classic xref、未加密且不含 object stream 的 PDF；不接受 progressive JPEG、交錯 PNG、動畫 WebP 或 xref-stream／object-stream PDF。單檔最多 20 MiB，圖片最多 1,600 萬 pixels、單邊最多 8,192 pixels，PDF 最多 20 頁。伺服器以不解碼像素的方式檢查容器邊界、尺寸／頁數與 PDF 禁用項目：不把未受信任的位元組交給影像解碼器，並讓驗證成本與檔案內容無關。**這不再是 CPU 額度的限制**——Workers Paid 的 CPU 上限是每次呼叫 5 分鐘（Free 為 10 ms，見 [ADR-0065](../adr/0065-cost-reasoning-uses-the-workers-paid-basis.md)），保守 profile 的理由是攻擊面與可預期的驗證成本，不是額度。可否正常顯示仍由投稿者與審閱者在私人預覽確認。另要求 HTTPS 官方來源 URL、文件日期及 PDF 頁碼；不符合 profile 時請先由可信工具轉存成上述格式。永久 metadata 是來源 URL、日期、頁碼、SHA-256、MIME、容量、尺寸／頁數與審閱結果。

原始 bytes 只存於 `MAP_CONTRIBUTIONS` 私人 R2 bucket。它與公開代表圖的 `THUMBNAILS` bucket 分離，不設定 custom domain 或 `r2.dev`。同一個 bucket 也存[主辦候選地圖](./organizer-workspace.md)的配置圖，位址前綴 `organizer-map-backgrounds/`，兩者互不重疊。先寫 R2、再綁 D1；D1 拒絕時立即刪除剛寫入的物件。帳號刪除與排程清除也先刪 bytes，再移除或匿名化 D1 資料，讓失敗保留可重試的 metadata，不留下已宣告刪除但仍可讀的物件。

## 保存與刪除

| 狀態 | 自動處置 |
|---|---|
| `draft` 180 天無活動 | 刪除內容、檔案與草稿 |
| `changes_requested` 180 天無活動 | 刪除可編輯內容與檔案，保留去識別化審閱紀錄 |
| `submitted` | 不自動刪除；由管理報表列出逾期未審案件 |
| `approved`／`rejected`／`exported`／`withdrawn` | 決定後 30 天刪除原始檔，保留來源 metadata 與審閱結果 |

刪除帳號時，從未提交的草稿立即刪除；已進入審閱流程的 owner、revision author 與 review actor 去識別化，內容依其狀態期限處理。preview reset 會清空隔離 D1 的地圖貢獻資料與私人 preview bucket。

排程每次先續跑既有清除 claim，沒有既有 claim 才取得新工作；單次最多處理 5 份草稿與 450 個原始物件，D1 更新以 90 個 ID 分批。R2 失敗時保留同一批 claim 供下次重試，不再擴張鎖定集合；測試直接計數 D1 呼叫並要求留在每次呼叫 50 次以內。**50 是本專案自訂的保守預算，不是平台限制**：Workers Paid 的實際上限是每次呼叫 10,000 個子請求，且 D1／KV／R2 呼叫均計入子請求。保留這個較緊的數字是為了固定上面的分批設計，使單次清除的工作量不隨資料量成長；要放寬須依[專案工作流程 §7.6](../runbooks/project-workflow.md) 的擴充門檻說明理由。
