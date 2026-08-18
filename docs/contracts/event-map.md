# 活動地圖契約

公開閱讀端的向量地圖：資料不變量、renderer 邊界、互動與縮放規則。

**實作**：[`app/accessible-event-map-renderer.tsx`](../../app/accessible-event-map-renderer.tsx)、[`app/event-map.ts`](../../app/event-map.ts)、[`app/map-viewport.ts`](../../app/map-viewport.ts)、[`app/map-view-state.ts`](../../app/map-view-state.ts)
**測試**：`tests/map-viewport.test.mjs`、`tests/map-view-state.test.mjs`、`tests/map-import.test.mjs`
**產物**：`public/data/events/ff47/map.json`
**流程**：[地圖 authoring](../runbooks/map-authoring.md)

一般使用者不上傳圖片、看不到管理入口。公開頁面只讀取隨 build 發布的已驗證靜態快照——決策見 [ADR-0008](../adr/0008-static-public-reading-path.md)。原始配置圖只供 authoring 階段辨識與對照，**不作為前台底圖**。

## 地圖資料不變量

- 座標使用原始辨識圖片的像素座標；`width`、`height` 定義 SVG `viewBox`。所有元素都在同一座標空間。
- `rows[].label` 在同一 layout 中唯一；完整 FF47 layout 必須包含 A–W。
- A–V 的 `orientation` 為 `vertical`，W 為 `horizontal`。
- slot 掛在排底下（`rows[].slots[]`，`EventMapLayout` 沒有頂層 `slots`）；`code` 在同一 layout 中唯一。slot 保存矩形 `x/y/width/height`，互動使用 slot 而非圖片座標點。
- pillar 必須保存 `x/y/width/height`；access point 必須保存 `kind`、位置與方向。
- layout JSON 必須通過 `validateEventMapLayout` 才能進入 renderer 或持久化層。
- **FF47 完整性規則**：23 排（A–W）、988 格（A 22、B–V 21×44、W 42）、28 根柱子、5 個出入口。

FF47 是單一展館的完整配置：`areaMode: "single"`。`FF47_EVENT.areas` 仍登錄 `ALL`（全館）與 `A`（A–K 區）、`B`（L–W 區）三筆，但 `single` 讓介面**不出現區域切換，也不呈現 A–K／L–W 分區**——那是同一館的兩半，不是兩個館。`areaMode: "switchable"` 保留給未來真正的多館或多層活動；只有 `switchable` 且展區多於一個時才顯示切換控制（`eventUsesAreaSwitcher()`）。

資料模型不得把 FF47 的 A–W、988 格或特定場館幾何當成所有活動的固定規則。

## Renderer 邊界

`AccessibleEventMapRenderer` 是深模組，穩定 interface 只接受已整理好的顯示資料與選取事件：

```ts
type AccessibleEventMapRendererProps = {
  eventName: string;
  layout: EventMapLayout;
  slots: Record<string, MapSlotView>;
  showMedia?: boolean;
  onSelect: (code: string) => void;
};
```

- `slots[boothCode]` 已包含標籤、可讀名稱、色調，以及 selected、favorite、planned、next、visited 顯示狀態。
- **renderer 不自行讀取社團資料、規劃 store 或 URL**，也不寫入產品狀態。
- 頁面 controller 負責把 URL、社團資料、收藏與行程投影成 renderer props，並在 `onSelect` 後同步 URL 與詳情。
- 這個邊界讓地圖可獨立測試，也讓同一份 layout 未來能投影出 minimap 而不維護第二套座標。

## 互動契約

- **SVG slot 本身是互動元素。** 禁止在圖片上疊 HTML 按鈕。
- **鍵盤**：攤位使用單一 Tab 入口的 roving focus，限制大量 Tab 停靠點；方向鍵依幾何鄰近攤位移動，Enter／Space 開啟。
- **可讀名稱**：可互動 slot 的 `aria-label` 必須包含攤位、社團、類別**以及所有目前規劃狀態**（已收藏、待前往、下一站、已走訪）。視覺標記與文字狀態由同一投影產生，狀態變更後即時更新。
- **指標與觸控**：滑鼠拖曳平移、游標中心滾輪縮放、觸控單指平移與雙指縮放（pointer capture）。空白地圖區支援拖曳；攤位本身保留點按，不觸發背景拖曳。
- 地圖容器與 SVG 文字套用不可選取規則，並由 `selectstart` 防線阻止拖曳時產生文字反白。
- **固定控制器**（放大、縮小、重設、指南針）固定在地圖邊緣，不隨 SVG 縮放。重設回到完整可用範圍。
- `prefers-reduced-motion` 時停用轉場；拖曳與縮放維持直接跟手，不加入彈性或慣性動畫。

### Slot 視覺狀態

未配置攤位低對比；有社團的攤位採分類色淡底；selected 使用實色與 3px 深色描邊；favorite 加入珊瑚圓點；next 加入深墨箭頭。**任何狀態都不得只靠顏色表達**，必須有形狀或文字補充。

## 縮放契約

- **最大放大倍率 600%。**
- **最小倍率是動態下限**，不是固定值：`min((viewportWidth - padding) / floorWidth, (viewportHeight - padding) / floorHeight, 6)`。重設、按鈕、滾輪與雙指縮放共用同一最小倍率；縮小到邊界後完整場館必須仍在可視區內。
- 視窗尺寸改變時，若使用者原本停在完整場館倍率，地圖重新置中並套用新的完整場館倍率。
- 實測參考值：614 × 430 的地圖可視區，完整場館倍率為 38%；再往下縮仍維持 38%，且場館四邊都在可視區內。
- **145% 起顯示具可追溯來源的社團縮圖**；低於門檻回到高辨識度的色塊與代碼。縮圖不得超出攤位格，以免遮住相鄰攤位。
- **沒有縮圖的攤位在任何倍率都畫成一般攤位格**：色塊、置中代碼與狀態標記，不留空白媒體區。依 [ADR-0012](../adr/0012-first-party-sources-only.md) 退場工作簿縮圖索引後這是常態——縮圖只剩社團自填，門檻之上多數攤位仍是色塊。
- **200% 以上固定控制器以 25% 級距縮放**，讓使用者能快速進入可辨識縮圖的倍率。
- **選取後只移動不改倍率**：搜尋結果、URL 或地圖選取攤位後，地圖只移動至對應座標並保留使用者目前倍率，不回彈到預設倍率。單一搜尋結果可自動開啟詳情。

## 使用者流程

1. 選擇活動與日期。只有 `areaMode: "switchable"` 的多館或多層活動才顯示區域切換與場館總覽。
2. 以拖曳、滾輪、觸控手勢或固定控制器平移和縮放；「重設」回到完整可用範圍。
3. 搜尋攤位代碼或社團名稱，選取結果後地圖直接移動到對應攤位。
4. 點選攤位後同步高亮 SVG slot、更新 URL，並開啟同一份社團資料的地圖側欄。共用攤位以緊密清單切換社團；側欄代表圖可直接開啟完整詳情。
5. 收藏、分類、備註、加入行程或設為下一站後，地圖、側欄、清單與完整詳情立即同步。
6. 從社團或收藏清單點「在地圖查看」時，直接恢復正確日期、區域、攤位與詳情，不要求再次搜尋。

## 命名

一般介面與輔助科技名稱使用「**社團攤位配置圖**」或「活動地圖」。「向量」是內部渲染技術，不作為使用者可見的地圖名稱。

## 目前不做

- **minimap 與多館總覽。** 單一場館且完整地圖可直接理解時不強制加入；未來若活動包含多館或分層場域，minimap 仍須與主地圖共用同一 layout 投影，不建立第二份座標資料。
- 對非一般攤位文字做 OCR。
- 將原始配置圖作為一般使用者地圖底圖。
- 圖磚式地圖（Leaflet 等）。見 [ADR-0001](../adr/0001-adopt-webcatalog-patterns-selectively.md)。

## 驗收條件

- FF47 原圖辨識結果包含 23 排：A–W；A–V 縱向、W 橫向，slot 總數 988，柱子與 5 個出入口在 SVG 中可見。
- 靜態快照發布後，另一個全新瀏覽器工作階段不需圖片、Worker 或 D1 即可取得同一 event map。
- 前台 DOM 不含作為地圖底圖的配置圖 `<img>`。
- 從社團清單點「在地圖查看」會直接顯示正確日期、區域、攤位高亮與對應詳情。
- 以含日期、區域及社團 ID 的網址開啟時，對應攤位被選取並顯示詳情；瀏覽器上一頁不會被平移／縮放事件淹沒。
- 使用滑鼠、觸控與鍵盤皆能選取攤位；螢幕閱讀器可讀出「A03、社團名、已收藏、下一站」等組合。
- 縮放後仍可回到完整場館範圍；縮小到邊界時場館四邊均在可視區內。
- 收藏群組改變後，地圖、清單與詳情不需重新整理便同步更新。
- 前台不顯示 A–K／L–W 區域切換。
- 外部內容缺少或載入失敗時，已發布向量地圖、社團核心資訊與收藏操作仍可使用。
