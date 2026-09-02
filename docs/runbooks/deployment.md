# Cloudflare Pages 部署

公開站與社團入口都部署到**同一個** Cloudflare Pages project：`tw-catalog`。

| 用途 | 網址 | Access |
|---|---|---|
| 正式公開入口 | <https://map.kotoban.top/> | 無；一般閱讀公開，社團端由應用層驗證 |
| Pages production origin | <https://tw-catalog.pages.dev/> | 無；只作 deployment smoke 與故障排查，不是對外正式入口 |
| PR alias／不可變 deployment | `https://pr-<N>.tw-catalog.pages.dev`／`https://<hash>.tw-catalog.pages.dev` | 有；維護者登入或 CI Service Auth |

`map.kotoban.top` 必須在 Pages project 的 **Custom domains** 顯示 Active，並使用 Cloudflare proxy。該 hostname 不啟用 Browser Insights／Web Analytics：專案不使用分析追蹤，既有 CSP 也會阻擋 Cloudflare 注入的 beacon；看到 `static.cloudflareinsights.com` 的 CSP console error 時應關閉 zone 設定，不得為它放寬 `script-src`。

產物邊界與快取策略見[資料傳輸與離線契約](../contracts/delivery-and-offline.md)。為什麼公開閱讀路徑不走 Worker，見 [ADR-0008](../adr/0008-static-public-reading-path.md)；為什麼用 GitHub Actions Direct Upload 而非 Dashboard Git integration，見 [ADR-0009](../adr/0009-single-pages-project-direct-upload.md)。

## 這個專案需要什麼

| 項目 | 需要嗎 |
|---|---|
| Pages project | 需要（`tw-catalog`） |
| Pages Functions | **需要**——`functions/` 承載社團身分、認領、編輯、管理 route 與公開的 `overrides.json` |
| D1 binding | **需要**——binding 名 `DB`。production 用 `tw-catalog-identity`，preview 用 `tw-catalog-identity-preview` |
| Runtime secrets | **需要**——production 六個 secret 與一個公開變數；preview 使用隔離的 session／pepper、E2E token、D1 mail sink、Mailgun sandbox 與 Turnstile dummy 金鑰，見下 |
| 排程 Worker（Cron Trigger） | **需要**——`tw-catalog-retention-purge`，與 Pages project 分開部署，見[排程清除 Worker](#排程清除-worker) |
| R2 | **需要**——每個環境各有公開縮圖 bucket（`THUMBNAILS`）與無公開網域的地圖來源 bucket（`MAP_CONTRIBUTIONS`） |
| KV / Durable Objects | 不需要 |
| advanced mode（`dist/_worker.js`） | **不得使用** |

不使用 advanced mode 是硬邊界：它會讓每一個請求（含 1.8 MB 的 `circles.json`）都經過 Worker。Pages 自動產生的路由表只涵蓋 `functions/` 下實際存在的路徑，其餘靜態資源仍由邊緣直送。

Pages project 的 production 與 preview 都必須使用 **Fail open**（Dashboard → Workers & Pages → `tw-catalog` → Settings → Runtime → Fail open / closed）。Cloudflare 沒有提供降低每日額度或模擬 Error 1027 的安全測試介面，因此不刻意耗盡正式帳號額度；CI 每次部署後會透過 Pages project API 校正並驗證兩個環境的 `fail_open: true`。這項決策見 [ADR-0031](../adr/0031-quota-exhaustion-is-not-a-release-gate.md)。

公開 build 有三個 entry：`index.html`（閱讀端，可離線）、`circle.html`（社團控制面，`noindex`）與 `organizer.html`（主辦單位工作區，`noindex`）。控制面的程式碼不得出現在閱讀端 bundle，`tests/service-worker.test.mjs` 會確認 precache 不含控制面 chunk。

本機 authoring 的第二套 build 已依 [ADR-0049](../adr/0049-the-local-authoring-backup-is-withdrawn.md) 移除；`vite.pages.config.ts` 是唯一的 build 設定。

## Secrets

production 的六個 runtime secret 以 `wrangler pages secret put` 設定。**不進 repo、不進 `wrangler.jsonc`**：

`SESSION_SECRET`、`HASH_PEPPER`、`ADMIN_EMAILS`、`MAILGUN_API_KEY`、`MAILGUN_DOMAIN`（選填 `MAILGUN_SENDER`）、`TURNSTILE_SECRET`

另有一個**不是 secret 的變數** `TURNSTILE_SITEKEY`：它會經 `GET /api/auth/config` 送到瀏覽器，公開是它的用途。它**已經寫在 `wrangler.jsonc` 的頂層 `vars`**，不在 dashboard，部署者不需要另外設定——理由見[真人驗證](./first-time-setup.md#真人驗證turnstile)。缺它時 `GET /api/auth/config` 回 503，登入頁因此拿不到 sitekey；其餘路由不受影響。

### Organizer 發布（目前全部不設定）

`ORGANIZER_PUBLICATION_MODE`、`GITHUB_WEBHOOK_SECRET`、`GITHUB_APP_ID`、`GITHUB_APP_PRIVATE_KEY`、`GITHUB_APP_INSTALLATION_ID` 是選用的。**現在一個都不要設。**

未設定即為關閉：`ORGANIZER_PUBLICATION_MODE` 預設 `disabled`，管理者的發布重試回 503，`POST /api/integrations/github/webhook` 也回 503。主辦單位工作區的其餘功能——建立、匯入、地圖、驗證、預覽、送審與核准——完全不需要這些變數。

依 [ADR-0046](../adr/0046-approved-organizer-publications-may-merge-app-owned-pull-requests.md) 決策第 4 點，要打開之前必須先以 API 實測兩個 repository 的 ruleset 為 active、required checks 名稱一致，且 GitHub App 不在 bypass 清單內。

### preview 的兩個信箱

preview 永遠不碰 production Mailgun，但它會寄信——只寄給兩份名單上的地址，並且**依收件人**決定寄法：

| 收件人在哪份名單 | 信去哪裡 | 誰在用 |
|---|---|---|
| `PREVIEW_TEST_RECIPIENTS`（`wrangler.jsonc` 的 `env.preview.vars`，兩個保留的 `.test` 假地址） | 寫進 preview D1 的 `preview_mail_sink`，以 `GET /api/preview/mail` 讀回 | CI 的 E2E |
| `PREVIEW_SANDBOX_RECIPIENTS`（Pages preview secret） | 由 Mailgun **sandbox** 網域實際寄出 | 人工測試 |
| 兩份都不在 | 兩邊都不碰，直接拒絕 | —— |

**依收件人而不依 branch 是被迫的，也是剛好的。** Pages 只有 `production` 與 `preview` 兩個環境，沒有 per-branch 變數，所以任何「這個 branch 改寄真信」的設定實際上都會套用到全部 preview deployment；而 CI 與人工測試本來就需要在同一批 deployment 上共存。兩份名單不重疊，因此在 sandbox 名單上加一個真實信箱，不會改變 CI 觀察到的任何東西。

`PREVIEW_SANDBOX_RECIPIENTS` 放 secret 而不放 `wrangler.jsonc`，因為它裝的是真實個人信箱，而這個 repository 是公開的。名單上的地址還必須**同時**是 Mailgun sandbox 的 Authorized Recipient——sandbox 網域只寄得到它自己授權過的信箱，兩邊都有才收得到信。

preview 因此需要七個與 production 分離的 secret：

- `SESSION_SECRET`、`HASH_PEPPER`：preview 專用亂數。
- `ADMIN_EMAILS`：固定設為 `preview-admin@example.test`；使用 secret binding，避免與 Pages 既有 binding 衝突。
- `PREVIEW_E2E_TOKEN`：只授權 CI 讀取／清空 preview mail sink；同一值同時設定為 Pages preview secret 與 GitHub Actions secret。
- `MAILGUN_API_KEY`、`MAILGUN_DOMAIN`：**sandbox 的那一組**，不是 production 的。secret 不跨環境繼承，所以 preview 讀到的必然是這裡設的值，沒有誤用正式網域的路徑。
- `PREVIEW_SANDBOX_RECIPIENTS`：逗號、分號或空白分隔，大小寫與前後空白都會正規化。

```bash
npx wrangler pages secret put PREVIEW_SANDBOX_RECIPIENTS --project-name=tw-catalog --env preview
```

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

## 在 preview 用真實信箱登入

CI 走 D1 mail sink，人不必。把自己的信箱掛上 sandbox 那條路之後，preview 的登入信會像正式站一樣寄到收件匣，**不需要 `PREVIEW_E2E_TOKEN`**——那條路只服務 CI。

1. Mailgun dashboard → sandbox 網域 → **Authorized Recipients** 加入該信箱，並到信箱點開 Mailgun 寄出的確認信。沒點確認，sandbox 一律拒收。
2. 把同一個地址加進 `PREVIEW_SANDBOX_RECIPIENTS`（見上節），**然後重新部署一次 preview**——secret 是在建立 deployment 時綁定的。
3. 到 `https://pr-<N>.tw-catalog.pages.dev/circle` 索取登入連結。Turnstile 在 preview 是永遠通過的 dummy widget，按下去即可。

沒收到信時，寄信端的原因只有一個地方看得到：

```bash
npx wrangler pages deployment tail --project-name=tw-catalog --environment=preview
```

Mailgun 回非 2xx 時，這裡會印出狀態碼與回應內文。**只有 preview sandbox 這條路徑會印內文**，因為它的收件人是這個環境自己列的名單；production 只印狀態碼，避免把使用者的地址寫進 log。常見的是 sandbox 未授權該收件人（400）、金鑰或區域不符（401——本專案寫死 `https://api.mailgun.net`，EU 帳號不適用）、網域名稱打錯（404）。

瀏覽器端如果連「請查收信件」都沒出現，那就不是寄信問題：503 是該環境缺 secret，500 才是寄信失敗或收件人不在任何一份名單上。

## CI 行為

`.github/workflows/deploy-pages.yml`：

| 觸發 | 行為 |
|---|---|
| push 到 `main` | 完整 gate 通過後以 branch `main` 發布到 `tw-catalog`；production origin smoke 必須通過，再以獨立 job 匿名觀測正式入口 `map.kotoban.top` |
| 同 repository 的 pull request | 以 branch `pr-<number>` 發布到**同一個 project**，網址 `pr-<number>.tw-catalog.pages.dev`；不覆蓋 production |
| fork pull request | **不執行 deploy job**，避免把 Cloudflare token 暴露給外部程式碼 |
| `workflow_dispatch` | 從 GitHub Actions 頁面手動重跑目前 branch |

- **只有一次部署，沒有先發到開發環境再晉升的流程。**
- 每個 branch 同時只保留最新執行，新的 commit 會取消舊的部署工作。
- Node.js `22.13.0`、`npm ci`、Wrangler `4.120.1`，build output 固定為 `dist`。
- Pages 要求使用 repository root 的標準 `wrangler.jsonc`，它是本 repo 唯一的 Wrangler 設定。
- **preview 環境不繼承 production 的 secrets。** preview 的 session、pepper 與 E2E token 都必須用 `--env preview` 設定；preview 的 Mailgun 用 sandbox 那一組，永遠不是 production 的。
- **401 wiring smoke 與完整 portal E2E 是兩件事。** production origin 與 preview smoke 的 200 只證明靜態資產上線，401 只證明 handler 可建立且 session／pepper 存在，**沒有寄信、D1 寫入或管理流程**。PR 的「Full preview portal E2E」才會實走 request link → mail sink → verify → claim → admin approval → preview → edit → public overlay。
- `map.kotoban.top` 的匿名觀測是獨立 advisory job。它成功時補上 custom domain、公開 Access 邊界與 Functions 的讀者視角；失敗時留下 warning 與 `cf-ray` 診斷，不把已由 production origin 證明成功的部署標成失敗。決策見 [ADR-0034](../adr/0034-production-origin-gates-deployment.md)。
- E2E 前後會查 production `accounts`、claims、overrides 與公開文件 revision fingerprint；任何變化立即失敗。流程結束（成功或失敗）以受 token 保護的 `DELETE /api/preview/mail` 清空 preview accounts、tokens、sessions、claims、overrides、地圖貢獻資料、公開文件、audit、captured mail，以及兩個 preview R2 bucket；admins roster 保留供下一次重跑。
- **preview 與 production 使用不同的 D1 資料庫**，見下節。設定 preview secrets **之前**必須先確認這件事已經生效——順序顛倒會讓 PR 上的測試寫進正式資料。

## 首次啟用

建立 Pages project、D1、R2、secrets、token、Access 與 Turnstile 的完整步驟見[首次啟用](./first-time-setup.md)。一個專案只做一次。

## 排程清除 Worker

獨立部署，見[排程清除 Worker](./retention-purge-worker.md)。

## 發布前 gate

與[本機共同 gate](./local-development.md#共同-gate) 相同，CI 會重跑一次。另需確認：

- `dist/index.html`、`dist/_headers` 存在，且沒有 Functions 或自訂 rewrite 規則攔截靜態請求。
- `npm run build:production` 已依 `data/published-events.json` 重建**每一個已發布活動**的產物，且每一份地圖 artifact 都通過該活動 template 的 layout 驗證（FF47：988 格、28 根柱子、5 個出入口）。
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
