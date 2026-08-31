# ADR-0046：已核准的 Organizer publication 可合併 App 自己建立的 PR

- **狀態**：Accepted
- **日期**：2026-08-31
- **取代**：[ADR-0037](./0037-the-control-plane-opens-pull-requests-with-a-scoped-token.md) 的「控制面不得 merge」；其路徑限制、不可直接寫既有分支、不可繞過 repository ruleset 與稽核要求仍有效
- **延續**：[ADR-0039](./0039-one-data-repo-for-events-and-references.md) 的固定兩個 repository 與 data → main 順序

## 背景

Organizer 工作區把活動資料、名單、地圖、審閱與發布狀態放在同一個可追溯流程。若核准後仍需要人員在 GitHub 手動合併兩個 PR，控制面無法可靠分辨「尚未處理」、「部分完成」與「部署失敗」，也無法安全提供從失敗步驟重試。

ADR-0037 禁止控制面合併，是在控制面只有提案資料、沒有 immutable approval snapshot、head SHA pin、required check 與 publication lease 時作出的邊界。這些前提在本決策中改變，但「按一下就直接改 main」仍然被禁止。

## 決策

### 1. 發布輸入是 immutable approval snapshot

Owner 送審固定 candidate version、正規化匯入來源 metadata、identity grouping／transition、reference 選擇及所有 day × venue-space map revision。全域管理者核准的是該 snapshot hash；後續編輯必須建立新 revision，不能改寫已核准內容。

送審與核准是兩次需要 fresh session 的獨立動作。管理者可以核准自己以 Owner 身分送出的 revision，但 UI 必須警示，audit 必須記錄 actor、snapshot hash、candidate version、時間與 `selfApproval`。

### 2. GitHub App 只安裝在固定兩個 repository

App 只安裝於 data repository 與 `dekkmarsvin/tw_doujin_event`。不使用 PAT、不建立 per-event repository，也不要求 Workflows 權限。權限限於 Contents、Pull requests、Checks、Actions 與必要的唯讀 metadata。

應用層路徑 allowlist 只接受預先定義的 event/reference/identity/pin 路徑，明確拒絕 `.github/**`、workflow、ruleset、repository setting 與任意既有分支寫入。

### 3. App 可合併的充分條件

App 只能合併同一 publication job 自己建立的 PR，且每次合併前全部條件同時成立：

1. candidate snapshot 仍是管理者核准的 hash；
2. PR repository、base、head branch 與記錄在 job 的值完全相同；
3. PR head SHA 與 job 的 `expectedHeadSha` 完全相同；
4. `Organizer publication approval` check 指向同一 SHA 且成功；
5. repository ruleset 要求的所有 checks 已成功；
6. PR 未被其他 actor 修改、關閉或換 head；
7. App 持有尚未過期的全域 publication lease；
8. data PR 已先完成，才可建立或合併 main identity + pin PR。

任一條件不成立時 job 失敗關閉，不嘗試「修正」第三方變更，也不以管理權限繞過 ruleset。

### 4. Repository ruleset 是第二道強制邊界

data repository 的 active ruleset 必須增加 `Organizer publication approval` check。main repository ruleset 必須啟用，要求 PR、`Verify and deploy`、`Full preview portal E2E` 與 `Organizer publication approval`。GitHub App 不得列為 bypass actor。

在兩個 ruleset 經 API 實測為 active、required checks 名稱一致且 App 不在 bypass 清單之前，production merge feature flag 必須保持關閉。

### 5. Webhook 驅動且逐步冪等

Pages request 不等待 CI。GitHub webhook 經 HMAC 驗證後，以 delivery ID 去重，再由 `(job, step, expected SHA)` 推進狀態。全域同時只允許一個 publication lease。

- data 已合併、main 失敗：保留未公開的 data commit，從 main 步驟重試。
- main 已合併、部署失敗：重跑記錄的 Actions workflow run，不重建資料或 PR。
- production Pages origin 的 event、catalog、每個 map artifact 與 `?event=<eventId>` smoke 全數成功前，candidate 保持鎖定且不可標為 published。

custom domain smoke 是 advisory；Pages production origin 是 blocking gate。

## 結果

- 核准不等於繞過 GitHub review；核准本身成為 required check，ruleset 仍決定可否合併。
- 控制面取得的 merge 能力比 ADR-0037 更大，因此 head SHA、App ownership、lease、路徑 allowlist、required checks 與 audit 都是不可省略的共同邊界。
- 本機 `/editor` 保留為離線／事故備援，不持有 production merge 能力，也不是 Organizer 正式流程。
