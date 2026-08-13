# Cloudflare Pages Free 首次發布

## 發布邊界

- 公開站是 Vite React SPA，build output 為 `dist/`。
- `dist/index.html`、hashed JS/CSS、自託管 Geist 字型、靜態地圖 JSON 與公開圖示是唯一部署內容。
- 不使用 advanced mode：不得產生 `dist/_worker.js`、`dist/server/index.js`、`dist/_redirects` 或 `dist/_routes.json`。advanced mode 會讓每一個請求（含 1.8 MB 的 `circles.json`）都經過 Worker，正是這些防線要避免的事。
- `functions/` 只承載社團身分、認領、編輯與管理 route，以及 `/data/events/:id/overrides.json` 這個公開補充資料端點。Pages 自動產生的路由表只涵蓋這些路徑，其餘靜態資源仍由邊緣直送。
- 社團入口不下載場刊：認領時的社團搜尋走 `/api/circle/search`，需要 session 且只回傳比對到的社團。這讓公開場刊在授權確認前可以維持閘控，也省下每位社團 1.8 MB 的下載。

## Cloudflare Access 例外路徑

在來源授權確認前，`/` 與 `/data/*` 維持閘控，但社團入口必須可達，否則社團無法登入或認領。Zero Trust 需要 Bypass 的路徑：

| 路徑 | 用途 |
|---|---|
| `/circle`、`/circle.html` | 社團入口頁 |
| `/assets/*`、`/fonts/*` | 入口頁的 JS／CSS／字型（與閱讀端共用） |
| `/api/auth/*` | 索取與驗證登入連結、查詢與登出 session |
| `/api/claims/*` | 送出認領與執行連結驗證 |
| `/api/circle/*` | 社團搜尋與自己的補充資料讀寫 |

`/api/admin/*` **刻意不放行**：管理操作同時受 Access 與 `ADMIN_EMAILS` 兩層保護。`/data/*` 也不放行——社團入口已不需要它。
- binding 只有一個 D1（`DB`，資料庫 `tw-catalog-identity`），用於帳號、session、認領、社團補充資料與稽核。不建立 R2、KV 或 Durable Objects。
- 密鑰以 `wrangler pages secret put` 設定，不進 repo、不進 `wrangler.jsonc`、GitHub Actions 也不需要：`SESSION_SECRET`、`HASH_PEPPER`、`ADMIN_EMAILS`、`MAILGUN_API_KEY`、`MAILGUN_DOMAIN`（選填 `MAILGUN_SENDER`）。本機開發用 `.dev.vars`，該檔已列入 `.gitignore`。
- `ADMIN_EMAILS` **只在管理者名單為空時作為種子**。名單存在 D1 的 `admins` 表，之後從 `/circle` 的管理面板增減，立即生效、不需重新部署。名單被清空時設定值會重新灌入，這是全員被移除時的救援路徑——而「不得移除最後一位管理者」與「不得移除自己」兩道限制讓它不會正常地走到那一步。
- **新增或修改密鑰後必須重新部署。** Pages 的密鑰是在建立 deployment 時綁定的，既有 deployment 不會追溯取得新密鑰——症狀是所有 `/api/*` 回 503「服務尚未設定完成」，而 `wrangler pages secret list` 明明列得出來。用 `gh workflow run deploy-pages.yml --ref main` 重跑即可。
- 產生密鑰時用管線送入，避免值出現在終端記錄或對話中：
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler pages secret put SESSION_SECRET --project-name=tw-catalog`
- `SESSION_SECRET` 一旦上線就不要更換：它簽署 session cookie，更換等同讓所有已登入的社團同時被登出。
- `app/editor/`、`app/api/`、`worker/` 與 `drizzle/` 保留在 source tree，供本機地圖 authoring 使用；`vite.pages.config.ts` 不會把它們納入公開 bundle。
- 公開 build 有兩個 entry：`index.html`（閱讀端，可離線）與 `circle.html`（社團控制面，`noindex`）。社團入口的程式碼不得出現在閱讀端 bundle，`tests/rendered-html.test.mjs` 會以內容比對把關。

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
