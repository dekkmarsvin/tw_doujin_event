# 攤位群組匯入驗證（2026-09-14）

對應 [#213](https://github.com/dekkmarsvin/tw_doujin_event/issues/213) 與[攤位匯入契約](../contracts/organizer-workspace.md#攤位匯入)。這是當日驗證紀錄；即時交付狀態以 issue 為準。

## 資料與環境

- Windows、本機 `npm run dev:portal`、Codex 內建瀏覽器，桌面約 1270 × 714。未執行正式發布。
- 隔離本機候選活動 `issue-213-ch20`，名稱 `#213 CH20 匯入驗收`；使用本機既有客家文化中心 5F 空間測試匯入，**不是 CH20 真實場館設定的驗收**。
- 從 [CH20 官方攤位列表](https://ch.gjs.tw/circle-list.html) 讀取 170 列，保存兩欄 CSV（編號、社團名稱）；未整理代碼。
- 當日網頁中「艾」的代碼是 `B15B6`（CSV 來源第 26 列），五字元不能依三字元切分。這份當日來源與 issue 描述的可直接拆成 202 碼之原始 CSV 不同。

## 瀏覽器操作結果

1. 對應攤位與社團欄位後，預設 single 模式當場提示可能存在連寫攤位，候選寬度為 3。
2. 選 fixed-width 後，字元數仍空白；點「確認使用建議的 3 個字元」才套用。
3. 未修改的當日來源預覽為 **169 列 → 200 個代碼、1 列待修正**。第 26 列顯示原值與無法拆分的錯誤，儲存按鈕 disabled。已直接檢視此畫面。
4. 僅在本機預覽輸入 `B15B16` 並離開欄位，模擬主辦更正；結果 **170 列 → 202 個代碼、0 列待修正**。這不是官方更正確認，不可據此修改正式資料。
5. 點儲存成功；重新載入頁面，已存清單仍顯示 **170 列、202 個代碼**。
6. 搜尋 `A02` 得到單一 `A01、A02` 群組與同一社團名稱；可搜尋群組的第二碼。
7. 清空搜尋，第一頁 100 列、第二頁 70 列；第二頁末列為 `S07、S08`。倒序後第一列為 `S07、S08`，並回到第一頁。
8. 選擇活動日與使用空間，仍正確顯示該範圍的 170 列。此候選只有一日、一空間，跨範圍隔離另由自動測試覆蓋。
9. 直接檢視搜尋與完整清單畫面；清單表格高度限制為 420px、可捲動，每頁最多 100 列。未執行 20,000 列瀏覽器效能量測，也未驗收手機版。

## 自動驗證

- 最終 `npm test`：658 / 658 通過；`npm run lint`、`npx tsc --noEmit`、`node scripts/check-doc-map.mjs --check` 與 `git diff --check` 通過。
- 群組拆分、寬度確認、分隔符、不可整除、群組內／跨群組重複，以及合成 170 群組／202 碼回歸資料。
- D1 群組往返、舊 nullable 欄位保留字面代碼、API 拒絕無效群組且不改寫既有匯入。
- authoring scope 展開群組、Reader preview 每碼同名、送審 snapshot `/2` 保存群組。
- 驗證訊息可由群組第二碼定位正確活動日、空間及來源列；既有 FF47 投影測試沿用。

## 驗收界線

當日官網資料需要主辦核對第 26 列，因此不把本機模擬更正記成「原始 CSV 未經修改直接得到 202 碼」。實作沒有猜測或自動修補該值。正式 CH20 資料、更正後重新匯入與發布交付不由這份本機紀錄宣告完成。下方另記後續獨立驗證，不改寫上方原始操作紀錄。

## 後續：大量清單與跨範圍驗證

應用程式版本 `70a905153d2d88c9460afc97540e5bbfc617c9ae`，Windows、Edge/Chromium `153.0.4234.32`、1600 × 1000。新 journey `tests/browser/portal-organizer-import.mjs` 在真實登入的隔離 portal 使用明確的 **synthetic response**，提供 20,000 群組／20,001 碼、兩個活動日與兩個空間。它驗證已存清單 UI，不代表實際上傳 20,000 列或完成 D1 寫入。

[同輪報告](assets/organizer-import-2026-09-14/browser-report-portal-organizer-import.json)時間為 `2026-09-14T08:45:16.016Z`，5 項檢查通過，0 page errors：

- [第一頁](assets/organizer-import-2026-09-14/organizer-import-page-1.png)與[第二頁](assets/organizer-import-2026-09-14/organizer-import-page-2.png)各 100 列；首碼分別為 A00001、A00201。
- 連續操作「下一頁」到[第 200 頁](assets/organizer-import-2026-09-14/organizer-import-page-200.png)，仍為 100 列，首尾為 B19803／B20000，下一頁停用。
- 改為[代碼倒序](assets/organizer-import-2026-09-14/organizer-import-sort-desc.png)後回第一頁，首碼 B20000。
- 活動日篩選得到 10,000 列，再限 B 空間得到 5,000 列；[搜尋第二碼](assets/organizer-import-2026-09-14/organizer-import-filtered-second-code.png) B01235-SECOND 得到唯一群組，仍顯示完整兩碼、第一天及 B 空間。

上述檢查沒有更正、覆蓋或使用 CH20 正式名單。未量測完整匯入管線效能，也不代表手機／真機驗收。

另一位未參與實作的 tester 直接檢視同輪五張截圖，清單欄位、完整第二碼、頁碼與篩選結果均可讀，未見重疊或裁切。第一頁截圖未涵蓋位於 viewport 下方的分頁控制項，其可到達性由實際 browser click 驗證；其餘頁面可直接看到控制項。這是獨立看圖結果，不冒稱該檢查者重走了流程。

## 後續：獨立 FF47 前後投影比較

另一位未實作攤位群組功能的 tester，以獨立 worktree 比較 PR #247 前的 `a68524b` 與 `70a9051`。兩邊都重新 fetch、stage 並檢查真實 FF47 pin：`dekkmarsvin/tw_doujin_event-data@8c645303fa6838383549fbe8433ece081c514e1e`，8 個輸入檔的 SHA-256 全部符合 pin。

[前版報告](assets/organizer-import-2026-09-14/ff47-before.json)、[後版報告](assets/organizer-import-2026-09-14/ff47-after.json)及[比較結果](assets/organizer-import-2026-09-14/ff47-comparison.json)保留完整 hash。兩邊 staging 都是 1,340 社團／2,953 配置；event、circles、map、reference-records 的輸出 bytes 相同。實際呼叫各版 Reader projection，三日各為 987／983／983 筆 records 與 slots，canonical projection SHA-256 均為 `dc5c7698342429b291871399133b3d813226d32625bcabd7e7dda3fdc557f1e2`。

這份證據使用真實 FF47 資料與各版程式，不以 sample fixture 的投影測試替代；沒有操作 production、D1 或 CH20。保留[當次比較程式](assets/organizer-import-2026-09-14/verify-ff47-reader.mjs.txt)供重現：複製為 repository 內暫存 `.mjs`，對兩個已 stage FF47 且已安裝依賴的 worktree 分別傳入 `--workspace`、`--output`；再以 `--compare --before <report> --after <report> --output <result>` 比較。當次 runtime 為 Node 24.20.0。

## 後續共同 gate 的本機限制

本機完整 `npm test` 初次為 656/658；兩個 D1/workerd 測試於約 520 秒後因 `SocketError: other side closed` 失敗。程式碼不變，兩個失敗測試各以 Node 24.20.0 單獨重跑皆通過；lint、TypeScript、doc-map 與 diff check 通過。完整測試的 npm 主程序是 11.19.0／Node 24.20.0，但未前置 PATH，子程序仍使用系統 Node 24.11.1，因此不能把它當成指定 runtime 的一次全綠；PR 必須另有同 head、指定版本的完整 CI 成功紀錄。
