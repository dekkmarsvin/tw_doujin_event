# ADR-0069：還原未公開修正後，保留失敗紀錄並重新送審

- 狀態：已定案（2026-09-24）；維護者已在 [#366](https://github.com/dekkmarsvin/tw_doujin_event/issues/366) 核准此恢復範圍。
- 延續：[ADR-0059](./0059-failed-publication-requires-explicit-reopen.md)、[ADR-0068](./0068-published-event-settings-are-declared-amendments.md)。0059 的無遠端產物 reopen 條件不變。

## 問題

AMEND 的 data PR 已合併，但 main PR 尚未合併時，產物可能不符合核准 snapshot。此時原公開 pin 仍有效，舊 job 必須停止；清空 checkpoint、重用核准或直接改 D1 都會失去可追溯性。既有 reopen 只處理沒有遠端產物的失敗，不能承接這個狀態。

## 決策

1. 恢復只適用於目前核准版本的 failed AMEND：data PR 已合併，main PR 已建立但尚未合併，沒有 deployment workflow checkpoint，且原公開基準仍有效。不延伸成 CREATE、已公開版本或任意步驟的回滾。
2. 維護者在 data repo 建立獨立還原 PR，經既有 `data / check` 後以單一 parent 的 squash commit 合併。內容只把該活動目錄還原至原公開 pin，其他活動與共用 reference 不得被還原。原 main PR 必須關閉且未合併，原 main 分支必須仍指向固定 head；原 PR、checkpoint 與 snapshot 均保留，恢復不刪除既存分支。data repo 既有的合併後自動刪除分支可以使原 data ref 不存在，此時仍須核對原 merged PR 的固定 head／merge SHA；不是以不存在的分支推論沒有遠端副作用。
3. Admin 在工作區提供還原 PR 編號與原因。伺服器取得既有 global publication lease，以固定 repository 的唯讀 GitHub API 核對原 PR 身分、核准 hash、head／merge SHA、還原 PR 的檢查與完整 tree、目前 data main 的活動內容、共用 reference 及目前 main 的公開 pin。不完整、未知、分歧的證據一律拒絕。
4. 核對後以同一 D1 batch 重新檢查 Admin 權限、版本、checkpoint、基準 hash 與有效 lease，將 candidate 改為唯讀終態 `abandoned`，顯示「已終止修正」，釋放同活動的 active AMEND 唯一性限制。舊 job 仍為 failed，只固定 `retryable=0`；snapshot、error、intent、metadata 與所有 checkpoint 不清除。review 及 `organizer.amendment.abandoned` audit 在同一交易保留原因、還原證據與來源。
5. 從已發布來源建立新的修正候選，重新載入目前公開基準、驗證、預覽、送審及核准，產生新的 snapshot 與 job。GitHub 讀取與 D1 不能跨服務原子提交；global lease 排除應用程式發布競爭，新候選與後續發布仍各自驗證遠端基準。恢復不授權下一次發布，也不讓舊 delivery 復活。

## 後果

恢復需要一次受控的維護者資料還原與 Admin 核對，不能算零人工補救。若原公開基準已改變、共用 reference 分歧、main 已合併或遠端結果不明，候選維持鎖定，由維護者另行判斷。此流程不新增服務、secret、排程或通用 rollback 機制。
