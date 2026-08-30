# 社團與活動資料更新

真實活動資料由獨立、公開的 data repo 維護；程式 repo 只保存不可變 pin、社團身分 registry 與 fictional fixtures。所有活動與跨活動 references 共用 [`dekkmarsvin/tw_doujin_event-data`](https://github.com/dekkmarsvin/tw_doujin_event-data)：活動資料在 `events/<eventId>/`，references 在 `references/`。

## 權威來源

| 資料 | 權威 |
|---|---|
| 活動名稱、日期與活動官方頁 | data repo `events/<eventId>/event.json` |
| 主辦 official URL、分類目錄、場館與場館空間 | data repo `references/` 的 pinned revision |
| 官方社團名與攤位配置 | data repo `events/<eventId>/official-booths.json`，來源為活動主辦單位 |
| 同活動 identity grouping | data repo `events/<eventId>/circle-identity-groups.json` |
| 向量地圖 | data repo `events/<eventId>/map.json`，由人工審閱的 authoring revision 匯出 |
| 永久社團 ID | 本 repo `data/circle-identities/allocations.json` |
| booth 到永久 ID 的證據 | 本 repo `data/circle-identities/evidence.json` |
| 社團介紹、作品、連結、代表圖 | 社團本人透過 overlay 提供 |

第三方工作簿與原始配置圖不在本 repo，也不參與 production catalog 生成。

> **流程定位**：本篇是目前維護者操作 repository pipeline 的 migration runbook，不是 Organizer P0 的最終操作介面。[`PRODUCT.md`](../../PRODUCT.md) 與 [#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104) 要求未來由 Web UI 完成建立、匯入、驗證、預覽與發布；UI 可以沿用本篇的 parser、evidence 與 validation 規則，但不得要求 Organizer 操作 Git、CLI、pin 或 agent。

> **現行 pipeline 的新活動前置條件**：主辦只公布錄取名單時，不產生可公開的 catalog、不配發 `c-*`、也不開放認領。`event-definition/3` 目前需要每一活動日的 `officialData.boothListUrls`，identity evidence 也只接受 `<day>:<booth>`；只有名稱與攤數的錄取名單不符合這兩個契約。等待攤位編號期間可以先完成 references、活動日與不依賴 placement 的 map layout。未來 Organizer CSV／XLSX 匯入若成為主辦配置的權威輸入，仍須在 #104 的受驗證草稿／預覽／發布流程中產生等價且可追溯的 booth evidence，不能在本 runbook 偷開特例。見 [ADR-0044](../adr/0044-an-accepted-circle-list-is-not-yet-catalogable.md)。

## 更新流程

### 0. 建立新活動資料夾（新活動才需要）

從本 repository 執行互動式 generator，並明確指定單一 data repo checkout：

```bash
npm run event:generate -- --workspace ../tw_doujin_event-data
```

Wizard 會建立 `events/<eventId>/event.json`、`reference-selection.json` 與必要的 `NOTICE`；選到尚不存在的 organizer、category catalog、venue 或 venue-space 時，也會在同一個 workspace 建立對應的 `references/` 候選檔。它使用 main repository 現行 parser 與 selection validator，在任何寫入前 fail closed。

相同答案重跑是 no-op。若活動資料夾或 reference stable ID 已存在但內容不同，generator 會拒絕覆寫，交由維護者 review 現有 diff 後處理。它不建立 `official-booths.json` 或 `map.json`，兩者仍由後續匯入與地圖 authoring 產生。

### 0.1 匯入官方攤位表（新活動才需要）

```bash
npm run booths:import -- --workspace ../tw_doujin_event-data --event <eventId>
```

Importer 可接 CSV、TSV 或單一 HTML table；每個輸入批次都要明確指定 booth code、circle name、day／period 對映與 booth code 解析模式。`single` 把儲存格當成一個 code，`delimited` 解析逗號、斜線或空白分隔的多攤，`fixed-width` 依維護者指定的字元寬度拆開 CWT 類型的 `A01A02`。無法整除的 concatenated 值會停在預覽。主辦將不同日期放在不同頁面時，可分批貼上並為每批指定固定 day。Importer 會先顯示列數、booth 數、完整 JSON 預覽與所有重複／缺漏／無法對映的來源列；只有輸入 `WRITE` 後才原子更新 `events/<eventId>/official-booths.json`。完成後仍需 review data repo diff。

### 1. 在 data repo 更新官方資料

更新 `events/<eventId>/` 底下的 `event.json`、`official-booths.json`、`circle-identity-groups.json`、`map.json` 或 `reference-selection.json`，依該活動的 `NOTICE` 檢查來源與差異，開 PR 通過 `data / check` 與人工 diff review 後合併。不要在程式 repo 直接建立真實活動快照。

跨活動 references 的修正改 `references/`，同樣走一個 PR。references 的變更不會自動改變既有活動：每個活動要以自己的 pin update 選擇採用。

### 2. 更新 identity evidence

每個官方 booth 以以下證據鍵連到一個永久 ID：

```json
{ "eventId": "ff47", "kind": "organizer-booth", "value": "1:A01" }
```

`circle-identity-groups.json` 必須把 `official-booths.json` 的每個 `<day>:<booth>` 恰好列一次；同一官方群組不可拆分。單一官方群組只需列 `sources`。要把不同日或不同官方群組放入同一 identity group，必須增加可 review 的 `linkage`：

```json
{
  "sources": ["1:A01", "1:A02", "2:B01", "2:B02"],
  "linkage": {
    "kind": "organizer-stable-key",
    "value": "application:1234",
    "reference": "https://organizer.example/applications/1234"
  }
}
```

`kind` 可為 `organizer-stable-key` 或 `manual-organizer-evidence`。只有名稱相同不得合併；不同活動即使同名也配發新的全域 ID。名稱只用來檢查官方資料與 evidence 是否漂移。

`event:onboard` 會在隔離 workspace 內執行產生器。需要單獨檢查已驗證 workspace 時，預設命令只輸出結構化 dry-run 摘要，不寫檔：

```bash
npm run identity:generate -- <eventId> --workspace <verified-workspace>
npm run identity:generate -- <eventId> --workspace <verified-workspace> --check
```

明確加上 `--write` 才會以配對原子替換更新該 workspace 的 `allocations.json` 與 `evidence.json`。`--check` 只在 registry 已完整涵蓋 grouping 且重跑為 no-op 時成功。

FF47 從舊工作簿 evidence 遷移到官方 booth evidence 的七筆拆分紀錄保存在 `ff47-official-migration-decisions.json`。它只說明已完成的裁決，不應在日常更新時修改。

新活動的 identity registry 差異在首次公開發布前仍是候選，現行流程把它和該活動 pin 放在同一張 main PR 審閱；若來源或 grouping 有誤，可以整組捨棄並重跑。公開發布後，Reader URL、收藏、認領與行程可能已引用這些 ID，此時不得重配或重用。

#### 已發布名單變動了

主辦在公布編號後調整名單時，**不要手動配號或編輯 `evidence.json`**。在 data repo 的 `circle-identity-groups.json` 宣告該次變動，並把 schema 升為 `circle-identity-groups/2`：

```json
{
  "schema": "circle-identity-groups/2",
  "eventId": "<eventId>",
  "groups": [ … ],
  "transitions": [
    { "source": "1:A01", "kind": "withdrawn", "reference": "https://organizer.example/notice" },
    { "source": "1:A02", "kind": "moved", "to": "1:C09" },
    { "source": "1:B01", "kind": "released" }
  ]
}
```

| kind | 什麼時候用 | 主辦名單上的該攤位 |
|---|---|---|
| `withdrawn` | 社團退出，沒有人接手 | 已消失 |
| `moved` | 同一個社團換到 `to` 的攤位 | 已消失，`to` 出現 |
| `released` | 攤位換手給別的社團 | **仍在**，但名稱不同 |

宣告與名單不符時 generator 會拒絕（例如宣告退出但攤位還在、移動到不存在的攤位、對從未配號的攤位宣告變動）。**未宣告的差異仍然 fail closed**——一個抓壞的名單頁看起來就像一批社團同時退出，所以不從差異推論。理由見 [ADR-0045](../adr/0045-list-changes-are-declared-not-inferred.md)。

`identity:generate` 的 dry-run 摘要會列出 `retirements`：這次會改變的每一筆**已發布** placement，含社團 ID、社團名、攤位與變動種類。**套用前逐項核對它**，那是唯一能在寫入前看見影響範圍的地方。

宣告在套用之後就完成任務，下一次更新時應從檔案移除；重複宣告已退役的攤位會被拒絕。

這條路徑要求編輯 JSON 與執行 CLI，因此是 migration path 而不是 Organizer 產品流程。[#139](https://github.com/dekkmarsvin/tw_doujin_event/issues/139) 與 [#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104) 要把它收斂成 UI，屆時 UI 產生的就是同一份宣告。

### 3. 更新 pin

在 data repo 完成 review 與合併後，以該 repo 的完整 40 字元 commit SHA 執行：

```bash
npm run event:onboard -- <eventId> <40-char-data-commit>
```

指令先取得固定 commit 下的新活動五個檔案（包含 `circle-identity-groups.json`），讀出 `reference-selection.json`，再依 selection 取得該活動使用的 `references/` 檔案，最後為兩組檔案一併計算 SHA-256。既有 FF47 pin 的四檔格式仍可讀取。分支、tag 與縮短的 commit 在送出任何請求前就被拒絕。

`data:fetch` → identity 產生 → `data:stage` → `event-data:check` 全部在隔離的臨時 workspace 執行；所有驗證完成後，才依序換入 allocations、evidence、event-data、public staging 與正式 pin。命令可回報的下載、schema、hash、grouping、registry、staging 或 rename 失敗會復原既有狀態。

若程序被外部終止，工作樹可能暫時留下 `.previous` backup，或已產生 identity registry 但尚未換入 pin。不要手動配號或編輯 evidence；以相同 `<eventId>` 與 commit 重跑 `event:onboard`，讓配對 registry recovery 與既有 source no-op 完成剩餘步驟，再 review main PR diff。

手動流程的對照格式如下；需要除錯時，可逐一下載同一個 commit 的 raw blob、計算 SHA-256，再與生成結果比較：

```json
{
  "schema": "event-data-pin/2",
  "eventId": "event-alpha",
  "repository": "dekkmarsvin/tw_doujin_event-data",
  "commit": "<40-char commit>",
  "files": [
    { "path": "events/event-alpha/event.json", "sha256": "<sha256>" },
    { "path": "events/event-alpha/official-booths.json", "sha256": "<sha256>" },
    { "path": "events/event-alpha/circle-identity-groups.json", "sha256": "<sha256>" },
    { "path": "events/event-alpha/map.json", "sha256": "<sha256>" },
    { "path": "events/event-alpha/reference-selection.json", "sha256": "<sha256>" },
    { "path": "references/<...>.json", "sha256": "<sha256>" }
  ]
}
```

不得手動 pin branch、tag 或未逐檔核對的內容。逐活動 pin 表示更新一場活動不會把其他活動的變更帶進部署；格式與 fail-closed 行為見[共享 reference 選擇契約](../contracts/reference-selection.md)。

### 4. 本機驗證 production staging

```bash
npm run data:fetch -- <event>
npm run data:stage -- <event>
npm run event-data:check
npm run build:production
```

單一活動的 `data:fetch`／`data:stage` 用來檢查你正在處理的那一場。`build:production` 則走 `--published`：它依 [`data/published-events.json`](../../data/published-events.json) 逐一取得並 staging **每一個已發布活動**，因此驗證的是實際會部署的整組資料。

`data:fetch` 把該 commit 下 pin 列出的所有檔案下載到暫存位置並核對 SHA-256，驗證 reference selection 後才把 `.event-data/<event>/` 換入；rename 失敗會復原舊 tree。活動自身檔案落在該目錄根層，`references/` 保留 repository 路徑。`data:stage` 先以 pinned grouping 對 identity registry 執行 no-op check，再驗證 selection 與 relationships，由官方 booth + identity evidence 生成 `circle-catalog/3`，並把該活動的 `event.json`、`reference-records.json`、`circles.json`、`map.json` staging 到忽略版控的 `public/data/events/<event>/`。

`data:stage` 每次都會先清空 `public/data/events/`，所以 staging 的樹永遠等於這次要服務的集合，不會是歷次執行的聯集。`event-data:check` 會斷言這件事。

### 首次發布一個新活動

pin 存在不等於已發布。活動要對讀者出現，必須把它的 id 加進 `data/published-events.json`；未列入的活動即使已有 pin 也不會進入 build。這條界線對應 [ADR-0044](../adr/0044-an-accepted-circle-list-is-not-yet-catalogable.md) 的草稿／已發布分界，也是[社團目錄契約](../contracts/circle-catalog.md)所說「首次公開發布」的實際開關。

以下任一情形會 fail closed：

- pin 的 commit 或 hash 不符；
- reference selection、schema 或 organizer／venue 關聯不符；
- pin 的 `references/` 檔案與 selection 不是同一個集合；
- 官方 booth 缺 identity evidence；
- 同一 booth 證據屬於多個 ID；
- 官網群組內的 booth 被拆到不同 ID；
- evidence 名稱與官方名稱漂移；
- staged tree 同時含多個活動；
- catalog 帶有工作簿時代欄位或無法解析的 placement。

### 5. 跑共同 gate

```bash
npm test
npm run lint
npx tsc --noEmit --incremental false
```

`npm test` 固定使用 fictional fixture，不需要網路；`build:production` 是真實資料的額外發行 gate。Review 時同時檢查 data repo commit、pin hash、identity registry 差異與生成摘要。

## 本機 fixture

`fixtures/events/sample` 是共同 gate 的最小活動，`sample-two` 用來證明不同日期型別與地圖模板不需要修改既有活動實作。fixture 必須是虛構資料，不得複製真實社團、攤位或原始圖片。
