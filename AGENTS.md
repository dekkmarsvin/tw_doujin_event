# AGENTS.md

給在這個 repo 工作的代理人。本專案由一人維護：不處理金流、只保存必要的少量個資。規則只有這一頁。

## 原則

- **簡單優先，能刪就刪。** 用最小的變更完成已接受的任務。不為假想情境、假想規模或「最佳實務」新增機制；新增防禦前要說得出誰、做什麼操作、會造成什麼實際影響。說不出來就不做。
- **必要邊界只有這些：** 登入與 session 時效、社團／活動層級授權、撤下立即生效、資料刪除請求、私人資料不進公開產物、secrets 不進版控、只有核准過的內容才會公開。其他保護是否值得，依維護成本判斷。
- **後端已依 [#546](https://github.com/dekkmarsvin/tw_doujin_event/issues/546) 重寫完成。** 現行規格是 `docs/contracts/` 的契約與 [後端 API](docs/api.md)；ADR 與 `docs/design/history/` 只是歷史，不是新需求的依據。
- **使用者操作：** 沿用已知資料與合理預設值，減少填寫與確認；草稿可以不完整，送審／發布時才檢查必要欄位；只有使用者必須做決定時才請使用者選擇。

## 測試

- 測使用者看得到的行為與上列必要邊界，不測函式名稱、JSX 寫法或樣式細節。
- 純文案、樣式與不改行為的整理不加測試。過時或重複的測試直接刪。
- 本機只跑受影響的測試（指令見[本機開發](docs/runbooks/local-development.md)），完整套件交給 CI。沒跑過的不說通過。

## Review

- 預設自查。改到授權、資料刪除或發布時，找一位沒參與實作的 reviewer 看那一塊。
- Finding 只處理「會壞」的：說得出輸入、路徑與錯誤結果。風格、完整性、「更一致」不擋 PR，也不另開 issue。
- 兩輪修正後還沒收斂，就停下來把剩下的問題交給維護者決定。

## 證據與文件

- UI 變更附從入口、操作到結果的截圖，貼在 PR 或 issue。不要提交驗收報告或證據圖到 repo；暫存在 PR 分支 `.evidence/` 的圖，合併前要刪掉。含個資的畫面不上傳。
- 決策寫在 GitHub issue，不再新增 ADR。`docs/adr/` 與 `docs/design/history/` 只是歷史。
- 改了前端行為，同一個 commit 更新對應的現行契約（清單見[文件索引](docs/README.md)）。

## 參考

- **Issue**：GitHub `dekkmarsvin/tw_doujin_event`，用 `gh` 操作，見 [issue-tracker](docs/agents/issue-tracker.md)；分類標籤見 [triage-labels](docs/agents/triage-labels.md)。
- **詞彙**：領域用詞以 [CONTEXT.md](CONTEXT.md) 為準。
- **介面文案**：改使用者看得到的文字前，先讀 [docs/design/copy.md](docs/design/copy.md)，只改受影響的畫面。
