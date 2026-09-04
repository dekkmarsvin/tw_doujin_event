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
- **管理者身分留言受 fresh-admin 閘控。** 貢獻者會把它讀成審閱意見，因此與其他管理寫入同一道再驗證邊界。管理者對**自己擁有**的草稿留言時算貢獻者，仍需有效授權。
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

接受的保守 upload profile 是 baseline JPEG、非交錯 PNG（宣告像素資料最多 32 MiB）、靜態 WebP，以及使用 classic xref、未加密且不含 object stream 的 PDF；不接受 progressive JPEG、交錯 PNG、動畫 WebP 或 xref-stream／object-stream PDF。單檔最多 20 MiB，圖片最多 1,600 萬 pixels、單邊最多 8,192 pixels，PDF 最多 20 頁。伺服器以不解碼像素的方式檢查容器邊界、尺寸／頁數與 PDF 禁用項目，避免上傳驗證本身超出 Workers Free CPU 預算；可否正常顯示仍由投稿者與審閱者在私人預覽確認。另要求 HTTPS 官方來源 URL、文件日期及 PDF 頁碼；不符合 profile 時請先由可信工具轉存成上述格式。永久 metadata 是來源 URL、日期、頁碼、SHA-256、MIME、容量、尺寸／頁數與審閱結果。

原始 bytes 只存於 `MAP_CONTRIBUTIONS` 私人 R2 bucket。它與公開代表圖的 `THUMBNAILS` bucket 分離，不設定 custom domain 或 `r2.dev`。同一個 bucket 也存[主辦候選地圖](./organizer-workspace.md)的配置圖，位址前綴 `organizer-map-backgrounds/`，兩者互不重疊。先寫 R2、再綁 D1；D1 拒絕時立即刪除剛寫入的物件。帳號刪除與排程清除也先刪 bytes，再移除或匿名化 D1 資料，讓失敗保留可重試的 metadata，不留下已宣告刪除但仍可讀的物件。

## 保存與刪除

| 狀態 | 自動處置 |
|---|---|
| `draft` 180 天無活動 | 刪除內容、檔案與草稿 |
| `changes_requested` 180 天無活動 | 刪除可編輯內容與檔案，保留去識別化審閱紀錄 |
| `submitted` | 不自動刪除；由管理報表列出逾期未審案件 |
| `approved`／`rejected`／`exported`／`withdrawn` | 決定後 30 天刪除原始檔，保留來源 metadata 與審閱結果 |

刪除帳號時，從未提交的草稿立即刪除；已進入審閱流程的 owner、revision author 與 review actor 去識別化，內容依其狀態期限處理。preview reset 會清空隔離 D1 的地圖貢獻資料與私人 preview bucket。

排程每次先續跑既有清除 claim，沒有既有 claim 才取得新工作；單次最多處理 5 份草稿與 450 個原始物件，D1 更新以 90 個 ID 分批。R2 失敗時保留同一批 claim 供下次重試，不再擴張鎖定集合；測試直接計數 D1 呼叫並要求留在 Workers Free 每次 50 次 service query 的預算內。
