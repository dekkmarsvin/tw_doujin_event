# Cloudflare Pages 部署

## 管理者待審通知

通知使用既有 `workers/publication-dispatch` 的每分鐘排程、同環境 D1 及 Mailgun；不新增部署單位。個人偏好位於 `/admin#review-notifications`，預設開啟、每 5 分鐘，只收初始化／啟用後的新送審。上線順序：先交付 Pages 的 runtime schema、偏好 API、四類送審寫入及面板，再交付 Worker 寄送端。既有資料庫首次初始化不回填待審項目。

全站待審通知由 D1 `admin_review_notifications_enabled` 控制，與發布及帳號通知分開。Worker 必須具備自己的 `MAILGUN_API_KEY`、`MAILGUN_DOMAIN`、`MAILGUN_SENDER` 及 `NOTIFICATION_ORIGIN`；Pages secrets 不會自動成為 Worker secrets。

Preview 使用獨立 D1；設定 `PREVIEW_MAIL_SINK=d1`、`.test` 的 `PREVIEW_TEST_RECIPIENTS` 及 preview 的固定 HTTPS origin，先驗證設定→送審→tick→D1 收信。通知 Worker 的 preview 已啟用，人工收信使用 `verify.kotoban.top` 與 `postmaster@verify.kotoban.top`，確保 SPF／DKIM 與 From 對齊；API key 仍由 preview 自己的 secret 提供。`PREVIEW_SANDBOX_RECIPIENTS` 是人工測試收件白名單，名稱雖含 sandbox，亦適用已驗證自有網域，不放寬任意收件人。Worker 的 `keep_vars: true` 保留 Dashboard 管理的白名單，設定檔明列的 vars 仍會覆寫同名值。preview 環境的 vars 與 secrets 必須各自設定。Pages preview 的登入與邀請信同樣由 `verify.kotoban.top` 寄出，見 [preview 的兩個信箱](#preview-的兩個信箱)。Mailgun `accepted` 後仍須查 `delivered`／`failed` 事件確認交付。

首次正式啟用須先完成 preview 實際收信驗收，再把正式 Worker 總開關設為 `true`。總開關關閉屬於維運暫停，已排入的工作會在恢復後續寄；管理者在面板關閉則取消其待寄工作，重新開啟不補寄。需要停止外部寄信時可關閉總開關，不影響送審與 publication。

以 Worker Logs 的 `review_notifications.tick`／`review_notifications.tick_failed` 檢查結果；摘要包含批次 ID、結果與錯誤分類，不輸出收件地址或供應商回應本文。`accepted` 只表示供應商受理；依 provider ID 查 Mailgun 交付結果。遇到設定錯誤先修正設定，既有批次依退避時間恢復，無需另建通知；不要把批次直接標為成功。已完成／取消的寄送紀錄由既有 retention Worker 清除（30 天）。

公開站與社團入口都部署到**同一個** Cloudflare Pages project：`tw-catalog`。

| 用途 | 網址 | Access |
|---|---|---|
| 正式公開入口 | <https://map.kotoban.top/> | 無；一般閱讀公開，社團端由應用層驗證 |
| Pages production origin | <https://tw-catalog.pages.dev/> | 無；只作 deployment smoke 與故障排查，不是對外正式入口 |
| PR alias／不可變 deployment | `https://pr-<N>.tw-catalog.pages.dev`／`https://<hash>.tw-catalog.pages.dev` | 有；維護者登入或 CI Service Auth |

`map.kotoban.top` 必須在 Pages project 的 **Custom domains** 顯示 Active，並使用 Cloudflare proxy。該 hostname 啟用 zone 的 Web Analytics 自動注入，`public/_headers` 的三份 CSP 都在 `script-src` 放行 `https://static.cloudflareinsights.com`；放行的是 origin 而非官方 FAQ 寫的 `/beacon.min.js` 路徑，因為自動注入載入的是帶版本號的子路徑，路徑型 CSP source 只精確比對自己那一個路徑。自動注入的 beacon 回報到本網域的 `/cdn-cgi/rum`，`connect-src 'self'` 已涵蓋，不需要額外放行 `cloudflareinsights.com`。

同一個 zone 另外還開著 Bot Fight Mode／JS Detections，它注入的是**行內** script（`window.__CF$cv$params`，轉去 `/cdn-cgi/challenge-platform/scripts/jsd/main.js`），內容含每次請求都不同的 ray ID，因此沒有穩定的 `sha256-` 可放行。要嘛在 zone 關掉它，要嘛接受該行 console error——不得為它加 `'unsafe-inline'`，那會把整份 `script-src` 的防護拆掉。

產物邊界與快取策略見[資料傳輸與離線契約](../contracts/delivery-and-offline.md)。為什麼公開閱讀路徑不走 Worker，見 [ADR-0008](../adr/0008-static-public-reading-path.md)；為什麼用 GitHub Actions Direct Upload 而非 Dashboard Git integration，見 [ADR-0009](../adr/0009-single-pages-project-direct-upload.md)。

## 這個專案需要什麼

| 項目 | 需要嗎 |
|---|---|
| Pages project | 需要（`tw-catalog`） |
| Pages Functions | **需要**——`functions/` 承載社團身分、認領、編輯、管理 route 與公開的 `overrides.json` |
| D1 binding | **需要**——binding 名 `DB`。production 用 `tw-catalog-identity`，preview 用 `tw-catalog-identity-preview` |
| Runtime secrets | **需要**——production 六個基本 secret、發布用的四個 GitHub App secret 與一個公開變數；preview 使用隔離的 session／pepper、E2E token、D1 mail sink、`verify.kotoban.top` 寄件網域與 Turnstile dummy 金鑰，見下 |
| 排程 Worker（Cron Trigger） | **需要**——`tw-catalog-retention-purge` 與 `tw-catalog-publication-dispatch`，與 Pages project 分開部署，見[排程清除 Worker](#排程清除-worker)與 [Organizer 發布](#organizer-發布) |
| R2 | **需要**——每個環境各有公開縮圖 bucket（`THUMBNAILS`）與無公開網域的地圖來源 bucket（`MAP_CONTRIBUTIONS`） |
| KV / Durable Objects | 不需要 |
| advanced mode（`dist/_worker.js`） | **不得使用** |

不使用 advanced mode 是硬邊界：它會讓每一個請求（含 1.8 MB 的 `circles.json`）都經過 Worker。`public/_routes.json` 明列 HTML、既有 API 與 overlay；HTML 經 middleware 加上 CSP nonce（[ADR-0074](../adr/0074-html-responses-carry-per-request-csp-nonces.md)），其餘靜態資源仍由邊緣直送。

### Identity runtime 初始化

Identity 保留首次使用時建表（#6／#24），沒有額外的手動 migration 步驟。`db/identity-runtime-initializer.ts` 以 D1 的 `identity_runtime_state` 保存完成版本；新 isolate 讀到相同或較新的版本即略過 schema／固定 seed，管理者與通知初始化仍由控制面獨立執行。

修改 schema、column migration、index、固定場館／reference seed 或初始化演算法時，遞增 `db/identity-runtime-version.json` 的 `version` 並更新 `fingerprint`。`tests/identity-runtime-initialization.test.mjs` 會計算初始化程式、schema 宣告與實際 seed bytes 的 SHA-256；不符時顯示新值。已發布的版本不可重用。僅控制面管理者設定改變不需要 schema 升版，也不能把信箱名單放進此檔。

升級必須維持前版程式可使用的 additive 結構；較新 marker 不能觸發舊 DDL 或被舊程式倒寫。失敗不記錄完成版本，下一次請求可重試。新部署的首次初始化仍可能較慢，同時開始的初始化仍靠既有冪等操作完成，並非 exactly-once。

Production 的既有 `smoke-published-events.mjs` 與隔離 preview E2E 都會透過 `overlay-readiness.mjs` 連續讀取公開 overlay，確認版本 header、有效資料與再次讀取成功；不寫入 production fixture，也不把一次 smoke 當成效能 SLO。Pages 驗證與 publication Worker 的 source／binding／active-version 證據仍分開；retention Worker 不建立 schema。

回復使用通過相容性測試的前版 Pages／受影響 Worker 程式，保留版本表及資料，不做 down migration。未來若需要破壞相容性的 schema 變更，必須另行定義切換與回復策略，不能沿用「較新版本直接略過」的假設。

### HTML nonce 驗收

HTML CSP 由 `functions/_html-security.ts` 宣告，`public/_headers` 保留相同來源限制作靜態備援。每次網路 HTML 回應有新的 256-bit nonce，Cloudflare JavaScript Detections 從 origin header 採用該值。不要以 Response Header Transform Rule 補 nonce，因為標頭與腳本注入的階段不同，必須驗證最終 script 真的帶上相同值。

部署後在正式網域檢查首頁、活動／社團介紹頁及 `/circle`、`/organizer`：回應只有一份 CSP，兩次網路請求 nonce 不同，JSD inline script 的 nonce 與回應一致。HTML 為 `private, no-store`，conditional request 不得回新 nonce 加舊 body；場刊 JSON 與雜湊資產仍保留原快取策略。瀏覽器確認 Reader、Turnstile 與離線 shell；離線 Response 的 body 與 CSP 必須一起保存。pages.dev 沒有正式 zone 的 Bot Fight Mode，不能代替此項驗收。回復方式為回復上一版 Pages deployment；嚴格靜態 CSP 仍在，JSD 可能恢復被擋。

Pages project 的 production 與 preview 都必須使用 **Fail open**（Dashboard → Workers & Pages → `tw-catalog` → Settings → Runtime → Fail open / closed）。Cloudflare 沒有提供降低每日額度或模擬 Error 1027 的安全測試介面，因此不刻意耗盡正式帳號額度；CI 每次部署後會透過 Pages project API 校正並驗證兩個環境的 `fail_open: true`。這項決策見 [ADR-0031](../adr/0031-quota-exhaustion-is-not-a-release-gate.md)。

公開 build 有四個 entry：`index.html`（閱讀端，可離線）、`circle.html`（社團控制面，`noindex`）、`organizer.html`（主辦單位工作區，`noindex`）與 `admin.html`（網站管理入口，`noindex`）。控制面的程式碼不得出現在閱讀端 bundle，`tests/service-worker.test.mjs` 會確認 precache 不含控制面 chunk。

本機 authoring 的第二套 build 已依 [ADR-0049](../adr/0049-the-local-authoring-backup-is-withdrawn.md) 移除；`vite.pages.config.ts` 是唯一的 build 設定。

## Secrets

production 的六個 runtime secret 以 `wrangler pages secret put` 設定。**不進 repo、不進 `wrangler.jsonc`**：

`SESSION_SECRET`、`HASH_PEPPER`、`ADMIN_EMAILS`、`MAILGUN_API_KEY`、`MAILGUN_DOMAIN`（選填 `MAILGUN_SENDER`）、`TURNSTILE_SECRET`

另有一個**不是 secret 的變數** `TURNSTILE_SITEKEY`：它會經 `GET /api/auth/config` 送到瀏覽器，公開是它的用途。它**已經寫在 `wrangler.jsonc` 的頂層 `vars`**，不在 dashboard，部署者不需要另外設定——理由見[真人驗證](./first-time-setup.md#真人驗證turnstile)。缺它時 `GET /api/auth/config` 回 503，登入頁因此拿不到 sitekey；其餘路由不受影響。

### Organizer 發布

活動申請與 publication 是不同的開關，由 `/admin?section=settings` 管理共用 D1 的即時設定。公開申請由維護者手動啟用；首頁沿用既有登入入口。

新環境與既有設定遷移順序見[網站營運設定遷移](#網站營運設定遷移477)。申請模式不依賴前端 build 或重新部署；關閉仍保留已有申請、審核與工作區。

`ORGANIZER_PUBLICATION_MODE=r2` 時，核准在同一個請求內寫入活動資料 bucket，見[核准即發布](#核准即發布)。未設定時預設 disabled，核准與重試回 503；編輯、匯入、地圖、驗證、預覽與送審仍可使用。設定同時寫在根目錄 `wrangler.jsonc` 與 `workers/publication-dispatch/wrangler.jsonc`，不以 dashboard 臨時改值代替。

獨立 `tw-catalog-publication-dispatch` Worker 綁同一個 production identity D1 與活動資料 bucket，每分鐘執行，沒有 HTTP 入口。它只接手核准請求中斷後留下的工作，並送出通知信。用 `npm run publication:deploy`（preview：`publication:deploy:preview`）部署，與 Pages 部署分開。

Worker 的 `preview_urls: false` 與 observability 也納入設定，保留既有 Dashboard 的入口／日誌狀態，避免 Wrangler 預設值在部署時覆寫。`tw-catalog-publication-dispatch` 與 `tw-catalog-retention-purge` 兩個 Worker 都開啟 Workers Logs 與 Workers Traces（`head_sampling_rate: 1`、`invocation_logs: true`、`persist: true`），因為兩者都只有 cron 入口，沒有使用者會替它們回報失敗；`observability` 是可繼承欄位，`env.preview` 不必重寫。

根目錄 `wrangler.jsonc` 是 Pages 專案設定，**不能**加 `observability`：Pages 的支援欄位清單沒有它，Wrangler 會直接以 `Configuration file for Pages projects does not support "observability"` 中斷部署。Pages Functions 也沒有可查詢的 Workers Logs，只有不落地的即時串流（見下方 `wrangler pages deployment tail`）。

需要暫停發布時，在 `/admin?section=settings` 關閉發布；保留 D1 job 與 snapshot，不手改 job 狀態。

### preview 的兩個信箱

preview 永遠不碰 production Mailgun，但它會寄信——只寄給兩份名單上的地址，並且**依收件人**決定寄法：

Pages 登入／邀請與排程 Worker 摘要都使用 `app/portal-mail.ts` 的 `sendPortalMail`；收件路由及拒絕本文的記錄規則由這個入口統一決定。

| 收件人在哪份名單 | 信去哪裡 | 誰在用 |
|---|---|---|
| `PREVIEW_TEST_RECIPIENTS`（`wrangler.jsonc` 的 `env.preview.vars`，兩個保留的 `.test` 假地址） | 寫進 preview D1 的 `preview_mail_sink`，以 `GET /api/preview/mail` 讀回 | CI 的 E2E |
| `PREVIEW_SANDBOX_RECIPIENTS`（Pages preview secret） | 由 Mailgun 以 `verify.kotoban.top` 實際寄出 | 人工測試 |
| 兩份都不在 | 兩邊都不碰，直接拒絕 | —— |

**依收件人而不依 branch 是被迫的，也是剛好的。** Pages 只有 `production` 與 `preview` 兩個環境，沒有 per-branch 變數，所以任何「這個 branch 改寄真信」的設定實際上都會套用到全部 preview deployment；而 CI 與人工測試本來就需要在同一批 deployment 上共存。兩份名單不重疊，因此在 `PREVIEW_SANDBOX_RECIPIENTS` 加一個真實信箱，不會改變 CI 觀察到的任何東西。

`PREVIEW_SANDBOX_RECIPIENTS` 放 secret 而不放 `wrangler.jsonc`，因為它裝的是真實個人信箱，而這個 repository 是公開的。寄件網域是已驗證的 `verify.kotoban.top`，Mailgun 不另設收件人白名單，所以這份名單就是 preview 能寄到哪些真實信箱的唯一限制；名稱裡的 sandbox 是沿用舊設定。

preview 因此需要六個與 production 分離的 secret：

- `SESSION_SECRET`、`HASH_PEPPER`：preview 專用亂數。
- `ADMIN_EMAILS`：固定設為 `preview-admin@example.test`；使用 secret binding，避免與 Pages 既有 binding 衝突。
- `PREVIEW_E2E_TOKEN`：只授權 CI 讀取／清空 preview mail sink；同一值同時設定為 Pages preview secret 與 GitHub Actions secret。
- `MAILGUN_API_KEY`：能以 `verify.kotoban.top` 寄信的金鑰，用 `--env preview` 另外設定。寄件網域不是機密，寫在 `wrangler.jsonc` 的 `env.preview.vars.MAILGUN_DOMAIN`；不要再另設同名的 `MAILGUN_DOMAIN` secret。
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

- **新增或修改密鑰後必須重新部署。** Pages 的密鑰是在建立 deployment 時綁定的，既有 deployment 不會追溯取得新密鑰。症狀是所有 `/api/*` 回 503「服務尚未設定完成」，而 `wrangler pages secret list` 明明列得出來。用 `gh workflow run ci.yml --ref main` 重跑即可。
- **`SESSION_SECRET` 一旦上線就不要更換。** 它簽署 session cookie，更換等同讓所有已登入的社團同時被登出。
- **`ADMIN_EMAILS` 只在管理者名單為空時作為種子。** 名單存在 D1 的 `admins` 表，之後從 `/admin` 增減，立即生效、不需重新部署。見[社團自助控制面契約](../contracts/circle-portal.md#管理者)。

## 在 preview 用真實信箱登入

CI 走 D1 mail sink，人不必。把自己的信箱加進 `PREVIEW_SANDBOX_RECIPIENTS` 之後，preview 的登入信會像正式站一樣寄到收件匣，**不需要 `PREVIEW_E2E_TOKEN`**——那條路只服務 CI。

1. 把地址加進 `PREVIEW_SANDBOX_RECIPIENTS`（見上節），**然後重新部署一次 preview**——secret 是在建立 deployment 時綁定的。
2. 到 `https://pr-<N>.tw-catalog.pages.dev/circle` 索取登入連結。Turnstile 在 preview 是永遠通過的 dummy widget，按下去即可。

要追查登入信或主辦邀請，**先開啟對應 deployment 的串流，再重現寄信**。Pages Functions log 不保存，未事先開啟時無法從 Pages 補回歷史 message ID。指定這次測試的不可變 deployment URL，避免同時有其他 PR 部署時誤看最新 preview：

```bash
npx wrangler pages deployment tail https://<deployment-id>.tw-catalog.pages.dev --project-name=tw-catalog --format=json
```

每次 Pages 寄信會有一筆 `portal.mail`：`mailType` 是 `login_link` 或 `organizer_invitation`（含首次及重寄），`result` 如下。

| result | 意義與下一步 |
|---|---|
| `accepted` | Mailgun 受理。以 `providerId` 到 Mailgun 的 Logs 對照同封信；`providerId: null` 表示受理但未取得 ID，不能判成寄送失敗。 |
| `preview_sink` | 已寫入 D1 測試收信槽，`providerId: null`，沒有 Mailgun 交付事件。 |
| `failed` | 供應商明確拒絕、寄信設定缺失或 preview 路由拒絕；依安全的 `errorCode`（如 `mailgun_403`）排查。 |
| `unknown` | 逾時／網路等不確定結果；`delivery_timeout` 或 `delivery_unknown`，不能假定未寄出。 |

事件不包含收件地址、主旨、正文、登入 URL／權杖、secret 或原始錯誤。`preview-sink`、`accepted` 是傳輸內部保留值，不會被當作 message ID。Mailgun 回非 2xx 時，**只有啟用 D1 preview 且寄給 `PREVIEW_SANDBOX_RECIPIENTS` 的這條路徑另印最多 300 字的拒絕內文**；production 僅有安全錯誤碼，即使殘留白名單亦不印本文。常見的是金鑰不能用於 `verify.kotoban.top` 或區域不符（401——本專案寫死 `https://api.mailgun.net`，EU 帳號不適用）、網域名稱打錯（404）。

頁面顯示已寄出或 log 的 `accepted` 只代表 Mailgun 受理；受理後仍可能寄送失敗。複製 provider ID 到 Mailgun Logs 的 message ID 篩選，查看同封信的 `delivered`／`failed` 事件；`delivered` 只表示收件伺服器接受，不代表使用者讀到信。這次不接 webhook、不存 D1 寄送歷史；供應商記錄可查期間依 Mailgun 帳號方案為準。

瀏覽器端如果連「請查收信件」都沒出現，那就不是寄信問題：503 是該環境缺 secret，500 才是寄信失敗或收件人不在任何一份名單上。

## CI 行為

`.github/workflows/ci.yml` 是唯一的 workflow（#546）。每次變更都跑同一組檢查，不依路徑分類；只改文件也照跑，多花幾分鐘 runner 時間，換來不必維護分類規則。

| Job | 何時執行 | 做什麼 |
|---|---|---|
| `Verify` | 每次 | `npm ci`、lint、型別檢查、`npm test` |
| `Browser acceptance` | PR 與手動 dispatch | 完整 browser journeys；main 不重跑 |
| `Deploy` | `Verify` 通過後；fork PR 不執行 | 見下表 |
| `Full preview portal E2E` | 同 repository 的 PR，部署後 | 對本次 preview deployment 實走 portal 流程 |

| 觸發 | 部署 |
|---|---|
| push 到 `main` | 以 branch `main` 發布到 `tw-catalog`，production origin smoke 必須通過 |
| 同 repository 的 pull request | 以 branch `pr-<number>` 發布到**同一個 project**，網址 `pr-<number>.tw-catalog.pages.dev`；不覆蓋 production |
| fork pull request | **不部署**，避免把 Cloudflare token 暴露給外部程式碼 |
| `workflow_dispatch` | 從 GitHub Actions 頁面手動重跑目前 branch |

- **只有一次部署，沒有先發到開發環境再晉升的流程。**
- PR 的新 push 取消同 PR 的舊 run；main 上執行中的部署不會被中途取消，排隊中的 run 由最新的一個取代。
- Node.js `24.20.0`（`.nvmrc`）、npm `11.19.0`、`npm ci`、Wrangler `4.120.1`，build output 固定為 `dist`。
- Pages 使用 repository root 的 `wrangler.jsonc`；獨立 Worker 使用各自目錄的設定。
- Browser job 使用與 Playwright lockfile 版本相符的官方容器，內含 browser 與 Linux libraries。更新 Playwright 時同步更新 image tag。
- **preview 環境不繼承 production 的 secrets。** preview 的 session、pepper、E2E token 與 Mailgun 金鑰都必須用 `--env preview` 設定；preview 的寄件網域是 `verify.kotoban.top`。
- **401 wiring smoke 與完整 portal E2E 是兩件事。** production origin 與 preview smoke 的 200 只證明靜態資產上線，401 只證明 handler 可建立且 session／pepper 存在，**沒有寄信、D1 寫入或管理流程**。PR 的「Full preview portal E2E」才會實走 request link → mail sink → verify → claim → admin approval → preview → edit → public overlay。
- `Full preview portal E2E` 使用該 run 的 immutable deployment URL，排隊期間即使 PR branch alias 已前進，也不會改驗另一版本。共用 preview 資源的 E2E 仍以同一個全域鎖序列執行；不代表每個 PR 擁有獨立 D1。
- E2E 先讀 Cloudflare 的本次 deployment 快照，核對 deployment ID、immutable URL、commit、preview 環境、成功狀態，以及 `DB` UUID／兩個 R2 bucket 名稱均符合 preview 設定。另讀 project 的 canonical production deployment，確認 preview 同時與 repo 宣告及實際 production 資源不重疊，避免 PR 誤改宣告掩蓋重疊；失敗時不開始產品操作。不查 production 資料筆數，也不寫額外隔離探針。
- 每個 run／attempt 使用保留的 `preview-admin+e2e-<runId>@example.test`、`preview-circle+e2e-<runId>@example.test`。只有對應 base 地址已列入 preview sink allowlist 才可使用；受 token 保護的 POST 建立該 run 的 admin。社團依搜尋結果順序逐一以 POST 核對原始 D1，任何狀態的 claims／overrides、或該社團 R2 prefix 中任一物件均略過；公開投影空白不代表原始資料不存在。取第一個沒有資料的社團走正常認領與編輯，全部都有資料時失敗，不覆寫人工資料。
- 流程開始時以 `DELETE /api/preview/mail` 加 JSON `{ "runId": "…", "finishedRuns": true }` 清除已結束 run 留下的保留 fixture：E2E job 持有全域 `preview-portal-e2e` 鎖，所以此時仍在 D1 的保留身分都屬於已結束的 run，包含自己的 cleanup 沒完成的 run。只比對上述保留地址，人工資料與相似但不在保留格式內的地址一律不動。遠端 journey 只在該 CI job 內執行，不另外手動對 preview 跑，以免繞過這個鎖。
- 流程 finally 及 CI always cleanup 使用同一 endpoint 加 JSON `{ "runId": "…" }`，只清除該 run 的帳號、登入資料、claims、自己最後更新的 overrides、對應通知／audit／captured mail 及臨時 admin。公開文件以同一交易移除相關項目，保留其他資料；此 journey 不建立 R2 物件，因此遠端 cleanup 不列舉或刪除 R2。空 body 的遠端 reset 拒絕；完整 reset 僅限 `LOCAL_PORTAL_DISPOSABLE=true` 且 HTTP loopback 的本機環境。
- Runner 強制終止或網路持續失敗仍可能留下該 run 的資料；下一個 run 開始時會清除，log 會列出被清除的 runId。不得用整庫 reset 解決。七天 artifact 只供診斷，必要驗收摘要貼回 issue／PR。
- **preview 與 production 使用不同的 D1 資料庫**，見下節。設定 preview secrets **之前**必須先確認這件事已經生效——順序顛倒會讓 PR 上的測試寫進正式資料。

## 活動資料（R2）

已發布活動存在 R2 bucket `tw-doujin-event-data`（preview：`tw-doujin-event-data-preview`），由 Pages Functions 以原本的 `/data/events/…` 路徑提供（#546）。bucket 不開公開網域。

- `index.json`：已發布活動與讀者看到的順序，每場記錄目前版本、檔案清單、活動定義、reference records 與發布它的核准來源，另記錄目前的社團配號表版本。這是唯一的版本指標。
- `events/<eventId>/<version>/<file>`：各版本的公開檔案，寫入後不再修改，舊版本保留。
- `events/<eventId>/<version>/source/`：下一次更正要讀的發布輸入（社團分組），不對外提供。
- `registry/<version>/`：社團配號表（`allocations.json`、`evidence.json`）。
- `history/index-<version>.json`：每一份發布過的 `index.json` 完整副本，供回滾使用。

讀不到 `index.json` 時所有 HTML 頁回 503，所以**部署讀 R2 的程式之前，production 與 preview 的 bucket 都要先有資料**。

### 核准即發布

`ORGANIZER_PUBLICATION_MODE=r2` 時，管理者核准後在同一個請求內：產生公開檔案、更新社團配號表、寫入新版本，最後改寫 `index.json`（帶 ETag 條件，另一筆發布剛完成時要求重試）。失敗不會改動讀者看到的內容；可重試的失敗用既有的「重試」按鈕，同一筆核准重送不會重複發布。更正沿用名單異動宣告，基準改從 bucket 讀取並與公開的 `circles.json` 核對。publication Worker 在 `r2` 模式下不推進任何發布，只保留通知排程。

### 從 data repository 上傳（一次性）

把 data repository 的已發布活動整批搬進 bucket，用於初次遷移，或 bucket 還沒有任何經核准發布的活動時：

```bash
npm run data:fetch -- --published
npm run data:stage -- --published
npm run event-data:upload -- --remote --preview
npm run event-data:upload -- --remote
```

需要已登入、可寫入該帳號 R2 的 Wrangler。上傳一併寫入 main repository 的社團配號表與各活動的分組，先寫完所有檔案，最後才寫 `index.json`；中途失敗時讀者仍看到上一版，重跑即可。

**bucket 裡一有經核准發布的活動，上傳就會拒絕執行**：data repository 沒有那些活動與它們的配號，整批上傳會把它們從讀者端移除。

### 回滾

舊版本的檔案、配號表與每一份 `index.json` 都還在。回滾就是把整份舊的 index 復原，不要只改其中某個活動的 `version`：index 裡的活動定義、reference records、核准來源與配號表版本必須一起回到同一個時間點。

```bash
npx wrangler r2 object get tw-doujin-event-data/history/index-<版本>.json --file index.json --remote
npx wrangler r2 object put tw-doujin-event-data/index.json --file index.json --content-type application/json --remote
```

回滾後，之後發布的版本與它們配發的社團 ID 都不再生效；這段期間核准的活動或更正要重新核准。

## 首次啟用

建立 Pages project、D1、R2、secrets、token、Access 與 Turnstile 的完整步驟見[首次啟用](./first-time-setup.md)。一個專案只做一次。

## 排程清除 Worker

獨立部署，見[排程清除 Worker](./retention-purge-worker.md)。

## 獨立 Worker

`tw-catalog-publication-dispatch` 與 `tw-catalog-retention-purge` 不隨 Pages 部署，CI 也不部署它們。改了 Worker 會用到的程式（`app/publication-dispatch.ts`、`db/retention-purge.ts` 等）後，合併到 main 再手動部署：

```bash
npm run publication:deploy
npm run publication:deploy:preview
npm run purge:deploy
npm run purge:deploy:preview
```

部署後用 `npx wrangler deployments list --config <設定檔>` 確認 active version 是剛才那次。

## 發布前 gate

與[本機共同 gate](./local-development.md#共同-gate) 相同，CI 會重跑一次。另需確認：

- `dist/index.html`、`dist/_headers`、`dist/_routes.json` 存在，HTML nonce 例外之外的靜態資產／場刊請求不經 Functions。
- 部署的 `dist` 由 `npm run build:deploy` 產生，不含 `data/events/`；活動資料見[活動資料（R2）](#活動資料r2)。
- `dist/_worker.js` 與 `dist/server/index.js` 不存在。
- 閱讀端 bundle 不包含寫入端點（`/api/auth/`、`/api/claims`、`/api/admin/`、`/api/organizer/`）或登入與認領文案，由 `tests/public-artifact.test.mjs` 檢查。

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

## 帳號結果與內容通知（#469）

沿用 publication-dispatch 與 retention 的既有排程、D1、Mailgun，新增產品／排程角色為 0。schema runtime version 3 新增三張 account notification 表及索引；不改舊 review notification 表、偏好與 pending，舊 consumer 也不讀新表。部署順序：先 Pages 的 schema／事件寫入／設定介面，再同版本的 publication-dispatch 與 retention Worker；先在獨立 preview D1 sink 驗證。沒有旗標時新入列與消費均停用，UI 可先設定偏好。

正式寄送由同環境 D1 `account_notifications_enabled` 控制，Pages producer 與 Worker 均讀取最新設定。Admin 從關閉改為啟用時自動建立 `account_notifications_since`，取消早於起點的舊 pending，不補寄停用期間事件。登入／邀請、待審通知與發布各自獨立；origin 沿用 `NOTIFICATION_ORIGIN`。

正式啟用前確認 Worker 已部署目前版本，並取得有授權 preview 信箱的社團結果、主辦結果與摘要收信證據。D1 sink、provider accepted、delivered、人工觀察分開記錄在 issue／PR；不由 CI 或 Pages 部署推定 Worker／收件匣已完成。preview 白名單與 Mailgun secrets 沿用既有隔離規則，不將 production 地址放入測試。

`account_notifications.tick` 含 batch ID 與結果；D1 批次保存安全錯誤分類及 provider ID，不記錄地址／信件全文於正式 logs。每 tick 最多 10 個批次、每摘要最多 100 項；租約 120 秒，批次內容固定，暫時錯誤退避至 6 小時，首次嘗試 48 小時後終止，完成／取消／失敗 30 天清除。外部已受理但寫回失敗可能重複，禁止以重試成功宣稱 exactly-once。

回滾與舊環境旗標清除依下方營運設定遷移段落，保留 notification 表與 monotonic schema marker。既有重試／保留期／個人偏好維持原契約。

## 網站營運設定遷移（#477）

既有環境透過保留一次性 env seed 的 PR #480 遷移；完成初始值、Pages／Worker 與 D1 核對後，Phase 5 移除舊五個營運環境旗標與 GitHub build variable，以及初始化讀取。現行版本只由 D1 管理營運設定，不保留 env fallback。

- 新環境先部署 Pages 並登入 `/admin?section=settings` 初始化。預設暫停申請、空名單、通知與發布關閉；由管理者在 Admin 開啟所需功能。
- 再部署 publication-dispatch Worker（見[獨立 Worker](#獨立-worker)），確認 active version 是剛才那次。Worker 不 seed 營運設定；只有 Pages／CI 成功不代表 Worker 已更新。
- 在 Admin 保存設定、重新載入並核對；下一次 request／scheduled tick 使用 D1 新值。手動「檢查服務」由實際 Worker 執行，不寄測試信或修改儲存庫；無結果／無診斷讀取權不宣稱寄信或發布失敗。
- `ORGANIZER_PUBLICATION_MODE`、憑證、binding、通知 origin 維持部署設定。

回滾到遷移前程式時，先從當前 D1 設定恢復舊旗標與同一通知 epoch，再部署舊程式。只回滾程式、不刪 `site_settings`、通知表、job／snapshot／checkpoint 或 monotonic schema marker；回滾到 PR #480 可直接沿用既有 D1。
