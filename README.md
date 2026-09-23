# 場刊 Map

台灣同人活動的互動場刊與攤位地圖，整合社團搜尋、收藏、備註與每日行程，支援桌面與行動瀏覽器。

## 使用入口

| 使用者 | 入口與目前可完成的事 |
|---|---|
| 一般參觀者 | [公開網站](https://map.kotoban.top/)：選擇活動、搜尋社團與攤位、查看地圖、收藏與安排每日行程；不需登入。 |
| 參展社團 | [社團入口](https://map.kotoban.top/circle)：以 email 一次性連結登入，認領後維護介紹、作品標籤、連結與代表圖，預覽公開結果或刪除補充資料。 |
| 主辦單位 | [主辦工作區](https://map.kotoban.top/organizer)：由管理者建立候選活動並邀請負責人，在桌機上設定日期與場館、匯入 CSV／XLSX 並維護攤位清單、編輯地圖、檢查、預覽及送審；管理者核准後由系統執行發布。 |
| 網站管理者 | [管理入口](https://map.kotoban.top/admin)：認領審核、撤下補充資料、管理者名單、停用帳號與地圖審閱／候選匯出；未登入時先到社團入口登入。活動核准與發布仍在主辦工作區。 |

收藏與行程只存在目前瀏覽器，可匯出 JSON／CSV 備份；一般介面尚未提供匯入或跨裝置同步。已下載的場刊與地圖支援離線閱讀。

已發布活動以 [published-events.json](data/published-events.json) 為準。主辦[首次發布](https://github.com/dekkmarsvin/tw_doujin_event/issues/212)與[發布後更正](https://github.com/dekkmarsvin/tw_doujin_event/issues/190)均已有實際交付紀錄；驗收仍保留工程補救與人工操作紀錄。

另外授權的地圖貢獻者可在社團入口維護私人草稿，核准匯出後仍需經資料發布流程，見[地圖貢獻契約](docs/contracts/map-contributions.md)。

## 快速開始

使用 Node.js `24.20.0` 與 npm `11.19.0`（[.nvmrc](.nvmrc)、[package.json](package.json)）。

```bash
npm ci
npm run dev:pages
```

這會啟動含測試活動資料的公開閱讀端，不需要 Cloudflare 帳號或 D1。測試登入及主辦工作區使用 `npm run dev:portal`；設定與驗證指令見[本機開發與驗證](docs/runbooks/local-development.md)。

## 專案結構

| 路徑 | 職責 |
|---|---|
| `app/` | 閱讀端、社團入口、主辦工作區、管理入口及共用領域模組 |
| `functions/` | Cloudflare Pages Functions：身分、認領、編輯、管理及公開補充資料端點 |
| `db/` | D1 schema、repository 與資料清除 |
| `workers/` | 獨立部署的發布排程與保存期限清除 Worker |
| `scripts/` | Build、資料產生與驗證、測試及維運命令 |
| `data/` | 已發布活動清單、資料 pin、社團身分配號等版控狀態；活動原始資料在獨立的 data repository |
| `fixtures/`、`tests/` | 測試活動、模組測試與瀏覽器旅程 |
| `public/` | 靜態資產與 Pages 標頭；`public/data/events/` 是 staging 產物 |
| `docs/` | 契約、操作流程、設計、決策及歷史證據 |

## 文件與貢獻

- [產品定義](PRODUCT.md)：使用者、任務、優先範圍與完成定義。
- [文件索引](docs/README.md)：依問題查找契約、設計、流程及 ADR。
- [貢獻指南](CONTRIBUTING.md)與[行為準則](CODE_OF_CONDUCT.md)：回報問題及提交變更。
- [GitHub issues](https://github.com/dekkmarsvin/tw_doujin_event/issues)：目前工作、依賴與進度。
