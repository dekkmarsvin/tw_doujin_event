# 本機開發與驗證

## 環境需求

- Node.js `>=22.13.0`
- npm
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

```bash
npm run dev
```

地圖辨識、細部編輯器與本機 D1 不屬於公開 Pages build。流程見[地圖 authoring](./map-authoring.md)。

## 共同 gate

```bash
npm ci
npm test
npm run lint
npx tsc --noEmit --incremental false
```

`npm test` 先以 fixture 建立 Pages build，再執行 Node 測試，確認：

- staged event、catalog v3 與 map 身分一致；
- 公開產物不含 Worker server bundle或 authoring route；
- 閱讀端與 portal bundle 維持分離；
- Service Worker precache 指向當次 staged event；
- official base、社團 overlay、URL、地圖與 planning 契約一致。

## 額外檢查

| 命令 | 何時執行 |
|---|---|
| `npm run build:production` | 更新 pin、release 或部署前；需要 GitHub 網路 |
| `npm run purge:dev` | 手動觸發 retention purge |
| `npm run map:snapshot -- <event-id> <data-repo-map.json>` | 從本機 authoring D1 匯出地圖到 data repo |

## 瀏覽器實測

自動測試不取代以下實際操作：

- 桌機三區工作台與行動版四頁籤面板；
- 鍵盤焦點、Escape 與焦點復原；
- 重新整理、分享網址與上一頁狀態恢復；
- 390px 下的收藏、行程與資料管理；
- production preview 的登入、認領與 overlay 顯示。
