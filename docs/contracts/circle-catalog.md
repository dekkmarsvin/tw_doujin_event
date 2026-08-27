# 社團目錄契約

社團身分、活動配置與社團自填內容的權威邊界。

**實作**：[`app/circle-records.ts`](../../app/circle-records.ts)、[`app/circle-overrides.ts`](../../app/circle-overrides.ts)
**身分權威**：`data/circle-identities/allocations.json` + `evidence.json`
**活動資料**：公開 data repo，由 `data/event-data-pins/<event>.json` 固定版本
**流程**：[社團資料更新](../runbooks/catalog-data-update.md)

## 權威順序

公開社團資料只有兩個組成：各活動主辦官方說明頁面建立的 reviewed base，以及社團本人經驗證後自填的 overlay。工作簿、社群試算表與其他第三方資料不具輸入、fallback 或補充地位。

1. `CircleRecord.id` 是專案內社團身分的唯一鍵；名稱不是身分。
2. 活動主辦資料決定社團名稱、日期、展區與攤位配置。
3. 活動定義選取 pinned category catalog；parser 投影出的 `circleCategories` 固定主辦公布的分類字彙與來源，但不表示主辦已替個別社團分類。
4. 社團本人只透過 `circle-overrides/1` 提供自己在該分類字彙中的一項主要類別、筆名、販售資訊、作品 facet、連結與代表圖。
5. 收藏、群組、備註與行程屬於使用者，不由 catalog 或 overlay 覆寫。

第三方工作簿不再是輸入、fallback 或補充來源。官方資料與 identity evidence 對不上時，build 必須失敗並要求審閱，不得用名稱猜測或虛構社團內容。

## 靜態 base：`circle-catalog/3`

```ts
type CircleCatalogPayload = {
  schema: "circle-catalog/3";
  eventId: string;
  generatedAt: string;
  circles: Array<{
    id: `c-${string}`;
    name: string;
  }>;
  placements: Array<{
    id: string;
    circleId: `c-${string}`;
    day: string | number;
    area: string;
    boothCode: string;
    status: "active" | "cancelled" | "moved";
    tone: "coral" | "mint" | "blue" | "amber" | "lilac";
  }>;
};
```

- `circles[]` 只含主辦可確認的 ID 與顯示名稱。
- `placements[]` 只含活動配置；座標由 event map 的 `boothCode` 解析，不重複存進 catalog。
- base 不含筆名、作品、分類、販售資訊、外部連結或代表圖。缺少內容時 UI 直接省略欄位。
- 分類的**選項集合**來自主辦分類目錄；分類的**逐社團值**不在 base，只有社團本人選擇後才出現在 overlay，並維持 `由社團填寫` 標示。
- `booths`、`templates`、`officialSupplementKeys` 與工作簿 `sourceRow` 都是退役欄位，任何一項出現在 staged payload 都使 build 失敗。

## 身分規則

- ID 是只增不減、不重排、不重用的 `c-xxxxxx` 配發序號，見 [ADR-0010](../adr/0010-circle-identity-is-an-allocated-serial.md)。
- 同一社團可在同日、跨日或跨活動有多筆 placement，仍沿用同一 ID。
- `evidence.json` 的正式活動證據為 `{ eventId, kind: "organizer-booth", value: "<day>:<booth>" }`。
- 同名不是合併依據；一個 booth 證據對到多個 ID、官方群組內的 booth 對到不同 ID、或目前名稱與官方名稱漂移時一律 fail closed。
- 已裁決的 migration 例外保存在 `ff47-official-migration-decisions.json`；它是稽核紀錄，不是執行期 fallback。
- 舊 `ff47-<hash>` ID 沒有相容路徑，見 [ADR-0013](../adr/0013-drop-the-legacy-circle-id-compatibility-path.md)。攤位 scoped ID 只由當前 records 即時解析。

## 社團 overlay

社團自填資料疊加在 base 之後，不得修改 `id`、`name` 或 placements。有效 overlay 會投影成：

- `provider: "社團本人"`
- `contentType: "circle"`
- `status: "unverified"`

沒有 overlay 時，所有自填欄位皆為空；「繼承」代表回到這個空的官方 base。代表圖只可能來自社團本人，因此 `media` 為空是常態，介面不得保留空框或佔位圖。

## 發布邊界

- 主 repo 不追蹤真實活動的 `event.json`、`official-booths.json`、`circles.json` 或 `map.json`。
- `npm run build` 使用 repo 內最小 fictional fixture，確保共同 gate 不依賴網路或真實活動資料。
- `npm run build:production` 先依 pin 下載並核對逐檔 SHA-256，再由官方 booth evidence 生成 v3 catalog，最後只把單一活動 staging 到 `dist`。
- overlay 無法取得時仍顯示完整的官方名稱與攤位 base；不得把 overlay 當成目錄存在的前提。

## 呈現契約

清單卡、完整詳情、地圖側欄與地圖 slot 都從同一個 `CircleViewRecord` 投影：

- 名稱與攤位在所有介面一致。
- 缺少作品、筆名、販售資訊或圖片時省略對應區塊，不補寫推測內容。
- 使用者選取、收藏或規劃的是 canonical circle ID；placement 只決定這次活動的日期與攤位。
- 活動主辦資料標示為「活動主辦單位」；社團補充資料標示為 `由社團填寫`。來源列不顯示驗證狀態或信任措辭（[ADR-0036](../adr/0036-provenance-labels-name-the-source-not-its-trust-level.md)）。
- 主要創作類別的篩選選項一律由 active event 的 `circleCategories` 投影，不保留工作簿分類或 UI 常數。

## 驗收條件

- fixture 與 pinned production build 都通過 `event-data:check`。
- 每個 placement 都指向唯一存在的 allocated circle ID，且每個官方 booth evidence 恰好產生一筆 placement。
- base payload 不含任何工作簿時代欄位或第三方個人檔案內容。
- overlay 不會移動、改名或拆分社團，且移除 overlay 後回到可完整使用的官方 base。
- 同一 ID 的多個 placement 在清單、詳情、地圖、收藏與行程中維持同一社團狀態。
