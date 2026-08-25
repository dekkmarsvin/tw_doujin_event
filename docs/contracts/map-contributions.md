# 地圖貢獻控制面基礎契約

地圖貢獻讓經管理者授權的維護者，把**活動主辦官方說明頁面中的配置證據**整理成私人草稿。它不新增資料來源：公開快照的基礎仍只來自主辦官方頁面，社團補充則仍只由社團本人自填；工作簿、社群試算表與其他第三方資料不在來源鏈中。

本契約涵蓋 [#72](https://github.com/dekkmarsvin/tw_doujin_event/issues/72) 的角色、私人草稿、檔案與保存機制。投稿／審閱介面、核准替換與 event-data 匯出工作流屬 [#73](https://github.com/dekkmarsvin/tw_doujin_event/issues/73)，不能把本次的底層 route 描述成已完成的公開產品流程。政策決策見 [ADR-0033](../adr/0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md)。

**實作**：[`app/map-contribution-files.ts`](../../app/map-contribution-files.ts)、[`app/circle-portal-handlers.ts`](../../app/circle-portal-handlers.ts)、[`db/identity-repository.ts`](../../db/identity-repository.ts)、[`db/retention-purge.ts`](../../db/retention-purge.ts)、[`functions/api/map-contributions/`](../../functions/api/map-contributions)
**測試**：`tests/map-contribution-files.test.mjs`、`tests/map-contribution-handlers.test.mjs`、`tests/map-contribution-repository.test.mjs`、`tests/map-contribution-retention.test.mjs`

## 授權邊界

- `map_contributor` 沿用 magic-link 帳號，由具有近期 session 的管理者以 `POST /api/admin/map-contributors` 授予、撤銷或停權。
- 社團認領不會自動取得此角色；停用帳號也不具備投稿能力。
- 撤銷與停權立即阻止建立、修改、上傳與提交，但不刪除已進入審閱流程的紀錄。
- 原始檔只有草稿 owner 與管理者可讀。原始下載一律是 attachment；圖片可經授權 route 預覽，PDF 不提供 inline 預覽。

## 草稿與版本

`eventId + periodKey + venueSpaceId` 是審閱範圍，同一範圍允許多份平行草稿。每份草稿有固定 ID 與單調遞增 revision；修改與提交都必須帶 `expectedRevision`，落後的版本回 `409`，不覆寫較新的內容。

狀態機為：

`draft -> submitted -> changes_requested -> submitted -> approved -> exported`

`rejected` 是終止狀態。資料庫 partial unique index 將 `approved` 與 `exported` 都視為仍有效的核准版本，保證同一範圍最多一份；#73 在核准另一份之前須提供明確替換／撤回動作。每個提交與管理決策寫入不可變的 `map_draft_reviews`；D1 batch 以每次操作的 transition token 把狀態更新與紀錄寫入綁在一起，同毫秒重試也不會多留一筆轉換。

## 現有 route

| Route | 權限 | 行為 |
|---|---|---|
| `POST /api/map-contributions/drafts` | 有效 contributor | 建立 revision 1 |
| `PUT /api/map-contributions/drafts/:draftId` | owner + 有效 contributor | 以 optimistic concurrency 新增 revision |
| `POST /api/map-contributions/drafts/:draftId/submit` | owner + 有效 contributor | 提交目前 revision |
| `POST /api/map-contributions/files` | owner + 有效 contributor | 上傳官方來源檔並綁定目前 revision |
| `GET /api/map-contributions/files/:fileId` | owner 或管理者 | 下載原始檔 |
| `GET /api/map-contributions/files/:fileId/preview` | owner 或管理者 | 預覽圖片；PDF 回 `415` |
| `GET /api/admin/map-contributions?days=N` | 近期管理者 session | 列出超過 N 天仍為 submitted 的草稿 |

## 官方來源檔

接受的保守 upload profile 是 baseline JPEG、非交錯 PNG（宣告像素資料最多 32 MiB）、靜態 WebP，以及使用 classic xref、未加密且不含 object stream 的 PDF；不接受 progressive JPEG、交錯 PNG、動畫 WebP 或 xref-stream／object-stream PDF。單檔最多 20 MiB，圖片最多 1,600 萬 pixels、單邊最多 8,192 pixels，PDF 最多 20 頁。伺服器以不解碼像素的方式檢查容器邊界、尺寸／頁數與 PDF 禁用項目，避免上傳驗證本身超出 Workers Free CPU 預算；可否正常顯示仍由投稿者與審閱者在私人預覽確認。另要求 HTTPS 官方來源 URL、文件日期及 PDF 頁碼；不符合 profile 時請先由可信工具轉存成上述格式。永久 metadata 是來源 URL、日期、頁碼、SHA-256、MIME、容量、尺寸／頁數與審閱結果。

原始 bytes 只存於 `MAP_CONTRIBUTIONS` 私人 R2 bucket。它與公開代表圖的 `THUMBNAILS` bucket 分離，不設定 custom domain 或 `r2.dev`。先寫 R2、再綁 D1；D1 拒絕時立即刪除剛寫入的物件。帳號刪除與排程清除也先刪 bytes，再移除或匿名化 D1 資料，讓失敗保留可重試的 metadata，不留下已宣告刪除但仍可讀的物件。

## 保存與刪除

| 狀態 | 自動處置 |
|---|---|
| `draft` 180 天無活動 | 刪除內容、檔案與草稿 |
| `changes_requested` 180 天無活動 | 刪除可編輯內容與檔案，保留去識別化審閱紀錄 |
| `submitted` | 不自動刪除；由管理報表列出逾期未審案件 |
| `approved`／`rejected`／`exported` | 決定後 30 天刪除原始檔，保留來源 metadata 與審閱結果 |

刪除帳號時，從未提交的草稿立即刪除；已進入審閱流程的 owner、revision author 與 review actor 去識別化，內容依其狀態期限處理。preview reset 會清空隔離 D1 的地圖貢獻資料與私人 preview bucket。

排程每次先續跑既有清除 claim，沒有既有 claim 才取得新工作；單次最多處理 5 份草稿與 450 個原始物件，D1 更新以 90 個 ID 分批。R2 失敗時保留同一批 claim 供下次重試，不再擴張鎖定集合；測試直接計數 D1 呼叫並要求留在 Workers Free 每次 50 次 service query 的預算內。
