# 資料匯入範圍

**實作**：[`app/planning-transfer.ts`](../../app/planning-transfer.ts)、[`app/planning-transfer-panel.tsx`](../../app/planning-transfer-panel.tsx)
**測試**：`tests/planning-transfer.test.mjs`

不同資料入口由各自契約定義，本文只提供索引，不另定一套比對、預覽或寫入流程。

| 入口 | 現行契約 |
|---|---|
| 讀者的完整 JSON 備份復原 | [收藏與走訪規劃：匯出與匯入分期](./planning.md#匯出與匯入分期)，包含格式、驗證、衝突處理與未匹配資料保留 |
| 接收分享行程 | [收藏與走訪規劃：分享行程](./planning.md#分享行程)，包含唯讀預覽、確認加入及私人欄位邊界 |
| 主辦匯入官方攤位資料 | [主辦單位工作區](./organizer-workspace.md)，使用獨立的官方名單格式與候選發布流程 |

讀者 CSV 匯入與外部服務授權／內容匯入仍未開放，分期依 [ADR-0005](../adr/0005-import-stays-p2-export-only.md) 及 [ADR-0078](../adr/0078-own-planning-backups-can-be-imported.md)。既有 parser 不代表公開介面已支援。

舊外部服務匯入提案中的 `ImportPreview`、身分比對、OAuth、批次紀錄及 CSV 往返要求，不是現行產品契約。[原提案保留於固定版本](https://github.com/dekkmarsvin/tw_doujin_event/blob/dbd0301227a8f89380ca8fd40ac09bea217c19f5/docs/contracts/data-import.md)，只供理解歷史取捨；重新啟動時需另立需求，依當時的實作與已接受決策評估，不以該提案直接驗收。
