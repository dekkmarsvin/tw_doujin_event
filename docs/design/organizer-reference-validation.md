# #248 主辦與分類驗收

2026-09-14，本機隔離 Pages Functions／D1，測試帳號 `local-admin@example.test`。所有名稱、來源與分類均為測試資料，未操作 production CH20。

本輪以實際 UI 完成建立候選、填來源、建立主辦、建立兩項分類、選取、儲存與重新載入。非 HTTPS 主辦來源遭拒絕；將唯一主辦改為合作夥伴時，儲存顯示必須恰好一個主辦，既有內容未被覆写。恢復 lead 後繼續日期與場館步驟，預覽顯示固定主辦／分類與正式場館名稱「爭艷館展區」，選單維持「全館」。

- [儲存結果](./assets/organizer-references-2026-09-14/references-saved.png)
- [缺少 lead 的拒絕](./assets/organizer-references-2026-09-14/references-lead-required.png)
- [canonical reference 預覽](./assets/organizer-references-2026-09-14/references-canonical-preview.png)

自動回歸 journey：`tests/browser/portal-organizer-references.mjs` 使用真實本機登入／API／D1，沒有 mock reference API。權限、鎖定狀態、stale version、部分寫入、分類歸屬、完整 snapshot/hash 與 parser 邊界由 `tests/organizer-handlers.test.mjs` 檢查。

獨立 review 與同 head CI 結果記在本切片 PR。此證據只接受 #248 的工程交付，不表示 CH20 已發布，也不替代 #212 正式發布／failure-retry 驗收。
