# 共享 reference-data pin 契約

跨活動共用的主辦、主辦分類目錄、場館與場館空間維護在公開的 [`dekkmarsvin/tw_doujin_event-reference-data`](https://github.com/dekkmarsvin/tw_doujin_event-reference-data)。公開事實只接受活動主辦或場館官方說明頁；社團自行填寫的內容仍屬活動 overlay。

## `reference-data-pin/1`

每個 event-data repo 必須保存一份 pin，包含：

- `eventId`；
- 固定的 repository 名稱；
- 完整 40 字元 reference commit SHA；
- 每個實際讀取檔案的 path 與 SHA-256；
- organizer、category catalog revision、venue 與 venue-space 的 stable ID selection。

Pin 不得使用 branch、tag 或省略逐檔 hash。分類目錄 selection 同時保存 `id`、`organizerId`、`revision` 與 path，避免不同版本被誤認為同一份資料。

## 驗證邊界

`npm run reference-data:fetch -- <reference-data-pin.json>` 先下載到同磁碟暫存目錄，再驗證：

- pin schema、完整 commit 與安全 path；
- 每個檔案的 SHA-256；
- organizer、category catalog、venue、venue-space schema；
- selection 的 stable ID、catalog revision 與關聯。

任一檢查失敗都不替換上一份已驗證資料。驗證成功後才將完整 tree 放到忽略版控的 `.reference-data/<eventId>/`。

#70 會把 pin 納入 event schema 與 production staging；本契約不預先改動 FF47 的 event definition。
