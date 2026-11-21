# 文件索引

後端重寫中（[#546](https://github.com/dekkmarsvin/tw_doujin_event/issues/546)）：新工作以 #546 為準，標為**凍結**的文件只描述舊實作，不再更新。

| 我想知道… | 去哪裡 |
|---|---|
| 產品要解決什麼、給誰用 | [`PRODUCT.md`](../PRODUCT.md) |
| 這個詞在本專案是什麼意思 | [`CONTEXT.md`](../CONTEXT.md) |
| 色彩、字體、層級 | [`DESIGN.md`](../DESIGN.md)、[元件與介面規格](./design/components.md) |
| 介面上該寫什麼字 | [對外文案](./design/copy.md) |
| 前端現在的行為 | 下方「現行契約」 |
| 怎麼做某件事 | 下方「流程」 |
| 對使用者承諾了什麼 | [隱私權與個人資料蒐集告知](./policy/privacy-notice.md) |
| Issue 怎麼開、標籤怎麼用 | [`agents/`](./agents) |

## 現行契約

描述前端現在的行為，可驗收。改了行為就在同一個 commit 更新。

| 文件 | 涵蓋 |
|---|---|
| [社團目錄](./contracts/circle-catalog.md) | 社團身分、領域模型、資訊密度、來源標示 |
| [活動地圖](./contracts/event-map.md) | layout 不變量、renderer 邊界、互動與縮放 |
| [收藏與走訪規劃](./contracts/planning.md) | 收藏／群組／行程、備份與復原、短網址分享 |
| [品書瀏覽](./contracts/catalog-browse.md) | 品書入口、日期與場地範圍、瀏覽位置恢復 |
| [搜尋、篩選與顯示設定](./contracts/search.md) | 三組條件的責任切分、詳細搜尋 |
| [URL 檢視狀態](./contracts/url-state.md) | 查詢參數與恢復規則 |
| [地圖編輯器](./contracts/map-editor.md) | 主辦工作區的地圖畫布操作 |
| [資料匯入範圍](./contracts/data-import.md) | 收藏與行程備份的匯入入口 |
| [資料傳輸與離線](./contracts/delivery-and-offline.md) | 載入行為、Service Worker、快取標頭（#546 階段 3 會改寫） |

## 凍結的後端契約

舊後端的規格，在 #546 中隨對應程式一起刪除。只用來理解現況，不作為新需求的依據。

- [社團自助控制面](./contracts/circle-portal.md)
- [主辦單位工作區](./contracts/organizer-workspace.md)
- [網站營運設定](./contracts/site-settings.md)
- [地圖貢獻控制面](./contracts/map-contributions.md)
- [資料 inventory](./contracts/data-inventory.md)
- [共享 reference 選擇](./contracts/reference-selection.md)

## 流程

| 文件 | 何時用 |
|---|---|
| [本機開發與驗證](./runbooks/local-development.md) | 啟動、跑測試 |
| [社團資料更新](./runbooks/catalog-data-update.md) | 活動資料或 data pin 有變動時 |
| [地圖 authoring](./runbooks/map-authoring.md) | 更新地圖時 |
| [部署](./runbooks/deployment.md) | 密鑰、CI 行為、回滾 |
| [首次啟用](./runbooks/first-time-setup.md) | 從零建 Cloudflare 資源 |
| [排程清除 Worker](./runbooks/retention-purge-worker.md) | 部署或驗證保存期限清除 |

## 歷史（不再更新）

- [ADR](./adr/INDEX.md)：到 2026-11-21 為止的架構決策。之後的決策寫在 GitHub issue。
- [`design/history/`](./design/history)：過去的設計提案。
- [`research/`](./research)：外部產品的觀察紀錄。
