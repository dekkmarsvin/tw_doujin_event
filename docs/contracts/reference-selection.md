# 共享 reference 選擇契約

**實作**：[`scripts/reference-selection-utils.mjs`](../../scripts/reference-selection-utils.mjs)、[`scripts/stage-event-data.mjs`](../../scripts/stage-event-data.mjs)、[`scripts/event-data-fetcher.mjs`](../../scripts/event-data-fetcher.mjs)、[`scripts/event-workspace-generator.mjs`](../../scripts/event-workspace-generator.mjs)
**測試**：`tests/reference-selection.test.mjs`、`tests/event-data-fetcher.test.mjs`、`tests/event-workspace-generator.test.mjs`

跨活動共用的主辦、主辦分類目錄、場館與場館空間維護在公開的 [`dekkmarsvin/tw_doujin_event-data`](https://github.com/dekkmarsvin/tw_doujin_event-data) 的 `references/`。公開事實只接受活動主辦或場館官方說明頁；社團自行填寫的內容仍屬活動 overlay。

活動資料與 references 住在同一個 repository，因此定位資訊只有一份：`data/event-data-pins/<event>.json` 的完整 40 字元 commit 與逐檔 SHA-256，同時涵蓋 `events/<eventId>/` 與該活動使用的 `references/`。

## `reference-selection/1`

每個活動在 `events/<eventId>/reference-selection.json` 保存語意，不保存定位：

- `eventId`；
- organizer 集合；
- category catalog 的 `id`、`organizerId`、`revision` 與 path；
- venue 與其 venue-space 集合的 stable ID 與 path。

所有 path 以 `references/` 開頭。selection 不含 repository、commit 或 hash——那些由 event data pin 承擔。

分類目錄 selection 同時保存 `id`、`organizerId`、`revision` 與 path，避免不同版本被誤認為同一份資料；organizers 與 venues 使用陣列，因此可完整表示 lead／co-organizer／partner 與多場館 assignment。

## 驗證邊界

`data:fetch` 依 pin 下載整個 commit 到同磁碟暫存目錄，再驗證：

- pin schema、完整 commit 與安全 path；
- 每個檔案的 SHA-256；
- organizer、category catalog、venue、venue-space schema；
- selection 的 stable ID、catalog revision 與關聯。

pin 列出的每個 `references/` 檔案必須恰好被 selection 使用一次，不接受未選取的額外記錄，也不接受 selection 指名卻未 pin 的檔案。任一檢查失敗都不替換上一份已驗證資料；驗證成功後才把整棵 tree 放到忽略版控的 `.event-data/<eventId>/`，其中活動自身檔案在根層，`references/` 保留 repository 路徑。

`data:stage` 再次核對 selection 關聯，並要求 event definition 的 organizer、catalog、venue 與 space assignments 和 selection 集合完全相等，再將記錄依 path 排序寫成單一 `reference-records.json`。`event-definition/3` 只在這份 verified selection 上解析；缺檔、額外／重複 selection 或關聯不一致皆 fail closed。
