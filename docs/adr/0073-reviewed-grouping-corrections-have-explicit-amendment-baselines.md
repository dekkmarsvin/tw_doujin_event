# ADR-0073：已核准的身分整合以固定紀錄承接修正基準

- 狀態：已定案（2026-09-28）；維護者接受修復方案並授權實作。
- 延續：[ADR-0071](./0071-organizer-review-confirms-cross-day-circle-grouping.md)、[ADR-0069](./0069-restored-unpublished-amendments-retain-failed-history.md)。

## 問題

ADR-0071 授權 PF45×RF14 的一次公開身分整合。資料與 main 經 PR 審核更新，但 Organizer 的歷史核准快照與 published job 正確地保留原版本。修正入口只接受原 job pin，因此無法從整合後的公開資料開始修正。這與其他活動的發布鎖無關。

## 決策

1. `data/organizer-baseline-adoptions.json` 是隨程式部署的承接允許清單。每筆固定來源 candidate／version／job／snapshot／approval hash／data 與 main commit，以及目標 main commit、完整 pin 的 canonical hash、分組與本活動身分證據的 canonical hash、授權 PR 與 ADR。空清單不啟用任何承接；瀏覽器不能提供、選取或修改紀錄。
2. 本次只支援 `reviewed-cross-day-grouping`。伺服器核對原 pin／核准檔案，確認新舊檔案範圍相同且只有分組檔可變；目標 pin 必須等於固定 main commit 中的 pin，分組及本活動身分證據必須符合記錄。目前公開 data commit、Reader catalog 與目前 main 的本活動證據也必須一致。無紀錄、歧義、未知差異均拒絕，不因讀取失敗退回較弱檢查。
3. `organizer-amendment-baseline/2` 將承接紀錄及其 hash 固定在 baseline，`source` 仍保留原 published job；`pin`／`grouping`／`evidence` 表示承接後的基準。不改寫舊快照、job 或其 checkpoint，也不偽造一次 published job。既有 `/1` 的來源與 pin 一致性規則不變。
4. 新格式沿用既有 D1 baseline JSON、AMEND `/4` snapshot、審核、發布與恢復流程。Worker 以核准 snapshot 內固定的承接證明驗證產物，不重新依目前允許清單解讀歷史核准。承接後的修正成功發布時，下一次修正回到新 published job 的一般 `/1` 基準，不遞迴攜帶舊 baseline。
5. 其他活動推進 main、增加 allocations 或身分證據不阻擋本活動建立修正。發布階段仍核對本活動 pin／身分／退出歷史，並使用最新全域 allocations；既有 publication lease 不變。
6. 部署先交付可讀 `/1` 與 `/2` 的 Pages／publication Worker，確認 Worker active version 後，才以第二個 PR 加入 PF45 承接紀錄。已有 `/2` 候選後，回滾也必須保留新格式的讀取能力。這不授權自動修改正式活動內容或省略核准。

## 後果

不用新增 D1 schema、Cloudflare 產品、排程或管理者操作介面。只在建立承接基準時多讀固定 Git 檔案；公開 Reader 不增加請求。紀錄只承接本次已核准例外，沒有一般匯入、回滾或身分合併 API。部署與真實活動驗收證據留在對應 PR。
