# AGENTS.md

Guidance for coding agents working in this repository.

## 交付原則

本專案是不處理金流、僅保存必要少量個資的同人活動網站。優先交付可用功能、簡單操作與低維護成本，不追求所有例外都自動恢復。

### 實作範圍

- 完成已接受的使用者任務，採用足以解決問題的最小變更。
- 不為尚未支援的情境、假想規模或單純最佳實務新增機制。新增防禦須指出目前支援環境中，誰做什麼操作、經哪條可到達路徑造成什麼影響、既有機制為何不足，以及最小修正；不必等事故發生，但回答不出來就不實作。「安全」「一致性」「資料完整性」不是免除舉證的理由。
- 維持登入、授權、活動／社團資料隔離、私人資料、公開／刪除與發布正確性的必要邊界；正常使用會遇到的登入逾時、儲存失敗、匯入錯誤及更新衝突，以最小且可理解的方式處理。
- 外部輸入在適當邊界驗證；已建立的內部型別與不變條件不在每層重複防禦。不同信任邊界、授權檢查與資料庫原子性需求仍須處理。
- 沿用既有驗證與恢復機制，不建立第二套，也不在一般 UI 任務中順帶拆除既有發布保護。
- 既有文件不是新增需求的授權；與本次已接受決策衝突時，說明衝突並同步修正受影響的現行文件，不自行擴大產品保證或改寫歷史決策。

### 測試

- 測試保護使用者行為與必要資料邊界，不保護函式名稱、JSX 寫法或精確樣式。
- 純文案、樣式與非行為性整理，預設不新增測試。優先修改既有測試；額外測試層須涵蓋不同的失敗類型，不預設同時補 unit、integration 與 browser。
- 低價值、重複或過時斷言可直接刪除，不要求一對一補測；有價值的行為保護須確認另一層已涵蓋或以適當行為測試承接。
- 本機預設只跑受影響驗證；完整 CI 的適用範圍依既有配置，未執行的驗證不得宣稱通過。具體測試選擇依 `docs/runbooks/local-development.md`。

### 使用者操作

- 優先沿用已知資料、合理預設值與原地完成操作，減少填寫、切換、重複登入與不必要確認。
- 草稿可未完成；正式送審／發布才套用必要完整性要求。可逆且局部的操作不預設新增確認步驟。
- 只有使用者必須作出決定時才要求選擇，不把內部模型轉成填寫負擔。
- UI 完成須有從入口、操作到結果的實際操作證據，不以原始碼斷言代替；依受影響任務選取驗收，不要求每次重做全站流程。

Review 的風險分級、finding 處置及結束條件統一依 `docs/agents/review-loop.md`，不另建平行稽核流程。

## Agent skills

### Project workflow

When triaging issues, choosing the next task, scheduling review follow-ups, or accepting a milestone, read `docs/runbooks/project-workflow.md` for goal-based classification, readiness, and completion evidence. Its section 7 holds the Cloudflare cost baseline, the complexity budget, and the expansion threshold — read it before proposing a cost-motivated change, a new Cloudflare product, or a new scheduled role.

Acceptance evidence — screenshots, measurements, dated verification or audit notes — goes on the issue or pull request, never into a new repository document. Section 6 of the same runbook says how to attach screenshots without leaving them on `main`. `docs/design/` holds current specs only, and `docs/design/history/` is frozen.

### Issue tracker

Issues live as GitHub issues in `dekkmarsvin/tw_doujin_event`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Domain vocabulary, architecture decisions, and behavioral contracts are located through `docs/agents/domain.md`.

### Interface copy

Before changing user-facing interface text, read `docs/design/copy.md`. Apply its audience and task boundary to the surface being changed, and keep actions and states consistent with what the user can actually do. Limit copy work to the affected surface; do not expand a copy change into a site-wide rewrite, a new copy framework, or an extra audit process unless the task explicitly requires it.

### Review-fix loop

For implementation review, finding disposition, reviewer assignment, verification, and review completion, follow `docs/agents/review-loop.md` as the single rule source.
