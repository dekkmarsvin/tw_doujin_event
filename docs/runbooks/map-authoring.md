# 地圖 authoring

把配置圖辨識成向量 layout、人工微調、發布到本機 D1，再匯出成公開靜態快照。

**這是受信任維護者的本機工作，不是產品功能。** 公開 Pages 介面不得出現檔案欄位、管理入口或寫入 route；讀取失敗只說明公開資料錯誤，不提供管理修復入口。地圖的資料不變量與前台契約見[活動地圖契約](../contracts/event-map.md)。

**實作**：[`app/map-recognition.ts`](../../app/map-recognition.ts)、[`app/editor/`](../../app/editor)、[`app/map-layout-editor.tsx`](../../app/map-layout-editor.tsx)、[`app/map-admin-importer.tsx`](../../app/map-admin-importer.tsx)、[`db/event-map-repository.ts`](../../db/event-map-repository.ts)、[`app/event-map-route-handlers.ts`](../../app/event-map-route-handlers.ts)
**測試**：`tests/map-import.test.mjs`、`tests/event-map-route.test.mjs`

## 流程

### 1. 啟動 authoring 環境

```bash
npm run dev
```

開啟 `/editor`，選擇 `data_source_test/FF47社團攤位配置圖.jpg`。

### 2. 辨識

`recognizeFF47Map(imageData)` 是深模組，唯一公開 interface 是輸入圖片像素、回傳 `MapRecognitionReport`。它負責：

- 從格線辨識 A–V 縱向排與 W 橫向排。
- 依 FF47 編號規則產生 slot：A 為 01–22；B–V 為 01–44；W 為 01–42。
- 從實心黑色元件辨識柱子，**保存矩形尺寸**而非降為單一點。
- 從紅色箭頭辨識出入口；上側為出口、下側為入口。
- 回傳信心、警告與完整向量 layout。

**企業攤與舞台不自動辨識**，必須在發布前手動新增。

### 3. 預覽對照

原圖與向量結果並列。摘要先呈現一般結構辨識信心、排數、攤位格、柱子與出入口。原圖**只在此階段**作比較用。

重新上傳配置圖時，既有手動區域依新圖片尺寸等比例保留，並要求再次確認。

### 4. 細部編輯

編輯畫布提供 100% 至 400% 檢視縮放、原生捲動、倍率重設與聚焦選取。

- 可拖曳或輸入座標調整一般攤位、柱子與出入口。
- 可新增、命名、分類、縮放或移除企業攤、舞台及其他非一般攤位區。
- 選取任一非一般攤位區後，物件四角顯示直接縮放把手。
- **吸附**：企業攤移動或縮放至相鄰企業攤 8 個螢幕像素內，且另一軸至少重疊四分之一時，自動吸附最近的相對邊並顯示對齊導引線。**按住 Alt 暫停吸附。**
- 方向鍵移動 1px，Shift + 方向鍵移動 10px。
- 720px 以下貼底並改為單欄預覽，主要發布動作固定在工作面板底部。此規則不增加任何公開 Pages route。

### 5. 發布到本機 D1

只有 A 至 W、988 格、28 根柱子、5 個出入口與**信心門檻全部通過**才可發布。按「發布活動地圖」後 route 驗證並 UPSERT，回傳 revision。

### 6. 匯出公開快照

```bash
npm run map:snapshot
```

```bash
npm test
```

`map:snapshot` 會建立 authoring build，再將本機 D1 的 `ff47` 已發布 revision 匯出到 `public/data/events/ff47/map.json`。

### 7. Review 後發布

檢查快照的 diff、revision、來源檔名與地標，跑完[共同 gate](./local-development.md#驗證-gate)，以 pull request 檢查 preview，合併到 `main` 讓 GitHub Actions 發布 production。

**靜態快照是公開資料的唯一真相。** 未經 review 的本機 D1 或圖片不會因 Pages 部署而公開。

## 持久化 seam

authoring 持久化由純 repository、純 route handlers 與環境 wrapper 構成。**它不在 Pages deployment 內。**

- `createEventMapRepository(database)` 只接收注入的 `D1Database`，負責資料表就緒、驗證、查詢與 revision UPSERT。
- `createEventMapHandlers(repository)` 只依賴 `getEventMap` / `publishEventMap`，負責參數與 payload 驗證及 HTTP 回應。Cloudflare route wrapper 才讀取環境 binding。

| Route | 行為 |
|---|---|
| `GET /api/events/:eventId/map` | 取得已發布 layout；不存在時 404 |
| `PUT /api/events/:eventId/map` | 驗證完整 layout 後以 event ID UPSERT |

- D1 `event_maps.event_id` 是唯一鍵；每次覆寫增加 revision，保存來源檔名、辨識信心與更新時間。
- **公開前台不呼叫這兩個 route。**
- 隔離 Miniflare D1 測試必須證明：一次 PUT 可由稍後 GET 讀回、第二次 PUT 會增加 revision、無效 event ID 與低信心內容不寫入。

## 尚未做

- **`PUT` route 沒有身分驗證。** 它只在本機 authoring 環境可達，不部署到 Pages。未來要開放外部編輯入口時，必須先拆成受驗證的控制面——加入身分驗證、角色、草稿、審核、稽核與版本化發布，**不得重新公開現有這條未驗證的 PUT route**。
  （社團自助控制面已有完整的身分與角色機制，但那是另一套系統，見[社團自助控制面契約](../contracts/circle-portal.md)。地圖 authoring 尚未接上它。）
- 對非一般攤位文字做 OCR。第一階段只保存可可靠辨識的相對矩形。
