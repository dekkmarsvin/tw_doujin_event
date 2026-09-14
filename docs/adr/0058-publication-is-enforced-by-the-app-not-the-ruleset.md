# ADR-0058：發布的強制點在 App adapter，ruleset 不作為必要閘門

- **狀態**：Accepted
- **日期**：2026-09-13
- **依據**：#212、#227、#104
- **部分取代**：[ADR-0046](./0046-approved-organizer-publications-may-merge-app-owned-pull-requests.md) 的三處——(a) 決策第 4 點（Repository ruleset 是第二道強制邊界）與該點附帶的「兩個 ruleset 經 API 實測完成前 production merge feature flag 必須保持關閉」全數失效；(b) 決策第 3 點條件 5「repository ruleset 要求的所有 checks 已成功」，其 required checks 的權威來源改為程式常數 `PUBLICATION_REQUIRED_CHECKS`（條件本身仍成立，改由 App adapter 驗證）；(c)〈結果〉第一句的「ruleset 仍決定可否合併」。決策第 1、2、5 點與第 3 點的其餘七項條件不變
- **延續**：ADR-0046 第 3 點的八項合併充分條件、[ADR-0057](./0057-approval-starts-create-publication.md) 的核准即發布

## 背景

`Organizer publication approval` 這個 check **只由 publication job 自己的 App 建立**（`app/github-publication.ts` 的 `createApprovalCheck`）。repository 裡沒有任何 workflow 會產生它。

把它列為 `dekkmarsvin/tw_doujin_event` 的 required status check，等於要求每一個 PR 都帶著一個只有發布流程才會出現的 check。一般人類 PR 永遠等不到它回報，因此永遠無法合併。ADR-0046 第 4 點寫下這條要求時沒有處理這個後果。

決策時的實測狀態：

- `dekkmarsvin/tw_doujin_event` ruleset `22001248`：active、`~DEFAULT_BRANCH`、只有 `deletion` 與 `non_fast_forward`、`bypass_actors` 為空。
- `dekkmarsvin/tw_doujin_event-data` ruleset `21704741`：active、有 `pull_request` 與 `data / check`、`bypass_actors` 為空。
- GitHub App `tw doujin map pilot`（App ID `4931208`、installation `161391064`）已安裝於且僅於上述兩個 repository，權限為 metadata 唯讀加上 actions、checks、contents、pull requests 的讀寫，未取得 Workflows。

專案目前由一位維護者經營，首次真實發布尚未完成。

## 決策

### 1. 合併前的強制檢查在 App adapter 執行

`mergeOwnedPullRequest()` 在合併前逐項驗證六件事：PR 仍為 open、base 為 `main`、head branch 等於 `organizer/{jobId}/{stage}`、head SHA 等於 job 記錄的 `expectedHeadSha`、PR 作者為 bot 帳號（`user.login` 以 `[bot]` 結尾），以及 `["Organizer publication approval", ...requiredChecks]` 中的每一項都在同一個 head SHA 上以 `conclusion === "success"` 完成。任一項不成立即失敗關閉。

**已知缺口**：作者檢查只確認 PR 由某個 bot 帳號建立，沒有比對本 App 的 app id、slug 或 installation，因此不等於 ADR-0046 第 3 點開頭的「App 只能合併同一 publication job 自己建立的 PR」。第 5 點重新評估時必須把這個缺口一併列入。

ADR-0046 第 3 點的八項充分條件完全保留，但不是全部落在這個 adapter：條件 1（snapshot hash）、7（publication lease）與 8（data 先於 main）由 `app/organizer-publication.ts` 的 driver 維持，adapter 負責條件 2、3、4、6 與條件 5 的比對。本決策改變的只是條件 5 的權威來源——required checks 由第 2 點的常數定義，不再要求 repository ruleset 同時強制同一組 checks。

### 2. required checks 由程式定義

`PUBLICATION_REQUIRED_CHECKS` 是這組檢查的唯一定義。目標值為：

```text
data  →  data / check
         Organizer publication approval

main  →  Verify and deploy
         Full preview portal E2E
         Browser acceptance
         Organizer publication approval
```

`Browser acceptance` 是本決策新增的目標項，已在 #245 driver 切片將 #227 A 落地，寫進 `app/publication-rollout.ts` 的 `PUBLICATION_REQUIRED_CHECKS.main`。名稱必須與 workflow 的 job name 逐字相符。

實作要注意 `Full preview portal E2E` 在 push 事件下的 conclusion 是 `skipped`，只有 PR 事件會實際執行；adapter 驗的是 PR head SHA，因此檢查對象正確，但不得把 `skipped` 當成通過。

### 3. ruleset 偏差降為維運報告

`publicationRolloutProblems()` 從「啟用發布的前置閘門」降為**維運報告**：它列出 ruleset 現況與偏差供維護者判斷，不阻擋任何 publication 步驟，也不是開啟 `ORGANIZER_PUBLICATION_MODE` 的必要條件。

依 #227，偵測範圍擴大到所有 `actor_type`，不再只看 `Integration`，並拆成兩個 code：`app_bypasses_ruleset`（App 自己可繞過，設定錯誤）與 `human_bypasses_ruleset`（人類 actor 可繞過，治理選擇）。兩者都是報告項目。

### 4. 開啟 production publication 的前置

取代 ADR-0046 第 4 點原本的 ruleset 前置，改為：

1. GitHub App 已安裝於且僅於 `dekkmarsvin/tw_doujin_event` 與 `dekkmarsvin/tw_doujin_event-data`。
2. App 權限限於 Contents、Pull requests、Checks、Actions 與必要的唯讀 metadata，未取得 Workflows。
3. App 不在任一 active ruleset 的 bypass 清單中。
4. App ID、installation ID、private key 與 webhook secret 已設定，且可實際簽出 installation token。
5. data → main → deployment → Pages production origin smoke 的順序與 blocking 性質不變。

ADR-0046 第 4 點原本要求三件事，其中兩件在此不再要求：

- data repository 的 active ruleset 增加 `Organizer publication approval` check；
- main repository ruleset 必須啟用，且要求 PR、`Verify and deploy`、`Full preview portal E2E` 與 `Organizer publication approval`——**連「要求 PR」這條規則本身也不再要求**，`22001248` 目前正好沒有 `pull_request` rule。

保留的是第三件「GitHub App 不得列為 bypass actor」，即上面第 3 項。ADR-0046 標頭沿用 ADR-0037 的「不可繞過 repository ruleset」仍然有效：App 不以管理權限繞過任何現存規則，改變的是不再要求 ruleset 先帶齊這些規則。

### 5. 這是單人維護期間的邊界，不是終局

本決策成立的前提是：repository 目前只有一位維護者、App 是唯一會自動合併的身分、首次真實發布尚未完成，而權限管控的優先序低於把發布閉環走通。

前提改變時——新增維護者，或首次發布與一次可恢復 failure 都已驗收——應重新評估是否把 ruleset 恢復為第二道強制邊界。屆時必須一併解決本 ADR 背景描述的那個問題：一般人類 PR 要如何滿足 `Organizer publication approval`，例如由 workflow 對非 `organizer/**` head 的 PR 直接回報成功。

## 結果

- 一般 PR 不會因為發布機制而被鎖死，日常開發與 Wave 0／Wave 1 自己的 PR 都能正常合併。
- **失去 ADR-0046 第 4 點的第二道邊界。** 若 App 憑證外洩，repository ruleset 不會再擋住它；殘餘風險由 ADR-0046 第 3 點的八項條件（其中 snapshot hash、lease 與 data 先於 main 由 driver 維持）、path allowlist 與 audit 承擔，而第 1 點的作者檢查只認 bot 帳號、不綁定本 App 身分。這個風險是明確接受的，不是疏漏。
- ADR-0046 第 4 點的「flag 保持關閉」不再是阻擋首次發布的條件；`ORGANIZER_PUBLICATION_MODE` 仍預設 `disabled`，由第 4 點的五項前置決定何時開啟。
- `publicationRolloutProblems()` 目前沒有 runtime caller，本決策使這個狀態成為刻意的設計而非待補的接線。
