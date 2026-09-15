# #248 主辦與分類驗收

2026-09-14，本機隔離 Pages Functions／D1，測試帳號 `local-admin@example.test`。所有名稱、來源與分類均為測試資料，未操作 production CH20。

本輪以實際 UI 完成建立候選、填來源、建立主辦、建立兩項分類、選取、儲存與重新載入。非 HTTPS 主辦來源遭拒絕；將唯一主辦改為合作夥伴時，儲存顯示必須恰好一個主辦，既有內容未被覆写。恢復 lead 後繼續日期與場館步驟，預覽顯示固定主辦／分類與正式場館名稱「爭艷館展區」，選單維持「全館」。

- [儲存結果](./assets/organizer-references-2026-09-14/references-saved.png)
- [缺少 lead 的拒絕](./assets/organizer-references-2026-09-14/references-lead-required.png)
- [canonical reference 預覽](./assets/organizer-references-2026-09-14/references-canonical-preview.png)

自動回歸 journey：`tests/browser/portal-organizer-references.mjs` 使用真實本機登入／API／D1，沒有 mock reference API。權限、鎖定狀態、stale version、部分寫入、分類歸屬、完整 snapshot/hash 與 parser 邊界由 `tests/organizer-handlers.test.mjs` 檢查。

以上截圖取自 journey 對應 assertion 完成後的真實畫面；缺少主辦的錯誤先捲入畫面再擷取。獨立 review 發現「全部類別」為 Reader 保留名稱，建立及選取現在共用 Reader 分類驗證並有拒絕／無部分寫入回歸。

獨立 review 與同 head CI 結果記在本切片 PR。此證據只接受 #248 的工程交付，不表示 CH20 已發布，也不替代 #212 正式發布／failure-retry 驗收。

## 2026-09-15：舊場館來源補齊（#212 / PR #261）

真實 CH20 的既有三重場館／全館已有 metadata 與來源 URL，但缺 canonical reference；唯讀 production 查核 `changes=0, rows_written=0`。本切片以隔離 local portal 的虛構 legacy venue 重現，所有保存驗收經 Chrome UI。

- 選取並儲存 legacy 場館後，場館 readiness 為需要處理，下一步指向補齊表單。
- HTTP URL 保存被拒；輸入公開名稱與 HTTPS 來源後分別保存場館、使用空間。
- 完成後補齊表單消失，場館已完成、攤位匯入可開始；目錄仍顯示舊友善名稱。
- Reader 預覽顯示「一樓展場・正式場館名稱」，只剩該虛構活動尚未匯入／製圖的預期阻擋。
- 證據：[核對表單](assets/legacy-venue-references-2026-09-15/explicit-source.png)、[公開名稱預覽](assets/legacy-venue-references-2026-09-15/canonical-preview.png)。截圖皆為本機保留 .test 帳號，不代表 CH20 已發布。
- 程式驗證：handlers＋venue catalog 23/23；提示定位小改後重驗對應 regression 1/1；build、typecheck、affected lint 通過。Production 的 UI 補齊與完整發布驗收仍由 #212 記錄。
