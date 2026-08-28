# ADR-0039：活動與 reference 資料收斂為單一資料 repo，跨活動 identity linkage 延後

- 狀態：已定案（2026-08-28）
- **取代**：[ADR-0014](./0014-event-data-lives-outside-the-code-repo.md) 決策第 3 點（一活動一資料 repo）、[ADR-0032](./0032-shared-reference-data-is-public-and-pinned.md) 決策第 1 點（獨立 reference repository）與第 5 點的更新順序
- **修訂**：[ADR-0010](./0010-circle-identity-is-an-allocated-serial.md) 規則一（ID namespace 維持全域唯一，但不再要求跨活動沿用同一 ID）
- **暫緩**：[ADR-0037](./0037-the-control-plane-opens-pull-requests-with-a-scoped-token.md) 的實施時點，決策不撤銷，見決策第 5 點
- 相關 issue：[#121](https://github.com/dekkmarsvin/tw_doujin_event/issues/121)、[#112](https://github.com/dekkmarsvin/tw_doujin_event/issues/112)、[#116](https://github.com/dekkmarsvin/tw_doujin_event/issues/116)、[#118](https://github.com/dekkmarsvin/tw_doujin_event/issues/118)
- 延續：[ADR-0026](./0026-public-sanitized-event-data-and-history-rewrite.md)、[ADR-0035](./0035-new-event-onboarding-is-data-driven.md)
- 相關契約：[共享 reference 選擇契約](../contracts/reference-selection.md)、[社團目錄契約](../contracts/circle-catalog.md)

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

**若日後某場活動的資料收到下架要求，資料放在程式碼 repo 裡（#121 的選項 C）就等於要重寫程式碼 repo 的歷史，所有既有 code clone 失效。**這是保留「程式碼與資料分屬不同 repository」這條線的理由。

但選項 B **只隔離 code repo 與 data repo，不隔離 data repo 內的各活動**。若在共享 data repo 對某個活動執行 history rewrite，該點之後的 descendant commit SHA 都可能改變；其他活動若 pin 到這些 commit，也要一起重算 pin。逐活動 pin 能阻止一般 forward update 漂移，不能抵擋 history rewrite。這個爆炸半徑必須由下架 runbook 與協調式 repin 承擔，不能再稱為逐活動隔離。

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

**`selection` 區塊不消失。**organizer 角色、category catalog revision、venue 與 venue-space 的 stable ID 關聯是語意，不是定位資訊，改存於 `events/<eventId>/reference-selection.json`。[共享 reference 選擇契約](../contracts/reference-selection.md)的驗證邊界——每個 pinned file 恰好被 selection 使用一次、不接受未選取的額外記錄、event definition 的 assignment 必須與 selection 集合完全相等、任一項不符即 fail closed——原封不動。

### 3. 否決 monorepo，但不宣稱逐活動歷史隔離

#121 的選項 C 不採用。選項 B 在真正需要 purge 時仍可能重寫共享 data repo 與重算多場活動的 pin，但不會改寫 code repo；選項 C 會連 code repo 一起重寫。B 保留的是 **code/data 歷史隔離**，不是 per-event 歷史隔離。

### 4. ID namespace 維持全域唯一，跨活動 identity linkage 延後

- **不變**：`c-xxxxxx` 仍由單一全域遞增序列配發，不從名稱、列號或任何可變欄位推導，配發一次永久保存且永不重用。ID 本身不因活動而重複，因此現有 URL、規劃資料與 D1 的 `(event_id, circle_id)` key 不需要 schema migration。
- **改變**：新活動不再以名稱或舊 evidence 判斷是否沿用既有 ID。每個尚無本活動 reviewed source 的**同活動 identity group** 一律配發新的全域唯一 ID；一個 identity group 可包含主辦方明確標示為同一社團的多日、多攤 booth sources。同名只表示同名，不得自動形成 identity group，也不建立跨活動關係。
- **同活動 linkage**：`official-booths.json` 目前按日期列出群組，不能單靠名稱證明兩日的群組是同一社團。#116 必須接受或產生一份可 review 的同活動 grouping：只有主辦來源本身的穩定鍵或人工確認的主辦證據能把不同日期的群組放進同一 group；缺少這種證據時 fail closed，不得以名稱相同猜測。group 中每個 `<day>:<booth>` 都保存為同一 ID 的 source，因此既有 FF47 多日社團及未來活動的收藏、規劃、認領與 overlay 不會在活動內被拆開。
- **保留**：`data/circle-identities/evidence.json` 與 `allocations.json` 繼續是 main repo 的 identity authority。前者保存 `eventId + organizer booth` 到 ID 的 reviewed source，後者保存全域配號 ledger。它們也讓日後可另外建立 optional cross-event mapping，但 mapping 不得回頭改寫既有活動 ID。
- **重新開啟的條件**：出現一個確實依賴跨活動 canonical identity 的產品情境時（例如同一畫面同時呈現多場活動、或社團覆蓋資料要跨活動沿用），以新 ADR 恢復，並以保留的 evidence 重建。

這個決策不會讓 identity 步驟消失，只會把需要產品判斷的「同名是否同社團」改成機械式配號。因此兩個 PR 的發布路徑明確為：

```text
data repo PR
  events/<eventId>/event.json + official-booths.json + circle-identity-groups.json + map.json + reference-selection.json
  ↓
main repo PR
  allocations.json + evidence.json + data/event-data-pins/<eventId>.json
```

main PR 必須先在同一分支產生並 review identity registry diff，再執行 staging 與 pin gate。現行 [`scripts/build-official-circle-catalog.mjs`](../../scripts/build-official-circle-catalog.mjs) 讀取 main repo 的 `evidence.json` 且要求完整 coverage；這項 fail-closed seam 保留。

[#116](https://github.com/dekkmarsvin/tw_doujin_event/issues/116) 不關閉，改為「新活動 identity 配號與 evidence 產生器」：移除跨活動候選、沿用與改名裁決 UI；從 `official-booths.json` 加上可 review 的同活動 grouping 產生全域唯一 allocation／本活動 evidence，並提供 dry-run、原子寫入與 coverage 驗證。該產生器完成前，不能宣稱新活動已達兩個 PR 的穩定流程。

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
- 決策第 1、2、4 點把發布路徑由「四個 PR、三個 repository、順序不可調換」降為「資料 repo 一個 PR → main identity + pin 一個 PR」。一年數次的手動路徑不構成需要 GitHub write credential 自動化的維運負擔。

重新評估的條件：**第二場真實活動以本 ADR 的架構跑完一次之後**，依實測的手動步驟數決定是否發行憑證。在那之前不發行，[#118](https://github.com/dekkmarsvin/tw_doujin_event/issues/118) 凍結。

### 6. 不可讓步的邊界不變

資料 repo 只收可再發布內容（ADR-0026）、以完整 commit SHA 與逐檔 SHA-256 引用、build 前校驗不符即中止、diff 本身是稽核紀錄。本 ADR 收斂的是 repository 數量，不是任何一道 gate。

## 後果

### 遷移面

一次性工作依下列順序執行，不得提早 archive 舊 repository：

1. 建立 `tw_doujin_event-data`，先啟用要求 PR 的 ruleset。
2. 建立最小 data-repo CI：拒絕無法解析的 JSON、`references/`／`events/<eventId>/` 以外的資料路徑、原始配置圖或其他 ADR-0026 禁入位元組，以及缺少逐活動權利／來源說明的資料夾。完整 schema、reference selection 與 SHA-256 authority 仍由 main pin PR 的既有 gate 驗證。
3. 以現有兩個 repository 的內容建立 `references/` 與 `events/ff47/`，但保留舊 repository 可用。
4. 在 main PR 更新 fetch／pin 契約與 `data/event-data-pins/ff47.json`，通過 `npm test`、lint、TypeScript、production build 與 preview smoke。
5. 合併與部署後執行一次 no-op production rebuild；確認同一 pin 產生相同快照後才 archive 舊 repository。回滾期間維持舊 pin 與舊 repository 不變。Archive 仍是 public readable history，不等於 purge；未來的移除要求必須一併盤點這些來源 repository。

程式面（依影響面大小）：

| 檔案 | 變更 |
|---|---|
| `scripts/reference-data-fetcher.mjs` → [`scripts/event-data-fetcher.mjs`](../../scripts/event-data-fetcher.mjs)、[`scripts/verified-tree-replace.mjs`](../../scripts/verified-tree-replace.mjs) | 第二次 fetch 與雙樹原子替換移除；`replaceVerifiedTrees` 降為單樹 |
| [`scripts/fetch-event-data.mjs`](../../scripts/fetch-event-data.mjs) | 移除 reference pin 的第二段解析與 `stageReferenceData` 呼叫；`files` 直接涵蓋 references |
| [`scripts/event-data-pin-utils.mjs`](../../scripts/event-data-pin-utils.mjs) | pin schema 升版，`files` 路徑允許 `events/` 與 `references/` 兩個前綴 |
| `scripts/reference-data-pin-utils.mjs` → [`scripts/reference-selection-utils.mjs`](../../scripts/reference-selection-utils.mjs) | **只移除定位面**：`REFERENCE_DATA_REPOSITORY`、`rawReferenceFileUrl`、pin 的 `repository`／`commit` 欄位驗證。記錄 schema、`validateSources`、`validateProvenance`、`selectEventReferenceRecords` 與 selection 驗證**全部保留** |
| [`scripts/stage-event-data.mjs`](../../scripts/stage-event-data.mjs) | selection 來源改為 `events/<eventId>/reference-selection.json` |
| [`scripts/circle-identity-registry.mjs`](../../scripts/circle-identity-registry.mjs) 與 #116 的產生器 | 保留全域唯一配號；新增 event-local linkage 模式，以可 review 的主辦來源 grouping 合併同活動多日 sources；名稱只用於 drift 檢查，不得作為 grouping 依據，也不得從其他活動產生候選或沿用 ID |
| [`scripts/build-official-circle-catalog.mjs`](../../scripts/build-official-circle-catalog.mjs) | main identity evidence 的完整 coverage gate 不變；main identity + pin PR 必須在同一分支通過 |
| `npm run reference-data:fetch` | 移除。獨立維護 reference 時直接 clone 資料 repo |
| [`tests/event-data-pin.test.mjs`](../../tests/event-data-pin.test.mjs)、[`tests/reference-selection.test.mjs`](../../tests/reference-selection.test.mjs)、[`tests/circle-identity-registry.test.mjs`](../../tests/circle-identity-registry.test.mjs) | 隨 pin schema 升版調整，並證明跨活動同名會配發新 ID、具主辦證據的同活動多日群組沿用同一 ID、只有同名但無 grouping 證據時 fail closed、同活動既有 source 重跑為 no-op |
| [共享 reference 選擇契約](../contracts/reference-selection.md)、[社團目錄契約](../contracts/circle-catalog.md)、[社團資料更新 runbook](../runbooks/catalog-data-update.md) | 前者只改定位面；後兩者改寫跨活動 linkage 與兩 PR 流程，完整 coverage 邊界不動 |

**現在做最便宜。**只有一場活動時遷移是一個 PR；每多一場活動就多一個 repository 要搬、一組 ruleset 要建、一份 pin 要重算。

### 對 #121 complexity budget 的實際位置

| 指標 | #121 的目標 | 本 ADR 之後 |
|---|---|---|
| 日常維護的 repository | 1，最多 2 | 2 |
| 新活動新增 repository | 0 | 0 |
| 新活動新增 PAT／secret | 0 | 0 |
| 新活動 publication PR | 1，最多 2 | 2 |
| 必須記得的跨 repo merge 順序 | 0 | 1 步（資料 repo → main identity + pin） |
| 新活動需要修改 TypeScript | 0 | 0，待 [#119](https://github.com/dekkmarsvin/tw_doujin_event/issues/119) 解除 `build:production` 的 `ff47` 硬編 |
| organizer-specific production adapter | 0 | 待 [#115](https://github.com/dekkmarsvin/tw_doujin_event/issues/115) |
| control plane 持有 GitHub write credential | 盡量 0 | 0（決策第 5 點暫緩） |

### issue 處置

| Issue | 處置 |
|---|---|
| [#112](https://github.com/dekkmarsvin/tw_doujin_event/issues/112) | 維持關閉，只承載 ADR-0037／0038；本 ADR 與 #104 完成定義改寫由 #121 承載，不把新工作塞回已關閉 issue |
| [#113](https://github.com/dekkmarsvin/tw_doujin_event/issues/113) | 降為 browser-only P2；不再阻擋本機 onboarding |
| [#114](https://github.com/dekkmarsvin/tw_doujin_event/issues/114) | P0 改為本機 wizard／generator，直接產生資料 repo 的 `events/<eventId>/` 資料夾，不依賴 #113；browser UI 留待 #113 解除後再做 |
| [#115](https://github.com/dekkmarsvin/tw_doujin_event/issues/115)、[#119](https://github.com/dekkmarsvin/tw_doujin_event/issues/119) | 不受 repository 收斂影響，照做 |
| [#116](https://github.com/dekkmarsvin/tw_doujin_event/issues/116) | 重新界定為本機 identity 配號與 evidence 產生器；刪除跨活動 adjudication UI |
| [#117](https://github.com/dekkmarsvin/tw_doujin_event/issues/117) | 降優先。[ADR-0038](./0038-authoring-moves-to-the-control-surface-local-stays-as-backup.md) 指出的能力缺口是真的，但接受「每場活動 checkout 一次」時它由能力前置降為可及性改善 |
| [#118](https://github.com/dekkmarsvin/tw_doujin_event/issues/118) | 凍結（決策第 5 點） |

### 其他

- [ADR-0014](./0014-event-data-lives-outside-the-code-repo.md) 的「必須提供一份最小 fixture 活動」不變，`fixtures/events/sample` 與 `sample-two` 維持。
- 單一資料 repo 的 issue tracker 會同時收到所有活動的資料回報。這是收斂的已知代價，以 label 區分即可，不構成回到 per-event repository 的理由。
- 本 ADR 不改變 [ADR-0012](./0012-first-party-sources-only.md) 的來源邊界，也不改變 [ADR-0008](./0008-static-public-reading-path.md) 的公開閱讀路徑。

## 不在本 ADR 範圍

- 舊 repository 的 archive 時點與其 issue／PR 的搬移。
- `events/<eventId>/NOTICE` 的實際措辭。
- 完整 schema authority 是否日後抽成可在 data repo 獨立執行的套件。初始 migration 已要求最小 repository-local CI；main pin PR 仍是完整 authority。
- [#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104) 完成定義的實際 issue body 改寫。它由 #121 執行，且是 #121 關閉前置；不指派給已關閉的 #112。

## 未決

- pin schema 升版後是否仍需要 `events/` 與 `references/` 兩個路徑前綴的區分，或只需一份扁平的檔案清單。等實作時看驗證訊息的可讀性決定。
- 第二場活動跑完後，決策第 5 點的重新評估要用什麼數字判定「手動步驟仍太多」。傾向以「從資料備妥到 production 上線的人工步驟數」為準，但門檻等實測再定。

## 下架與 history rewrite gate

一般更正與停止發布優先使用 forward commit。只有要求從 Git 歷史移除位元組時才執行 rewrite；執行前必須：

1. 列出 main 中所有指向共享 data repo 的活動 pin，並列出仍保存相同位元組的來源 repository；包含已 archive 的 `tw_doujin_event-data-ff47`、`tw_doujin_event-reference-data` 與未來其他來源。Archive 是唯讀，不是不可存取。
2. 判定共享 data repo 中哪些 pin commit 是被重寫 commit 的 descendant；不得只檢查被要求下架的活動。同時確認移除要求涵蓋哪些來源 repository 副本。
3. 在隔離 clone 對共享 data repo 與所有受要求涵蓋的來源 repository 完成 rewrite。若 archived repository 需要改寫，先依平台程序解除 archive，改寫並驗證後再 archive；只改共享 repo 而讓來源 archive 保留相同位元組不算完成。
4. 重算所有受影響 pin，並讓每個活動通過 fetch／SHA-256／schema／staging gate。
5. 以協調式 maintenance window 更新各受影響 data repository 與 main pins；任何活動缺少可驗證的新 pin、或任一應移除的 repository 副本尚可存取時，都不得宣告 purge 完成。
6. 完成後重跑 production build 與 no-op retry。被重寫 data repository 的既有 clone 失效必須記錄；code repo clone 不受影響，除非移除要求本身也涵蓋 code repo 內的副本。
