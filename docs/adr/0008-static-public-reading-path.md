# ADR-0008：公開閱讀路徑純靜態，不經 Worker

- 狀態：已定案
- 相關契約：[資料傳輸與離線契約](../contracts/delivery-and-offline.md)、[活動地圖契約](../contracts/event-map.md)
- 相關流程：[部署](../runbooks/deployment.md)

## 脈絡

場刊資料很大：`circles.json` 約 1.8 MB，涵蓋 1,336 個社團與 2,977 筆配置。地圖 layout 是另一份版本化 JSON。

Cloudflare Pages 的 advanced mode（產生 `dist/_worker.js`）會讓**每一個請求都經過 Worker**，包含這 1.8 MB 的靜態檔案。同時，把場刊打包進 JS bundle 也會讓首屏必須等整包下載完。

而展場現場的網路條件是這個產品最壞的執行環境。

## 決策

**公開閱讀路徑完全靜態，由邊緣直送。**

- 場刊與地圖是版本化靜態快照（`circles.json`、`map.json`），隨 build 發布，**不打包進 JS bundle**。
- **不使用 advanced mode**：不得產生 `dist/_worker.js` 或 server bundle。
- `functions/` 只承載社團身分、認領、編輯、管理 route 與公開的 `overrides.json`。Pages 自動產生的路由表只涵蓋這些路徑，`/`、`/assets/*`、`/fonts/*` 與場刊快照都不被攔截。
- 地圖以 SVG slot 直接互動，不使用圖磚式底圖（也見 [ADR-0001](./0001-adopt-webcatalog-patterns-selectively.md)）。
- 註冊 Service Worker 作為離線 shell。

## 後果

- **首屏必須先畫介面骨架**，社團清單於快照載入後補上。因此需要 skeleton、需要「篩選詞彙先到」、需要「延後套用選取」——這一整套載入契約都是這個決策的直接後果。
- 展場離線可重新載入並繼續使用已下載的場刊與地圖。
- **測試必須把關產物邊界**：`_worker.js` 不存在、主 bundle 不含場刊資料字面值、precache 清單完整。這些不是額外的謹慎，是這個決策唯一的執行機制。
- 社團補充資料因為需要即時撤下，走 Pages Function（`overrides.json`）而非快照。它的 ETag 必須含活動階段，否則快取會提供已撤回的內容。
- 地圖 authoring 因此必須留在本機：發布流程是「本機 D1 → `map:snapshot` → 版本控制 → build」，見[地圖 authoring](../runbooks/map-authoring.md)。
- **靜態快照是公開資料的唯一真相。** 未經 review 的本機 D1 或圖片不會因部署而公開。
