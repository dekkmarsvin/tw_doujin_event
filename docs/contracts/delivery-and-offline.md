# 資料傳輸與離線契約

公開閱讀端如何取得場刊與地圖資料、載入時的介面行為，以及離線可用範圍。

**實作**：[`app/catalog-publication.ts`](../../app/catalog-publication.ts)、[`app/static-circle-catalog-client.ts`](../../app/static-circle-catalog-client.ts)、[`app/static-event-map-client.ts`](../../app/static-event-map-client.ts)、[`app/static-circle-overrides-client.ts`](../../app/static-circle-overrides-client.ts)、[`app/use-circle-catalog.ts`](../../app/use-circle-catalog.ts)、[`app/service-worker-source.js`](../../app/service-worker-source.js)、[`scripts/build-service-worker.mjs`](../../scripts/build-service-worker.mjs)
**測試**：`tests/catalog-publication.test.mjs`、`tests/service-worker.test.mjs`、`tests/pages-build-preparation.test.mjs`、`tests/rendered-html.test.mjs`
**設定**：[`public/_headers`](../../public/_headers)

## Payload 邊界

- **場刊與地圖是版本化靜態快照**（`circles.json`、`map.json`），隨 build 發布，**不打包進 JS bundle**。
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
| 導覽 | network-first，回退已快取 shell |
| static `/data/events/*`（`circles.json`、`map.json`） | stale-while-revalidate |
| Function `/data/events/:eventId/overrides.json` | network-only；失敗時 publication module 使用 reviewed base |
| 雜湊資產 | cache-first |

- precache 清單由 build 時產生，**只涵蓋 `index.html` 實際載入的資源**，不含社團入口。
- **絕不把被重新導向的回應當成 shell 或場刊快取。**
- 展場離線可重新載入並繼續使用已下載的場刊、地圖、字型與介面。
- **離線範圍只涵蓋自家靜態產物。** 外部社團縮圖與外部連結不快取；離線時維持既有的降級狀態，不得改以本地內容假冒。
- 提供 web app manifest 與可遮罩圖示，讓使用者能在展前把工具加入主畫面。**安裝與否不改變任何核心流程。**

## 快取標頭

由 `public/_headers` 設定：

| 路徑 | Cache-Control |
|---|---|
| `/assets/*` | `public, max-age=31536000, immutable`（檔名含 content hash） |
| static `/data/events/*` | `public, max-age=300, must-revalidate` |
| Function `/data/events/:eventId/overrides.json` | `public, max-age=60, must-revalidate` + strong ETag（Function response 明確覆寫 static `_headers` 規則） |
| `/sw.js` | `no-cache`（另帶 `Service-Worker-Allowed: /`） |
| `/manifest.webmanifest` | `public, max-age=3600` |

reviewed base 五分鐘 revalidate；dynamic overlay 每分鐘 revalidate，讓社團儲存與管理者 takedown 約一分鐘內可見。Service Worker 不保存 overlay：離線或 freshness 無法確認時使用完整 base，不把可能任意過期的 overlay 描述成即時資料。

同一份 `_headers` 也設定 CSP、`Permissions-Policy`（關閉相機、麥克風、定位）、`Referrer-Policy`、`X-Content-Type-Options` 與 `X-Frame-Options`。`img-src` 只允許 `'self'`、`data:` 與 `THUMBNAIL_HOST_ALLOWLIST` 的主機，**不含裸 `https:`**。這份清單的唯一權威在 `app/circle-overrides.ts`，`_headers` 與它不一致時 `tests/circle-overrides.test.mjs` 失敗，見[社團自助控制面契約](./circle-portal.md#媒體安全)。

`/circle*` 另有一份放寬的 CSP：`script-src` 與 `frame-src` 加入 `https://challenges.cloudflare.com`，供登入表單的 Turnstile 使用（[ADR-0016](../adr/0016-human-verification-guards-the-mailer.md)）。**閱讀端的策略不變**——這是全站唯一的第三方 script，且只在社團入口。Cloudflare 對多條命中的 `_headers` 規則採合併而非覆寫，所以該區塊先以 `! Content-Security-Policy` 移除站台層的策略再重新宣告；兩份策略同時生效會被瀏覽器取交集，反而擋掉元件。兩份策略的關係（站台層 + 恰好兩個 Turnstile 來源）由 `tests/circle-overrides.test.mjs` 斷言。

Service Worker 不受影響：它只攔截同源請求，`challenges.cloudflare.com` 直接落到網路。

## 驗收條件

- `dist/index.html` 存在；`dist/_worker.js` 與 `dist/server/index.js` 不存在。
- `dist/data/events/ff47/map.json` 通過完整 layout 驗證。
- 主 bundle 不含場刊資料字面值。
- 公開 bundle 不包含 `/api/events/`、地圖管理匯入器或管理發布文案。
- `dist/sw.js` 的 precache 清單涵蓋所有離線必要檔案。
- `dist/_headers` 存在，且沒有 Functions 或自訂 rewrite 規則攔截靜態請求。
- 全新瀏覽器工作階段不需圖片、Worker 或 D1 即可取得同一份場刊與地圖。
- 離線重新載入後，已下載的場刊、地圖、字型與介面仍可運作；外部縮圖維持可理解的降級狀態。
