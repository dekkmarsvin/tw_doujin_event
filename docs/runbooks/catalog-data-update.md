# 社團資料更新

從上游試算表同步 FF47 社團資料，透過永久 identity registry 重新生成場刊快照。

資料模型與身分規則見[社團目錄契約](../contracts/circle-catalog.md)。

## 來源

依 [ADR-0012](../adr/0012-first-party-sources-only.md)，長期只保留主辦官網與社團本人兩類來源。工作簿與縮圖索引是**退場中的過渡輸入**，目前仍供應內容欄位。

| 角色 | 位置 | 長期地位 |
|---|---|---|
| 配置權威（主辦官網） | [FF47 三日攤位編號公佈](https://www.f-2.com.tw/ff47%E4%B8%89%E6%97%A5%E6%94%A4%E4%BD%8D%E7%B7%A8%E8%99%9F%E5%85%AC%E4%BD%88/)，版本化快照為 `data_source_test/ff47-official-booths.json` | 保留 |
| 內容來源 | [FF47 Google 試算表](https://docs.google.com/spreadsheets/d/1LvbfijXkjcoK6nKw06U2YBZ655vcIXWvyEVX-pP0ovU/edit?usp=sharing)，版本化快照為 `data_source_test/FF47 完整攤位整理.xlsx` | 過渡 |
| 社團模板來源工作表 | `攤位整理表 請在此填寫資訊`（一列一個具名稱的社團） | 過渡 |
| 縮圖索引 | Excel 以 `IMPORTRANGE` 查詢的[公開縮圖索引](https://docs.google.com/spreadsheets/d/1f7uHQQgxgff8nh6aFDrh_cqkeFpcVPsvJILesm778_0/)，固定快照為 `data_source_test/ff47-thumbnail-index.csv` | 過渡 |

`DAY1`、`DAY2`、`DAY3` 工作表只用於核對活動配置，**不以同名推測社團身分**。

生成器（`scripts/generate-ff47-circle-templates.mjs`）只使用 Node.js 內建模組解析 XLSX／CSV，不依賴未鎖定的全域套件或即時網路資料。

## 官網攤位清單

官網頁面只公布「攤位編號 → 社團名」，沒有座標，因此它**不取代**帶幾何的 `BOOTHS`。它能執行的權威是另一件事：**場刊不得在沒有人記錄原因的情況下偏離官網。**

```bash
npm run official:check
```

比對線上三日頁面與本機快照，有差異就列出新增／移除／改名並以非零狀態結束，不修改檔案。確認後：

```bash
npm run official:update
```

解析對版面變動 fail closed：抓不到 `<table>`、單日列數低於 600、攤位編號不符 `[A-W]\d{2}`、同一攤位兩個名字，都會中止而不是寫入半份清單。

### 場刊與官網的一致性

```bash
npm run official:agreement
```

離線比對已提交的官網快照與 `circles.json`，已納入 `npm run build`。它會失敗於：

- 任一側獨有的攤位（`day:code` 網格不一致）。
- **未記錄的名稱衝突**——官網與工作簿對同一攤位給出不同社團名，而 `data_source_test/ff47-official-name-adjudications.json` 裡沒有這一筆。

已記錄的衝突不會擋 build，只會計入「尚未裁決」數。這是刻意的：擋在已知的積欠上，只會讓人把檢查刪掉。裁決一筆就把該筆的 `decision` 從 `unadjudicated` 改為 `official` 或 `catalog` 並寫下 `note`；衝突消失後，該筆要從檔案移除，否則檢查會報 stale。

FF47 目前的狀態：2,953 個攤位網格完全一致，26 筆名稱衝突全部待裁決。

## 管線

```
Google 試算表
  └─ npm run source:update
       └─ data_source_test/*.xlsx           版本化來源快照
            ├─ data/circle-identities/{allocations,evidence}.json
            └─ npm run catalog:generate
                 └─ app/ff47-circle-templates.generated.json   （+ .manifest.json 記錄 SHA-256）
                      └─ npm run catalog:snapshot
                           └─ public/data/events/ff47/circles.json   執行期讀取的快照
```

`npm run build` 會以 `catalog:check` 與 `catalog:snapshot:check` 逐位元組驗證快照與來源一致，再以 `official:agreement` 確認快照沒有偏離官網，任一項不一致就中止。**所有快照必須納入版本控制。**

## 更新流程

### 1. 先看差異

```bash
npm run source:check
```

若有差異，命令會列出各工作表新增、移除與變更的儲存格數量及最多 20 筆樣本，並以非零狀態結束，**但不修改檔案**。

比對以工作表名稱、儲存格值與公式為準，不會因 Google 每次匯出產生不同的 XLSX 封裝位元而誤判。下載失敗、回傳內容不是 XLSX、缺少主資料工作表或資料列異常過少時都會停止，不覆寫既有來源。

### 2. 確認後更新

```bash
npm run source:update
```

會依序下載並驗證 XLSX、替換本機來源、重新產生社團模板與來源 manifest，最後重新輸出 `circles.json`。

### 3. 審閱 identity registry 差異

`catalog:generate` 對同一 `eventId + source kind + source value` 沿用既有 `c-xxxxxx`。全新且沒有名稱候選的證據才會追加配號；只有名稱相符、來源重複或其他衝突時會 fail closed，輸出人工裁決報告。此時先確認是既有社團或新社團，再編輯 `evidence.json`，不得用名稱自動合併。

檢查 diff 時確認：`allocations.json` 只在尾端追加、`nextSequence` 單調增加；`evidence.json` 的來源不重複。`npm run catalog:check` 會驗證 registry、manifest 與產物同步。

### 4. 走完共同 gate 再 commit

見[本機開發與驗證](./local-development.md#驗證-gate)。

## 只重新生成、不同步來源

上游沒變但生成邏輯改了時：

```bash
npm run catalog:generate
```

驗證工作簿、縮圖快照與輸出未漂移：

```bash
npm run catalog:check
```

## 已知的來源修正

來源第 452 列的「攤位名稱」欄被填入貼文網址而非社團名。生成器以主辦當日攤位清單為權威修正該列（D09 = 紅色荔枝樹）。

**修正表以貼上的網址為鍵，不以列號為鍵**——上游插入一列會讓列號鍵的修正套到別的社團身上。任何名稱欄為網址但無對應修正的列，會讓生成器**失敗**而非發布出去。

## 生成結果的規模參考（FF47）

| 項目 | 數量 |
|---|---|
| 社團模板 | 1,341 |
| 配置 | 2,977 |
| 外部連結 | 5,791 |
| 販售資訊 | 500 |
| 具原始 Drive 連結的縮圖 | 262 |

投影後的社團數應**恰為模板數**。高於此數代表有攤位比不到模板而退回位置式身分，是必須修的漂移。上表是 2026-08-18 的實際數字，供對照用——它會隨上游成長，不是驗收門檻。

未出現在來源中的欄位不補值；沒有來源圖片時維持文字卡。
