# 貢獻指南

參與前請閱讀[行為準則](CODE_OF_CONDUCT.md)。功能問題與提案使用 [GitHub issues](https://github.com/dekkmarsvin/tw_doujin_event/issues)；個人資料、帳號及未公開的安全細節寄至 `maintain@kotoban.top`。

## 開始修改

1. 依 [README 快速開始](README.md#快速開始)啟動；登入、主辦工作區及測試指令見[本機開發與驗證](docs/runbooks/local-development.md)。
2. 用 [PRODUCT.md](PRODUCT.md) 確認使用者任務與範圍，再由[契約索引](docs/contracts/INDEX.md)找受影響的行為及 ADR。領域命名以 [CONTEXT.md](CONTEXT.md) 為準。
3. 不確定範圍時，先在 issue 說明使用者問題與預期結果；工作分類及驗收依[專案工作流程](docs/runbooks/project-workflow.md)。

## Issue 與 pull request

新 issue 使用合適的表單，預設為 `needs-triage`；維護者依[五個 triage 標籤](docs/agents/triage-labels.md)判斷範圍與可開工性。不要在公開 issue 放入 email、登入連結、token 或其他個人／秘密資料。

PR 保持一個可獨立驗收的目的，依模板說明結果、對應 issue／契約、範圍邊界、驗證及部署影響。Review 與相稱驗證依 [review-fix loop](docs/agents/review-loop.md)，文件更新依[文件維護規則](docs/README.md#維護規則)。

活動資料與 pin 更新依[資料更新 runbook](docs/runbooks/catalog-data-update.md)的雙 repo 順序執行。不要提交下載後的 `.event-data/`、本機產物或秘密。
