# 活動地圖模組設計

## 產品定義

- 配置圖匯入是管理員工作；開發階段先不做權限控管，但所有寫入集中在管理匯入介面與 `PUT /api/events/:eventId/map`。
- 一般使用者不需要也不應上傳圖片。頁面只透過 `GET /api/events/:eventId/map` 讀取該活動目前發布的地圖。
- 原始圖片只供辨識與管理預覽；發布內容是可版本化的向量地圖資料，不保存為前台底圖。
- FF47 第一階段以 A–W 一般攤位排、柱子及出入口準確為完成條件。非一般攤位區域使用可選的 landmark 保存相對位置，之後可以逐步補上語意標籤。
- 地圖的可分享檢視狀態由 URL 表達；外部圖片或介紹是可選補充，載入失敗不得阻斷攤位定位、收藏與行程操作。

## 模組與 seam

### `recognizeFF47Map(imageData)`

深模組，唯一公開 interface 是輸入圖片像素、回傳 `MapRecognitionReport`。implementation 內部負責：

- 從格線辨識 A–V 縱向排與 W 橫向排。
- 依 FF47 編號規則產生 slot：A 為 01–22；B–V 為 01–44；W 為 01–42。
- 從實心黑色元件辨識柱子並保存矩形尺寸，不將柱子降為單一點。
- 從紅色箭頭辨識出入口；上側為出口、下側為入口。
- 回傳信心、警告與完整向量 layout。低信心結果不能發布。

### `AccessibleEventMapRenderer`

深模組，穩定 interface 只接受已整理好的顯示資料與選取事件：

```ts
type AccessibleEventMapRendererProps = {
  eventName: string;
  layout: EventMapLayout;
  slots: Record<string, MapSlotView>;
  onSelect: (boothCode: string) => void;
};
```

`slots[boothCode]` 已包含標籤、可讀名稱、色調、selected、favorite、planned、next 與 visited 顯示狀態。renderer 不自行讀取社團 repository、收藏 storage 或 URL。implementation 使用 SVG `viewBox` 繪製：

- 場館輪廓、A–W 攤位 slot、柱子、出入口及可選 landmark。
- 類別色、收藏、下一站及選取狀態。
- SVG 元素本身負責互動；不得再用原始圖片作底圖並在上方放置 HTML 按鈕。
- 可選 minimap 與主地圖使用同一份 layout 和 viewport 投影，不維護第二套座標。

頁面 controller 負責把 URL、社團資料、收藏與行程狀態投影成 renderer props，並在 `onSlotSelect` 後同步 URL 與詳情。這個邊界讓地圖可獨立測試，也避免 renderer 直接寫入產品狀態。

### 活動地圖 repository

持久化 seam 由純 repository、純 route handlers 與環境 wrapper 構成：

- `createEventMapRepository(database)` 只接收注入的 `D1Database`，負責資料表就緒、驗證、查詢與 revision UPSERT。
- `createEventMapHandlers(repository)` 只依賴 `getEventMap`／`publishEventMap`，負責參數與 payload 驗證及 HTTP 回應；Cloudflare route wrapper 才讀取環境 binding。

- `GET /api/events/:eventId/map`：取得已發布 layout；不存在時回傳 404。
- `PUT /api/events/:eventId/map`：驗證完整 layout 後以 event ID UPSERT；開發階段不驗證管理員身分。
- D1 `event_maps.event_id` 是唯一鍵；每次覆寫增加 revision，保存來源檔名、辨識信心與更新時間。
- 前台只讀 GET。管理匯入器在預覽確認後才呼叫 PUT。
- 隔離 Miniflare D1 測試必須證明一次 PUT 可由稍後 GET 讀回，第二次 PUT 會增加 revision，且無效 event ID／低信心內容不寫入。

## 地圖資料不變量

- 座標使用原始辨識圖片的像素座標，`width`、`height` 定義 SVG viewBox；所有元素都在同一座標空間。
- `rows[].label` 在同一 layout 中唯一，完整 FF47 layout 必須包含 A–W。
- A–V 的 `orientation` 為 `vertical`，W 為 `horizontal`。
- `slots[].code` 在同一 layout 中唯一；slot 保存矩形 `x/y/width/height`，互動使用 slot 而非圖片座標點。
- pillar 必須保存 `x/y/width/height`；access point 必須保存 `kind`、位置與方向。
- layout JSON 必須通過 `validateEventMapLayout` 才能進入 renderer 或 repository。

## 一般使用者流程

1. 使用者選擇活動與日期；只有 `areaMode: "switchable"` 的多館或多層活動才顯示區域切換與場館總覽。FF47 是同一展館的完整配置，固定使用 `ALL`，不把 A–K／L–W 誤作兩館。
2. P1 使用者以拖曳、滑鼠滾輪、觸控手勢或固定控制器平移和縮放；「重設」回到完整可用範圍。
3. 使用者可搜尋攤位代碼或社團名稱，選取結果後地圖直接移動並放大到對應攤位。
4. 點選攤位後同步高亮 SVG slot、更新 URL，並開啟相同社團資料的地圖側欄；共用攤位以緊密清單切換社團。側欄代表圖可直接開啟同一筆社團的完整詳情。
5. 收藏、分類、備註、加入行程或設為下一站後，地圖、側欄、清單與完整詳情立即同步。
6. 從社團或收藏清單點「在地圖查看」時，直接恢復正確日期、區域、攤位與詳情，不要求再次搜尋。

## 地圖檢視狀態與 URL

```ts
type MapViewState = {
  eventId: string;
  day?: string;
  area?: string;
  selectedCircleId?: string;
  selectedBoothCode?: string;
  query?: string;
};
```

- `eventId`、日期、區域、搜尋文字與目前選取是重新整理、上一頁與分享連結後應恢復的狀態。
- `selectedCircleId` 與 `selectedBoothCode` 必須互相驗證；無效或已變更的關聯降級為只開啟仍有效的活動／區域，不顯示錯誤社團。
- hover、拖曳中的 viewport、動畫進度與尚未套用的篩選草稿是暫時介面狀態，不寫入 URL。
- 使用者透過明確操作改變選取或篩選時才建立歷史紀錄；連續平移與縮放不得淹沒瀏覽器上一頁。

## 分期邊界

- **P0：** 已發布 SVG 地圖、攤位選取、社團詳情雙向定位、可恢復的 URL 選取狀態，以及收藏／行程跨介面一致性。
- **P1：** 完整拖曳、滾輪與觸控縮放、重設視野、地圖定位搜尋，以及只在多館或高倍率情境出現的總覽／minimap。
- **P2：** 外部來源可補充社團詳情，但 provider、授權或同步失敗時仍必須保持地圖核心流程可降級使用。

## 管理流程

1. 管理員開啟「管理地圖」。
2. 上傳 FF47 配置圖，在瀏覽器完成一般攤位、柱子與出入口的純像素辨識；企業攤與舞台目前需手動新增。重新上傳時，既有手動區域會依新圖片尺寸等比例保留並要求再次確認。
3. 預覽 SVG 草稿與辨識摘要；原圖只在此階段作比較。
4. 在細部位置編輯器以 100% 至 400% 縮放、捲動與精確聚焦定位元素，再點選、拖曳或輸入座標，微調一般攤位、柱子、出入口、企業攤、舞台與其他區域；非一般攤位區可改分類，企業攤與舞台可直接拖曳物件四角縮放，方向鍵移動 1px，Shift 加方向鍵移動 10px。
5. 完整性規則與信心門檻通過後按「發布活動地圖」。
6. route 驗證並 UPSERT 到 D1，回傳 revision。
7. 所有使用者重新載入時從 GET 取得同一份活動地圖。

## 目前不做

- 管理員登入與角色授權；PUT route 保留明確 TODO。
- 對非一般攤位文字做 OCR。第一階段只保存可可靠辨識的相對矩形。
- 將原始配置圖作為一般使用者地圖底圖。
- 複製 Comike WebCatalog 的時限解鎖、付費牆或地圖存取倒數。
- 在只有單一場館且完整地圖可直接理解時強制加入 minimap；多館總覽與 minimap 視活動複雜度列為 P1。

## 驗收條件

- FF47 原圖辨識結果包含 23 排：A–W；A–V 縱向、W 橫向。
- slot 總數為 988（A 22、B–V 21×44、W 42）。
- 真圖可辨識柱子與 5 個出入口，且 SVG 中可見。
- 管理員發布後，另一個全新瀏覽器工作階段不需圖片即可取得同一 event map。
- 前台 DOM 不含作為地圖底圖的配置圖 `<img>`。
- 從社團清單點「在地圖查看」會直接顯示正確日期、區域、攤位高亮與對應詳情。
- 複製地圖 URL 到新瀏覽器工作階段後，可恢復有效的查詢與選取；瀏覽器上一頁不會被平移／縮放事件淹沒。
- 同一社團的名稱、攤位、來源與收藏／行程狀態在清單、詳情、地圖 slot 與側欄一致，修改後不需重新整理。
- FF47 前台不顯示 A–K／L–W 區域切換；保留 `switchable` 模式供未來真正的多館活動使用。
- 管理員可移動既有地圖元素、加入企業攤或舞台，且只有調整後的 layout 再次通過完整性規則才可發布。
- P1 地圖可用滑鼠、觸控與鍵盤完成縮放、重設、搜尋定位與攤位選取；狀態不只以色彩表達。
- 外部內容缺少或載入失敗時，已發布向量地圖、社團核心資訊與收藏操作仍可使用。
- build、lint、辨識測試、route 持久化測試與瀏覽器實測通過。
