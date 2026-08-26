# 場刊 Map

同人展逛攤地圖。介面把社團搜尋、SVG 攤位地圖、收藏分組、備註與每日行程整合在同一個工作區，支援桌面與行動版。

公開閱讀的 reviewed base 是**純靜態**的：場刊與地圖以版本化 JSON 快照隨 build 發布，由靜態邊緣直接服務。社團自填資料則由公開的 Pages Function overlay 疊加；overlay 無法讀取時仍顯示完整 base。另有一個獨立入口 `/circle` 供參展社團登入並維護補充資料，由 `functions/` 與 D1 承載。publication 與離線邊界見[交付與離線契約](docs/contracts/delivery-and-offline.md)。

正式公開網站：<https://map.kotoban.top/>。一般閱讀與社團入口皆可公開到達；一般讀者不需登入，社團端仍以 Turnstile、email 一次性連結與應用程式權限保護。Pull request 與不可變 preview deployment 則繼續由 Cloudflare Access 閘控，決策見 [ADR-0029](docs/adr/0029-public-production-gated-preview.md)，實際設定與驗證方式見[部署 runbook](docs/runbooks/deployment.md#cloudflare-accessproduction-公開preview-閘控)。

地圖辨識與細部編輯器是本機 authoring 工具，不是公開 Pages 入口的一部分。

## 網站使用方式

### 一般參觀者：公開閱讀端

開啟 <https://map.kotoban.top/> 後：

1. 先選活動日期與展區，再搜尋社團、攤位或作品；「詳細搜尋」可依創作者、作品類型與分級縮小結果。
2. 從搜尋結果或地圖攤位開啟社團資訊。兩個入口共用同一筆收藏、備註與行程狀態；地圖可拖曳、縮放，也支援方向鍵與 Enter／空白鍵操作攤位。
3. 「收藏」、「加入行程」與「設為下一站」是三個獨立動作。行程可排序、記錄購買項目與預算，並在「導航模式」只看當日預定攤位與已走訪狀態；本站不做 GPS 定位或自動路徑推算。
4. 收藏群組、備註與行程只存在目前瀏覽器。「資料管理」可匯出 JSON／CSV 備份；一般網頁尚未提供匯入或跨裝置同步。

同一份精簡說明也可由網站右上角的「使用說明」開啟。詳細行為見[搜尋契約](docs/contracts/search.md)、[活動地圖契約](docs/contracts/event-map.md)與[規劃契約](docs/contracts/planning.md)。

### 參展社團與地圖貢獻者：`/circle`

- 社團在 <https://map.kotoban.top/circle> 通過真人驗證並以 email 一次性連結登入，認領社團後補充販售資訊、連結、代表圖與作品標籤。送出前會以閱讀端元件預覽；社團名稱、攤位與日期仍由主辦資料決定，無法在此修改。
- 經管理者另外授權的地圖貢獻者，登入同一控制面後可建立私人地圖草稿、綁定官方來源檔並送審。核准與匯出只產生 event-data 候選，不會直接發布公開地圖。

完整邊界見[社團自助控制面契約](docs/contracts/circle-portal.md)與[地圖貢獻控制面契約](docs/contracts/map-contributions.md)。

### 維護者：本機地圖 authoring

`npm run dev` 的 `/editor` 可從既有 revision、配置圖辨識結果或空白地圖開始，並以「新增一排」或個別元素編輯一般攤位、柱子、出入口與非一般攤位區。來源說明會進入快照；發布本機 revision 後仍須匯出到 event-data repository 並經 diff、schema 與 review。逐步操作見[地圖 authoring runbook](docs/runbooks/map-authoring.md)。

## 功能狀態

| 範圍 | 現況 |
|---|---|
| 公開場刊與地圖 | **已實作**：FF47 是目前唯一正式活動；公開端提供搜尋、詳細搜尋、互動地圖、分享 URL 與離線 shell。|
| 收藏與走訪規劃 | **已實作**：收藏群組、備註、行程、下一站、已走訪、購買項目、預算、導航模式與 JSON／CSV 匯出。資料只存於目前瀏覽器。|
| 社團自助維護 | **已實作**：登入、認領、預覽、補充資料、代表圖、保存期限、活動後退出、自助刪除與管理者撤下。|
| 地圖貢獻控制面 | **已實作基礎流程**：角色授權、私人 revision、官方來源檔、送審、核准替換與 event-data 候選匯出。錨定推算、留言串與局部修改請求尚未實作。|
| 本機地圖 authoring | **已實作**：可從既有 revision、辨識結果或空白畫布開始，建立整排與個別地圖元素；仍需本機 D1 與 repository review。|
| 規劃資料匯入、外部服務、跨裝置同步 | **P2，未對外開放**：底層已有 JSON／CSV 解析與衝突預覽，但一般介面只有安全匯出。|
| 詳細搜尋進階語意 | **部分實作**：創作者、作品、原創／二創與分級可用；多主題 AND／OR、排除主題與命中原因仍未實作。|

目前 open issues 是待辦或待決策的追蹤面，不等於都已承諾實作：其餘五個場館官方編目 [#85](https://github.com/dekkmarsvin/tw_doujin_event/issues/85)、地圖貢獻效率與協作 [#86](https://github.com/dekkmarsvin/tw_doujin_event/issues/86)、本機 editor 效率 [#87](https://github.com/dekkmarsvin/tw_doujin_event/issues/87)、東西向出入口 [#88](https://github.com/dekkmarsvin/tw_doujin_event/issues/88)、發布地圖 provenance 的必要性評估 [#89](https://github.com/dekkmarsvin/tw_doujin_event/issues/89)，以及自動產生 pin [#90](https://github.com/dekkmarsvin/tw_doujin_event/issues/90)。其中 #86、#89 仍需先釐清需求或價值；ADR-0035 的整體方向也仍是草稿，只有空白畫布、來源說明與排原語的第一階段已落地。

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

- `app/map-recognition.ts`、`app/map-admin-importer.tsx`、`app/map-layout-editor.tsx`
- `db/event-map-repository.ts`、`worker/`、`drizzle/`

**設定**

- `vite.pages.config.ts`、`wrangler.jsonc`：Pages 純靜態 build 與部署設定
- `public/_headers`：CSP、權限政策與快取規則
- `.github/workflows/deploy-pages.yml`：驗證、preview 與 production 自動部署
