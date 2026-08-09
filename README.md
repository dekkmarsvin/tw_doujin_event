# FF47 場刊 MAP

Fancy Frontier 47 的同人展逛攤地圖。介面把社團搜尋、SVG 攤位地圖、收藏分組、備註與每日行程整合在同一個工作區，並支援桌面與行動版。

目前的規劃資料保存在瀏覽器 `localStorage`，不會跨裝置同步。活動地圖由管理介面辨識配置圖，可再微調攤位、柱子、出入口、企業攤與舞台等向量元素，通過驗證後發布至 Cloudflare D1；開發階段的管理員身分與寫入權限尚未實作，請勿把未受保護的 PUT route 公開部署。

## 環境需求

- Node.js `>=22.13.0`
- npm
- 本機開發不需要預先建立 D1；`vite.config.ts` 會模擬 `.openai/hosting.json` 宣告的 `DB` binding

## 啟動

```bash
npm install
npm run dev
```

開啟終端顯示的本機網址。第一次使用且 D1 尚無已發布地圖時，從頁首右上角的「管理」選擇 `data_source_test/FF47社團攤位配置圖.jpg`，確認辨識結果後發布；前台之後會透過 `GET /api/events/ff47/map` 取得版本化 SVG layout。

## 驗證與資料庫

```bash
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run db:generate
```

`npm test` 會先建立 production build，再執行所有 Node 測試。Drizzle schema 位於 `db/schema.ts`，migration 位於 `drizzle/`。

## 專案結構

- `app/event-map-app.tsx`：搜尋、地圖、詳情與行程工作區
- `app/accessible-event-map-renderer.tsx`：可用鍵盤操作的 SVG 地圖 renderer
- `app/planning-store.ts`：版本化本機收藏與行程狀態
- `app/map-recognition.ts`：配置圖辨識與發布前驗證
- `app/api/events/[eventId]/map/route.ts`：活動地圖讀寫 route
- `data_source_test/`：本專案引用的 FF47 公開整理資料與配置圖測試輸入
- `PRODUCT.md`、`DESIGN.md`、`docs/`：產品、互動、資料及分期契約

## 目前邊界

- 一般使用者公開瀏覽；管理寫入權限仍是部署前必做項目。
- 收藏、群組、備註與行程只儲存在目前瀏覽器。
- 安全匯出已提供；JSON／CSV 匯入、帳號同步與協作仍屬 P2，尚未在一般介面開放。
- 外部來源只補充內容與可核對連結，不取代本地社團及攤位身分。
