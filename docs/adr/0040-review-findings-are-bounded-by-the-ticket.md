# ADR-0040：review 發現以 ticket 範圍與已記錄的威脅模型為界

- 狀態：已定案（2026-08-30）
- 延續：[ADR-0039](./0039-one-data-repo-for-events-and-references.md) 的 single-maintainer 前提
- 相關 issue：[#116](https://github.com/dekkmarsvin/tw_doujin_event/issues/116)、[#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104)
- 相關 PR：[#128](https://github.com/dekkmarsvin/tw_doujin_event/pull/128)（未合併關閉）、[#129](https://github.com/dekkmarsvin/tw_doujin_event/pull/129)
- 相關流程：[review-fix 迴圈守則](../agents/review-loop.md)

## 問題

[#128](https://github.com/dekkmarsvin/tw_doujin_event/pull/128) 在 26 小時內跑了 12 輪 `@codex review` → `fix:`，產生 16 條 review thread，其中 15 條以 `Fixed in <sha>` 結案，0 條被拒絕。issue [#116](https://github.com/dekkmarsvin/tw_doujin_event/issues/116) 要的是「本機 identity 配號與 evidence 產生器」；PR 收斂時已包含 repository-wide 交易 journal、跨行程寫入鎖、stale-PID 接管、quarantine rename 與子行程存活偵測。人工重做的 [#129](https://github.com/dekkmarsvin/tw_doujin_event/pull/129) 通過同一組驗收條件只需 +713/−150、15 檔，#128 是 +1352/−188、18 檔。

三個結構成因：

1. **規格沒有進入迴圈。** review 比對的是 `HEAD` 與 base 的 diff，不是 diff 與 ticket 的差距。#116 寫了「非目標」與 8 條驗收條件、母票 #104 的標題就是 single-maintainer，但沒有任何一輪引用它們。同一個 reviewer 卻主動引用了 `AGENTS.md` 的行號——它讀 repo 文件，只是沒有 ticket 脈絡。
2. **審查面積隨修補單調成長。** 第 6 輪為了滿足第 5 輪的 finding 而新增 `scripts/event-onboarding-lock.mjs`；其後 4 條 finding 全部針對這個檔案。迴圈在審查自己的產物，`d(面積)/d(輪)` 為正就不會自然收斂。
3. **被要求的性質不可達。** 需求在第 3 輪由 #116 寫的「任一步失敗保持原狀」悄悄升級為「任意 instruction boundary 被終止、任意兩行程交錯都不留下不一致狀態」，而工具只有本機 POSIX rename。最後一條未解決的 finding（父行程 PID 已死但子行程仍在寫）證明了這點：要修就得加 child lease → heartbeat → timeout，每一層都有自己的窗口。沒有不動點的迴圈不會停。

缺的不是更好的 reviewer，是**讓「這不在範圍內」成為有依據、可引用、且比修還便宜的結論**。

## 決策

### 1. 資料維運指令的威脅模型：單一維護者、單一序列執行

`scripts/` 下的資料維運指令（`event:onboard`、`data:fetch`、`data:stage`、`event-data:check`，以及 catalog builder 與 identity registry 相關腳本）假設同一時間只有一位維護者、在本機依 runbook 順序執行一條指令。

明確**不**假設：多行程並發執行、CI 並行呼叫、任意 instruction boundary 被外部終止後仍可自動回復。

可回復性的界線是：

- **指令自己回報的失敗**（驗證失敗、rename 失敗、下載失敗）必須保持原狀，兩個 registry 檔不得成為混合狀態。這是 #116 就寫下的要求，仍然有效。
- **被外部終止的指令**以「用同一 event ID 與同一 commit 重跑同一條指令」復原，不承諾自動 crash recovery。

### 2. review finding 的處置以 ticket 為界

任何 review finding 在修補前必須先通過範圍關卡，判準與流程見 [review-fix 迴圈守則](../agents/review-loop.md)。落在威脅模型之外的 finding 不是 bug，處置是記錄與拒絕，不是修補。

### 3. review 觸發的修補不得新增模組或子系統

修補只能就地改既有檔案。需要新檔案、新概念或新原語的，代表它不是這張 ticket 的修補，另開 issue 走 triage。

### 4. 迴圈有熔斷條件

每張 PR 最多 3 輪 review-fix；另外，只要某輪 finding 指向的檔案在 `main` 上不存在，立即停止——那代表迴圈在審查自己的產物。任一條件觸發時交回維護者裁定，不得自動續跑。

### 5.「不修」是合法且必須留下紀錄的結果

repo 既有的 `wontfix` 語彙延伸到 review thread。拒絕必須寫在 thread 上並註明理由與依據（ticket 的哪一條非目標、或本 ADR 的哪一節），不是靜默忽略。

### 6. 推翻第 1 點需要新的 ADR

若日後真的引入 CI 並行、多人同時維運或自動化排程觸發資料指令，威脅模型即失效，屆時以新 ADR 定案並補上對應機制。**不得由單一 review thread 決定改變威脅模型**——#128 正是這樣發生的。

## 後果

- #128 的並發類 finding 從此有可引用的駁回依據，不必逐條辯論。它們描述的行為在本 ADR 的威脅模型下不是缺陷。
- 已知且接受的風險：`main` 目前不具備跨行程互斥。同時執行兩條資料維運指令、或在 rename 之間終止指令，可能留下需要人工判讀的中間狀態。復原方式是重跑同一條指令；runbook 的順序要求因此是必要的，不是建議。
- 代價明確：本 ADR 用「縮小承諾」換「可收斂」。若前提改變而沒有及時寫新 ADR，這裡的每一條都會變成沒有依據的樂觀假設。前提改變的訊號是：資料指令開始由 CI 或排程觸發、或維護者不只一人。
- reviewer 的權重順序被承認：它引用 repo 文件而不是 PR 內文。因此範圍邊界要寫在 ADR 與 `AGENTS.md`，PR 模板的「範圍邊界」欄位是輔助，不是唯一依據。

## 不在本 ADR 範圍

- 不規定 review 工具的選擇，也不假設特定 reviewer 的實作。
- 不改變 `docs/README.md` 的維護規則、triage 標籤語彙或 issue 表單。
- 不追認或否定 #128 分支上任何個別修補的技術正確性；它們多數在自己的假設下成立，只是假設不在範圍內。

## 未決

- 熔斷的 3 輪上限是依 #128 觀察（漂移始於第 3 輪、第 6 輪起完全脫離 ticket）取的值，不是量測結果。累積幾張 PR 後再回頭校正。
