# FF47 場刊 MAP

Fancy Frontier 47 的同人展逛攤地圖。介面把社團搜尋、SVG 攤位地圖、收藏分組、備註與每日行程整合在同一個工作區，並支援桌面與行動版。

目前的規劃資料保存在瀏覽器 `localStorage`，不會跨裝置同步。

公開閱讀路徑是純靜態的：場刊與地圖以版本化 JSON 快照隨 build 發布，由靜態邊緣直接服務，不經過任何 Worker。另有一個獨立入口 `/circle` 供參展社團登入並維護自己的補充資料，由 `functions/` 下的 Pages Functions 與 D1 承載；**不使用 advanced mode**（不產生 `dist/_worker.js`），因此 `/`、`/assets/*`、`/fonts/*` 與場刊快照都不會被 Worker 攔截。

地圖辨識與細部編輯器仍保留為本機 authoring 工具，供未來拆成受驗證的編輯控制面；它不是公開 Pages 入口的一部分。

## 環境需求

- Node.js `>=22.13.0`
- npm
- 公開 Pages 前台不需要 Cloudflare 帳號或 D1
- 只有要更新地圖靜態快照時，才需要本機 authoring D1

## 啟動

```bash
npm install
npm run dev:pages
```

開啟終端顯示的本機網址。前台會從 `public/data/events/ff47/map.json` 讀取已驗證的 revision 3 地圖快照，並從 `public/data/events/ff47/circles.json` 讀取社團與攤位快照。

`npm run dev:pages` 不註冊 Service Worker，開發時不會有快取擋在前面。要驗證離線行為請改用 `npm run preview`（先 `npm run build`）。

## Cloudflare Pages 首次發布

```bash
npm ci
npm test
npm run lint
npx tsc --noEmit --incremental false
```

合併或推送到 GitHub `main` 後，`.github/workflows/deploy-pages.yml` 會重跑以上 gate，先發布並 smoke test `dev-tw-catalog.pages.dev`，再以同一份產物發布 `tw-catalog.pages.dev`；同 repository 的 pull request 會發布 `pr-<number>.dev-tw-catalog.pages.dev` 獨立 preview。首次啟用所需的兩個 repository secrets 見 `docs/cloudflare-pages-deployment.md`。

## 驗證

```bash
npm test
npm run lint
npx tsc --noEmit --incremental false
```

`npm test` 會先建立 Pages production build，再執行所有 Node 測試。測試會確認 `dist/index.html`、靜態地圖與社團快照存在，公開產物不含 `_worker.js` 或 vinext server bundle，主 bundle 不含場刊資料字面值，且 `dist/sw.js` 的 precache 清單涵蓋所有離線必要檔案。

## 更新 FF47 試算表資料

權威來源是公開的 [FF47 Google 試算表](https://docs.google.com/spreadsheets/d/1LvbfijXkjcoK6nKw06U2YBZ655vcIXWvyEVX-pP0ovU/edit?usp=sharing)。先檢查線上資料與本機 `data_source_test/FF47 完整攤位整理.xlsx` 是否有儲存格差異：

```bash
npm run source:check
```

若有差異，命令會列出各工作表新增、移除與變更的儲存格數量及最多 20 筆樣本，並以非零狀態結束，但不修改檔案。確認後執行：

```bash
npm run source:update
```

更新命令會先下載及驗證 XLSX，再替換本機來源，接著重新產生社團模板與來源 manifest，最後重新輸出 `public/data/events/ff47/circles.json`。快照必須納入版本控制；`npm run build` 會以 `catalog:snapshot:check` 驗證它與來源一致，不一致就中止。

**重建場刊後、commit 之前**，必須確認既有認領仍指向存在的社團：

```bash
npm run claims:check
```

社團 ID 是 `FNV-1a(試算表列號 + 社團名)`，上游插入一列或社團改名都會讓其後所有 ID 改變。這個檢查會列出失效的認領與補充資料，並用認領當下記錄的名稱建議新的 ID。它不在 `npm run build` 裡——CI 沒有 D1 binding，放進去只會讓每次部署失敗，而不是抓到真正的漂移。加上 `-- --remote` 可檢查正式環境的 D1。比對以工作表名稱、儲存格值與公式為準，不會因 Google 每次匯出產生不同的 XLSX 封裝位元而誤判。下載失敗、回傳內容不是 XLSX、缺少主資料工作表或資料列異常過少時都會停止，不會覆寫既有來源。

## 本機地圖 authoring

```bash
npm run dev
```

開啟 `/editor`，選擇 `data_source_test/FF47社團攤位配置圖.jpg`，完成辨識、細部調整與本機 D1 發布。確認後執行：

```bash
npm run map:snapshot
npm test
```

`map:snapshot` 會建立 authoring build，再將本機 D1 的 `ff47` 已發布 revision 匯出到公開靜態 JSON。匯出結果必須納入版本控制並通過完整 layout 驗證。

## 專案結構

- `app/event-map-app.tsx`：搜尋、地圖、詳情與行程工作區
- `app/accessible-event-map-renderer.tsx`：可用鍵盤操作的 SVG 地圖 renderer
- `app/planning-store.ts`：版本化本機收藏與行程狀態
- `app/static-event-map-client.ts`：公開版靜態地圖讀取與格式驗證
- `app/static-circle-catalog-client.ts`、`app/circle-records.ts`：社團快照讀取、格式驗證與讀取模型投影
- `app/use-circle-catalog.ts`：社團快照的共用載入狀態
- `app/service-worker-source.js`、`scripts/build-service-worker.mjs`：離線 shell 與 build 時產生的 precache 清單（只涵蓋 `index.html` 實際載入的資源，不含社團入口）
- `app/circle-overrides.ts`：社團補充資料的型別、驗證與長度上限，寫入路由與閱讀端共用同一套規則
- `app/circle-portal-handlers.ts`、`db/identity-repository.ts`：與框架無關的 portal route 與 D1 查詢層
- `functions/`：Pages Functions（身分、認領、編輯、管理，以及公開的 `overrides.json`）
- `circle.html`、`app/circle-portal/`：社團控制面入口與介面
- `scripts/check-claimed-circles.mjs`：重建場刊後檢查認領是否仍指向存在的社團
- `public/data/events/ff47/map.json`：首次公開版地圖快照
- `public/data/events/ff47/circles.json`：社團與攤位快照（由 `npm run catalog:snapshot` 產生）
- `public/fonts/`：公開版自託管 Geist / Geist Mono 字型與授權
- `app/map-recognition.ts`、`app/editor/`：未部署到 Pages 的本機 authoring 工具
- `vite.pages.config.ts`、`wrangler.jsonc`：Pages 純靜態 build 與部署設定
- `.github/workflows/deploy-pages.yml`：GitHub Actions 驗證、preview 與 production 自動部署
- `data_source_test/`：本專案引用的 FF47 公開整理資料與配置圖測試輸入
- `PRODUCT.md`、`DESIGN.md`、`docs/`：產品、互動、資料及分期契約

## 目前邊界

- 一般使用者公開瀏覽，不需登入；閱讀端 bundle 不含任何寫入 route 或登入介面。
- 參展社團可在 `/circle` 以 email 一次性登入連結認領自己的社團，並維護販售資訊、連結與作品標籤。這些內容標示為「社團自述／尚未驗證」，與主辦資料分開呈現；社團名稱、筆名需經審核，攤位與日期不開放修改。管理者可隨時撤下，所有決策寫入稽核記錄。
- 場刊資料以 `circles.json` 靜態快照隨 build 發布，不打包進 JS bundle；首屏先顯示介面骨架，社團清單於快照載入後補上。
- 站台註冊 Service Worker 作為離線 shell：導覽採 network-first，`/data/events/` 採 stale-while-revalidate，雜湊資產採 cache-first。展場離線可重新載入並繼續使用已下載的場刊與地圖；社團縮圖等外部圖片不在離線範圍。
- 收藏、群組、備註與行程只儲存在目前瀏覽器。
- 安全匯出已提供；JSON／CSV 匯入、使用者規劃資料的跨裝置同步與協作仍屬 P2，尚未在一般介面開放。社團登入只用於維護社團自己的公開資料，不涉及一般使用者的收藏與行程。
- 外部來源只補充內容與可核對連結，不取代本地社團及攤位身分。
- 未來外部編輯控制面必須另行加入身分驗證、角色、草稿、審核、稽核與版本化發布，不得重新公開現有未驗證的 PUT route。
