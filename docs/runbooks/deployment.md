# Cloudflare Pages 部署

公開站與社團入口都部署到**同一個** Cloudflare Pages project：`tw-catalog`。

產物邊界與快取策略見[資料傳輸與離線契約](../contracts/delivery-and-offline.md)。為什麼公開閱讀路徑不走 Worker，見 [ADR-0008](../adr/0008-static-public-reading-path.md)；為什麼用 GitHub Actions Direct Upload 而非 Dashboard Git integration，見 [ADR-0009](../adr/0009-single-pages-project-direct-upload.md)。

## 這個專案需要什麼

| 項目 | 需要嗎 |
|---|---|
| Pages project | 需要（`tw-catalog`） |
| Pages Functions | **需要**——`functions/` 承載社團身分、認領、編輯、管理 route 與公開的 `overrides.json` |
| D1 binding | **需要**——binding 名 `DB`。production 用 `tw-catalog-identity`，preview 用 `tw-catalog-identity-preview` |
| Runtime secrets | **需要**——production 六個 secret 與一個公開變數；preview 使用隔離的 session／pepper、E2E token、D1 mail sink 與 Turnstile dummy 金鑰，見下 |
| R2 / KV / Durable Objects | 不需要 |
| advanced mode（`dist/_worker.js`） | **不得使用** |

不使用 advanced mode 是硬邊界：它會讓每一個請求（含 1.8 MB 的 `circles.json`）都經過 Worker。Pages 自動產生的路由表只涵蓋 `functions/` 下實際存在的路徑，其餘靜態資源仍由邊緣直送。

`app/editor/`、`app/api/`、`worker/` 與 `drizzle/` 保留在 source tree 供本機地圖 authoring 使用；`vite.pages.config.ts` 不會把它們納入公開 bundle。

公開 build 有兩個 entry：`index.html`（閱讀端，可離線）與 `circle.html`（社團控制面，`noindex`）。社團入口的程式碼不得出現在閱讀端 bundle，`tests/rendered-html.test.mjs` 會以內容比對把關。

## Secrets

production 的六個 runtime secret 以 `wrangler pages secret put` 設定。**不進 repo、不進 `wrangler.jsonc`**：

`SESSION_SECRET`、`HASH_PEPPER`、`ADMIN_EMAILS`、`MAILGUN_API_KEY`、`MAILGUN_DOMAIN`（選填 `MAILGUN_SENDER`）、`TURNSTILE_SECRET`

另有一個**不是 secret 的變數** `TURNSTILE_SITEKEY`：它會經 `GET /api/auth/config` 送到瀏覽器，公開是它的用途。它寫在 `wrangler.jsonc` 的 `vars` 裡，不在 dashboard——理由與設定方式見[真人驗證](#真人驗證turnstile)。缺它時 `GET /api/auth/config` 回 503，登入頁因此拿不到 sitekey；其餘路由不受影響。

preview 不使用 production Mailgun，也不寄外部郵件。`wrangler.jsonc` 的 `env.preview.vars` 明確啟用 D1 mail sink，只允許 `preview-admin@example.test` 與 `preview-circle@example.test`。這些都是保留的 `.test` 假地址，不是真實收件人。preview 另需四個與 production 分離的 secret：

- `SESSION_SECRET`、`HASH_PEPPER`：preview 專用亂數。
- `ADMIN_EMAILS`：固定設為 `preview-admin@example.test`；使用 secret binding，避免與 Pages 既有 binding 衝突。
- `PREVIEW_E2E_TOKEN`：只授權 CI 讀取／清空 preview mail sink；同一值同時設定為 Pages preview secret 與 GitHub Actions secret。

preview 的 Turnstile **不需要設定任何東西**：`wrangler.jsonc` 已把 dummy 金鑰寫在 `env.preview.vars`（sitekey `1x00000000000000000000AA`、secret `1x0000000000000000000000000000000AA`）。那組 secret 依設計接受任何 token，所以它只能留在 preview。

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler pages secret put PREVIEW_E2E_TOKEN --project-name=tw-catalog --env preview
```

```bash
gh secret set PREVIEW_E2E_TOKEN
```

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

## 真人驗證（Turnstile）

`POST /api/auth/request-link` 要求一枚 Turnstile token，決策見 [ADR-0016](../adr/0016-human-verification-guards-the-mailer.md)，行為見[社團自助控制面契約](../contracts/circle-portal.md#索取登入連結需要通過真人驗證)。

### 建立 widget

1. Cloudflare dashboard → **Turnstile** → Add widget，模式 **Managed**。
2. Hostname 填**正式網域與 `tw-catalog.pages.dev`**。hostname 自動涵蓋子網域，所以後者一條就包含 `pr-*.tw-catalog.pages.dev`；免費方案每個 widget 上限 10 個 hostname。
3. 模式選 **Managed**。本專案不使用 pre-clearance。
4. 取得 Site Key 與 Secret Key。**Secret Key 只顯示一次。**

Turnstile 本身不需要申請或審核，有 Cloudflare 帳號就能建立 widget。

### Secret Key 進 Pages secret

```bash
npx wrangler pages secret put TURNSTILE_SECRET --project-name=tw-catalog --env production
```

`--env` 一定要寫，理由見 [Secrets](#secrets)。

### Site Key 進 `wrangler.jsonc`，不要進 dashboard

Site Key 公開是它的用途，所以它屬於版本控制，不屬於 dashboard 狀態。加在**頂層** `vars`：

```jsonc
"vars": {
  "TURNSTILE_SITEKEY": "0x4AAA…"
},
```

**頂層是 production 專用。** `vars` 是 non-inheritable key，named environment 不繼承它——preview 的那份已經在 `env.preview.vars`（dummy 金鑰）。兩邊各自宣告是正確的，不是重複。

不放 dashboard 有實際理由：帶著設定檔部署時，wrangler 會以檔案內容覆寫 dashboard 上的變數（除非設 `keep_vars`）。只設在 dashboard 而設定檔沒有的話，下一次部署可能把它清掉，症狀是登入頁忽然拿不到 sitekey。**Secret 不受影響**——它們存在另一個地方，設定檔不會覆寫。

改完**必須重新部署**：Pages 的變數與密鑰都是在建立 deployment 時綁定的。

```bash
gh workflow run deploy-pages.yml --ref main
```

### 這件事只能用瀏覽器驗

CI 的 E2E 不是瀏覽器：它在 preview 用 dummy 金鑰直接送 token，因此**不會**發現 widget 載入失敗。真正要確認的是 CSP——`public/_headers` 在 `/circle*` 先移除站台層的 `Content-Security-Policy` 再重新宣告一份放寬版，Cloudflare 對多條命中的規則是合併而非覆寫，移除若沒生效，瀏覽器會取兩份策略的交集並擋掉元件。

部署後以瀏覽器開啟 `/circle`（preview 或 production 皆可），確認：

- 登入表單下方出現 Turnstile 元件，且 console 沒有 CSP 違規。
- 回應標頭只有**一個** `content-security-policy`，且含 `https://challenges.cloudflare.com`：

```bash
curl -sI https://tw-catalog.pages.dev/circle | grep -ci '^content-security-policy'
```

輸出 `1` 才是對的；`2` 代表移除沒生效，元件會被擋。

**Turnstile 不可達時登入會停擺，這是刻意的。** siteverify 逾時或回非 2xx 一律視為未通過；症狀是登入表單回「真人驗證未通過」，而 Mailgun 與 D1 都沒有動靜。

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
- **preview 環境不繼承 production 的 secrets。** preview 的 session、pepper 與 E2E token 都必須用 `--env preview` 設定；不設定 preview Mailgun credentials。
- **401 wiring smoke 與完整 portal E2E 是兩件事。** 「Smoke test deployment」只證明靜態資產上線；「Smoke test Functions」的 401 只證明 handler 可建立且 session／pepper 存在，**沒有寄信、D1 寫入或管理流程**。PR 的「Full preview portal E2E」才會實走 request link → mail sink → verify → claim → admin approval → preview → edit → public overlay。
- E2E 前後會查 production `accounts`、claims、overrides 與公開文件 revision fingerprint；任何變化立即失敗。流程結束（成功或失敗）以受 token 保護的 `DELETE /api/preview/mail` 清空 preview accounts、tokens、sessions、claims、overrides、公開文件、audit 與 captured mail；admins roster 保留供下一次重跑。
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

社團控制面的八張核心表——`accounts`、`admins`、`login_tokens`、`sessions`、`circle_claims`、`circle_overrides`、`overrides_doc`、`audit_log`——以及 preview-only mail sink 使用的 `preview_mail_sink`，由 `db/identity-repository.ts` 的 `ensureTables()` 在首次請求時以 `CREATE TABLE IF NOT EXISTS` 建立。production 也會有空的 sink 表，但沒有 preview flag 與 E2E token，路由一律回 404，且正常寄信路徑不會寫入它。

identity schema 的唯一 authority 是 `db/identity-runtime-schema.ts`；它從同一組 table／column／index declarations 產生首次請求使用的 SQL 與測試驗證 metadata。`drizzle/` 下唯一的 migration 只涵蓋 `event_maps`，而那張表同樣由 `db/event-map-repository.ts` 的 `ensureTable()` 於執行期建立。**本專案沒有任何一條路徑會執行 migration**；`drizzle.config.ts` 與 `db/schema.ts` 只服務本機地圖 authoring，不是 identity schema 的第二份 representation，也不參與部署。

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

### 4. 設定 production 與 preview runtime secrets

見上節。設定後重部署一次 preview，再確認 `/api/auth/session` 是 401；完整 E2E 由 PR workflow 執行。mail sink 只接受 `PREVIEW_TEST_RECIPIENTS` allowlist，任何其他地址都在寫入 D1 前被拒絕，絕不退回 production Mailgun。

### 5. 建立最小權限 token

在 Cloudflare Dashboard 建立 Custom API Token，權限給目標 account 的 **Cloudflare Pages: Edit** 與 **D1: Read**。記下 Account ID 與 token；不要寫進 repository、`.env` 或 workflow YAML。

D1 權限不是為了部署，而是為了 PR 的 E2E job：它在跑之前與跑之後各查一次 production D1 的 row counts 與 revision，用來證明 preview 沒有寫到正式資料（見[CI 行為](#ci-行為)）。**只給 Pages: Edit 的 token 可以部署成功，卻會讓那道保護無法執行**——症狀是 E2E job 回報 `The given account is not valid or is not authorized to access this service [code: 7403]`，而同一個 workflow 的 deploy job 一切正常。看到這個錯誤時要補的是 token 權限，不是 Account ID。

若 `D1: Read` 仍被 7403 拒絕，改用 `D1: Edit`——`wrangler d1 execute --remote` 走的是 D1 的 query endpoint，即使 SQL 只有 `SELECT` 也可能被歸類為需要寫入權限。

### 6. 設定 GitHub Actions secrets

到 repository 的 **Settings → Secrets and variables → Actions** 建立 `CLOUDFLARE_ACCOUNT_ID` 與 `CLOUDFLARE_API_TOKEN`。也可以用 GitHub CLI：

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID
```

```bash
gh secret set CLOUDFLARE_API_TOKEN
```

部署以外，CI 還需要 `PREVIEW_E2E_TOKEN` 與一組 Access service token（`CF_ACCESS_CLIENT_ID`、`CF_ACCESS_CLIENT_SECRET`），後者見 [CI 用 service token 通過 Access](#ci-用-service-token-通過-access)。

完成後 push `main`，第一次 workflow 會建立 production deployment。驗證 `tw-catalog.pages.dev` 後，再綁定正式網域。

## Cloudflare Access：全站閘控，沒有例外路徑

FF47 期間**全站不公開，含社團端**。決策與理由見 [ADR-0011](../adr/0011-ff47-is-not-a-public-launch.md)。

Zero Trust 的 application 涵蓋整個 `tw-catalog.pages.dev`（以及日後綁定的正式網域），policy 只放行維護者帳號。**不保留任何 Bypass 路徑。**

早期為了讓社團登入而放行過七條路徑，現在全部移除：

| 已移除的 Bypass | 原本用途 |
|---|---|
| `/circle`、`/circle.html` | 社團入口頁 |
| `/assets/*`、`/fonts/*` | 入口頁的 JS／CSS／字型（與閱讀端共用） |
| `/api/auth/*` | 索取與驗證登入連結、查詢與登出 session |
| `/api/claims/*` | 送出認領與執行連結驗證 |
| `/api/circle/*` | 社團搜尋與自己的補充資料讀寫 |

`/api/admin/*` 從來就沒有放行過；管理操作本來就同時受 Access 與管理者名單兩層保護。

### 移除步驟

1. Zero Trust → **Access → Applications**，開啟涵蓋 Pages 網域的 application。
2. 刪除上表列出的每一條 Bypass policy。保留放行維護者帳號的 Allow policy。
3. 確認 application 的 domain 涵蓋 `*.tw-catalog.pages.dev`——preview deployment 也在閘控內。

### 驗證

以**未登入的瀏覽器**（或無痕視窗）實測，三個路徑都必須落在 Access 登入頁而不是站台內容：

```bash
for path in / /circle /api/auth/session; do curl -s -o /dev/null -w "$path %{http_code} %{redirect_url}\n" "https://tw-catalog.pages.dev$path"; done
```

三者都應導向 `*.cloudflareaccess.com`。任何一個回傳站台自己的內容，代表還有 Bypass 沒清掉。再以維護者帳號確認全站可達。

社團端的功能驗收因此只能在 preview 環境進行，見[社團自助控制面契約](../contracts/circle-portal.md)。

### CI 用 service token 通過 Access

閘控涵蓋 `*.tw-catalog.pages.dev`，preview deployment 也在內。GitHub Actions 不是瀏覽器，走不完 identity 登入流程，所以它以 **Access service token** 認證：CI 對站台的每一個請求都帶上兩個 header。

```
CF-Access-Client-Id: <CLIENT_ID>
CF-Access-Client-Secret: <CLIENT_SECRET>
```

兩邊都要設定才會生效：

1. Zero Trust → **Access → Service credentials → Service Tokens** 建立 token（本專案為 `tw-catalog - action`）。Client Secret 只顯示一次。
2. 在涵蓋 `*.tw-catalog.pages.dev` 的 application 上新增一條 policy，**action 必須是 Service Auth**：

   | Action | Rule type | Selector | Value |
   |---|---|---|---|
   | Service Auth | Include | Service Token | `tw-catalog - action` |

   action 設成 Allow 不會生效——Access 仍會要求 identity 登入。

3. 以 `gh secret set CF_ACCESS_CLIENT_ID` 與 `gh secret set CF_ACCESS_CLIENT_SECRET` 設定 GitHub Actions secrets。

deploy job 的兩個 smoke test 與 `scripts/preview-portal-e2e.mjs` 都會帶這組 header；缺任一個 secret 時 job 直接失敗，不會靜默地量到登入頁。

**沒有 header 的 CI 會量錯東西。** Access 對未認證請求回 302 到 `*.cloudflareaccess.com`，不是 4xx；`curl --fail` 不會因此失敗，所以「靜態資源 smoke test 通過」也可能只是通過了登入頁。兩個 smoke test 因此改為斷言明確的狀態碼（`/` 要 200、`/api/auth/session` 要 401），並把 301／302 當成 service token 被拒絕來報錯。

token 過期或被撤銷、或 policy 被改成 Allow 時的症狀都一樣：CI 報 `redirected to the Access login page`。錯誤訊息會附上 Access 在登入導向裡宣告的 `service_token_status`，用來分辨兩者：

- `false`：Access 根本不認得這組憑證——secret 值錯誤、混入空白或換行、或 token 已被撤銷。重設 GitHub secrets。
- `true`：token 有效，但沒有任何 Service Auth policy 放行它。回頭檢查 policy 的 action 與 include。

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
