# 地圖 authoring

把配置圖辨識成向量 layout、人工微調、發布到本機 D1，再匯出成公開靜態快照。

**本篇描述的是本機 authoring 環境。它目前仍是一個新活動畫出第一份地圖的唯一路徑。**

`/circle` 的貢獻面板雖然已在 Pages 上運作，但它建立草稿的唯一入口是「從目前公開地圖建立私人草稿」（`app/circle-portal/map-contribution-panel.tsx`）。新活動沒有公開地圖，那一步必定失敗。

[ADR-0038](../adr/0038-authoring-moves-to-the-control-surface-local-stays-as-backup.md) 決策第 3 點已定：瀏覽器端的空白／描摹起點（[#117](https://github.com/dekkmarsvin/tw_doujin_event/issues/117)）落地後，本篇降為離線備援。**在那之前不是。** 該 PR 必須在同一個 commit 改寫本段。

**讀者介面（`index.html`）不得出現檔案欄位、管理入口或寫入 route**；讀取失敗只說明公開資料錯誤，不提供管理修復入口。這條約束只約束讀者介面。`circle.html` 是自始分離的獨立 entry（`vite.pages.config.ts`），它在身分驗證後方提供檔案上傳與管理入口，那是 [ADR-0033](../adr/0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md) 的既有機制，不是本條的例外。見 [ADR-0038](../adr/0038-authoring-moves-to-the-control-surface-local-stays-as-backup.md) 決策第 2 點。

> 2026-08-28 修訂。本段原文為「**這是受信任維護者的本機工作，不是產品功能。** 公開 Pages 介面不得出現檔案欄位、管理入口或寫入 route」。該無條件措辭自 #72／#73 落地起即與現況不符——`/circle` 早已有檔案上傳與管理入口——並且會擋住 ADR-0035 選項 B。依 ADR-0038 限縮為只約束讀者介面。

地圖的資料不變量與前台契約見[活動地圖契約](../contracts/event-map.md)。

**實作**：[`app/map-recognition.ts`](../../app/map-recognition.ts)、[`app/editor/`](../../app/editor)、[`app/map-layout-editor.tsx`](../../app/map-layout-editor.tsx)、[`app/map-editor-history.ts`](../../app/map-editor-history.ts)、[`app/map-admin-importer.tsx`](../../app/map-admin-importer.tsx)、[`db/event-map-repository.ts`](../../db/event-map-repository.ts)、[`app/event-map-route-handlers.ts`](../../app/event-map-route-handlers.ts)
**測試**：`tests/map-import.test.mjs`、`tests/event-map-route.test.mjs`

## 流程

### 1. 啟動 authoring 環境

```bash
npm run data:fetch -- ff47
npm run data:stage -- ff47
npm run dev
```

authoring build 會讀取目前 staged event definition，據此選擇 recognizer 與畫面標籤。開啟 `/editor`，從該活動 data repo 或受信任的本機來源選擇原始配置圖。原圖不複製到程式 repo。

### 2. 辨識

`recognizeMapTemplate(event.mapTemplate, imageData)` 依活動定義分派辨識 adapter，回傳 `MapRecognitionReport`。FF47 adapter 負責：

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

- **「新增一排」一次產生整排攤位**：輸入排標籤、起點與終點、格數、每格寬高與編號規則（前綴、起始編號、補零位數），工具依端點等距產生 slot。起點與終點是**第一格與最後一格的中心**。**排方向由端點自動判定**（橫向跨距大於縱向即為橫排），不另外輸入——兩個渲染器都用 `orientation` 決定排標籤放在哪一軸，與幾何矛盾的值會把標籤放到錯的位置。特殊情況可在建立後於排清單更改。排標籤與代碼前綴是任意字串，因此地支（`子`、`丑`…）或 `商` 這類區段不需特殊處理；前綴留空則沿用排標籤。
- 建立前會即時預覽將產生的代碼，並擋下重複的排標籤與跨排重複的攤位代碼。
- **錨點推算**：在「新增一排」面板按「開始標記錨點」後，於畫布空白處點選三格以上的中心，並在清單填入該格在這一排的編號（可不相鄰、不依序，例如第 1、5、12 格）。工具以最小平方法對兩軸擬合直線，外推出最低到最高編號之間的每一格，並顯示格數、起始編號與**最大偏差**——偏差大代表某個錨點點在別格上，應先修正再推算。三個是最少能互相矛盾的數量，兩個只能決定一條線而無法平均掉點選誤差。
  - **推算結果一律是草稿**：草稿以虛線畫在畫布上，逐格列出並各自有確認勾選框，**預設全部未確認**。未確認的格以灰色虛線畫出、已確認的以綠色實線畫出，兩者都在畫面上，才能對著原圖判斷該留哪幾格——外推會產生錨點之間本來不存在的格子（例如中間其實是通道），預設勾選會讓確認步驟形同虛設。只有勾選確認的格會寫進 layout，一格都沒確認時「加入確認的 N / M 格」不可按。草稿不存在於 `EventMapLayout` 裡，因此未確認的格子在結構上就不可能進入送審內容——這是位置關係，不是額外的旗標。
  - 改動排標籤、代碼前綴、每格寬高、補零位數等任一欄位，或新增、移除、改動任一錨點編號，都會**丟棄既有草稿**；改變畫布尺寸時錨點與其他元素一起依比例縮放，草稿同樣丟棄，必須重新推算，必須重新推算，避免畫面顯示新值卻寫入舊值。關閉「新增一排」面板會一併結束錨點標記，畫布隨即恢復框選。
  - 推算只決定端點與格數，實際產生 slot 仍由 `generateRowSlots` 負責，代碼與唯一性檢查與手動建立完全相同。推算邏輯在 `app/map-layout-editor-geometry.ts`，不依賴任何版型辨識器，可用於沒有辨識器的新版型。
- inspector 的排清單可改名、改方向或移除整排。**手動「新增攤位」只會加進目前選取的排**，無法建立新的排——排一律由「新增一排」建立。
- 可拖曳或輸入座標調整一般攤位、柱子與出入口。**場館外框從外框線拖曳**，避免填滿整張圖時吃掉空白處的點擊。
- 可新增、命名、分類、縮放或移除企業攤、舞台及其他非一般攤位區。
- 選取一般攤位、柱子、非一般攤位區或場館外框後，物件四角顯示直接縮放把手。
- **多選**：Shift 點選加選或取消單一元素；在空白處拖曳框選範圍內的所有元素，按住 Shift 拖曳則併入既有選取。選超過一個元素時，四角把手改為框住整組，縮放會把整組從原本的外接矩形映射到新的外接矩形，內部間距按比例保留。
- **批次操作**：多選後可一起拖曳、以方向鍵微調，或用 inspector 的靠左／靠右／靠上／靠下對齊。整組共用同一位移，因此碰到畫布邊界時整組一起停下，不會壓扁彼此間距；對齊後所有元素仍在畫布內。一次批次操作是一個復原步驟。
- **複製整排**：選取一格或多格攤位後按「複製選取的 N 格」，輸入位移 X／Y 與新排標籤即可貼上成新的一排，供對排配置使用。排標籤留空則沿用原標籤。重複的排標籤與攤位代碼會自動加上數字後綴，代碼隨新排標籤更名，因此貼上結果不會與既有代碼衝突。貼上後新排即為選取狀態，可直接拖曳修正位移。
- inspector 上方的「畫布寬」「畫布高」改變座標空間，既有排、柱子、非一般攤位區與出入口依比例保留。
- **吸附**：拖曳四角縮放時對同類元素吸附（攤位對攤位、柱子對柱子、企業攤對企業攤），移動時只有企業攤對企業攤吸附。距離 8 個螢幕像素內且另一軸至少重疊四分之一時，自動吸附最近的相對邊並顯示對齊導引線。**按住 Alt 暫停吸附。**
- 方向鍵移動 1px，Shift + 方向鍵移動 10px；多選時整組一起移動。
- **逐步復原**：工具列的「復原」與「重做」（`Ctrl`／`Cmd` + `Z`，加 `Shift` 或 `Ctrl` + `Y` 重做）可回到任一中間狀態，不必整份還原。快捷鍵在 inspector 有焦點時同樣有效，但文字欄位內保留瀏覽器原生的復原。
  - **一次手勢算一步**：一次拖曳或縮放、一段連續同方向的方向鍵微調、同一欄位的連續輸入各自合併成單一步驟；改變方向、換欄位、放開方向鍵或結束拖曳都會結束該步驟，下一次操作另起一步。
  - 復原後再編輯會捨棄可重做的分支。
  - 歷史只保存最近 `LAYOUT_HISTORY_LIMIT`（50）份 layout，**不保存原始圖位元組**。超出上限的最舊步驟會被丟棄。
  - 重新辨識圖片、改用空白地圖或按「還原本次編輯」是整份替換 layout，不是編輯步驟，歷史會從新的 layout 重新開始。
- 720px 以下貼底並改為單欄預覽，主要發布動作固定在工作面板底部。此規則不增加任何公開 Pages route。

### 5. 發布到本機 D1

只有該活動 template 的完整性條件通過、**來源說明非空**，且**信心門檻通過**才可發布。FF47 為 A 至 W、988 格、28 根柱子與 5 個出入口；人工繪製的 layout 只套用通用 layout 驗證，信心固定為 `1`。按「發布活動地圖」後 route 驗證並 UPSERT，回傳 revision。

人工繪製沒有 template 完整性規則可擋，**逐格與官方攤位清單的核對是人工責任**。

### 6. 匯出公開快照

```bash
npm run map:snapshot -- ff47 ../tw_doujin_event-data/events/ff47/map.json
```

```bash
npm test
```

`map:snapshot` 會建立 authoring build，再將指定活動的已發布 revision 寫到明確指定的 data repo 路徑。程式會拒絕寫回已退役的 `public/data/events/`。在 data repo review、提交並推送後，再依[社團與活動資料更新](./catalog-data-update.md)更新 pin。

### 7. Review 後發布

檢查快照的 diff、revision、來源檔名與地標，跑完[共同 gate](./local-development.md#驗證-gate)，以 pull request 檢查 preview，合併到 `main` 讓 GitHub Actions 發布 production。

**靜態快照是公開資料的唯一真相。** 未經 review 的本機 D1 或圖片不會因 Pages 部署而公開。

## 持久化 seam

本機 authoring 的持久化由純 repository、純 route handlers 與環境 wrapper 構成。**這一段持久化不在 Pages deployment 內**，且依 ADR-0038 決策第 2 點維持如此——瀏覽器內的 authoring 不使用它，改走 `/circle` 的私人草稿與版本化候選匯出路徑。

- `createEventMapRepository(database)` 只接收注入的 `D1Database`，負責資料表就緒、驗證、查詢與 revision UPSERT。
- `createEventMapHandlers(repository)` 只依賴 `getEventMap` / `publishEventMap`，負責參數與 payload 驗證及 HTTP 回應。Cloudflare route wrapper 才讀取環境 binding。

| Route | 行為 |
|---|---|
| `GET /api/events/:eventId/map` | 取得已發布 layout；不存在時 404 |
| `PUT /api/events/:eventId/map` | 驗證完整 layout 後以 event ID UPSERT |

- D1 `event_maps.event_id` 是唯一鍵；每次覆寫增加 revision，保存來源檔名、辨識信心與更新時間。
- **公開前台不呼叫這兩個 route。**
- 隔離 Miniflare D1 測試必須證明：一次 PUT 可由稍後 GET 讀回、第二次 PUT 會增加 revision、無效 event ID 與低信心內容不寫入。

## 現行限制與後續範圍

- **`PUT` route 沒有身分驗證。** 它只在本機 authoring 環境可達，不部署到 Pages，也不得因地圖貢獻控制面存在而重新公開。**ADR-0038 對選項 B 定案後這句仍然有效**：B 把 authoring **介面**搬上 Pages，持久化改走 `/circle` 既有的管理者授權、私人草稿、審閱與版本化候選匯出機制，不部署這個 route。見[地圖貢獻控制面基礎契約](../contracts/map-contributions.md)。
- 對非一般攤位文字做 OCR。第一階段只保存可可靠辨識的相對矩形。
