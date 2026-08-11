# FF47 場刊 MAP

Fancy Frontier 47 的同人展逛攤地圖。介面把社團搜尋、SVG 攤位地圖、收藏分組、備註與每日行程整合在同一個工作區，並支援桌面與行動版。

目前的規劃資料保存在瀏覽器 `localStorage`，不會跨裝置同步。首次公開版本部署為 Cloudflare Pages Free 純靜態站：場刊在 build 時打包，活動地圖讀取版本化 JSON 快照，不部署 Pages Functions、Cloudflare Worker、D1 binding 或管理寫入 route。

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

開啟終端顯示的本機網址。前台會從 `public/data/events/ff47/map.json` 讀取已驗證的 revision 3 地圖快照。

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

`npm test` 會先建立 Pages production build，再執行所有 Node 測試。測試會確認 `dist/index.html` 與靜態地圖快照存在，且公開產物不含 `_worker.js` 或 vinext server bundle。

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
- `public/data/events/ff47/map.json`：首次公開版地圖快照
- `public/fonts/`：公開版自託管 Geist / Geist Mono 字型與授權
- `app/map-recognition.ts`、`app/editor/`：未部署到 Pages 的本機 authoring 工具
- `vite.pages.config.ts`、`wrangler.jsonc`：Pages 純靜態 build 與部署設定
- `.github/workflows/deploy-pages.yml`：GitHub Actions 驗證、preview 與 production 自動部署
- `data_source_test/`：本專案引用的 FF47 公開整理資料與配置圖測試輸入
- `PRODUCT.md`、`DESIGN.md`、`docs/`：產品、互動、資料及分期契約

## 目前邊界

- 一般使用者公開瀏覽；公開 build 不含管理入口或伺服器寫入 route。
- 收藏、群組、備註與行程只儲存在目前瀏覽器。
- 安全匯出已提供；JSON／CSV 匯入、帳號同步與協作仍屬 P2，尚未在一般介面開放。
- 外部來源只補充內容與可核對連結，不取代本地社團及攤位身分。
- 未來外部編輯控制面必須另行加入身分驗證、角色、草稿、審核、稽核與版本化發布，不得重新公開現有未驗證的 PUT route。
