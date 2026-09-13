# ADR-0057：核准即開始首次發布

- 狀態：Accepted
- 日期：2026-09-13
- 依據：#212；延續 ADR-0046 的安全邊界

Organizer 負責內容，Maintainer 負責必要審核，System 負責發布。管理者的「核准並發布」同時同意 immutable snapshot 公開並建立唯一 publication；不增加第二個人工 Publish 動作。允許 self approval，沿用 fresh session 與稽核。

首次發布是 CREATE：已存在的 eventId 必須拒絕，不能 overwrite 或自動猜成 amendment。#190 的 amendment 需要明確的 published baseline 與重新送審，不由本次 CREATE 自動轉換。

publication failure 保留內容鎖定與核准，不能回 draft 或 changes_requested。Owner 與全域管理者可重試 retryable failure，永遠使用原 snapshot 與原 publication job；已完成的 data、main、deployment checkpoint 不重建。

UI 使用準備活動資料、更新公開資料、部署網站、確認公開結果四個階段。技術錯誤與內部狀態放在技術詳細資訊。只有 Pages production origin smoke 成功，才能標示 published 及送審與發布區段完成；custom domain smoke 為 advisory。

第一次啟用仍須完成 ADR-0046 的 App、ruleset、GitHub adapter 與實際 production smoke 驗證。在執行器尚未接線的環境，核准並發布明確禁用、API 回 503，不能再建立永遠等待的核准工作。既有 approved/queued 記錄保留，啟用時必須以原 job 恢復。

不做 scheduled publication、embargo 或另一個人工發布流程。
