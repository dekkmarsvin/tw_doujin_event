# ADR-0039：活動與 reference 資料收斂為單一資料 repo，identity 序號改為活動範圍

- 狀態：已定案（2026-08-28）
- **取代**：[ADR-0014](./0014-event-data-lives-outside-the-code-repo.md) 決策第 3 點（一活動一資料 repo）、[ADR-0032](./0032-shared-reference-data-is-public-and-pinned.md) 決策第 1 點（獨立 reference repository）與第 5 點的更新順序
- **修訂**：[ADR-0010](./0010-circle-identity-is-an-allocated-serial.md) 規則一（序號不含活動範圍）
- **暫緩**：[ADR-0037](./0037-the-control-plane-opens-pull-requests-with-a-scoped-token.md) 的實施時點，決策不撤銷，見決策第 5 點
- 相關 issue：[#121](https://github.com/dekkmarsvin/tw_doujin_event/issues/121)、[#112](https://github.com/dekkmarsvin/tw_doujin_event/issues/112)、[#116](https://github.com/dekkmarsvin/tw_doujin_event/issues/116)、[#118](https://github.com/dekkmarsvin/tw_doujin_event/issues/118)
- 延續：[ADR-0026](./0026-public-sanitized-event-data-and-history-rewrite.md)、[ADR-0035](./0035-new-event-onboarding-is-data-driven.md)
- 相關契約：[共享 reference-data pin 契約](../contracts/reference-data-pin.md)

## 脈絡

[#121](https://github.com/dekkmarsvin/tw_doujin_event/issues/121) 挑戰的不是任何單一決策，而是它們的組合：ADR-0014 拆出 per-event repository、ADR-0032 再拆出 reference repository、ADR-0037 為了跨三個 repository 開四批 PR 而讓控制面持有 GitHub 憑證。每一步都有理由，疊起來之後，接一場新活動要新增一個 repository、一組 branch protection、一次 token 範圍更新，以及四個順序不可調換的 PR。

本專案由單人以業餘時間維護。**「幾個月不碰之後仍能理解」與「新活動不新增 repository 或 secret」必須和可重現、可 review、fail closed 一樣是一級需求。**

### ADR-0014 的三個動機，兩個已經失效

逐項對照 2026-08-28 的實測：

| ADR-0014 的動機 | 現況 |
|---|---|
| 資料重量超過程式碼：per-event 7.29 MB，其中 `circles.json` 1.9 MB、`ff47-circle-templates.generated.json` 1.6 MB、`app/ff47-booths.ts` 0.75 MB 都是每次重寫的衍生物 | **不成立。**[ADR-0026](./0026-public-sanitized-event-data-and-history-rewrite.md) 的准入邊界落地後，`dekkmarsvin/tw_doujin_event-data-ff47` 是 57 KB、3 個檔案（`event.json` 3.5 KB、`map.json` 203 KB、`official-booths.json` 249 KB）。`tw_doujin_event-reference-data` 是 25 KB。膨脹的前提消失了 |
| 每個活動的授權狀態不同，混在一起會讓新活動繼承舊活動的授權債 | **已由別的機制承擔。**ADR-0026 規定資料 repo 只收可再發布的主辦活動事實、本站產物、裁決紀錄與 provenance；第三方工作簿與配置圖原檔不得進入。授權邊界由**內容准入**擋住，repository 邊界是在重複做同一件事 |
| 每個活動的公開時程不同 | **與現況不符。**三個 repository 目前全是 public，`tw_doujin_event-data-ff47` 自 2026-08-25 起公開。閘控公開時程的是 main 的 pin 與部署（[ADR-0029](./0029-public-production-gated-preview.md)），不是 repository 邊界 |

ADR-0014 真正在承重、且本 ADR **不改**的是它的核心句：「問題不在位元組住哪個 repo，而在資料變更有沒有一個可 review 的 diff。」以及決策第 1、4、5、6 點——跨活動資產留在程式碼 repo、以完整 commit SHA 與逐檔 SHA-256 引用、build 前校驗不符即中止、人工裁決隨資料移動。

### 仍然成立、而 #121 沒有列出的那個理由

[ADR-0026](./0026-public-sanitized-event-data-and-history-rewrite.md) 明文保留歷史重寫空間，[ADR-0015](./0015-access-lifts-when-no-third-party-bytes-remain.md) 也已經實際執行過一次 `git filter-repo` 重寫與 force-push。

**若日後某場活動的資料收到下架要求，資料放在程式碼 repo 裡（#121 的選項 C）就等於要重寫程式碼 repo 的歷史，所有既有 clone 失效。**這是 monorepo 唯一擋不掉的代價，也是「程式碼與資料分屬不同 repository」這條線必須保留的理由——但它只需要**一條**線，不需要逐活動一條。

### Circle identity 的實測

[ADR-0010](./0010-circle-identity-is-an-allocated-serial.md) 規定序號跨活動延續，因此每接一場新活動都要人工裁決哪些社團沿用既有序號（[ADR-0035](./0035-new-event-onboarding-is-data-driven.md) 第 7 步，明列為不可自動化的人工判斷）。

但目前沒有任何消費者使用那個跨活動性質：

- `circle_claims` 的唯一索引是 `(event_id, circle_id)`，`circle_overrides` 同樣是 `(event_id, circle_id)`（[`db/identity-runtime-schema.ts`](../../db/identity-runtime-schema.ts)）。社團在下一場活動本來就要重新認領，覆蓋資料也不會沿用。
- 前端一次只載入一個活動定義：[`app/event-catalog.ts`](../../app/event-catalog.ts) 的 `ACTIVE_EVENT = EVENT_DEFINITIONS[0]`，由 build 時注入。跨活動比對在產品上沒有可達的畫面。

也就是說，人工裁決的成本是每場活動都要付的，而它換到的能力目前沒有任何一處在用。

## 決策

### 1. 建立單一資料 repository，停止一活動一 repository

```text
dekkmarsvin/tw_doujin_event-data
├─ references/          （原 tw_doujin_event-reference-data 的內容）
└─ events/
   ├─ ff47/
   └─ <下一場活動>/
```

程式碼與資料仍分屬兩個 repository。`tw_doujin_event-data-ff47` 與 `tw_doujin_event-reference-data` 在遷移完成後 archive，不刪除。

ADR-0014 決策第 3 點「不是一個資料 repo 分目錄」由本點取代。逐活動的授權宣告改以 `events/<eventId>/NOTICE` 表達，repository 層的 `LICENSE` 不概括涵蓋活動資料。

### 2. main 保留逐活動 pin 檔，第二層 pin 消失

`data/event-data-pins/<eventId>.json` **維持一個活動一份**，只是 `repository` 都指向同一個資料 repo，`commit` 各自獨立。

**這一點不可簡化為「main 只 pin 一個 data commit」。**若 main 只有單一 pin，更新一場活動就會把其他活動自上次 pin 以來的變更一併帶進部署，[ADR-0032](./0032-shared-reference-data-is-public-and-pinned.md) 決策第 5 點「reference 修正不會自動改變既有活動；活動必須以可審閱的 pin update 選擇採用」會失效。逐活動 pin 是保住那句話的機制。

pin 的 `files` 同時列出該活動使用的 `events/<eventId>/*` 與 `references/*`，全部帶逐檔 SHA-256，全部取自同一個 commit。**`reference-data-pin/2` 的 `repository` 與 `commit` 欄位隨之消失，第二次 fetch 與第二次原子替換也消失。**

**`selection` 區塊不消失。**organizer 角色、category catalog revision、venue 與 venue-space 的 stable ID 關聯是語意，不是定位資訊，改存於 `events/<eventId>/reference-selection.json`。[共享 reference-data pin 契約](../contracts/reference-data-pin.md)的驗證邊界——每個 pinned file 恰好被 selection 使用一次、不接受未選取的額外記錄、event definition 的 assignment 必須與 selection 集合完全相等、任一項不符即 fail closed——原封不動。

### 3. 否決 monorepo

#121 的選項 C 不採用，理由是脈絡「仍然成立、而 #121 沒有列出的那個理由」一節：下架與歷史重寫的隔離。選項 B 保留該隔離，選項 C 不保留。

### 4. Circle identity 序號範圍改為活動範圍，跨活動 mapping 延後

- **不變**：序號仍是配發的，不從名稱、列號或任何可變欄位推導，配發一次永久保存。[ADR-0010](./0010-circle-identity-is-an-allocated-serial.md) 規則二與規則三完全不動——那兩條擋的是「改名就換 ID」，與範圍無關。
- **改變**：規則一「序號不含活動範圍、跨活動延續」限縮為活動範圍。新活動不再需要與既有序號比對。
- **保留**：`data/circle-identities/evidence.json` 與 `allocations.json` 不刪。它們是日後要建立跨活動 mapping 時的重建依據。
- **重新開啟的條件**：出現一個確實依賴跨活動 canonical identity 的產品情境時（例如同一畫面同時呈現多場活動、或社團覆蓋資料要跨活動沿用），以新 ADR 恢復，並以保留的 evidence 重建。

[#116](https://github.com/dekkmarsvin/tw_doujin_event/issues/116) 的人工裁決介面隨之關閉。

### 5. ADR-0037 暫緩實施，不撤銷

控制面持有 GitHub 憑證的**決策內容維持有效**：不可讓步的邊界（不得 merge、不得改寫既有分支、不得改動 workflow 檔案、不得繞過既有驗證、不得留下部分狀態）、外洩影響分析，以及「repository 端強制到位前不得發行 token」這個前置條件本身。

**但那兩張表點名的 repository 由本 ADR 取代。**ADR-0037 的憑證範圍表列出 `tw_doujin_event`、`tw_doujin_event-reference-data` 與「該活動自己的 event-data repository」，發行前置表同樣以這三者為對象。決策第 1 點之後，後兩者是 archive 的 repository——照字面執行會保護不再可寫的 repository，而真正可寫的 `tw_doujin_event-data` 沒有任何保護。因此逐條改寫：

| ADR-0037 的項目 | 本 ADR 取代為 |
|---|---|
| 憑證範圍表「目標 repository」列 | 僅 `dekkmarsvin/tw_doujin_event` 與 `dekkmarsvin/tw_doujin_event-data`。不再有逐活動追加的第三個名字 |
| 憑證範圍表其餘各列（型別、權限、保存位置、有效期） | 不變 |
| 「event-data 是每場活動一個 repository」整段，含「新活動的 repository 必須先加進 token 選取」這道刻意保留的人工關卡 | 刪除。該關卡的目的是擋住「token 範圍等於未來所有 repository」，決策第 1 點讓範圍恆為固定兩個，關卡失去對象 |
| 發行前置的 ruleset 表 | 對象改為上述兩個 repository。`tw_doujin_event` 的要求不變（啟用 `branch_main`、加上「`main` 必須經 pull request」）；`tw_doujin_event-data` 在建立時即比照設定，見後果「遷移面」。archive 的兩個舊 repository 不在此列 |
| 「token 的 actor 不得列入任何 ruleset 的 bypass 清單」 | 不變 |

暫緩的是**實施時點**。理由是本 ADR 拿掉了它大部分的動機：

- ADR-0037 明列的營運成本「fine-grained PAT 的 repository 選取每接一場新活動就要更新一次」由決策第 1 點消滅，token 目標固定為兩個 repository。
- 決策第 1、2、4 點把發布路徑由「四個 PR、三個 repository、順序不可調換」降為「資料 repo 一個 PR → main pin 一個 PR」。一年數次的手動路徑不構成需要自動化的維運負擔。

重新評估的條件：**第二場真實活動以本 ADR 的架構跑完一次之後**，依實測的手動步驟數決定是否發行憑證。在那之前不發行，[#118](https://github.com/dekkmarsvin/tw_doujin_event/issues/118) 凍結。

### 6. 不可讓步的邊界不變

資料 repo 只收可再發布內容（ADR-0026）、以完整 commit SHA 與逐檔 SHA-256 引用、build 前校驗不符即中止、diff 本身是稽核紀錄。本 ADR 收斂的是 repository 數量，不是任何一道 gate。

## 後果

### 遷移面

一次性工作：建立 `tw_doujin_event-data`、以現有兩個 repository 的內容建立 `references/` 與 `events/ff47/`、比照 ADR-0037 前置建立 ruleset、重算 `data/event-data-pins/ff47.json`、開一個 PR、archive 舊 repository。

程式面（依影響面大小）：

| 檔案 | 變更 |
|---|---|
| [`scripts/reference-data-fetcher.mjs`](../../scripts/reference-data-fetcher.mjs) | 第二次 fetch 與雙樹原子替換移除；`replaceVerifiedTrees` 降為單樹 |
| [`scripts/fetch-event-data.mjs`](../../scripts/fetch-event-data.mjs) | 移除 reference pin 的第二段解析與 `stageReferenceData` 呼叫；`files` 直接涵蓋 references |
| [`scripts/event-data-pin-utils.mjs`](../../scripts/event-data-pin-utils.mjs) | pin schema 升版，`files` 路徑允許 `events/` 與 `references/` 兩個前綴 |
| [`scripts/reference-data-pin-utils.mjs`](../../scripts/reference-data-pin-utils.mjs) | **只移除定位面**：`REFERENCE_DATA_REPOSITORY`、`rawReferenceFileUrl`、pin 的 `repository`／`commit` 欄位驗證。記錄 schema、`validateSources`、`validateProvenance`、`selectEventReferenceRecords` 與 selection 驗證**全部保留** |
| [`scripts/stage-event-data.mjs`](../../scripts/stage-event-data.mjs) | selection 來源改為 `events/<eventId>/reference-selection.json` |
| `npm run reference-data:fetch` | 移除。獨立維護 reference 時直接 clone 資料 repo |
| [`tests/event-data-pin.test.mjs`](../../tests/event-data-pin.test.mjs)、[`tests/reference-data-pin.test.mjs`](../../tests/reference-data-pin.test.mjs) | 隨 schema 升版調整 |
| [共享 reference-data pin 契約](../contracts/reference-data-pin.md) | 改寫定位面，驗證邊界不動 |

**現在做最便宜。**只有一場活動時遷移是一個 PR；每多一場活動就多一個 repository 要搬、一組 ruleset 要建、一份 pin 要重算。

### 對 #121 complexity budget 的實際位置

| 指標 | #121 的目標 | 本 ADR 之後 |
|---|---|---|
| 日常維護的 repository | 1，最多 2 | 2 |
| 新活動新增 repository | 0 | 0 |
| 新活動新增 PAT／secret | 0 | 0 |
| 新活動 publication PR | 1，最多 2 | 2 |
| 必須記得的跨 repo merge 順序 | 0 | 1 步（資料 repo → main pin） |
| 新活動需要修改 TypeScript | 0 | 0，待 [#119](https://github.com/dekkmarsvin/tw_doujin_event/issues/119) 解除 `build:production` 的 `ff47` 硬編 |
| organizer-specific production adapter | 0 | 待 [#115](https://github.com/dekkmarsvin/tw_doujin_event/issues/115) |
| control plane 持有 GitHub write credential | 盡量 0 | 0（決策第 5 點暫緩） |

### issue 處置

| Issue | 處置 |
|---|---|
| [#112](https://github.com/dekkmarsvin/tw_doujin_event/issues/112) | 承載本 ADR；ADR-0037／0038 的定案不受影響 |
| [#113](https://github.com/dekkmarsvin/tw_doujin_event/issues/113) | 降優先 |
| [#114](https://github.com/dekkmarsvin/tw_doujin_event/issues/114)、[#115](https://github.com/dekkmarsvin/tw_doujin_event/issues/115)、[#119](https://github.com/dekkmarsvin/tw_doujin_event/issues/119) | 不受影響，照做。#114 的輸出改為資料 repo 的 `events/<eventId>/` 資料夾 |
| [#116](https://github.com/dekkmarsvin/tw_doujin_event/issues/116) | 關閉（決策第 4 點） |
| [#117](https://github.com/dekkmarsvin/tw_doujin_event/issues/117) | 降優先。[ADR-0038](./0038-authoring-moves-to-the-control-surface-local-stays-as-backup.md) 指出的能力缺口是真的，但接受「每場活動 checkout 一次」時它由能力前置降為可及性改善 |
| [#118](https://github.com/dekkmarsvin/tw_doujin_event/issues/118) | 凍結（決策第 5 點） |

### 其他

- [ADR-0014](./0014-event-data-lives-outside-the-code-repo.md) 的「必須提供一份最小 fixture 活動」不變，`fixtures/events/sample` 與 `sample-two` 維持。
- 單一資料 repo 的 issue tracker 會同時收到所有活動的資料回報。這是收斂的已知代價，以 label 區分即可，不構成回到 per-event repository 的理由。
- 本 ADR 不改變 [ADR-0012](./0012-first-party-sources-only.md) 的來源邊界，也不改變 [ADR-0008](./0008-static-public-reading-path.md) 的公開閱讀路徑。

## 不在本 ADR 範圍

- 舊 repository 的 archive 時點與其 issue／PR 的搬移。
- `events/<eventId>/NOTICE` 的實際措辭。
- 資料 repo 內是否需要 CI（schema gate 目前在程式碼 repo 的 build 前置執行）。
- [#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104) 完成定義的改寫。本 ADR 只否定「不使用 terminal」作為驗收條件的必要性；改寫本身由 #112 執行。

## 未決

- pin schema 升版後是否仍需要 `events/` 與 `references/` 兩個路徑前綴的區分，或只需一份扁平的檔案清單。等實作時看驗證訊息的可讀性決定。
- 第二場活動跑完後，決策第 5 點的重新評估要用什麼數字判定「手動步驟仍太多」。傾向以「從資料備妥到 production 上線的人工步驟數」為準，但門檻等實測再定。
