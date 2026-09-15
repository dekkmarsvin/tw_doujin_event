# ADR-0059：失敗發布退回修改必須是明確且可驗證的動作

- **狀態**：Accepted
- **日期**：2026-09-14
- **依據**：#242
- **延續**：[ADR-0057](./0057-approval-starts-create-publication.md)、[ADR-0058](./0058-publication-is-enforced-by-the-app-not-the-ruleset.md)
- **相關文件**：[主辦單位工作區契約](../contracts/organizer-workspace.md)、[資料 inventory](../contracts/data-inventory.md)

## 背景

發布工作可能在留下可確認 checkpoint 前就把遠端寫入送出，接著因 timeout 或網路錯誤失敗。只查空 branch 或空 PR 不能證明遠端沒有未完成的副作用；讓舊 job 自動回到編輯狀態也會使過期 retry 或延遲 delivery 重新發布舊 snapshot。

## 決策

### 1. 退回是人工明確動作

Owner 或 Admin 以有效 session 呼叫 `POST /api/organizer/events/:candidateId/reopen`，提供目前 `expectedVersion` 與非空、最多 1000 字的理由。Editor、過期 session、版本或狀態不符都拒絕。這是內容恢復操作，不受 `ORGANIZER_PUBLICATION_MODE=disabled` 阻擋。

### 2. 先取得既有全域 lease，再查核固定遠端狀態

重開使用 publication 共用的 `global` lease，但維持 failed job 的狀態。伺服器固定查核 `dekkmarsvin/tw_doujin_event-data` 的 `organizer/{jobId}/data` 與 `dekkmarsvin/tw_doujin_event` 的 `organizer/{jobId}/main`，PR 查詢包含所有狀態與完整 pagination。任一 branch、open／closed／merged PR、403、網路錯誤、格式錯誤或不完整回應都拒絕；查核期間 lease 過期也拒絕。呼叫者不能提供 repository、URL、branch 或權限範圍。

### 3. D1 CAS 保留歷史並隔離舊工作

只有 candidate 仍是 failed、目前版本、`approved_at` 非 NULL，匹配的 failed job 七個 confirmed checkpoint 與 `remote_write_intent_at` 都是 NULL，且同一 lease token 仍有效時，才在一個 batch 內：遞增 candidate version、改為 `changes_requested`、清除目前核准、插入 revision 與理由 review、令舊 job `retryable=0`、插入 audit，最後只釋放自己的 lease。event ID lock、snapshot、reviews、job metadata 與 error 都保留。任何 CAS 失敗不新增 business row 或 audit。

### 4. Sticky remote intent 與 publication fencing

`remote_write_intent_at` 是 nullable timestamp，獨立於已確認的 PR／SHA／workflow checkpoint。driver 第一次遠端 mutation 前必須 await 目前 lease/version/approval 的 CAS callback，並在每次 mutation 前再次 assert lease；timeout、錯誤、retry 或空查核都不清除 intent。有 intent 的工作不能 reopen。retry、lease claim 與 checkpoint/failure update 都以 candidate current version、approval 與狀態再次 fencing，延遲舊 executor 不能復活已退回的 snapshot。

既有 job 的 NULL 採用前提是本次 rollout 已確認 production publication driver 尚未啟用，沒有未記錄 intent 的舊 driver 遠端寫入；NULL 不是通用的歷史無副作用證明。未來啟用的 driver 必須先遵守上述 callback 與 lease 契約。已有退回紀錄時，部署回退也必須保留版本與 retry fencing，不能讓舊工作重新取得發布資格。

## 結果

- Organizer 可以在真正未開始的 failed approval 上留下理由並回到可編輯版本，舊發布證據仍可追溯。
- 空 remote audit 只在固定 scope、完整回應與同一 lease 下才是清楚證據；不確定性會 fail closed。
- 這是一次人工內容恢復流程，不是 rollback、排程自動返回或新的分散式交易框架。正式 publication driver 仍維持 disabled，啟用前需以 intent、競態與 stale delivery 測試證明 fencing。
