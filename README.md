# 場刊 Map

同人展逛攤地圖。介面把社團搜尋、SVG 攤位地圖、收藏分組、備註與每日行程整合在同一個工作區，支援桌面與行動版。

公開閱讀的 reviewed base 是**純靜態**的：場刊與地圖以版本化 JSON 快照隨 build 發布，由靜態邊緣直接服務。社團自填資料則由公開的 Pages Function overlay 疊加；overlay 無法讀取時仍顯示完整 base。另有一個獨立入口 `/circle` 供參展社團登入並維護補充資料，由 `functions/` 與 D1 承載。publication 與離線邊界見[交付與離線契約](docs/contracts/delivery-and-offline.md)。

正式公開網站：<https://map.kotoban.top/>。一般閱讀與社團入口皆可公開到達；一般讀者不需登入，社團端仍以 Turnstile、email 一次性連結與應用程式權限保護。Pull request 與不可變 preview deployment 則繼續由 Cloudflare Access 閘控，決策見 [ADR-0029](docs/adr/0029-public-production-gated-preview.md)，實際設定與驗證方式見[部署 runbook](docs/runbooks/deployment.md#cloudflare-accessproduction-公開preview-閘控)。

地圖辨識與細部編輯器是本機 authoring 工具，不是公開 Pages 入口的一部分。

## 快速開始

需要 Node.js `>=22.13.0` 與 npm。公開前台不需要 Cloudflare 帳號或 D1。

```bash
npm install
```

```bash
npm run dev:pages
```

交付前的共同 gate：

```bash
npm test && npm run lint && npx tsc --noEmit --incremental false
```

完整說明見[本機開發與驗證](docs/runbooks/local-development.md)。

要回報問題或送出改動，請先閱讀[貢獻指南](CONTRIBUTING.md)與[行為準則](CODE_OF_CONDUCT.md)。

## 文件

| 想知道 | 去哪裡 |
|---|---|
| 產品要解決什麼、給誰用、邊界在哪 | [PRODUCT.md](PRODUCT.md) |
| 介面的視覺與版面規則 | [DESIGN.md](DESIGN.md) |
| 這個詞在本專案是什麼意思 | [CONTEXT.md](CONTEXT.md) |
| 各模組現在的行為與驗收條件 | [docs/contracts/](docs/contracts) |
| 怎麼更新資料、發布地圖、部署 | [docs/runbooks/](docs/runbooks) |
| 怎麼回報問題與貢獻程式碼 | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 為什麼當初這樣決定 | [docs/adr/](docs/adr) |

完整索引見 [docs/README.md](docs/README.md)。

## 常用流程

| 要做的事 | 文件 |
|---|---|
| 主辦活動資料有變動，要更新場刊 | [社團資料更新](docs/runbooks/catalog-data-update.md) |
| 要重新產生地圖快照 | [地圖 authoring](docs/runbooks/map-authoring.md) |
| 首次部署、改密鑰、回滾 | [部署](docs/runbooks/deployment.md) |

> 社團 ID 由版本化 registry 配發且永不重算；更新場刊時必須審閱 `data/circle-identities/` 的 `allocations.json` 與 `evidence.json` 差異。規則見 [ADR-0010](docs/adr/0010-circle-identity-is-an-allocated-serial.md)；舊 `ff47-<hash>` ID 的對照表與相容路徑已移除，見 [ADR-0013](docs/adr/0013-drop-the-legacy-circle-id-compatibility-path.md)。

## 專案結構

**閱讀端**

- `app/event-map-app.tsx`：搜尋、地圖、詳情與行程工作區
- `app/event-url-state.ts`、`app/event-workspace-projection.ts`：多活動 URL round-trip 與桌機／手機／地圖共用的衍生狀態
- `app/accessible-event-map-renderer.tsx`：可用鍵盤操作的 SVG 地圖 renderer
- `app/circle-records.ts`：社團與配置的型別、索引與讀取模型投影
- `app/circle-search.ts`、`app/advanced-circle-search.tsx`：探索搜尋與詳細搜尋
- `app/planning-store.ts`：版本化本機收藏與行程狀態
- `app/static-*-client.ts`：靜態快照讀取與格式驗證
- `app/service-worker-source.js`、`scripts/build-service-worker.mjs`：離線 shell 與 build 時產生的 precache 清單

**社團控制面**

- `circle.html`、`app/circle-portal/`：社團入口與介面
- `app/circle-portal-handlers.ts`、`db/identity-repository.ts`：與框架無關的 route 與 D1 查詢層
- `app/circle-overrides.ts`：補充資料的型別、驗證與長度上限，寫入端與閱讀端共用
- `functions/`：Pages Functions（身分、認領、編輯、管理，以及公開的 `overrides.json`）

**資料與產物**

- `fixtures/events/`：不含真實活動資料的共同 build／test fixtures
- `data/event-data-pins/`：公開 data repo 的不可變 commit 與逐檔 hash
- `data/circle-identities/`：永久社團 ID 配號、官方 booth evidence 與裁決紀錄
- `public/fonts/`：自託管 Geist / Geist Mono 字型與授權
- `scripts/fetch-event-data.mjs`、`stage-event-data.mjs`：驗證 pin 並建立忽略版控的單一活動 staging tree
- `scripts/build-official-circle-catalog.mjs`：由主辦攤位資料與 identity evidence 生成 official-only catalog
- `.event-data/`、`public/data/events/`：本機／CI 產物，不進版控

**本機 authoring（不部署到 Pages）**

- `app/map-recognition.ts`、`app/editor/`、`app/map-layout-editor.tsx`
- `db/event-map-repository.ts`、`worker/`、`drizzle/`

**設定**

- `vite.pages.config.ts`、`wrangler.jsonc`：Pages 純靜態 build 與部署設定
- `public/_headers`：CSP、權限政策與快取規則
- `.github/workflows/deploy-pages.yml`：驗證、preview 與 production 自動部署
