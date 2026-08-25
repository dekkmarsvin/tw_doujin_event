# 共享 reference-data pin 契約

跨活動共用的主辦、主辦分類目錄、場館與場館空間維護在公開的 [`dekkmarsvin/tw_doujin_event-reference-data`](https://github.com/dekkmarsvin/tw_doujin_event-reference-data)。公開事實只接受活動主辦或場館官方說明頁；社團自行填寫的內容仍屬活動 overlay。

## `reference-data-pin/2`

每個 event-data repo 必須保存一份 pin，包含：

- `eventId`；
- 固定的 repository 名稱；
- 完整 40 字元 reference commit SHA；
- 每個實際讀取檔案的 path 與 SHA-256；
- organizer 集合、category catalog revision，以及 venue 與其 venue-space 集合的 stable ID selection。

Pin 不得使用 branch、tag 或省略逐檔 hash。每個 pinned file 必須恰好被 selection 使用一次，不接受未選取的額外記錄。分類目錄 selection 同時保存 `id`、`organizerId`、`revision` 與 path，避免不同版本被誤認為同一份資料；organizers 與 venues 使用陣列，因此可完整表示 lead／co-organizer／partner 與多場館 assignment。

## 驗證邊界

event-data 的 `reference-data-pin.json` 由 production `data:fetch` 讀取；獨立維護時也可用 `npm run reference-data:fetch -- <reference-data-pin.json>`。兩條路徑都先下載到同磁碟暫存目錄，再驗證：

- pin schema、完整 commit 與安全 path；
- 每個檔案的 SHA-256；
- organizer、category catalog、venue、venue-space schema；
- selection 的 stable ID、catalog revision 與關聯。

任一檢查失敗都不替換上一份已驗證資料。驗證成功後才將完整 tree 放到忽略版控的 `.reference-data/<eventId>/`。

`data:stage` 再次核對 event-data 內的 pin、下載檔案 hash 與 selection 關聯，並要求 event definition 的 organizer、catalog、venue 與 space assignments 和 selection 集合完全相等，再將記錄寫成單一 `reference-records.json`。`event-definition/3` 只在這份 verified selection 上解析；缺檔、額外／重複 selection 或關聯不一致皆 fail closed。
