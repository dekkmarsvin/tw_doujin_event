# 文件管理說明

本檔定義本專案每一份文件的**類型、職權與變更規則**，以及目前所有文件的歸類。

寫這份說明的原因很具體：`project-design-conformance-repair-record.md` 檔名是「紀錄」，內容卻同時是紀錄、決策、待辦與執行計畫；其中未實作的項目用契約時態書寫，於是被當成契約驗收，與 `DESIGN.md` 產生直接衝突（見 `project-docs-implementation-review-2026-08-13.md` 的 B1）。文件類型混用不是整潔問題，是矛盾的來源。

## 七種文件類型

每一種的差別不在寫什麼，而在**它是否約束實作**與**它什麼時候可以改**。

| 類型 | 是否約束實作 | 變更規則 | 書寫時態 |
| --- | --- | --- | --- |
| **契約** contract | **是**。實作必須符合，不符合就是缺陷 | 與實作同時更新。變更契約本身是一個決策，需留下決策紀錄 | 現在式，描述現行約定 |
| **手冊** runbook | 否。指示人怎麼操作 | 流程改變時更新 | 祈使句 |
| **現況說明** implementation note | 否。說明「目前是怎麼做的」 | 實作改變時更新；實作消失就刪除 | 現在式 |
| **研究紀錄** research log | 否。外部觀察的證據 | **不可變**。只能被新的觀察取代，不得回頭修改 | 過去式，必須有觀察日期 |
| **決策紀錄** decision log | 否。記錄某次決定與理由 | **只增不改**。決策翻案時補新條目，不改舊條目 | 過去式，必須有決策日期 |
| **待辦** backlog | 否。尚未實作的意圖 | 項目開啟與關閉；完成後移出並在決策紀錄留痕 | **祈使或未來式，禁止現在式規範語氣** |
| **審查報告** review | 否。某時間點的落差快照 | **不可變**。下次審查另開一份，不覆寫舊的 | 過去式，必須標基準 commit |

## 四條規則

### 1. 一個檔案只能是一種類型

混合體會讓讀者無法判斷手上這段字是「已經成立的約定」還是「希望達成的目標」。要放兩種內容就開兩個檔案，互相連結。

### 2. 待辦不得用契約時態

這是 B1 的直接成因。待辦項目寫「應包含 A、B、C」而不是「包含 A、B、C」；驗收條件寫「完成後應可…」而不是「可以…」。任何人翻到中間一節，都要能只從語氣判斷這是不是已生效的約定。

### 3. 契約只描述現行實作

`DESIGN.md` 已自述「本章描述現行實作」（Components 節開頭），這條規則把它推廣到所有契約文件。想寫的、打算做的、下一版要有的，一律進待辦。契約文件裡出現未來式，就是漂移的起點。

### 4. 每份文件開頭必須有識別區塊

```markdown
- 類型：契約／手冊／現況說明／研究紀錄／決策紀錄／待辦／審查報告
- 職權：是否約束實作
- 最後校驗：<日期>，對照 commit <sha>
```

「最後校驗」是指有人實際把文件與程式碼對照過的時間，不是最後一次編輯文件的時間。兩者差很遠時，就知道這份文件有多可信。

## 目前文件歸類

### 契約（具約束力）

| 文件 | 範圍 |
| --- | --- |
| `PRODUCT.md` | 使用者、產品目的、核心任務、邊界、原則 |
| `DESIGN.md` | 設計系統、版面、元件、互動、URL 契約、離線、社團控制面 |
| `docs/favorites-and-visit-planning-design.md` | 收藏、群組、備註、行程、購物規劃的領域模型與同步 |
| `docs/event-map-design.md` | 地圖模組 seam、資料不變量、authoring 流程 |
| `docs/circle-data-sources-and-import-design.md` | 資料權威順序、身分比對、來源顯示、匯入分期 |

`PRODUCT.md` 與 `DESIGN.md` 有工具管理的結構：前者開頭有 `<!-- impeccable:product-schema 1 -->` 標記，後者有 YAML frontmatter 並對應 `.impeccable/design.json`。編輯時不得破壞這兩個結構。

### 手冊

| 文件 | 範圍 |
| --- | --- |
| `README.md` | 環境需求、啟動、驗證、資料更新、地圖 authoring |
| `docs/cloudflare-pages-deployment.md` | Pages 首次啟用、自動部署、密鑰、快取、回滾 |

**待處理**：`cloudflare-pages-deployment.md` 的「發布邊界」節其實是契約（`dist/` 不得含 `_worker.js` 等規則有測試把關），混在手冊裡。

### 現況說明

| 文件 | 範圍 |
| --- | --- |
| `docs/ff47-circle-template-integration.md` | FF47 資料管線：來源、生成器、匹配、驗證數據 |

**待處理**：此檔的「社團模板匹配契約」與「地圖縮放契約」兩節是契約內容，應上移至 `circle-data-sources-and-import-design.md` 與 `event-map-design.md`，此處只留指向。

### 研究紀錄（不可變）

| 文件 | 觀察日期 |
| --- | --- |
| `docs/comike-webcatalog-map-research.md` | 2026-08-06 |
| `docs/comike-webcatalog-information-favorites-integration-research.md` | 2026-08-06 |
| `docs/comike-webcatalog-information-favorites-integration-verification.md` | 2026-08-06 |
| `docs/comike-webcatalog-circle-editing-research.md` | 2026-08-13 |

這四份記錄的是外部網站在某個時間點的實際行為。**即使外部網站改版也不修改它們**——那只代表需要一份新的觀察紀錄。

### 決策紀錄（只增不改）

| 文件 | 範圍 |
| --- | --- |
| `docs/comike-webcatalog-product-document-update-recommendations.md` | 研究結論轉入產品文件的採納清單與追溯 |

此檔 `:25` 已自述「保留為研究到決策的追溯紀錄」，定位正確；但檔名 `recommendations` 讀起來像待辦，建議更名。

### 審查報告（不可變）

| 文件 | 基準 |
| --- | --- |
| `docs/project-docs-implementation-review-2026-08-13.md` | commit `40c5c46` |

### 待辦

**目前不存在。** 這是本專案文件結構的根本缺口：沒有地方放「還沒做的事」，所以 R1–R8 寄生在一份名為紀錄的文件裡，2026-08-13 審查發現的 B1／B3／B4／C1 同樣無處可去。

### 混合體（待拆解）

| 文件 | 現況 |
| --- | --- |
| `docs/project-design-conformance-repair-record.md` | 同時是決策紀錄（`:10-45`）、規範（`:60-153`）、待辦（`:155-217`）與執行計畫（`:219-234`） |

## 建議的拆解

以下需要拍板後才執行，本說明先記錄建議：

1. **新增 `docs/backlog.md`**（待辦）。收納：repair record 中 R1–R8 尚未關閉的部分、「已確認的進階搜尋決策」裡未實作的五項（搜尋範圍切換、多主題、排除主題、AND／OR 規則顯示、命中原因），以及 2026-08-13 審查的待決項。全部改寫為祈使時態。
2. **`project-design-conformance-repair-record.md` 收斂為純決策紀錄**，只保留三段日期收斂與文件狀態，其餘移出。是否連同更名（例如 `docs/decision-log.md`）需一併決定。
3. **`ff47-circle-template-integration.md` 的兩節契約上移**至對應的模組契約文件。
4. **`cloudflare-pages-deployment.md` 的發布邊界節**改為指向契約，或明確標注該節為契約。
5. **所有文件補上識別區塊**（規則 4）。

拆解完成前，遇到現有文件互相矛盾時，**以契約類文件為準**；`project-design-conformance-repair-record.md` 中任何未標記為已完成的規範性敘述，一律視為待辦而非契約。

## 新增文件時

1. 先決定類型。無法歸入七種之一，代表這份文件想做兩件事，拆開。
2. 依類型放置：契約與模組設計放 `docs/`，根目錄只保留 `README.md`、`PRODUCT.md`、`DESIGN.md`。
3. 補識別區塊。
4. 在本檔的歸類表新增一列。**沒有出現在本檔的文件視為未受管理。**
