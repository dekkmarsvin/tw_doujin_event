# 社團資料更新

從上游試算表同步 FF47 社團資料，重新生成場刊快照，並確認既有認領沒有被打斷。

資料模型與身分規則見[社團目錄契約](../contracts/circle-catalog.md)。

## 來源

| 角色 | 位置 |
|---|---|
| 線上權威來源 | [FF47 Google 試算表](https://docs.google.com/spreadsheets/d/1LvbfijXkjcoK6nKw06U2YBZ655vcIXWvyEVX-pP0ovU/edit?usp=sharing) |
| 版本化本機快照 | `data_source_test/FF47 完整攤位整理.xlsx` |
| 社團模板來源工作表 | `攤位整理表 請在此填寫資訊`（FF47 為 1,336 筆具名稱的社團列） |
| 縮圖索引 | Excel 以 `IMPORTRANGE` 查詢的[公開縮圖索引](https://docs.google.com/spreadsheets/d/1f7uHQQgxgff8nh6aFDrh_cqkeFpcVPsvJILesm778_0/)，固定快照為 `data_source_test/ff47-thumbnail-index.csv` |

`DAY1`、`DAY2`、`DAY3` 工作表只用於核對活動配置，**不以同名推測社團身分**。

生成器（`scripts/generate-ff47-circle-templates.mjs`）只使用 Node.js 內建模組解析 XLSX／CSV，不依賴未鎖定的全域套件或即時網路資料。

## 管線

```
Google 試算表
  └─ npm run source:update
       └─ data_source_test/*.xlsx           版本化來源快照
            └─ npm run catalog:generate
                 └─ app/ff47-circle-templates.generated.json   （+ .manifest.json 記錄 SHA-256）
                      └─ npm run catalog:snapshot
                           └─ public/data/events/ff47/circles.json   執行期讀取的快照
```

`npm run build` 會以 `catalog:check` 與 `catalog:snapshot:check` 逐位元組驗證快照與來源一致，不一致就中止。**快照必須納入版本控制。**

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

### 3. 檢查認領是否還指得到社團

```bash
npm run claims:check
```

**這一步不能跳過。** `CircleRecord.id` 是 `FNV-1a(試算表列號 + 社團名)`，上游插入一列或社團改名都會讓其後**所有** ID 改變。這個檢查會列出失效的認領與補充資料，並用認領當下記錄的名稱建議新的 ID。

加上 `-- --remote` 可檢查正式環境的 D1：

```bash
npm run claims:check -- --remote
```

它刻意不放在 `npm run build` 裡——CI 沒有 D1 binding，放進去只會讓每次部署失敗，而不是抓到真正的漂移。

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
| 社團模板 | 1,336 |
| 配置 | 2,977 |
| 外部連結 | 5,137 |
| 販售資訊 | 336 |
| 具原始 Drive 連結的縮圖 | 262 |

投影後的社團數應**恰為 1,336**。高於此數代表有攤位比不到模板而退回位置式身分，是必須修的漂移。

未出現在來源中的欄位不補值；沒有來源圖片時維持文字卡。
