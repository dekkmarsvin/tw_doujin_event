# ADR-0037：控制面以受限 GitHub 憑證開 PR，不得合併

- 狀態：已定案（2026-08-28）
- 相關 issue：[#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104) §5、[#112](https://github.com/dekkmarsvin/tw_doujin_event/issues/112)、[#118](https://github.com/dekkmarsvin/tw_doujin_event/issues/118)
- 延續：[ADR-0014](./0014-event-data-lives-outside-the-code-repo.md)、[ADR-0032](./0032-shared-reference-data-is-public-and-pinned.md)、[ADR-0033](./0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md)、[ADR-0035](./0035-new-event-onboarding-is-data-driven.md)
- 部分取代：[地圖貢獻控制面基礎契約](../contracts/map-contributions.md)「候選匯出不呼叫 GitHub」一句

## 脈絡

建立一個新活動要跨三個 repository 產生四批變更，且順序不可調換：reference-data → main repo identity → event-data → main repo pin。順序不是偏好：`scripts/build-official-circle-catalog.mjs` 從 main repo root 讀 `data/circle-identities/evidence.json`，而 `data:stage` 會呼叫它，因此 identity evidence 必須早於 event-data staging。

`npm run event:onboard` 已消除最後一段的手抄雜湊值。但它的輸入前提是 event-data repository 已由人工準備完成——也就是維護者仍要在三個 repository 之間手動搬檔案、開分支、開 PR。這正是 ADR-0035 想移除的機械勞動的最後一段。

現行的[地圖貢獻控制面基礎契約](../contracts/map-contributions.md)明文：候選匯出「不呼叫 GitHub、不寫 event-data repository，也不改變任何匿名公開 endpoint」。讓控制面自己開 PR 會推翻這句話，並新增一個信任面：一份存在於 Cloudflare Pages 環境、可寫入三個 repository 的憑證。

## 決策

**控制面可持有 GitHub 憑證，用途限於「推一個新分支並開一個 pull request」。合併權不在控制面。**

這不違反 ADR-0035 決策第 5 點。該點禁止的是「按一下即公開」；開 PR 之後，diff、schema gate、測試與 review／merge 關卡全部原封不動。控制面得到的是**提案權**，不是發布權。

也不違反 ADR-0014 的三 repository 分離：憑證不合併 repository，只是讓同一個操作者不必手動在三處重複同一批機械步驟。

### 憑證範圍

fine-grained personal access token，逐項限定：

| 項目 | 設定 |
|---|---|
| 型別 | fine-grained PAT，非 classic、非 OAuth app |
| 目標 repository | 僅 `tw_doujin_event`、`tw_doujin_event-event-data`、`tw_doujin_event-reference-data` |
| 權限 | Contents: read/write；Pull requests: read/write；其餘全部 no access |
| 保存位置 | `wrangler pages secret put`。不進 repository、不進 bundle、不進任何 build artifact |
| 有效期 | 設定到期日並排入輪替，不使用永不過期的憑證 |

### 不可讓步的邊界

- **不得 merge。** 控制面不呼叫任何 merge、auto-merge 或 merge queue API。
- **不得改寫既有分支。** 只 push 新分支，分支名帶活動 ID 與時間戳；不 force push，不寫 `main`。
- **不得觸碰上述三個 repository 以外的目標。**
- **不得改動 workflow 檔案。** `.github/` 之下的路徑不在控制面可寫入的範圍內。
- **不得繞過既有驗證。** 未通過 identity／map／booth validation 的資料不得成為發布候選；SHA-256 與 schema gate 不因自動化而放寬。
- **不得留下部分狀態。** 任一步失敗時不留下已推的分支或半份候選；四批 PR 的順序不可調換。

### 憑證外洩時

持有者可以在三個 repository 開 PR、推新分支，並讀取三者的內容（三者本來就是公開 repository，讀取不新增暴露）。持有者**不能**合併、不能改寫 `main`、不能改 workflow、不能改動這三個 repository 以外的任何東西，也不能讓任何資料在未經 merge 的情況下抵達 production——production 只從 `main` 的 pin 建置。

復原：撤銷 token、刪除控制面推出的分支、關閉未經預期的 PR、以 `wrangler pages secret put` 換發新 token。不需要重建任何公開資料，因為公開資料的真相仍在 `main` 的 pin 與靜態快照。

## 後果

- [地圖貢獻控制面基礎契約](../contracts/map-contributions.md)「不呼叫 GitHub」一句必須改寫，寫明控制面可開 PR、不可合併，以及此能力只在管理者身分後方可達。改寫由 [#118](https://github.com/dekkmarsvin/tw_doujin_event/issues/118) 執行。
- 「候選匯出不改變任何匿名公開 endpoint」一句**不變**。開 PR 不改變任何匿名可達的回應。
- 稽核邊界不變：要回答「這格攤位為什麼屬於這個社團」，需要的仍是 `main` 的那份 diff。控制面只是把 diff 的產生自動化，diff 本身仍是紀錄。
- 單人維護時 PR review 是自我 review。**這不是放寬理由**：review 之所以留著，是因為 diff 本身是稽核紀錄（ADR-0035 對選項 D 的否決理由），與有幾個人 review 無關。

## 未決

- 是否要求控制面開出的 PR 帶固定標籤或標題前綴，以便和人工 PR 區分。傾向要求，但等第一個真實活動跑過再決定格式。
- 是否讓控制面在 PR 內文附上它自己算出的 SHA-256，供 review 時對照。這會讓 review 更快，但也讓「control plane 說的」與「gate 算的」兩個數字同時出現在畫面上；哪一個是真相必須寫清楚才能加。
