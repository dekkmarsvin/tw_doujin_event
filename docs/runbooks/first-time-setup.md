# 首次啟用

從零建立這個專案的 Cloudflare 資源與憑證。**一個專案只做一次**——日常部署、CI 行為、發布前 gate 與回滾在[部署](./deployment.md)。

順序有相依性：Pages project → D1 與 R2 → runtime secrets → token 與 GitHub secrets → Access → Turnstile。


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

identity、社團控制面與地圖貢獻共 16 張 runtime table，由 `db/identity-repository.ts` 的 `ensureTables()` 在首次請求時以 `CREATE TABLE IF NOT EXISTS` 建立。地圖貢獻新增 `map_contributor_grants`、`map_drafts`、`map_draft_revisions`、`map_draft_reviews`、`map_draft_comments`、`map_draft_files`、`map_draft_exports`；preview-only mail sink 使用 `preview_mail_sink`。production 也會有空的 sink 表，但沒有 preview flag 與 E2E token，路由一律回 404，且正常寄信路徑不會寫入它。

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

### 3.1 建立 R2 縮圖 bucket 與 custom domain

production 與 preview 必須分開；`r2_buckets` 和 D1 一樣不跨環境繼承：

```bash
npx wrangler r2 bucket create tw-doujin-event-thumbnails
npx wrangler r2 bucket create tw-doujin-event-thumbnails-preview
npx wrangler r2 bucket domain add tw-doujin-event-thumbnails --domain media.kotoban.top --zone-id <ZONE_ID> --min-tls 1.2 --force
npx wrangler r2 bucket domain add tw-doujin-event-thumbnails-preview --domain media-preview.kotoban.top --zone-id <ZONE_ID> --min-tls 1.2 --force
```

Pages 與排程 Worker 都以 `THUMBNAILS` 綁定同一環境的 bucket；Pages 另由 `THUMBNAIL_PUBLIC_ORIGIN` 產生公開 URL。不得啟用 `r2.dev` 或新增 Function 代理讀取。驗證：

```bash
npx wrangler r2 bucket domain list tw-doujin-event-thumbnails
npx wrangler r2 bucket domain list tw-doujin-event-thumbnails-preview
```

容量與操作量的營運監控追蹤於 [#66](https://github.com/dekkmarsvin/tw_doujin_event/issues/66)，不屬於縮圖請求路徑。

### 3.2 建立私人地圖來源 bucket

production 與 preview 分開，且不得設定 custom domain 或開啟 `r2.dev`：

```bash
npx wrangler r2 bucket create tw-doujin-event-map-contributions
npx wrangler r2 bucket create tw-doujin-event-map-contributions-preview
npx wrangler r2 bucket domain list tw-doujin-event-map-contributions
npx wrangler r2 bucket domain list tw-doujin-event-map-contributions-preview
```

最後兩個指令應顯示沒有 custom domain。Pages 與排程 Worker 都以 `MAP_CONTRIBUTIONS` 綁定同一環境的私人 bucket；不得與有公開圖片網域的 `THUMBNAILS` 共用。Pages 只透過需要 session 與 owner／管理者檢查的 Function 讀取，排程 Worker 只刪除到期原始檔。

### 4. 設定 production 與 preview runtime secrets

見上節。設定後重部署一次 preview，再確認 `/api/auth/session` 是 401；完整 E2E 由 PR workflow 執行。兩份收件人名單以外的地址，在寫入 D1 或呼叫 Mailgun **之前**就被拒絕，絕不退回 production Mailgun。

### 5. 建立最小權限 token

在 Cloudflare Dashboard 建立 Custom API Token，權限給目標 account 的 **Cloudflare Pages: Edit** 與 **D1: Read**。記下 Account ID 與 token；不要寫進 repository、`.env` 或 workflow YAML。

D1 權限不是為了部署，而是為了 PR 的 E2E job：它在跑之前與跑之後各查一次 production D1 的 row counts 與 revision，用來證明 preview 沒有寫到正式資料（見[CI 行為](./deployment.md#ci-行為)）。**只給 Pages: Edit 的 token 可以部署成功，卻會讓那道保護無法執行**——症狀是 E2E job 回報 `The given account is not valid or is not authorized to access this service [code: 7403]`，而同一個 workflow 的 deploy job 一切正常。看到這個錯誤時要補的是 token 權限，不是 Account ID。

若 `D1: Read` 仍被 7403 拒絕，改用 `D1: Edit`——`wrangler d1 execute --remote` 走的是 D1 的 query endpoint，即使 SQL 只有 `SELECT` 也可能被歸類為需要寫入權限。

### 6. 設定 GitHub Actions secrets

到 repository 的 **Settings → Secrets and variables → Actions** 建立 `CLOUDFLARE_ACCOUNT_ID` 與 `CLOUDFLARE_API_TOKEN`。也可以用 GitHub CLI：

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID
```

```bash
gh secret set CLOUDFLARE_API_TOKEN
```

部署以外，CI 還需要 `PREVIEW_E2E_TOKEN` 與一組 Access service token（`CF_ACCESS_CLIENT_ID`、`CF_ACCESS_CLIENT_SECRET`），後者見 [CI 用 service token 通過 preview Access](#ci-用-service-token-通過-preview-access)。

完成後 push `main`，第一次 workflow 會建立 production deployment。在 Pages project 的 **Custom domains** 將 `map.kotoban.top` 設為 Active。CI 以 `tw-catalog.pages.dev` 完成阻擋式 deployment smoke，再以正式網域執行非阻塞匿名觀測；前者只作部署驗證與故障排查，正式入口仍是 `map.kotoban.top`。

## Cloudflare Access：production 公開，preview 閘控

[ADR-0029](../adr/0029-public-production-gated-preview.md) 的現行邊界是：

- `map.kotoban.top` 與 `tw-catalog.pages.dev` 不掛 Access application；一般讀者與社團登入表單都可公開到達。
- `*.tw-catalog.pages.dev` 掛一個 preview Access application。Wildcard 只匹配下一層 hostname，因此涵蓋 `pr-<N>.tw-catalog.pages.dev` 與 `<hash>.tw-catalog.pages.dev`，不涵蓋 `tw-catalog.pages.dev` 本身。
- `map.kotoban.top` 不得被精確 hostname 或 `*.kotoban.top` 的其他 Access application 涵蓋。若帳號內有較廣規則，必須縮小其 hostname，而不是為正式站加入 Bypass。

preview application 不設 Bypass；它同時持有維護者 Allow policy 與 GitHub Actions 的 Service Auth policy。production 的管理 API 仍由 session 與管理者名單保護，不依賴 Access。

### 匿名驗證

production 不帶任何 Access header：

```bash
for path in / /circle /privacy/; do curl -s -o /dev/null -w "$path %{http_code}\n" "https://map.kotoban.top$path"; done
curl -s -o /dev/null -w "/api/auth/session %{http_code}\n" https://map.kotoban.top/api/auth/session
```

前三個路徑必須是 `200`，未登入 session 必須是應用程式自己的 `401`，不得導向 `*.cloudflareaccess.com`。

### production CI 的兩個訊號

- `Smoke test production deployment` 對 `tw-catalog.pages.dev` 匿名要求 `/` 200、`/api/auth/session` 401；這是 deployment job 的必要 gate。
- `Observe public production custom domain` 在 deployment job 通過後，對 `map.kotoban.top` 匿名要求同一組狀態碼。這個 job 不帶 Access header，也不阻擋部署。

正式網域若回傳非預期狀態，job 會留下 warning、UTC 時間、`cf-ray` 等回應標頭與短 body preview。先以 Ray ID 到 Cloudflare **Security → Events** 對照規則，再從另一個網路位置重測；不要替 production 加入 service token 或 Access Bypass。若 production origin 同時失敗，則視為 deployment 本身異常。

preview 不帶 header：

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://pr-<N>.tw-catalog.pages.dev/
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://<hash>.tw-catalog.pages.dev/
```

兩者都必須 `302` 到 `*.cloudflareaccess.com`。CI 直接使用 Wrangler Action 回報的 `pages-deployment-alias-url` 與 `deployment-url`；不要從 branch 名自行拼 alias，因為 Pages 會正規化 `/` 等非英數字元。branch alias 與該次 deployment hash 都要測；只測 alias 無法證明不可變 URL 沒有繞過 Access。

### CI 用 service token 通過 preview Access

GitHub Actions 不是瀏覽器，走不完 identity 登入流程，所以 preview smoke 與 portal E2E 以 **Access service token** 認證；production origin smoke 與正式網域觀測都不得帶這組 header。

```
CF-Access-Client-Id: <CLIENT_ID>
CF-Access-Client-Secret: <CLIENT_SECRET>
```

兩邊都要設定才會生效：

1. Zero Trust → **Access → Service credentials → Service Tokens** 建立 token（本專案為 `tw-catalog - action`）。Client Secret 只顯示一次。
2. 在涵蓋 `*.tw-catalog.pages.dev` 的 preview application 上新增一條 policy，**action 必須是 Service Auth**：

   | Action | Rule type | Selector | Value |
   |---|---|---|---|
   | Service Auth | Include | Service Token | `tw-catalog - action` |

   action 設成 Allow 不會生效——Access 仍會要求 identity 登入。

3. 以 `gh secret set CF_ACCESS_CLIENT_ID` 與 `gh secret set CF_ACCESS_CLIENT_SECRET` 設定 GitHub Actions secrets。

PR deploy job 的 preview smoke 與 `scripts/preview-portal-e2e.mjs` 都會帶這組 header；缺任一個 secret 時 preview job 直接失敗。production job 不讀這兩個 secret。

preview 若只看 `curl --fail` 會量錯東西：Access 對未認證請求回 302 而不是 4xx。CI 因此先斷言匿名請求確實導向 Access，再帶 service token 斷言 `/` 是 200、`/api/auth/session` 是應用程式自己的 401。production 的 origin gate 與正式網域觀測則全程匿名檢查同一組狀態碼。

token 過期或被撤銷、或 policy 被改成 Allow 時，CI 會報 `Service token was redirected by Access`。錯誤訊息會附上 Access 在登入導向裡宣告的 `service_token_status`，用來分辨兩者：

- `false`：Access 根本不認得這組憑證——secret 值錯誤、混入空白或換行、或 token 已被撤銷。重設 GitHub secrets。
- `true`：token 有效，但沒有任何 Service Auth policy 放行它。回頭檢查 policy 的 action 與 include。

## 真人驗證（Turnstile）

`POST /api/auth/request-link` 要求一枚 Turnstile token，決策見 [ADR-0016](../adr/0016-human-verification-guards-the-mailer.md)，行為見[社團自助控制面契約](../contracts/circle-portal.md#索取登入連結需要通過真人驗證)。

### 建立 widget

production 的 widget 已建立，sitekey `0x4AAAAAAET9rAWIzjOckkSc`。要換一個時：

1. Cloudflare dashboard → **Turnstile** → Add widget。Turnstile 不需要申請或審核，有帳號就能建。
2. Hostname 填 `map.kotoban.top` 與 `tw-catalog.pages.dev`。前者是 production 正式入口，後者保留給 Pages origin；preview 使用 dummy widget，不依賴 production hostname 清單。
3. 模式選 **Managed**。本專案不使用 pre-clearance。
4. 取得 Site Key 與 Secret Key。**Secret Key 只顯示一次。**

### Secret Key 進 Pages secret

```bash
npx wrangler pages secret put TURNSTILE_SECRET --project-name=tw-catalog --env production
```

`--env` 一定要寫，理由見 [Secrets](./deployment.md#secrets)。

### Site Key 在 `wrangler.jsonc`，不在 dashboard

Site Key 公開是它的用途，所以它屬於版本控制，不屬於 dashboard 狀態。現值已在**頂層** `vars`，換 widget 時改這裡：

```jsonc
"vars": {
  "TURNSTILE_SITEKEY": "0x4AAAAAAET9rAWIzjOckkSc"
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
curl -sI https://map.kotoban.top/circle | grep -ci '^content-security-policy'
```

輸出 `1` 才是對的；`2` 代表移除沒生效，元件會被擋。

**Turnstile 不可達時登入會停擺，這是刻意的。** siteverify 逾時或回非 2xx 一律視為未通過；症狀是登入表單回「真人驗證未通過」，而 Mailgun 與 D1 都沒有動靜。
