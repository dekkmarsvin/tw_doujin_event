# 地圖 authoring

把配置圖辨識成向量 layout、人工微調，成為候選活動的地圖草稿，經審閱後匯出為公開靜態快照。

**地圖畫在[主辦單位工作區](../contracts/organizer-workspace.md)。** 候選活動的每一組「活動日 × 場館空間」各建立一份地圖草稿，從空白或描摹起點開始。

本機曾經有一套獨立的 `/editor` authoring 環境，寫入本機 D1 再以 `map:snapshot` 匯出。它已依 [ADR-0049](../adr/0049-the-local-authoring-backup-is-withdrawn.md) 移除：實際共用的只有 `MapLayoutEditor` 一個 component，其餘是一整套為它獨存的 build 與持久化堆疊，而那條備援路徑從未被驗證過。控制面不可用時的復原路徑改為直接編輯 data repository 中的靜態快照。

`/circle` 的貢獻面板仍只服務已公開的活動：它建立草稿的唯一入口是「從目前公開地圖建立私人草稿」（`app/circle-portal/map-contribution-panel.tsx`）。

**讀者介面（`index.html`）不得出現檔案欄位、管理入口或寫入 route**；讀取失敗只說明公開資料錯誤，不提供管理修復入口。這條約束只約束讀者介面。`circle.html` 與 `organizer.html` 是自始分離的獨立 entry（`vite.pages.config.ts`），它們在身分驗證後方提供檔案上傳與管理入口，那是 [ADR-0033](../adr/0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md) 的既有機制，不是本條的例外。見 [ADR-0038](../adr/0038-authoring-moves-to-the-control-surface-local-stays-as-backup.md) 決策第 2 點。

地圖的資料不變量與前台契約見[活動地圖契約](../contracts/event-map.md)，編輯器行為見[地圖編輯器契約](../contracts/map-editor.md)。

## 流程

### 1. 開啟工作區

```bash
npm run dev:portal
```

以 Organizer 身分登入 `/organizer`，開啟候選活動的「地圖」區。地圖區需要攤位匯入已完成，因為候選地圖的 `allowedBoothCodes` 與 `requiredBoothCodes` 都由該 scope 實際匯入的攤位代碼推導（[`resolveCandidateAuthoringScope()`](../../app/event-authoring-scope.ts)）。

每一組「活動日 × 場館空間」各一份地圖草稿；缺任何一份在驗證時是 error，不是 warning。

### 2. 辨識

從該活動 data repo 或受信任的本機來源選擇原始配置圖。原圖不複製到程式 repo。

`recognizeMapTemplate(event.mapTemplate, imageData)` 依活動定義分派辨識 adapter，回傳 `MapRecognitionReport`。**辨識完全在瀏覽器內執行**（canvas `getImageData` 取像素），沒有伺服器端相依。FF47 adapter 負責：

- 從格線辨識 A–V 縱向排與 W 橫向排。
- 依 FF47 編號規則產生 slot：A 為 01–22；B–V 為 01–44；W 為 01–42。
- 從實心黑色元件辨識柱子，**保存矩形尺寸**而非降為單一點。
- 從紅色箭頭辨識出入口；上側為出口、下側為入口。
- 回傳信心、警告與完整向量 layout。

**企業攤與舞台不自動辨識**，必須在送審前手動新增。沒有辨識器的新版型從空白起點開始，改用下方的框選建立排段與手動描繪。

### 3. 預覽對照

原圖與向量結果並列。摘要先呈現一般結構辨識信心、排數、攤位格、柱子與出入口。原圖**只在此階段**作比較用。

重新上傳配置圖時，既有手動區域依新圖片尺寸等比例保留，並要求再次確認。

### 4. 細部編輯

工具與行為規則見[地圖編輯器契約](../contracts/map-editor.md)；配置圖的保存與更換見[主辦單位工作區契約](../contracts/organizer-workspace.md#地圖)。常見順序是先用「新增排／排段」框出各段攤位，再補柱子、出入口、企業攤與舞台，最後以攤位清單對照確認沒有待畫代碼後儲存。

### 5. 保存為候選 revision

地圖草稿以 `PUT /api/organizer/events/:candidateId/maps/:draftId` 保存，成為候選活動的一份 revision。每份已保存地圖必須通過與正式 validation 相同的攤位覆蓋、未知攤位、重疊與幾何規則。

候選活動的地圖可以含沒有社團的攤位格，未知代碼只是提醒，見[主辦契約](../contracts/organizer-workspace.md#地圖)。

人工繪製沒有 template 完整性規則可擋，**逐格與官方攤位清單的核對是人工責任**。

### 6. 驗證、送審與核准

依[主辦單位工作區契約](../contracts/organizer-workspace.md)：`POST …/validate` → `POST …/preview` → `POST …/submit`（僅 Owner），再由全域管理者以 `POST /api/admin/organizer/events/:candidateId/review` 核准。

送審會固定一份 submission snapshot（新活動為 `organizer-submission-snapshot/3`，已發布修正為 `/4`），包含每份地圖內容，並以其 SHA-256 作為 approval hash。

### 7. 發布

在「送審與發布」查看進度。管理者核准後，系統以固定的核准 snapshot 建立發布工作，自動準備資料與程式 repo 的 PR、等待必要檢查、合併、部署並驗證公開結果。失敗時依介面提示處理，可重試的工作沿用原 job 與 snapshot；詳細邊界見[主辦契約](../contracts/organizer-workspace.md#發布邊界)。

主辦正常流程不要求操作 Git 或 CLI。維運者手動更新靜態快照的路徑見[社團與活動資料更新](./catalog-data-update.md)，不與主辦發布步驟混用。

**靜態快照是公開資料的唯一真相。** 未經 review 的候選內容不會因 Pages 部署而公開。

## 現行限制與後續範圍

- 對非一般攤位文字做 OCR。第一階段只保存可可靠辨識的相對矩形。
