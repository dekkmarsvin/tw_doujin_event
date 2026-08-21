# 貢獻指南

感謝你願意改善場刊 Map。這份文件只放開始貢獻所需的入口；產品、契約與決策的權威仍在既有文件中，不在這裡複製。

參與前請閱讀 [行為準則](CODE_OF_CONDUCT.md)。功能問題與一般提案使用 GitHub issue；涉及個人資料、帳號或未公開的安全細節時，請改寄 `maintain@kotoban.top`。

## 本機開始

需要 Node.js `>=22.13.0` 與 npm。公開前台不需要 Cloudflare 帳號、D1 或任何 secret。

```bash
npm install
npm run dev:pages
```

提交前必須通過共同 gate：

```bash
npm test
npm run lint
npx tsc --noEmit --incremental false
```

`npm test` 已包含 production build、資料一致性檢查與 Node tests。完整啟動方式及本機 authoring 的額外需求見[本機開發與驗證](docs/runbooks/local-development.md)。

## 先確認改動邊界

- 長期資料來源只接受**活動主辦官網**與**社團本人自填**；不接受新增第三方抓取來源的 PR，見 [ADR-0012](docs/adr/0012-first-party-sources-only.md)。
- 活動資料以資料 repo 的完整 commit SHA 與逐檔 SHA-256 固定；程式碼 repo 只 review pin 與跨活動 identity 變更，見 [ADR-0014](docs/adr/0014-event-data-lives-outside-the-code-repo.md)。
- 地圖辨識與編輯是本機 authoring，不會打包進公開 Pages。
- 收藏與行程資料只存在使用者瀏覽器；不要在沒有新 ADR 的情況下加入帳號同步或伺服器儲存。
- P2 是明確延後的產品範圍，不等於可直接領取的待辦。

不確定改動是否落在邊界內時，先開 issue 說明使用者問題與預期結果，不要先投入大幅實作。

## 文件與程式碼一起改

請遵守 [docs/README.md 的維護規則](docs/README.md#維護規則)：

- 行為改變時，在同一個 commit 更新唯一對應的 contract。
- ADR 只新增；推翻決策時新增一份 ADR 並標示取代關係。
- research 是有日期的觀察紀錄，不直接改寫。
- policy 是對使用者的承諾，不得落後於實際行為。

領域詞彙以 [CONTEXT.md](CONTEXT.md) 為準。尤其不要把 `CircleRecord`（社團）與 `PlacementRecord`（配置）、場館與展區、快照與 overlay 混用。

## Issue 與 triage

請選擇最接近的 issue form；新 issue 會先套用 `needs-triage`。維護者確認後才會轉成以下其中一種狀態：

| 標籤 | 意義 |
|---|---|
| `needs-triage` | 等待維護者判斷範圍與優先序 |
| `needs-info` | 還缺重現資訊或必要背景 |
| `ready-for-agent` | 規格與驗收條件完整，可獨立實作 |
| `ready-for-human` | 需要人工操作、外部協調或不可自動化的判斷 |
| `wontfix` | 已決定不處理 |

請勿在公開 issue 放入 email、登入連結、Access token 或其他個人／秘密資料。

## Pull request

PR 請保持一個可獨立驗收的目的，並填寫模板中的：

- 使用者可觀察到的改變；
- 對應 issue、contract 與 ADR；
- 實際執行的 gate；
- 資料、部署與回滾影響。

資料更新遵循[社團資料更新 runbook](docs/runbooks/catalog-data-update.md)的雙 repo 順序：資料 repo 先取得不可變 commit，再由程式碼 repo 更新 pin 與必要的 identity registry。不要把下載後的 `.event-data/` 或 secret 提交進版控。
