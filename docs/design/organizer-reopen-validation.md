# 失敗發布候選退回修改：2026-09-14 驗證

範圍為 [#242](https://github.com/dekkmarsvin/tw_doujin_event/issues/242) 與 [ADR-0059](../adr/0059-failed-publication-requires-explicit-reopen.md)。此輪使用隔離的本機候選，未退回、重試或發布真實 CH20；publication mode 維持 disabled。正式活動操作由 [#212](https://github.com/dekkmarsvin/tw_doujin_event/issues/212) 保存。

## 交易與權限

`tests/organizer-reopen-handlers.test.mjs` 的 27 個案例通過：fresh Owner／Admin、Editor 拒絕、過期 session、理由與版本驗證、狀態／checkpoint／intent／全域 lease、遠端查核不明，以及查核後發生版本競態。拒絕不留下部分 revision、review 或 audit；成功推進版本、清除目前核准並保留活動代碼及舊工作歷史。publication disabled 不阻止這個內容修正動作。

`tests/organizer-reopen.test.mjs` 的 5 個案例通過，包含真正 executor 的兩種延遲情境：

- 已記錄 remote-write intent 後，遠端呼叫尚未完成、lease 過期；退回仍被拒絕，延遲回應不能抹除 intent。
- executor 尚未取得寫入授權時，另一個合法退回已完成；舊 executor 恢復後不能寫入遠端，mutation counter 為 0，新版本與舊 job 的不可重試狀態保留。

`tests/github-remote-auditor.test.mjs` 的 5 個案例通過，涵蓋固定兩個 repository／branch、分支存在、已刪分支但 closed／merged PR 仍存在、不完整回應及 token mint 逾時。GitHub 的 [PR listing](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests) 支援 `state=all` 與 `owner:branch` 的 head filter；單靠 [branch lookup](https://docs.github.com/en/rest/branches/branches#get-a-branch) 找不到分支不構成可退回證據。

## 瀏覽器整合證據

此文件隨附的是提交前整合檢查：`2026-09-14T10:57:26.37Z`，Edge `153.0.4234.32`，隔離的 `http://127.0.0.1:8790/organizer`。報告明確記錄基準 `d487a36e242317289ff14bea55a54e41dbd1498e` 與 `sourceDirty: true`，不能代替最終 PR head 的驗收。

專用 journey `tests/browser/portal-organizer-reopen.mjs` 以 synthetic session／candidate／API response 操作真實 UI，8 個 checks 通過、browser errors 為 0。它證明畫面與互動；D1、權限及 GitHub 查核由上述測試另行驗證。截圖與 [browser report](./assets/organizer-reopen-2026-09-14/browser-report-portal-organizer-reopen.json) 來自同一輪。

| 情境 | 證據 |
| --- | --- |
| 未填理由不能送出 | [理由必填](./assets/organizer-reopen-2026-09-14/organizer-reopen-owner-required.png) |
| 等待時停用退回，避免重複請求 | [等待](./assets/organizer-reopen-2026-09-14/organizer-reopen-owner-pending.png) |
| 成功後舊工作顯示為歷史且沒有 retry 入口 | [完整歷史區塊](./assets/organizer-reopen-2026-09-14/organizer-reopen-owner-history.png) |
| 新版本可繼續編輯、活動代碼仍鎖定 | [可編輯狀態](./assets/organizer-reopen-2026-09-14/organizer-reopen-owner-editable.png) |
| Admin session 過期提供重新登入連結 | [重新登入](./assets/organizer-reopen-2026-09-14/organizer-reopen-admin-fresh-login-error.png) |
| 遠端查核 503 顯示錯誤，沒有偽造退回成功 | [遠端查核錯誤](./assets/organizer-reopen-2026-09-14/organizer-reopen-remote-audit-error.png) |
| Editor 不顯示退回控制 | [Editor](./assets/organizer-reopen-2026-09-14/organizer-reopen-editor-hidden.png) |
| 已知發布開始時不能送出退回 | [已有處理紀錄](./assets/organizer-reopen-2026-09-14/organizer-reopen-started-remote-record.png) |

最終提交 SHA、同 head CI、提交後的同輪 browser report／截圖及 agy／Astra review 結果保存在 #242 對應 PR 的驗收紀錄。合併前必須重新核對這些 gate；本文件不宣告尚未執行的最終 review 或正式活動驗收完成。
