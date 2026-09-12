# 本機開發與驗證

## 環境需求

- Node.js `24.20.0`（見 `.nvmrc`）
- npm `11.19.0`
- 公開 Pages 前台不需要 Cloudflare 帳號或 D1；只有地圖 authoring、portal 或部署操作需要 Cloudflare 資源。

## 啟動 Pages 前台

```bash
npm install
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

[gate](../../CONTEXT.md) 在本機是這四道指令：

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
| `npm run test:browser` | 代表性尺寸（`1440x900` 與 `390x844`，標準字級）與全部互動 journey | 30 秒 |
| `npm run test:browser:matrix` | 完整 10 尺寸 × 3 字級矩陣 | 90 秒 |

`npm run test:browser` 自己處理所有前置：staging pinned FF47、啟動 Vite、等待相依預先打包完成、跑完後關閉伺服器。不需要另開 terminal，也不需要自行組 `MAP_TEST_URL`。

瀏覽器**刻意不列入 `package.json`**——`npm ci` 與整套 Node 測試必須能在沒有瀏覽器的機器上執行。第一次跑之前安裝一次：

```bash
npm run test:browser:install
```

它使用 `--no-save`，所以不會動到 `package.json`；下一次 `npm ci` 之後需要重跑。已經有 Playwright 的話，改設 `PLAYWRIGHT_MODULE` 指向它即可。

代表性尺寸是 PR gate（CI 的 `Browser acceptance` job），完整矩陣是 QA／release 前的檢查。要對既有的伺服器或 preview 部署執行，設 `MAP_TEST_URL`；此時資料與伺服器由呼叫者負責，腳本不會 staging。`BROWSER_CHANNEL` 可改用系統安裝的 Chrome 通道。

**注意**：`npm run test:browser` 會把 staging 從 fixture 換成 FF47。之後跑 `npm test` 會自動換回 fixture，但開發途中若直接執行 `npm run dev:pages` 看到的會是 FF47。

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
