# ADR-0050：候選地圖保存它所依據的配置圖

- **狀態**：Accepted
- **日期**：2026-09-04
- **延續**：[ADR-0033](./0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md) 的私人 bucket 與保存期限機制、[ADR-0048](./0048-a-map-covers-one-day-in-one-hall.md) 的地圖 scope
- **不變更**：[ADR-0049](./0049-the-local-authoring-backup-is-withdrawn.md) 決策第 2 點——配置圖辨識仍然完全在瀏覽器內執行
- **相關文件**：[主辦單位工作區契約](../contracts/organizer-workspace.md)、[地圖 authoring runbook](../runbooks/map-authoring.md)

## 背景

主辦畫地圖的方式是把活動配置圖放在底下，照著描出每一排攤位。原本這張圖只存在瀏覽器這一次的作業裡：讀成 data URL 進 React state，儲存時只送向量 layout。一張地圖要畫很多輪，而每一輪重新開啟地圖，底圖都不在，得再去找一次原始檔——那個檔案往往在信箱附件或某個下載資料夾裡。描到一半的地圖因此很難接著描。

同時，四個動作會無聲丟掉畫面上的內容：空白畫布、切換地圖分頁、從同場館空間複製、切換使用空間。只有「關閉編輯器」會問。

## 決策

### 1. 配置圖存在伺服器，以草稿為單位

一份地圖草稿有一張目前的配置圖，存進既有的私人 bucket `MAP_CONTRIBUTIONS`（`private, no-store`，無 custom domain），只有該候選活動的協作者讀得到。它不是公開資料，不隨地圖送審，也不進發布 snapshot。

### 2. 物件位址由草稿的 id 決定，D1 不記錄它

位址是 `organizer-map-backgrounds/<candidateId>/<draftId>`。這個選擇是本 ADR 的重點：**沒有 metadata 資料列**，因此沒有 R2 與 D1 之間需要補償的寫入順序、沒有 schema migration、沒有孤兒資料列。再上傳一次就是覆蓋同一個位址；保存期限清除草稿時照同一組 id 刪除物件，不必先讀出 metadata 才知道要刪什麼。

代價是查不出「這個 bucket 裡有哪些配置圖屬於誰」以外的任何事：沒有上傳時間、沒有上傳者、沒有 SHA-256 可供比對。這些留在 `organizer_event.map_background_updated` 稽核裡，那裡本來就是回答「誰在什麼時候動了什麼」的地方。

### 3. 配置圖不進 revision 流

上傳配置圖不推進 candidate version，也不寫 map revision。理由是它不是送審內容，而是描圖用的底圖：把它寫進 revision 會讓候選活動的歷史多出一批與 layout 無關的版本，而 review 讀的是 layout。**一份地圖只留一張配置圖**，沒有版本流也就沒有「哪個 revision 配哪張圖」的問題；要換就是覆蓋，覆蓋前先問。

### 4. 會清掉畫面內容的動作一律先確認

上述四個動作與「已經有配置圖時再次上傳」都改為先確認。判準不同：空白畫布看畫面上有沒有內容，其餘三個看有沒有未儲存變更——已儲存而沒改過的地圖換掉不會失去任何東西，問了只是噪音。

## 後果

- 重新開啟已儲存的地圖時底圖自己回來，描圖可以跨多次作業進行。
- 共用 middleware 的 multipart allowlist 多一條，且限定為這個路徑的 `PUT`；同源檢查與 `SameSite=Lax` 不變。介面顯示底圖仍走 `data:` URL，因為 `/organizer*` 的 `img-src` 收 `data:` 而不收 `blob:`——CSP 不因這個功能放寬。
- 私人 bytes 的總量增加。上限為每份地圖 10 MB，容器檢查與貢獻來源檔共用同一份實作，圖片一律不解碼像素。
- 保存期限的刪除路徑多了一個不靠 metadata 的分支。它與既有分支共用同一套「先刪 bytes 再動 D1」的順序與失敗後可重試的 claim。
- 沒有「移除配置圖」。配置圖只能被新的一張覆蓋，或隨草稿一起被清除。

## 未決

- 若日後需要知道某張配置圖是哪一版 layout 描的，就得引入 metadata；那時再決定它是資料列還是 R2 custom metadata。目前沒有任何流程需要這個對應。
