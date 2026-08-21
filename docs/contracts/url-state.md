# URL 檢視狀態契約

URL 是跨模組的共享狀態，因此獨立成一份契約：搜尋、地圖、規劃篩選與顯示設定都往同一組查詢參數寫入。任何模組新增可分享狀態，都必須先在這裡登記。

**實作**：[`app/event-url-state.ts`](../../app/event-url-state.ts)（schema、defaults、codec 與 history intent）、[`app/map-view-state.ts`](../../app/map-view-state.ts)（選取解析）、[`app/event-workspace-projection.ts`](../../app/event-workspace-projection.ts)（共享衍生狀態）
**測試**：`tests/event-url-state.test.mjs`、`tests/map-view-state.test.mjs`、`tests/event-workspace-projection.test.mjs`

## 參數

所有可分享狀態都掛在根路徑的 query string，不建立會和 Pages `index.html` 正規化衝突的 SPA rewrite。

| 參數 | 負責模組 | 說明 |
|---|---|---|
| `event` | 活動 | 目前活動 ID，永遠寫出 |
| `day` | 活動 | 活動日，永遠寫出 |
| `area` | 活動 | 展區，永遠寫出。讀取時接受 legacy 別名 `hall` |
| `query` | 探索搜尋 | 一般關鍵字 |
| `genre` | 探索搜尋 | 社團主題類別；值為 active event 分類目錄中的顯示名稱 |
| `creator` | 詳細搜尋 | 創作者類型 |
| `work` | 詳細搜尋 | 作品名稱／題材 |
| `workType` | 詳細搜尋 | `original` 或 `derivative` |
| `r18` | 詳細搜尋 | 分級；`general` 只匹配明確一般分級 |
| `favorite` | 規劃篩選 | `1` 代表只看收藏 |
| `favoriteGroup` | 規劃篩選 | 收藏群組 ID |
| `visit` | 規劃篩選 | 行程狀態 |
| `sort` | 顯示設定 | 結果排序 |
| `density` | 顯示設定 | 資訊密度 |
| `media` | 顯示設定 | 每筆媒體數 |
| `selectedCircle` | 地圖／詳情 | canonical `CircleRecord.id` |
| `selectedBooth` | 地圖／詳情 | 實際 `PlacementRecord` 的攤位代碼 |

除 `event`、`day`、`area` 外，**參數在等於預設值時從 URL 移除**，不留下無意義的殘留條件。

## 規則

- **`selectedCircle` 與 `selectedBooth` 必須互相驗證。** 兩者都在時取交集；只有 `selectedCircle` 時取該社團在該日的第一筆配置；無效或已變更的關聯降級為只開啟仍有效的活動與區域，**不顯示錯誤社團**。
- **攤位範圍 deep link 在 selection seam 解析。** `selectedCircle` 若帶的是攤位範圍 ID（`1-e19`、`1-e19-0`），先從 records 解析為 allocated ID，再與日期／攤位取交集；成功恢復後只會重新序列化 canonical `c-*`。舊的 `ff47-<hash>` ID 已無相容路徑，解析不到就 fail closed（[ADR-0013](../adr/0013-drop-the-legacy-circle-id-compatibility-path.md)）。
- **採多活動資料模型、單一 active-event UI。** codec 與 workspace projection 都接受 event definition；`event` 缺少時使用 active event，等於其他活動時整份 query fail closed 回 active event defaults，不讓篩選或選取跨活動洩漏。加入第二個活動前不先顯示活動選擇器。
- **defaults 從 event definition 推導。** `day`、`area` 與 genre 預設分別取活動定義的第一筆，不在 codec 內硬編碼 FF47 的 `1`、`ALL` 或「全部類別」。
- `genre` 只接受 active event 的衍生分類字彙；舊工作簿類別或其他活動的值一律回到「全部類別」，不跨活動猜測對應。
- **恢復時機**：初始化、重新整理與 `popstate` 必須恢復篩選及選取。地圖資料延後完成時，以保存的攤位代碼重新聚焦。
- **延後套用選取**：可分享連結的社團與攤位選取要等社團快照可解析後才套用。**在此之前不得改寫 URL**，否則會把使用者分享的深層連結洗掉。
- **不寫入 URL 的狀態**：hover、拖曳中的 viewport、動畫進度、尚未套用的篩選草稿。
- **歷史紀錄**：只有使用者透過明確操作改變選取或篩選時才建立歷史紀錄；連續平移與縮放不得淹沒瀏覽器上一頁。
- **桌機與手機使用相同的 URL 狀態與結果集合**，不建立第二套參數語意。
- 搜尋結果、地圖 markers、selection、planning、active filters 與桌機／手機 panels 都消費同一份 event-scoped workspace projection；rendering 與 pointer gestures 不進入該 domain seam。

## 驗收條件

- 複製任一 URL 到新瀏覽器工作階段後，可恢復有效的查詢、篩選與選取。
- 套用詳細搜尋後重新整理，四個詳細搜尋參數與結果都還在；未套用的草稿不在 URL 裡。
- 深層連結（含 `selectedCircle`）在快照載入完成前不被改寫。
- 切換資訊密度、媒體數量或排序會更新 URL，但不改變結果 ID 集合。
- 瀏覽器上一頁可逐步退回明確的操作，不會退回到平移或縮放的中間狀態。
