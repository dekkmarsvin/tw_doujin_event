# ADR-0066：required status check 不綁定產生者時，ruleset 擋不住持有 checks 寫入權的 App

- **狀態**：Accepted
- **日期**：2026-09-20
- **依據**：[ADR-0058](./0058-publication-is-enforced-by-the-app-not-the-ruleset.md) 第 5 點的重新評估觸發、#232、#227、#212
- **延續**：ADR-0058 第 1、2、3、4 點；[ADR-0046](./0046-approved-organizer-publications-may-merge-app-owned-pull-requests.md) 第 3 點的八項合併充分條件

## 背景

ADR-0058 第 5 點要求在「新增維護者」或「首次發布與一次可恢復 failure 都已驗收」時，重新評估是否把 repository ruleset 恢復為第二道強制邊界。後者已於 2026-09-15 達成，其後又完成 #190 的更正與 `pf45-rf14` 的建立與修正兩次發布。維護者仍只有一位，前一個觸發條件尚未發生。

### 2026-09-20 實測

`dekkmarsvin/tw_doujin_event` ruleset `22001248`：active、`~DEFAULT_BRANCH`、exclude 為空、`bypass_actors` 為空、規則只有 `deletion` 與 `non_fast_forward`。另有 ruleset `20681840` 為 disabled。

`dekkmarsvin/tw_doujin_event-data` ruleset `21704741`：active、`~DEFAULT_BRANCH`、`bypass_actors` 為空、規則含 `pull_request` 與 `required_status_checks`，其參數為

```json
{"required_status_checks":[{"context":"data / check"}],"strict_required_status_checks_policy":true}
```

與 ADR-0058 決策時相同，兩個 repository 的 App 均不在 bypass 清單中。

### 決定性的細節

`required_status_checks` 的項目**只有 `context`，沒有 `integration_id`**。GitHub 以名稱比對這個條件，不限定由誰回報。

本 App 持有 checks 寫入權，而且就是靠它產生自己的放行條件：`app/github-publication.ts` 的 `createApprovalCheck()` 以 `POST /check-runs` 建立 `name: "Organizer publication approval"`、`conclusion: "success"` 的 check run。同一個權限可以建立任何名稱的 check run。

因此**憑證外洩的 App 可以自行滿足 `data / check`**，一如它自行滿足 `Organizer publication approval`。data repository 上那道「第二邊界」對它要防的威脅本來就不成立；這不是本決策造成的退化，是量測後才看清的既有狀態。

## 決策

### 1. 不把 ruleset 恢復為 required checks 閘門

理由有二，缺一不可：

- **不綁定產生者時它擋不住目標威脅。** 見上。加上 `Organizer publication approval` 只是多一項 App 自己就能滿足的條件。
- **綁定產生者後它會擋住人類。** `Organizer publication approval` 只由 publication job 產生，repository 沒有任何 workflow 會回報它。把它列為 main 的 required check，一般 PR 永遠等不到。這不是推測：2026-09-20 一天之內經人類路徑合併了七個 PR（#288、#289、#291、#293、#295、#296、#299），若該條件生效則一個都合不了。要同時保留人類路徑就得再加一個「對非 `organizer/**` head 直接回報成功」的 workflow——為一道形同虛設的邊界增加一套機制。

ADR-0058 第 1 點的 adapter 檢查、第 2 點的 `PUBLICATION_REQUIRED_CHECKS`、ADR-0046 第 3 點的八項條件、path allowlist 與 audit 仍是實際承載的強制點。

### 2. 若日後恢復，必須以 `integration_id` 綁定

這一點記下來，是為了不讓下一次評估重走同一條錯路。恢復 ruleset 作為第二邊界時：

- 每一筆 `required_status_checks` 項目都要帶 `integration_id`，指向實際產生該 check 的 App（workflow 產生的項目指向 GitHub Actions），否則條件可被任何持有 checks 寫入權的身分滿足。
- `Organizer publication approval` 不得列入 main 的 required checks，除非同時提供非 `organizer/**` head 的回報路徑。
- 先確認 App 的 checks 權限是否仍為必要：若改由 workflow 回報核准狀態，App 可以降為不需 checks 寫入，屆時本 ADR 的前提才真正改變。

### 3. 作者檢查綁定本 App 身分

ADR-0058 第 1 點記錄的已知缺口現在補上：`mergeOwnedPullRequest()` 原本只確認 `user.login` 以 `[bot]` 結尾，等於接受任何 bot 帳號開的 PR。

改為比對**同一個 head SHA 上那筆核准 check 的產生者**：該 check 由 publication App 自己以 `createApprovalCheck()` 建立，其 `app.slug` 就是應有的 PR 作者，要求 `user.login` 等於 `<slug>[bot]`。核准 check 沒有 App 身分時直接失敗關閉，不退回舊的字尾判斷。

這綁定的是「開 PR 的人就是簽核准的那個 App」，不是靜態設定的 app id——後者需要新增設定項或以 JWT 取得 slug，而本綁定不需要新設定就能排除 #232 指名的情境（他人以另一個 bot 帳號開 PR 誘使 App 合併）。若日後 App 的 checks 寫入權被移除（見第 6 點），核准 check 改由 workflow 回報，屆時這個來源也要跟著改。

這道檢查落在**實際承載強制力的那一層**，成本是一次比對。在 ruleset 不提供第二邊界的前提下，第一邊界的完整性比新增第二邊界更值得投資。

### 4. ruleset 偏差報告依 ADR-0058 第 3 點實作

ADR-0058 第 3 點已決定偵測範圍擴大到所有 `actor_type`，並拆成 `app_bypasses_ruleset` 與 `human_bypasses_ruleset` 兩個 code，兩者都是報告項目、不阻擋任何步驟。`app/publication-rollout.ts` 至今仍只檢查 `actor_type === "Integration"`。這不需要新的決策，是未落地的既有決策。

報告另增一項：required status check 未綁定 `integration_id` 時列為 `unpinned_check:<context>`，使第 2 點的條件在報告裡看得見。

### 5. 保留 `deletion` 與 `non_fast_forward`

這兩條規則**確實**約束憑證外洩的 App：它不能刪除 main，也不能改寫歷史。兩個 repository 都已 active 且 bypass 為空，維持不變。這是 ruleset 目前提供的真實價值，與第 1 點不衝突。

### 6. 下一次重新評估的觸發

- 新增第二位維護者。
- App 的 checks 寫入權被移除，或核准狀態改由 workflow 回報。
- required status checks 開始以 `integration_id` 綁定。

## 結果

- 第二道邊界仍然不存在，且現在知道它在目前設定下**從未存在過**。殘餘風險與 ADR-0058〈結果〉所列相同，但描述更準確：不是「失去」第二邊界，而是該邊界對持有 checks 寫入權的身分本來就無效。
- 作者檢查綁定本 App 後，ADR-0046 第 3 點開頭「App 只能合併同一 publication job 自己建立的 PR」首次完整成立。
- 人類 PR 路徑不受影響，日常開發維持現狀。
- 不新增 workflow、Cloudflare 產品或排程角色。
