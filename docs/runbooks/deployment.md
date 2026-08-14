# Cloudflare Pages 部署

公開站與社團入口都部署到**同一個** Cloudflare Pages project：`tw-catalog`。

產物邊界與快取策略見[資料傳輸與離線契約](../contracts/delivery-and-offline.md)。為什麼公開閱讀路徑不走 Worker，見 [ADR-0008](../adr/0008-static-public-reading-path.md)；為什麼用 GitHub Actions Direct Upload 而非 Dashboard Git integration，見 [ADR-0009](../adr/0009-single-pages-project-direct-upload.md)。

## 這個專案需要什麼

| 項目 | 需要嗎 |
|---|---|
| Pages project | 需要（`tw-catalog`） |
| Pages Functions | **需要**——`functions/` 承載社團身分、認領、編輯、管理 route 與公開的 `overrides.json` |
| D1 binding | **需要**——binding 名 `DB`。production 用 `tw-catalog-identity`，preview 用 `tw-catalog-identity-preview` |
| Runtime secrets | **需要**——五個，見下 |
| R2 / KV / Durable Objects | 不需要 |
| advanced mode（`dist/_worker.js`） | **不得使用** |

不使用 advanced mode 是硬邊界：它會讓每一個請求（含 1.8 MB 的 `circles.json`）都經過 Worker。Pages 自動產生的路由表只涵蓋 `functions/` 下實際存在的路徑，其餘靜態資源仍由邊緣直送。

`app/editor/`、`app/api/`、`worker/` 與 `drizzle/` 保留在 source tree 供本機地圖 authoring 使用；`vite.pages.config.ts` 不會把它們納入公開 bundle。

公開 build 有兩個 entry：`index.html`（閱讀端，可離線）與 `circle.html`（社團控制面，`noindex`）。社團入口的程式碼不得出現在閱讀端 bundle，`tests/rendered-html.test.mjs` 會以內容比對把關。

## Secrets

五個 runtime secret 以 `wrangler pages secret put` 設定。**不進 repo、不進 `wrangler.jsonc`、GitHub Actions 也不需要**：

`SESSION_SECRET`、`HASH_PEPPER`、`ADMIN_EMAILS`、`MAILGUN_API_KEY`、`MAILGUN_DOMAIN`（選填 `MAILGUN_SENDER`）

本機開發用 `.dev.vars`，該檔已列入 `.gitignore`。

產生密鑰時用管線送入，避免值出現在終端記錄或對話中：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler pages secret put SESSION_SECRET --project-name=tw-catalog --env production
```

**`--env` 一定要寫。** `wrangler pages secret put --help` 不會列出這個旗標——wrangler 4.120.1 把它設為 `hideGlobalFlags`——但它存在，而且**省略時預設是 `production`**（原始碼：`env ??= "production"`）。只接受 `production` 與 `preview`。

指令成功時會印出目標環境，這是唯一的即時確認：

```
🌀 Creating the secret for the Pages project "tw-catalog" (preview)
```

括號裡不是你要的環境就代表寫錯地方了。事後可用 `wrangler pages secret list --project-name=tw-catalog --env <環境>` 分別核對兩邊。

三件必須知道的事：

- **新增或修改密鑰後必須重新部署。** Pages 的密鑰是在建立 deployment 時綁定的，既有 deployment 不會追溯取得新密鑰。症狀是所有 `/api/*` 回 503「服務尚未設定完成」，而 `wrangler pages secret list` 明明列得出來。用 `gh workflow run deploy-pages.yml --ref main` 重跑即可。
- **`SESSION_SECRET` 一旦上線就不要更換。** 它簽署 session cookie，更換等同讓所有已登入的社團同時被登出。
- **`ADMIN_EMAILS` 只在管理者名單為空時作為種子。** 名單存在 D1 的 `admins` 表，之後從 `/circle` 的管理面板增減，立即生效、不需重新部署。見[社團自助控制面契約](../contracts/circle-portal.md#管理者)。

## CI 行為

`.github/workflows/deploy-pages.yml`：

| 觸發 | 行為 |
|---|---|
| push 到 `main` | 完整 gate 通過後以 branch `main` 發布到 `tw-catalog`，再 smoke test `tw-catalog.pages.dev` |
| 同 repository 的 pull request | 以 branch `pr-<number>` 發布到**同一個 project**，網址 `pr-<number>.tw-catalog.pages.dev`；不覆蓋 production |
| fork pull request | **不執行 deploy job**，避免把 Cloudflare token 暴露給外部程式碼 |
| `workflow_dispatch` | 從 GitHub Actions 頁面手動重跑目前 branch |

- **只有一次部署，沒有先發到開發環境再晉升的流程。**
- 每個 branch 同時只保留最新執行，新的 commit 會取消舊的部署工作。
- Node.js `22.13.0`、`npm ci`、Wrangler `4.120.1`，build output 固定為 `dist`。
- Pages 要求使用 repository root 的標準 `wrangler.jsonc`；本機 vinext authoring 以 `vite.config.ts` 明確覆寫自己的 Worker 與 D1 binding。
- **preview 環境不繼承 production 的 secrets。** 要在 PR preview 測社團入口，五個 secret 需另以 `--env preview` 設定一次。
- **兩個 smoke test 檢查不同的東西。** 「Smoke test deployment」只證明靜態資產上線——那些由邊緣直送，Functions 有沒有環境都回 200。「Smoke test Functions」打未登入的 `/api/auth/session`：**401 = handlers 建構並執行成功；503 = `requireSecret` 因缺少 `SESSION_SECRET` 或 `HASH_PEPPER` 而拋錯**。只設這兩個 secret 就足以讓它變 401，缺 Mailgun 只影響寄信。
- **preview 與 production 使用不同的 D1 資料庫**，見下節。設定 preview secrets **之前**必須先確認這件事已經生效——順序顛倒會讓 PR 上的測試寫進正式資料。

## 首次啟用

### 1. GitHub repository

目前目錄必須有 `origin` remote，default branch 為 `main`。

### 2. 建立 Direct Upload Pages project

```bash
npx wrangler login
```

```bash
npx wrangler pages project create tw-catalog --production-branch main
```

**不要在 Dashboard 用 Connect to Git 建立同名 project。** Cloudflare 不允許同一個 project 在 Git integration 與 Direct Upload 之間切換，這條路徑在建立時就定死了。

`package.json` 另保留 `pages:deploy:dev` 指向 `dev-tw-catalog`，供需要完全獨立環境時手動使用。**CI 不會用到它**；只有要用時才需要另外建立那個 project。

### 3. 建立 D1 與 binding

建立資料庫 `tw-catalog-identity`，在 `wrangler.jsonc` 以 binding 名 `DB` 綁定。**不需要執行任何 migration。**

社團控制面的八張表——`accounts`、`admins`、`login_tokens`、`sessions`、`circle_claims`、`circle_overrides`、`overrides_doc`、`audit_log`——由 `db/identity-repository.ts` 的 `ensureTables()` 在首次請求時以 `CREATE TABLE IF NOT EXISTS` 建立。Pages Functions 沒有執行 migration 的時機，因此建表發生在請求路徑上，不在部署步驟裡。

`drizzle/` 下唯一的 migration 只涵蓋 `event_maps`，而那張表同樣由 `db/event-map-repository.ts` 的 `ensureTable()` 於執行期建立。**本專案沒有任何一條路徑會執行 migration**；`drizzle.config.ts` 與 `db/schema.ts` 存在是為了讓 `npm run db:generate` 能產出 schema，產物本身不參與部署。

#### preview 必須用另一個資料庫

```bash
npx wrangler d1 create tw-catalog-identity-preview
```

在 `wrangler.jsonc` 以 `env.preview` 覆寫，**binding 名維持 `DB`**：

```jsonc
"env": { "preview": { "d1_databases": [
  { "binding": "DB", "database_name": "tw-catalog-identity-preview", "database_id": "…" }
] } }
```

三件容易做錯的事：

- **`wrangler d1 create` 建議的 binding 名不能用。** 它會依資料庫名產生 `tw_catalog_identity_preview`，但 Functions 讀的是 `env.DB`；照抄會讓 preview 找不到資料庫。
- **`d1_databases` 不會被繼承。** 環境要嘛宣告完整的 binding、要嘛完全沒有。日後在頂層新增 KV、R2 或第二個資料庫時，`env.preview` 必須同步補上，否則 preview 會靜默地少一個 binding。
- **不要用 `preview_database_id`。** D1 binding 有這個欄位，但它是 Workers `wrangler dev` 的機制，不是 Pages preview deployment 的。

沒有這層隔離時，頂層 binding 會同時套用到 preview：在 PR 上送出一筆認領會佔用正式資料裡該社團的唯一擁有者名額，儲存一次編輯會讓 `rebuildOverridesDoc()` 改寫正式讀者下載的 overrides 文件。

**驗收不能只看設定檔**，因為 Direct Upload 專案的 binding 也可能在 dashboard 有 per-environment 設定。實際做一次寫入再確認它落在哪邊：

```bash
npx wrangler d1 execute tw-catalog-identity --remote --command "SELECT COUNT(*) FROM login_tokens"
npx wrangler d1 execute tw-catalog-identity-preview --remote --command "SELECT COUNT(*) FROM login_tokens"
```

### 4. 設定五個 runtime secrets

見上節。

### 5. 建立最小權限 token

在 Cloudflare Dashboard 建立 Custom API Token，權限只給目標 account 的 **Cloudflare Pages: Edit**。記下 Account ID 與 token；不要寫進 repository、`.env` 或 workflow YAML。

### 6. 設定 GitHub Actions secrets

到 repository 的 **Settings → Secrets and variables → Actions** 建立 `CLOUDFLARE_ACCOUNT_ID` 與 `CLOUDFLARE_API_TOKEN`。也可以用 GitHub CLI：

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID
```

```bash
gh secret set CLOUDFLARE_API_TOKEN
```

完成後 push `main`，第一次 workflow 會建立 production deployment。驗證 `tw-catalog.pages.dev` 後，再綁定正式網域。

## Cloudflare Access 例外路徑

在來源授權確認前，`/` 與 `/data/*` 維持閘控，但**社團入口必須可達**，否則社團無法登入或認領。Zero Trust 需要 Bypass 的路徑：

| 路徑 | 用途 |
|---|---|
| `/circle`、`/circle.html` | 社團入口頁 |
| `/assets/*`、`/fonts/*` | 入口頁的 JS／CSS／字型（與閱讀端共用） |
| `/api/auth/*` | 索取與驗證登入連結、查詢與登出 session |
| `/api/claims/*` | 送出認領與執行連結驗證 |
| `/api/circle/*` | 社團搜尋與自己的補充資料讀寫 |

`/api/admin/*` **刻意不放行**：管理操作同時受 Access 與管理者名單兩層保護。`/data/*` 也不放行——社團入口不需要它。

## 發布前 gate

與[本機共同 gate](./local-development.md#驗證-gate) 相同，CI 會重跑一次。另需確認：

- `dist/index.html`、`dist/_headers` 存在，且沒有 Functions 或自訂 rewrite 規則攔截靜態請求。
- `dist/data/events/ff47/map.json` 通過 FF47 layout 驗證（988 格、28 根柱子、5 個出入口）。
- `dist/_worker.js` 與 `dist/server/index.js` 不存在。
- 公開 bundle 不包含 `/api/events/`、`MapAdminImporter` 或管理發布文案。

## 手動 Direct Upload 備援

Pages project 已建立且 Wrangler 已登入時：

```bash
npm run pages:deploy
```

會重新 build 再 Direct Upload 到 production。**不要直接上傳舊的 `dist/`**；一般 production 發布仍以 GitHub Actions 為準，緊急情況才用這條。

## 回滾

Pages 每次部署都是不可變 deployment。若正式版本有問題：

1. 到 Pages project 的 **Deployments** 選擇上一個已驗證 deployment 並執行 rollback。
2. **同時在 repository 回復有問題的 snapshot 或程式變更**，避免下一次 build 再次發布錯誤版本。
