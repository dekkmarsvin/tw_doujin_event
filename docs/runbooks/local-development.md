# 本機開發與驗證

## 環境需求

- Node.js `24.20.0`（見 `.nvmrc`）
- npm `11.19.0`
- 公開 Pages 前台不需要 Cloudflare 帳號或 D1。本機 portal／地圖編輯使用 Wrangler 模擬的 D1／R2，不需要遠端資源；正式部署才需要 Cloudflare 帳號及設定。

## 啟動 Pages 前台

```bash
npm ci
npm run dev:pages
```

`predev:pages` 會自動把 `fixtures/events/sample` staging 到忽略版控的 `public/data/events/sample/`。因此新 checkout 不需要網路、真實活動資料或額外設定即可啟動。

第二個 fixture 可用 `npm run data:stage -- --fixture sample-two` staging；這用來驗證不同天數、area 與 template 的活動不會回退到 FF47 假設。

開發模式不註冊 Service Worker。要驗證 production bundle 與離線 shell：

```bash
npm run build
npm run preview
```

`npm run build` 同樣使用 fictional fixture。

## 啟動需要登入的 portal

`/circle` 與 `/organizer` 需要 Pages Functions、session、Turnstile 與收信路徑；只跑 `npm run dev:pages` 會讓 `/api/*` 被 Vite 當成前台 fallback，因此不能用來測登入。完整的本機隔離環境使用：

```bash
npm run dev:portal
```

這條命令會 build fictional `sample` fixture，再由 Wrangler 啟動 Pages Functions。`config/local-portal.env` 只包含可公開的本機測試值：Cloudflare 官方 always-pass Turnstile 金鑰、兩個 `.test` 收信地址、local D1 收信槽、loopback 縮圖來源，以及與 production 無關的 session／hash 字串。Wrangler 的 D1 與 R2 都維持 local mode，資料固定寫入 `.wrangler/local-portal`，不會碰到其他 Wrangler 本機資料；不會連到遠端 D1／R2，也不會寄出真實 email。這份設定不得用於 production。

伺服器預設位於 `http://127.0.0.1:8788`。另開一個 terminal 執行完整登入 smoke：

```bash
npm run smoke:portal
```

smoke 會實走 auth config → 匿名 session → request link → local D1 mail sink → verify → authenticated session → Organizer API，完成後只清除 `.wrangler/local-portal` 內的隔離測試資料。若要在瀏覽器登入，先保持伺服器執行，再取得一次性連結：

```bash
npm run portal:login-link
```

它只接受 loopback HTTP 伺服器，並將最新的一次性連結印在 terminal；不會略過任何驗證。預設是管理者的 `/organizer` 連結。

本機有兩個可收信的 `.test` 地址：`local-admin@example.test` 是管理者，`local-circle@example.test` 不是。需要社團與管理者同時登入的流程——認領審核、主辦邀請——用第二個地址取連結，在另一個瀏覽器 profile 或無痕視窗開啟：

```bash
npm run portal:login-link -- --email=local-circle@example.test --audience=circle
```

## 驗證真實活動資料

只有資料更新、release 或部署前需要這條路徑：

```bash
npm run data:fetch -- ff47
npm run data:stage -- ff47
npm run event-data:check
npm run build:production
```

`data:fetch` 只接受 `data/event-data-pins/ff47.json` 的完整 commit SHA，逐檔核對 SHA-256 後原子替換 `.event-data/ff47/`。`build:production` 會再次執行 fetch、生成 official-only catalog 並建立 production `dist`。

`.event-data/`、`.event-data-stage.json` 與 `public/data/events/` 都是本機／CI 產物，不進版控。

## Authoring 環境

地圖 authoring 在主辦單位工作區 `/organizer`，走 `npm run dev:portal` 起的本機隔離環境。獨立的本機 `/editor` 已依 [ADR-0049](../adr/0049-the-local-authoring-backup-is-withdrawn.md) 移除。流程見[地圖 authoring](./map-authoring.md)。

## 共同 gate

程式改動的完整 [gate](../../CONTEXT.md) 使用以下指令；本機驗證範圍依 [review-fix loop](../agents/review-loop.md#相稱的驗證)判斷，純說明文件檢查內容與連結即可。Required CI 仍照常執行。

```bash
npm ci
npm test
npm run lint
npx tsc --noEmit --incremental false
```

`npm test` 先以 fixture 建立 Pages build，再執行全部 Node 測試，確認：

- staged event、catalog v3 與 map 身分一致；
- 公開產物不含 Worker server bundle 或 authoring route；
- 閱讀端與 portal bundle 維持分離；
- Service Worker precache 指向當次 staged event；
- official base、社團 overlay、URL、地圖與 planning 契約一致。

### 開發途中只跑相關的測試

全套要跑幾分鐘，而且大部分時間花在需要 Miniflare D1 的那一層。改東西的當下不必每次跑完：

| 命令 | 跑什麼 | 需要 build |
|---|---|---|
| `npm run test:module` | 純模組測試（多數） | 否 |
| `npm run test:d1` | 需要 Miniflare D1 的 route 與 repository 測試 | 否 |
| `npm run test:cli` | 會另外開子行程跑 `scripts/` CLI 的測試 | 否 |
| `npm run test:artifact` | 檢查 `dist/` 產物的測試 | 是 |

分層不需要維護清單：tier 歸屬由 `scripts/run-tests.mjs` 讀每支測試自己的原始碼推導——讀 `dist/` 的是 artifact、`import "miniflare"` 的是 d1、`import "node:child_process"` 的是 cli，其餘是 module。新增測試檔不必登記到任何地方，也因此不可能有測試檔落在所有 tier 之外而到處都不跑。

### 瀏覽器驗收

`tests/browser/` 不屬於上述任何 tier，因為它需要瀏覽器；`npm test` 不會執行它。它有自己的入口：

| 命令 | 跑什麼 | 約略耗時 |
|---|---|---|
| `npm run test:browser` | 全部 journey；地圖以代表性尺寸（`1440x900` 與 `390x844`，標準字級） | 3 分鐘 |
| `npm run test:browser:matrix` | 同上，但地圖改跑完整 10 尺寸 × 3 字級矩陣 | 4 分鐘 |

`npm run test:browser` 自己處理所有前置：staging、啟動 Vite、等待相依預先打包完成、跑完後關閉伺服器。不需要另開 terminal，也不需要自行組 `MAP_TEST_URL`。

### journey 與它需要的資料

journey 放在 `tests/browser/*.mjs`，**不需要登記到任何清單**：runner 掃描該目錄，並從每支 journey 自己的原始碼讀出它需要哪一組 staged 資料，與 `scripts/run-tests.mjs` 推導 tier 的原則相同。檔案開頭宣告：

```js
// staged-data: fixture
```

| 宣告 | 環境 | 用途 |
|---|---|---|
| `pinned`（預設，可省略） | Vite + pinned FF47 | 真實 catalog 的尺寸、幾何與互動 |
| `fixture` | Vite + `sample` + `sample-two` | 真實資料不該有的情境：已移動／已取消攤位、有圖與無圖社團、多活動選擇器 |
| `portal` | `dev:portal` 的隔離環境 | 需要登入的流程：magic-link、認領、審核、編輯與發布 |

一次只能有一組資料，所以 runner 依宣告分組：先備妥並啟動一台伺服器跑完該組，再換下一組。即使某支 journey 失敗，其餘仍會跑完，最後一次回報全部失敗項目。

`portal` 組與 Vite 組是**不同的伺服器**：`/api/*` 只存在於 Pages Functions 底下，Vite dev server 會把登入請求當成前台 HTML fallback。runner 會自行 build `dist`、清空 `.wrangler/local-portal`，再用 `scripts/run-local-portal.mjs`（與 `npm run dev:portal` 同一支）啟動。

清空是必要的：帳號、認領、收信與**登入連結速率限制**都存在那個 D1。journey 會斷言「這個社團尚未被認領」並固定登入幾次，沿用上一輪的資料會第一次通過、之後因為與程式無關的原因失敗。

因此 `portal` journey 需要 8788 埠。若你自己的 `npm run dev:portal` 正在跑，runner 會直接停下並說明，不會半跑在你的資料上。

`pinned` 每次都重新下載並驗證目前 pin 的 FF47 資料，即使 `.event-data/ff47` 已存在，避免切換分支或更新 pin 後仍驗收舊資料；下載或驗證失敗即停止，不沿用舊資料繼續測試。因此 `pinned` 需要 GitHub 網路，`fixture` 則完全離線。

`portal` journey 使用 `config/local-portal.env` 的本機測試值（Cloudflare 官方 always-pass Turnstile 金鑰、保留的 `.test` 收信地址、local D1 收信槽），magic link 由本機收信槽取得，與 `npm run smoke:portal` 同一條路徑。安全性本身的驗證仍留在 `tests/circle-portal-route.test.mjs`：enumeration resistance、Turnstile/CSRF 檢查順序、rejected request 不寫 DB、claim 唯一性與競態、retention/刪除、token 不變式——這些 browser 證明不了，改用 browser 會是拿真實覆蓋換更慢更不穩的版本。

`fixture` journey 以攔截 `circles.json` 與 `overrides.json` 的方式供應情境資料，不修改 `fixtures/` 內任何檔案；圖片只接受 https，所以 journey 自行應答該來源，藉此區分「沒有圖」與「有圖但讀不到」。共用工具在 `tests/browser/support/`，該子目錄不會被當成 journey 執行。

瀏覽器**刻意不列入 `package.json`**——`npm ci` 與整套 Node 測試必須能在沒有瀏覽器的機器上執行。第一次跑之前安裝一次：

```bash
npm run test:browser:install
```

它使用 `--no-save`，所以不會動到 `package.json`；下一次 `npm ci` 之後需要重跑。已經有 Playwright 的話，改設 `PLAYWRIGHT_MODULE` 指向它即可。

代表性尺寸是 PR gate（CI 的 `Browser acceptance` job），完整矩陣是 QA／release 前的檢查。要對既有的伺服器或 preview 部署執行，設 `MAP_TEST_URL`；此時資料與伺服器由呼叫者負責，腳本不會 staging，因此**只會執行 `pinned` journey**——部署提供的是已發布活動，不是 fixture。`BROWSER_CHANNEL` 可改用系統安裝的 Chrome 通道。

使用共用 journey helper 的操作失敗時，`browser-report-<journey>.json` 保留原始錯誤，並附最多五個開啟頁面的畫面文字、失敗截圖路徑與最近二十筆請求結果。請求只記 method、path、status／網路錯誤，不記 query、headers 或 body；診斷取不到的項目如實標示，不覆蓋原始失敗。先用當時畫面與狀態判斷等待條件，再決定是否重跑。

**注意**：`npm run test:browser` 會改寫 staging（最後一組是 fixture `sample` + `sample-two`）。之後跑 `npm test` 會自動換回單一 fixture，但開發途中若直接執行 `npm run dev:pages`，看到的會是上一次驗收留下的 staging。

**交付前仍然要跑一次完整的 `npm test`**，分層只是開發途中的捷徑。

## 額外檢查

| 命令 | 何時執行 |
|---|---|
| `npm run build:production` | 更新 pin、release 或部署前；需要 GitHub 網路 |
| `npm run purge:dev` | 手動觸發 retention purge |

## 人工瀏覽器實測

`npm run test:browser` 已涵蓋地圖 viewport、選取、焦點與 URL 狀態的自動驗收。以下仍需人工操作，自動測試不取代：

- 桌機探索／行程左欄與詳情浮層，以及行動版探索／行程兩入口與獨立社團摘要；
- 鍵盤焦點、Escape 與焦點復原；
- 重新整理、分享網址與上一頁狀態恢復；
- 390px 下的收藏、行程與資料管理；
- production preview 的登入、認領與 overlay 顯示。
