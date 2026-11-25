# 文件索引

後端已依 [#546](https://github.com/dekkmarsvin/tw_doujin_event/issues/546) 重寫完成。`docs/adr/` 與 `docs/design/history/` 只是歷史。

| 我想知道… | 去哪裡 |
|---|---|
| 產品要解決什麼、給誰用 | [`PRODUCT.md`](../PRODUCT.md) |
| 這個詞在本專案是什麼意思 | [`CONTEXT.md`](../CONTEXT.md) |
| 色彩、字體、層級 | [`DESIGN.md`](../DESIGN.md)、[元件與介面規格](./design/components.md) |
| 介面上該寫什麼字 | [對外文案](./design/copy.md) |
| 前端現在的行為 | 下方「現行契約」 |
| 後端要提供哪些 API、重寫後各自保留或刪除 | [後端 API](./api.md) |
| 怎麼做某件事 | 下方「流程」 |
| 對使用者承諾了什麼 | [隱私權與個人資料蒐集告知](./policy/privacy-notice.md) |
| Issue 怎麼開、標籤怎麼用 | [`agents/`](./agents) |

## 現行契約

描述前端現在的行為，可驗收。改了行為就在同一個 commit 更新。

| 文件 | 涵蓋 |
|---|---|
| [Reader](./contracts/reader.md) | 社團目錄與來源標示、活動地圖、搜尋與篩選、逛品書、收藏與行程、URL 狀態、資料傳輸與離線、匯入範圍 |
| [社團入口](./contracts/circle-portal.md) | `/circle`：登入、認領、可編輯範圍、預覽、分享、活動後退出、保存與刪除 |
| [主辦工作區](./contracts/organizer-workspace.md) | `/organizer`：活動申請、建置冊、匯入、地圖與地圖編輯器、修正宣告、送審與發布 |
| [管理入口](./contracts/admin.md) | `/admin`：審核、帳號、網站營運設定、共用資料 |
| [資料 inventory](./contracts/data-inventory.md) | 本站持有哪些資料、存在哪裡、保存多久。仍描述 #546 之前的資料表，待更新 |

## 流程

| 文件 | 何時用 |
|---|---|
| [本機開發與驗證](./runbooks/local-development.md) | 啟動、跑測試 |
| [地圖 authoring](./runbooks/map-authoring.md) | 更新地圖時 |
| [部署](./runbooks/deployment.md) | 密鑰、CI 行為、回滾 |
| [首次啟用](./runbooks/first-time-setup.md) | 從零建 Cloudflare 資源 |
| [排程清除 Worker](./runbooks/retention-purge-worker.md) | 部署或驗證保存期限清除 |

## 歷史（不再更新）

- [ADR](./adr/INDEX.md)：到 2026-11-21 為止的架構決策。之後的決策寫在 GitHub issue。
- [`design/history/`](./design/history)：過去的設計提案。
- [`research/`](./research)：外部產品的觀察紀錄。
