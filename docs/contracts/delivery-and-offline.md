# 資料傳輸與離線契約

公開閱讀端如何取得場刊與地圖資料、載入時的介面行為，以及離線可用範圍。

**實作**：[`app/catalog-publication.ts`](../../app/catalog-publication.ts)、[`app/static-circle-catalog-client.ts`](../../app/static-circle-catalog-client.ts)、[`app/static-event-map-client.ts`](../../app/static-event-map-client.ts)、[`app/static-circle-overrides-client.ts`](../../app/static-circle-overrides-client.ts)、[`app/use-circle-catalog.ts`](../../app/use-circle-catalog.ts)、[`app/service-worker-source.js`](../../app/service-worker-source.js)、[`app/offline-readiness.ts`](../../app/offline-readiness.ts)、[`app/offline-prep-dialog.tsx`](../../app/offline-prep-dialog.tsx)、[`scripts/build-service-worker.mjs`](../../scripts/build-service-worker.mjs)、[`app/static-discovery.ts`](../../app/static-discovery.ts)、[`scripts/build-discovery-pages.mjs`](../../scripts/build-discovery-pages.mjs)、[`app/circle-page-data.ts`](../../app/circle-page-data.ts)、[`app/circle-page/`](../../app/circle-page)
**測試**：`tests/catalog-publication.test.mjs`、`tests/service-worker.test.mjs`、`tests/public-artifact.test.mjs`、`tests/seo.test.mjs`、`tests/discovery-artifact.test.mjs`、`tests/circle-page.test.mjs`、`tests/offline-readiness.test.mjs`、`tests/multi-space-event-map.test.mjs`、`tests/browser/circle-page.mjs`、`tests/browser/reader-offline-prep.mjs`
**設定**：[`public/_headers`](../../public/_headers)、[`public/_routes.json`](../../public/_routes.json)、[`functions/_html-security.ts`](../../functions/_html-security.ts)

## 公開搜尋介紹頁

「逛品書」使用 Reader 原有 publication，一次載入同活動 base 與 overlay，沒有逐卡查詢或新增輪詢。卡片以既有 preview URL 延遲載入，完整圖片只在社團出展頁讀取；不新增懶載入路由、Service Worker 策略或 precache 名單特例。返回時可重取 overlay，分享結果隨現行公開內容更新；驗收邊界見[品書瀏覽契約](./catalog-browse.md)。

`scripts/build-discovery-pages.mjs` 在同一次已驗證 staging／Vite build 後產生活動及社團介紹 HTML、首頁未執行 JS 的活動摘要與 sitemap。HTML 僅投影 reviewed base 的社團名稱、配置及活動 reference；不讀取或靜態保存社團 overlay、圖片、聯絡資料、收藏或行程。新增／移除已發布活動由整份 build 產物反映，不增加每活動人工操作。

介紹頁仍在 build 產生；HTML 經既有 Function 加上每次回應的 CSP nonce（ADR-0074）。社團頁另依 [ADR-0077](../adr/0077-circle-share-images-follow-published-media.md) 唯讀取得分享縮圖，不重建 overlay 或寫入資料。Event JSON-LD 僅使用可解析的活動日日期與既有場館／主辦名稱、網址，活動有別稱時以 `alternateName` 列出；`image` 使用活動圖片（[ADR-0070](../adr/0070-event-images-are-published-by-approval-under-their-hash.md)），沒有時使用下段的品牌分享圖。pinned 場館記錄有地址時，`location[].address` 輸出 `PostalAddress`：從官方地址文字拆出郵遞區號、縣市（`addressRegion`）、鄉鎮市區（`addressLocality`）與其餘街道（`streetAddress`），`addressCountry` 為 `TW`，拆不出縣市時整段作為 `streetAddress`。地址只出現在 JSON-LD，不加到頁面文字。沒有地址的舊 pin 省略地址；售票、表演者、活動狀態與開場時間沒有資料，一律省略，不保證 rich result 資格。

FF47 的舊資料沒有 Organizer 候選及身分分組檔。除原始固定 pin 外，僅允許 #395 的固定地址補齊 pin `44c437efc9133e1a37a68b93f3ed3e49175684e2` 省略分組檔；其七份非場館檔案 bytes 與原 pin 相同，場館只補上已公開的地址及出處。其他新 commit／活動仍須提供分組檔；本次不建立候選、不變更既有身分、攤位或歷史核准紀錄。

首頁、介紹頁的 build 產物與 Reader 啟動後的 head 預設以絕對網址指向品牌分享圖 `/share-card.png`（1200×630 PNG，維護者選定的 C 版），並使用 `summary_large_image`。有活動圖片時，活動介紹頁與 Reader 的活動畫面使用活動圖片及其尺寸。社團頁 GET 回應使用該社團已儲存的分享縮圖選擇；代表圖尺寸未知時移除尺寸 metadata，未選圖或所選內容已不公開時回到品牌圖。多數分享平台不接受 SVG，所以不用站台圖示。分享圖供其他平台的伺服器抓取，不加入 Service Worker precache。

首頁原始 HTML 另帶一份 `WebSite` JSON-LD（`name`「場刊 Map」、`url` 正式網域首頁），供搜尋結果顯示網站名稱；Reader 啟動後不另外插入。介紹頁的站內連結都是最終網址（例如頁尾連到 `/privacy/`），不經轉址。

介紹頁不加入地圖離線 precache，導覽仍 network-only；它們不得寫入 Reader 的離線 shell。社團介紹頁腳本自己的資產同樣不進 precache（`scripts/build-service-worker.mjs` 與 `tests/public-artifact.test.mjs` 把關），與 Reader 共用的 chunk 除外。原 query 地圖仍使用既有離線行為。介紹頁 HTML 為 `private, no-store`；sitemap 的公開 HTTP 快取最多 5 分鐘後重新驗證；這不新增輪詢。

### 社團介紹頁的頁面腳本

社團介紹頁（`circlePath`）是可分享的出展頁。靜態 HTML 已列出社團名稱、每一筆配置與「在地圖查看」；未執行 JS 時仍是完整的官方頁面。頁面另外載入自己的入口 `circlePage`（Vite 以 `circle-page.html` 為模板建置，discovery build 把資產標籤複製到每個社團頁後移除模板），只做靜態 HTML 做不到的兩件事：

- **即時讀取社團填寫的內容。** 經既有的 `/data/events/:eventId/overrides.json` 讀取，與地圖使用同一條路徑、同一個 publication module 與同一個 `buildCircleCatalog` 投影；不是新的公開讀取路徑。可撤下的社團內容因此不會寫進 build 產物。每次開啟頁面讀一次 overlay，不輪詢；已開啟頁面的更新時機同下方「更新可見性」。
- **收藏、行程與分享。** 收藏與行程經既有 planning store 寫入，與地圖是同一份資料，見[收藏與走訪規劃契約](./planning.md#責任邊界)；逐日的「加入這天行程」填進靜態攤位卡預留的位置。分享只使用瀏覽器的系統分享或剪貼簿，不送出任何請求。

頁面腳本需要的官方資料不另外請求：該社團在 reviewed base 中的名稱與全部 placement，以 `circle-catalog/3` 格式（只有這一個社團）寫在 HTML 的 `application/json` 區塊（`#circle-page-data`）。欄位逐一複製，不帶其他屬性；`day` 保持原型別，行程才會與地圖寫入的鍵一致。整份 `circles.json` 不因開啟一個社團頁而下載。

載入行為沿用下方「base first、overlay optional」：overlay 讀取中顯示保留版面的 skeleton；讀取失敗時保留官方配置，明說社團介紹暫時無法顯示並提供重新讀取，不表示成社團沒有填寫；overlay 可用但該社團沒有內容時不顯示介紹區塊，也不放佔位圖。頁面腳本不載入 session、Turnstile 或任何寫入端點。

## Payload 邊界

- **場刊與地圖是版本化靜態快照**（`circles.json`，加上 `map.json` 或 `map-manifest.json` + `maps/<periodKey>/<venueSpaceId>.json`），隨 build 發布，**不打包進 JS bundle**。
- 公開 bundle 只承載介面與投影邏輯。**場刊資料字面值不得回流到 bundle**，由測試把關。
- 公開產物不得包含 `_worker.js` 或 server bundle。理由與整體取捨見 [ADR-0008](../adr/0008-static-public-reading-path.md)。
- 社團補充資料由 `/data/events/:eventId/overrides.json` 這個 Pages Function 提供，疊加在靜態快照之上。
- request、base payload、overlay payload 與 event config 的 `eventId` 必須一致；任何 mismatch fail closed。store、listener、in-flight request 與 server catalog cache 都按 event 分區。

## 載入行為

- **Shell First**：首屏必須先畫出頂部列、日期、篩選與面板結構。
- **Skeleton 而非 spinner**：搜尋結果在快照載入前顯示保留版面的 skeleton 與「正在讀取社團資料…」，不得以空白畫面或孤立 spinner 代替。
- **篩選詞彙先到**：創作類別等篩選選項屬於活動定義，必須在快照抵達前就可見。只有依賴資料的計數可以稍後補上。
- **延後套用選取**：可分享連結的社團與攤位選取在快照可解析後才套用；在此之前不得改寫 URL。見 [URL 檢視狀態契約](./url-state.md)。
- **規劃閘門**：收藏與行程只在快照可用後才判定社團是否存在，不得在空目錄上判定孤立。見 [收藏與走訪規劃契約](./planning.md#儲存與版本)。
- **失敗狀態**：快照讀取失敗時保留介面結構，明確說明是**社團資料讀取失敗**並提示重新整理。**不得偽裝成「查無結果」。**
- **base first、overlay optional**：reviewed base 驗證成功就先進入 ready；overlay 的離線、Access、500、格式或 event mismatch 只將 overlay 標成 unavailable，完整 base 不進入 error。重試按 event 執行，不會鎖住其他活動。

## 離線

站台註冊 Service Worker 作為離線 shell：

| 資源 | 策略 |
|---|---|
| 閱讀端導覽（`/`、`/index.html`） | network-first，回退已快取 shell |
| 其他導覽（`/circle`、`/organizer`、`/privacy`） | network-only；不讀也不寫 shell 快取 |
| static `/data/events/*`（`circles.json`、地圖 artifacts） | stale-while-revalidate |
| Function `/data/events/:eventId/overrides.json` | network-only；失敗時 publication module 使用 reviewed base |
| 公開頁首樣式 `/site-header.css` | stale-while-revalidate；只儲存 CSS 回應 |
| 雜湊資產 | cache-first |

- precache 清單由 build 時產生，**只涵蓋 `index.html` 實際載入的資源**，不含社團入口。
- **只有閱讀端自己的路徑可以更新 shell 快取。** `/circle`、`/organizer` 與 `/privacy` 是各自獨立的文件，其資產刻意不進 precache；若把它們的回應寫進 shell，下一次離線啟動閱讀端就會拿到入口文件而不是地圖，且缺少從未快取的資產。閱讀端狀態全部放在 query parameter，因此閱讀端就是這兩條路徑。
- **絕不把被重新導向的回應當成 shell 或場刊快取。**
- 展場離線可重新載入並繼續使用已下載的場刊、地圖、字型與介面。只發布單一 `map.json` 的分日活動，離線時 manifest 請求在網路層失敗，與 404 相同改讀 `map.json`。
- **準備離線使用（#415）**：行程面板提供「準備離線使用」，明示活動、日期與場地，以及不包括的內容（社團自填介紹與品書圖、外部連結）。沿用既有 Service Worker 與 cache：核對該日所需的 shell、目前頁面載入的資產、`circles.json`、地圖 manifest 與該範圍的地圖，缺少的以與 Worker 相同的條件補抓，**再核對一次才標為已就緒**；曾載入過或曾按過按鈕都不是就緒證據。部分失敗顯示可重試；不支援或同時存在多個版本快取時請使用者重新整理。不新增 Worker、排程或下載平台。
- **離線範圍只涵蓋自家靜態產物。** 外部社團縮圖與外部連結不快取；離線時維持既有的降級狀態，不得改以本地內容假冒。
- 提供 web app manifest 與可遮罩圖示，讓使用者能在展前把工具加入主畫面。**安裝與否不改變任何核心流程。**

## 分享短網址

`POST /api/shares` 建立匿名 snapshot；`GET /api/shares/<shareId>` 回 snapshot（`private`，最多 60 秒）、不存在 404、過期 410；`GET /s/<shareId>` 由 Function 回應含活動名稱與項目數的 `og:title`／`og:description`、固定 `/share-card.png`、`noindex` 與 refresh 到 `/?event=<id>&share=<shareId>`。三者都不進 Service Worker precache，離線時不可用。格式與保存見[收藏與走訪規劃契約](./planning.md#分享行程)與[資料 inventory](./data-inventory.md)。

## 快取標頭

靜態資產由 `public/_headers` 設定；HTML 由 Functions 加上 CSP nonce 與 `private, no-store`，不沿用靜態 HTML 快取時間：

| 路徑 | Cache-Control |
|---|---|
| `/assets/*` | `public, max-age=31536000, immutable`（檔名含 content hash） |
| static `/data/events/*` | `public, max-age=300, must-revalidate` |
| Function `/data/events/:eventId/overrides.json` | `public, max-age=60, must-revalidate` + strong ETag（Function response 明確覆寫 static `_headers` 規則） |
| R2 代管縮圖 | `public, max-age=31536000, immutable`（URL 含內容 SHA-256） |
| `/sw.js` | `no-cache`（另帶 `Service-Worker-Allowed: /`） |
| `/manifest.webmanifest` | `public, max-age=3600` |
| `/share-card.png` | `public, max-age=86400`（網址固定，換圖後最多一天更新） |

### 更新可見性

上述 `max-age` 是 HTTP 快取有效期，不是輪詢間隔。現行 `app/use-circle-catalog.ts` 在每個活動初次載入時取得資料，沒有定時重新載入；持續開著的頁面不保證在一分鐘內看到儲存或撤下結果。重新載入時依快取標頭驗證資料；Service Worker 不保存 overlay，取得 overlay 失敗時使用完整 reviewed base。

**尚未達成、保留待決策的要求：**社團更新與管理者 takedown 約一分鐘內對已開啟的讀者頁面可見。要維持該要求需提出最小方案及請求成本；在維護者決定前，不把它寫成已實作、不刪除要求，也不默默加入輪詢。此落差的實測見 [#48](https://github.com/dekkmarsvin/tw_doujin_event/issues/48)。

**overlay 的每一次 revalidation 都是一次 Function 呼叫，包含回 304 的那些。** strong ETag 省的是頻寬，不是請求數：304 的分支在 Function 內部，且在算出 ETag 之前已經讀過一次 D1。Cloudflare 的邊緣不會在 Function 之前擋下這些請求——Workers Cache 是 `wrangler.jsonc` 的 `cache.enabled` 選項，目前沒有開；zone 層的預設快取副檔名清單也不含 `.json`。

計費方案與用量基準只維護於[專案工作流程第 7 節](../runbooks/project-workflow.md)及 [ADR-0065](../adr/0065-cost-reasoning-uses-the-workers-paid-basis.md)，不在此複製費率或從快取有效期推算活躍讀者數。

Cloudflare 沒有提供降低帳號用量上限或模擬 Error 1027 的測試介面，也不以受控實驗消耗正式帳號用量。部署流程以 Pages project API 驗證並設定 production／preview 的 `fail_open: true`；這是可重複驗收的配置契約，與方案層級無關，維持有效。

不以耗盡配額實驗作發布 gate、部署配置採 fail-open 的決策仍有效（[ADR-0031](../adr/0031-quota-exhaustion-is-not-a-release-gate.md)）；舊有 Free 成本前提的取代關係見 ADR-0065。

公開場刊／地圖與資產不得新增 Pages Function 讀取路徑。HTML nonce 是 [ADR-0074](../adr/0074-html-responses-carry-per-request-csp-nonces.md) 的例外，每次 HTML 網路請求計入同一份帳號 Function 用量，但不查 D1／R2。社團縮圖已使用獨立的 production／preview R2 bucket 與 custom domain，不走 Function（[ADR-0017](../adr/0017-thumbnails-are-self-hosted-with-external-urls-kept.md)）。

同一份 `_headers` 也設定 CSP、`Permissions-Policy`（關閉相機、麥克風、定位）、`Referrer-Policy`、`X-Content-Type-Options` 與 `X-Frame-Options`。`img-src` 允許 `'self'`、`data:` 與 `https:`——寫入驗證接受任何 https 圖片位址（[ADR-0052](../adr/0052-thumbnail-addresses-are-checked-as-images-not-hosts.md)），CSP 若比它窄，存得進去的圖片會在讀者瀏覽器被擋掉。兩者一致由 `tests/circle-overrides.test.mjs` 把關，見[社團自助控制面契約](./circle-portal.md#媒體安全)。

`/circle*` 與 `/organizer*` 各有一份放寬的 CSP：`script-src` 與 `frame-src` 加入 `https://challenges.cloudflare.com`，供登入表單的 Turnstile 使用（[ADR-0016](../adr/0016-human-verification-guards-the-mailer.md)）。兩份內容相同。**閱讀端的策略不變**——Turnstile 是本站程式碼唯一載入的第三方 script，且只在這兩個登入入口。三份策略都放行的 `https://static.cloudflareinsights.com` 是正式網域由 Cloudflare 自動注入的 Web Analytics beacon，見[資料 inventory](./data-inventory.md#第三方)。Cloudflare 對多條命中的 `_headers` 規則採合併而非覆寫，所以該區塊先以 `! Content-Security-Policy` 移除站台層的策略再重新宣告；兩份策略同時生效會被瀏覽器取交集，反而擋掉元件。兩個入口的策略關係（站台層 + 恰好兩個 Turnstile 來源）由 `tests/circle-overrides.test.mjs` 斷言。

HTML 的 Functions policy 與三份靜態 policy 除 nonce 外一致，由 `tests/html-security.test.mjs` 把關。HTML 不做通用 script nonce 重寫，只讓 Cloudflare 採用 CSP header 的 nonce；私人圖片 API 保留 sandbox policy。靜態政策仍作 fail-open 備援。

Service Worker 只攔截同源請求，`challenges.cloudflare.com` 直接落到網路。Reader 離線 shell 保存完整 Response，使 body 與 nonce policy 配對；不獨立刷新 CSP nonce。每次線上 HTML 回應產生新 nonce，並移除資產 ETag／Last-Modified，禁止 CDN 與 HTTP 快取。

`/admin*` 僅增加 `X-Robots-Tag: noindex, nofollow`，沿用全站 CSP；它沒有登入表單，不需放寬 Turnstile 來源。`/circle`、`/organizer`、`/admin` 的專用資產都不進 Reader precache。

## 驗收條件

- `dist/index.html` 存在；`dist/_worker.js` 與 `dist/server/index.js` 不存在。
- 每個已發布活動的 `dist/data/events/<event>/event.json`、`circles.json` 與地圖 artifacts 的 event ID 一致，且每一份 map 都通過該活動 template 的完整 layout 驗證；多場地活動的 manifest 必須恰好覆蓋每個活動日 × 場地一次。
- 主 bundle 不含場刊資料字面值。
- 公開 bundle 不包含 `/api/events/`、地圖管理匯入器或管理發布文案。
- `dist/sw.js` 的 precache 清單涵蓋所有離線必要檔案：**每一個**已發布活動的 `circles.json` 與其全部地圖 artifacts。選了第二場活動再離線的讀者不得拿到空殼。
- `dist/_headers` 與 `dist/_routes.json` 存在；Functions 僅涵蓋 HTML、既有 API 與 overlay，其他靜態資料／資產直送。
- 全新瀏覽器工作階段不需圖片或 D1 即可取得同一份場刊與地圖；HTML 僅經輕量 nonce middleware。
- 離線重新載入後，已下載的場刊、地圖、字型與介面仍可運作；縮圖不可用時維持文字卡。
