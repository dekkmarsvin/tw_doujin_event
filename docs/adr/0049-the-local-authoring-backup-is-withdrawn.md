# ADR-0049：本機 authoring 備援退場，只留控制面一條路

- **狀態**：Accepted
- **日期**：2026-09-02
- **取代**：[ADR-0038](./0038-authoring-moves-to-the-control-surface-local-stays-as-backup.md) 決策第 3 點「本機 authoring 環境保留為離線備援，不退場」。該 ADR 其餘各點——authoring 介面在控制面、讀者介面不得出現管理入口、持久化走 `/circle` 私人草稿——全部維持有效
- **延續**：[ADR-0008](./0008-static-public-reading-path.md) 的靜態公開讀取路徑、[ADR-0033](./0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md) 的草稿與審閱機制
- **相關文件**：[地圖 authoring runbook](../runbooks/map-authoring.md)、[主辦單位工作區契約](../contracts/organizer-workspace.md)

## 背景

ADR-0038 把 authoring 介面搬到控制面後，保留本機 `/editor` 作為離線／事故備援，理由寫得很明確：「它與控制面共用同一個 `MapLayoutEditor`，維護成本近乎零。」該 ADR 同時留下一個未決問題：「搬移後 `/editor` 是否仍需要自己的 `vite.config.ts` build，等看實際共用面積再決定。」

實際共用面積現在可以量了，而「成本近乎零」不成立。共用的只有 `MapLayoutEditor` 這一個 component；不共用而且只為 `/editor` 存在的，是一整套平行技術堆疊：

- 第二套 build：`vite.config.ts`、`vinext`、`@vitejs/plugin-rsc`、`react-server-dom-webpack`、`@cloudflare/vite-plugin`，以及 `worker/index.ts` 這個 Cloudflare Worker entry。
- 第二套持久化：`drizzle-orm`、`drizzle-kit`、`drizzle.config.ts`、`db/schema.ts`、`drizzle/` 下永遠不會執行的 migration。全 repo 只有 `event_maps` 一張表走 ORM，其餘二十餘張表都是 `database.prepare()` 的原生 SQL，而且 `event_maps` 自己的 `CREATE TABLE` 也是手寫的。
- 第二套 Next 形狀的 app：`app/page.tsx`、`app/layout.tsx`、`app/editor/`、`app/api/`，其中 `PUT /api/events/:eventId/map` 至今沒有身分驗證。
- 一個只為了清掉前者副作用而存在的 build 步驟：`scripts/prepare-pages-build.mjs` 每次 Pages build 都要移除 vinext 留下的 Wrangler deploy redirect。

換句話說，公開部署的每一次 build 都要先繞過備援路徑留下的殘骸。這不是近乎零，這是七個 dependency、兩條 build pipeline，外加一個清理腳本。

備援本身也未被證實可用。`map:snapshot` 依賴本機 D1 有一份已發布 revision，而該 revision 只能由那個沒有身分驗證的 `PUT` route 寫入；沒有任何測試或 CI 步驟走過完整的「離線重建快照」流程。一條沒有人走過的備援路徑，在事故當下不會比沒有更可靠。

## 決策

### 1. 移除本機 authoring 堆疊

刪除 `/editor` 及其專屬的一切：`app/editor/`、`app/editor-page.tsx`、`app/page.tsx`、`app/layout.tsx`、`app/api/`、`app/map-admin-importer.tsx`、`app/event-map-client.ts`、`app/event-map-route-handlers.ts`、`db/event-maps.ts`、`db/event-map-repository.ts`、`db/schema.ts`、`worker/`、`build/`、`drizzle/`、`vite.config.ts`、`next.config.ts`、`drizzle.config.ts`、`scripts/prepare-pages-build.mjs`、`scripts/export-static-event-map.mjs`。

`npm run dev`、`npm run build:editor`、`npm run map:snapshot`、`npm run pages:prepare` 與 `npm run db:generate` 一併移除。

### 2. 辨識能力留在控制面，不隨 `/editor` 一起走

`recognizeMapTemplate()` 與 `app/map-recognition.ts`、`app/map-template-registry.ts` 全部保留——它們早已由主辦單位工作區直接呼叫（`app/organizer/organizer-app.tsx`）。ADR-0035 已經記載「配置圖辨識完全在瀏覽器內執行」，本機伺服器從來不是辨識的前提，只是寫入本機 D1 的前提。因此刪掉寫入路徑不會失去辨識能力。

同理，`MapLayoutEditor`、`app/map-editor-history.ts`、`app/map-layout-editor-*.ts` 全部保留，它們是控制面的實作。

### 3. 事故備援改由既有機制承擔

不再保留一條獨立的離線寫入路徑。控制面不可用時的復原方式是既有的兩項，兩者都已在流程內被使用過：

- 公開資料的唯一真相是 data repository 裡的靜態快照。它在版本控制中，可直接編輯與 review，不需要任何本機 D1。
- 地圖草稿與審閱走 [ADR-0033](./0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md) 的私人草稿與版本化候選匯出。

### 4. 沒有身分驗證的寫入 route 從此不存在

`PUT /api/events/:eventId/map` 一併刪除。ADR-0038 決策第 2 點要求它「不得因地圖貢獻控制面存在而重新公開」；刪除比維持一條靠「不建置進 Pages」來保證安全的 route 更能滿足該要求。

## 後果

- 少七個 dependency（`vinext`、`@vitejs/plugin-rsc`、`react-server-dom-webpack`、`@next/eslint-plugin-next`、`@cloudflare/vite-plugin`、`drizzle-orm`、`drizzle-kit`），`npm ci` 少裝 122 個套件。
- 只剩一條 build pipeline（`vite.pages.config.ts`），`build:staged` 少一個清理步驟。
- 本 repo 從此沒有任何 ORM，也沒有任何 migration 檔案。所有 D1 schema 的唯一 authority 是 `db/identity-runtime-schema.ts`，執行期建立。
- 失去「控制面不可用時仍能從本機 D1 重建地圖快照」這條路徑。接受這個損失的理由是它從未被驗證過，而它保護的情境已有兩條走過的替代路徑（決策第 3 點）。
- CSS Modules 的型別宣告原本來自 `next-env.d.ts`，改由 `vite-env.d.ts` 自行宣告。

## 未決

- 若日後真的發生控制面長時間不可用且需要離線 authoring，重建的形狀不會是 `/editor`：它應該直接產出 data repository 的靜態快照，而不是先寫進一個本機資料庫再匯出。
