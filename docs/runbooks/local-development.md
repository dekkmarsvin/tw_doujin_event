# 本機開發與驗證

## 環境需求

- Node.js `>=22.13.0`
- npm
- **公開 Pages 前台不需要 Cloudflare 帳號或 D1。** 只有要更新地圖靜態快照時，才需要本機 authoring D1。

## 啟動公開前台

```bash
npm install
```

目前 checkout 仍帶著過渡資料；[#38](https://github.com/dekkmarsvin/tw_doujin_event/issues/38) 搬移完成後，以 pin 取得真實活動資料：

```bash
npm run data:fetch -- ff47
```

命令只讀 `data/event-data-pins/ff47.json` 的完整 commit SHA，逐檔核對 SHA-256，成功後原子替換 `.event-data/ff47/`。hash 不符或下載不完整時不會留下半份資料。UI-only 開發與共同 gate 最終會改用 repo 內的最小 fixture，不要求網路。

```bash
npm run dev:pages
```

開啟終端顯示的本機網址。前台會從 `public/data/events/ff47/map.json` 讀取已驗證的地圖快照，並從 `public/data/events/ff47/circles.json` 讀取社團與攤位快照。

`npm run dev:pages` **不註冊 Service Worker**，開發時不會有快取擋在前面。要驗證離線行為請改用：

```bash
npm run build && npm run preview
```

## 啟動 authoring 環境

地圖辨識與細部編輯器是本機 authoring 工具，跑在另一個 dev server 上：

```bash
npm run dev
```

它不是公開 Pages 入口的一部分。流程見[地圖 authoring](./map-authoring.md)。

## 驗證 gate

以下四道是所有交付的共同 gate，CI 也跑同一組：

```bash
npm ci
```

```bash
npm test
```

```bash
npm run lint
```

```bash
npx tsc --noEmit --incremental false
```

`npm test` 會先建立 Pages production build，再執行所有 Node 測試。測試會確認：

- `dist/index.html`、靜態地圖與社團快照存在。
- 公開產物不含 `_worker.js` 或 server bundle。
- 主 bundle 不含場刊資料字面值。
- 社團入口的程式碼不出現在閱讀端 bundle。
- `dist/sw.js` 的 precache 清單涵蓋所有離線必要檔案。

完整的產物邊界見[資料傳輸與離線契約](../contracts/delivery-and-offline.md#驗收條件)。

## 不在共同 gate 裡的檢查

| 命令 | 何時執行 | 為什麼不在 gate 裡 |
|---|---|---|
| `npm run source:check` | 懷疑上游試算表有更新時 | 需要對外網路 |
| `npm run official:check` | 懷疑主辦官網攤位清單有更新時 | 需要對外網路 |
| `npm run data:fetch -- ff47` | 要取得 pin 指向的真實活動資料時 | 需要 GitHub 網路；共同 gate 改以 fixture 執行 |
| `npm run purge:dev` | 要手動觸發一次排程清除時 | 是獨立部署單位的本機執行，不是測試；清除邏輯本身由 `tests/retention-purge.test.mjs` 涵蓋 |

用法見[社團資料更新](./catalog-data-update.md)。identity registry 與產物一致性已由共同 build 內的 `catalog:check` 驗證；場刊與官網的一致性由 `official:agreement` 驗證，它是離線的，所以留在 gate 裡。

## 測試必須涵蓋的資料形狀

社團來源資料是人工填寫的試算表，因此測試資料必須包含這些真實存在的髒值：

- 尾端空白與連續空白。
- 逗號合併的複合標籤（例如「R18, 一般」）。
- 跨語別的同義作品名。
- 一筆社團同時標成多種分級。
- 分級未知。
- 同名但實為不同社團。

## 瀏覽器實測範圍

自動測試不涵蓋版面與手勢，交付前仍需實際操作：

- 桌機三區工作台、1050px 詳情浮層、760px 四頁籤行動面板。
- 鍵盤焦點：對話框開啟／Tab 圈限／Escape 關閉／焦點復原。
- 重新整理與瀏覽器上一頁的狀態恢復。
- 390px 下的收藏、行程與資料管理流程。
