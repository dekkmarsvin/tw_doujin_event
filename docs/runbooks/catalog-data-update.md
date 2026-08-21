# 社團與活動資料更新

真實活動資料由獨立、公開的 data repo 維護；程式 repo 只保存不可變 pin、社團身分 registry 與 fictional fixtures。FF47 data repo 是 [`dekkmarsvin/tw_doujin_event-data-ff47`](https://github.com/dekkmarsvin/tw_doujin_event-data-ff47)。

## 權威來源

| 資料 | 權威 |
|---|---|
| 活動名稱、日期、場館、主辦 URL | data repo `event.json` |
| 官方社團名與攤位配置 | data repo `official-booths.json`，來源為活動主辦單位 |
| 向量地圖 | data repo `map.json`，由人工審閱的 authoring revision 匯出 |
| 永久社團 ID | 本 repo `data/circle-identities/allocations.json` |
| booth 到永久 ID 的證據 | 本 repo `data/circle-identities/evidence.json` |
| 社團介紹、作品、連結、代表圖 | 社團本人透過 overlay 提供 |

第三方工作簿與原始配置圖不在本 repo，也不參與 production catalog 生成。

## 更新流程

### 1. 在 data repo 更新官方資料

更新 `event.json`、`official-booths.json` 或 `map.json`，依 data repo 的 provenance 說明檢查來源與差異，提交並推送。不要在程式 repo 直接建立真實活動快照。

### 2. 更新 identity evidence

每個官方 booth 以以下證據鍵連到一個永久 ID：

```json
{ "eventId": "ff47", "kind": "organizer-booth", "value": "1:A01" }
```

規則：

- 既有 booth 與既有社團沿用既有 ID。
- 新社團先在 `allocations.json` 追加下一個序號，再在 `evidence.json` 增加 entry。
- 只有名稱相同不足以合併；跨活動沿用或一對多情形必須人工核對可追溯證據。
- 改名保留 `previousNames`，並更新 `currentName`。
- 不刪除或重用已配發 ID。

FF47 從舊工作簿 evidence 遷移到官方 booth evidence 的七筆拆分紀錄保存在 `ff47-official-migration-decisions.json`。它只說明已完成的裁決，不應在日常更新時修改。

### 3. 更新 pin

把 data repo 的完整 40 字元 commit SHA 與三個 raw blob 的 SHA-256 寫入 `data/event-data-pins/<event>.json`：

```json
{
  "schema": "event-data-pin/1",
  "eventId": "ff47",
  "repository": "dekkmarsvin/tw_doujin_event-data-ff47",
  "commit": "<40-char commit>",
  "files": {
    "event.json": "<sha256>",
    "official-booths.json": "<sha256>",
    "map.json": "<sha256>"
  }
}
```

不得 pin branch、tag 或未逐檔核對的內容。

### 4. 本機驗證 production staging

```bash
npm run data:fetch -- ff47
npm run data:stage -- ff47
npm run event-data:check
npm run build:production
```

`data:fetch` 先下載到暫存位置、核對 SHA-256，再原子替換 `.event-data/<event>/`。`data:stage` 由官方 booth + identity evidence 生成 `circle-catalog/3`，並把該活動的 `event.json`、`circles.json`、`map.json` staging 到忽略版控的 `public/data/events/<event>/`。

以下任一情形會 fail closed：

- pin 的 commit 或 hash 不符；
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
