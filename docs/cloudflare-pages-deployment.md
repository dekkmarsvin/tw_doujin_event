# Cloudflare Pages Free 首次發布

## 發布邊界

- 公開站是 Vite React SPA，build output 為 `dist/`。
- `dist/index.html`、hashed JS/CSS、自託管 Geist 字型、靜態地圖 JSON 與公開圖示是唯一部署內容。
- 不建立 `functions/`、`_worker.js`、D1、R2 或其他 Pages binding。
- `app/editor/`、`app/api/`、`db/`、`worker/` 與 `drizzle/` 保留在 source tree，供本機 authoring 與遠期控制面設計；`vite.pages.config.ts` 不會把它們納入公開 bundle。

## 自動部署架構

本專案選擇 **GitHub Actions + Wrangler Direct Upload**，不使用 Cloudflare Dashboard 的原生 Git integration。Cloudflare 不允許同一個 Pages project 在 Git integration 與 Direct Upload 之間切換，因此首次建立 project 時就必須選定這條路徑。開發與正式環境分別使用 `dev-tw-catalog` 與 `tw-catalog`，避免 preview 與 production deployment 共用回滾歷史。

`.github/workflows/deploy-pages.yml` 的行為：

- push 到 `main`：完整 gate 通過後，先發布並 smoke test `dev-tw-catalog.pages.dev`，成功後才發布並 smoke test `tw-catalog.pages.dev`。
- 同 repository 的 pull request：發布 `pr-<number>.dev-tw-catalog.pages.dev` preview deployment，不觸碰 production project。
- fork pull request：只因拿不到 deployment secrets 而不執行 deploy job，避免把 Cloudflare token 暴露給外部程式碼。
- `workflow_dispatch`：允許從 GitHub Actions 頁面手動重跑目前 branch。
- 每個 branch 同時只保留最新執行，新的 commit 會取消舊的部署工作。

Workflow 使用 Node.js `22.13.0`、`npm ci`、Wrangler `4.120.1`，build output 固定為 `dist`。Pages 要求設定使用 repository root 的標準 `wrangler.jsonc`；本機 vinext authoring 以 `vite.config.ts` 明確覆寫自己的 Worker 與 D1 binding。

## 首次啟用

### 1. 建立 GitHub repository

目前目錄必須有 `origin` remote，default branch 為 `main`。若尚未建立，先在 GitHub 建立 repository，再加入 remote；repository 公開或私有是擁有者決策，不應由部署 script 猜測。

### 2. 建立 Direct Upload Pages project

以有權限的 Cloudflare 帳號執行：

```bash
npx wrangler login
npx wrangler pages project create dev-tw-catalog --production-branch main
npx wrangler pages project create tw-catalog --production-branch main
```

不要在 Dashboard 用 **Connect to Git** 建立同名 project。專案不需要 Functions、D1、R2、KV 或 runtime secret。

### 3. 建立最小權限 token

在 Cloudflare Dashboard 建立 Custom API Token，權限只給目標 account 的 **Cloudflare Pages: Edit**。記下 Account ID 與 token；不要寫進 repository、`.env` 或 workflow YAML。

### 4. 設定 GitHub Actions secrets

到 repository 的 **Settings → Secrets and variables → Actions** 建立：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

也可以在已設定 `origin` 的本機用 GitHub CLI：

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID
gh secret set CLOUDFLARE_API_TOKEN
```

完成後 push `main`，第一次 workflow 就會依序建立 development 與 production deployment。驗證兩個 `pages.dev` 網址後，再為 `tw-catalog` 綁定正式網域。

## 發布前 gate

```bash
npm ci
npm test
npm run lint
npx tsc --noEmit --incremental false
```

必須確認：

- `dist/index.html` 存在。
- `dist/data/events/ff47/map.json` 通過 FF47 layout 驗證，包含 988 格、28 根柱子與 5 個出入口。
- `dist/_worker.js` 與 `dist/server/index.js` 不存在。
- `dist/_headers` 存在，且沒有 Functions 或自訂 rewrite 規則攔截靜態請求。
- 公開 bundle 不包含 `/api/events/`、`MapAdminImporter` 或管理發布文案。

## 手動 Direct Upload 備援

Pages project 已建立且 Wrangler 已登入時，可執行：

```bash
npm run pages:deploy:dev
npm run pages:deploy
```

兩個 script 都會重新 build，再分別 Direct Upload 至 development 或 production project。不要直接上傳舊的 `dist/`；一般 production 發布仍以 GitHub Actions 為準。

## 更新活動地圖

1. 執行 `npm run dev`，開啟 `/editor`。
2. 在本機 authoring 流程匯入、驗證並發布到本機 D1。
3. 執行 `npm run map:snapshot`。
4. 檢查 `public/data/events/ff47/map.json` 的 diff、revision、來源檔名與地標。
5. 執行完整發布前 gate。
6. 以 pull request 檢查 preview，合併到 `main` 讓 GitHub Actions 發布 production；緊急情況才使用手動 Direct Upload。

靜態快照是公開資料的唯一真相。未經 review 的本機 D1 或圖片不會因 Pages 部署而公開。

## Cache 與路由

- `/assets/*` 使用一年 immutable cache；檔名含 content hash。
- `/data/events/*` 使用五分鐘 cache 並要求 revalidation，以便日後把 authoring 發布拆成獨立控制面。
- 目前所有可分享狀態都使用根路徑的 URL query，不建立會和 Pages `index.html` 正規化衝突的 SPA rewrite。
- `_headers` 限制 frame、object、相機、麥克風與定位權限；外部社團縮圖只允許 HTTPS。

## 回滾

Pages 每次部署都是不可變 deployment。若正式版本有問題，到 Pages project 的 **Deployments** 選擇上一個已驗證 deployment 並執行 rollback；同時在 repository 回復有問題的 snapshot 或程式變更，避免下一次 Git build 再次發布錯誤版本。
