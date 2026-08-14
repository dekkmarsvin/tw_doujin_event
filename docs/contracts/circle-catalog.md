# 社團目錄契約

社團身分、活動配置與外部來源的權威關係，以及同一筆社團資料在三種介面的呈現規則。

**實作**：[`app/circle-records.ts`](../../app/circle-records.ts)、[`app/booth.ts`](../../app/booth.ts)、[`app/event-catalog.ts`](../../app/event-catalog.ts)
**身分權威**：`data/circle-identities/allocations.json` + `evidence.json`
**產物**：`app/ff47-circle-templates.generated.json` → `public/data/events/ff47/circles.json`
**流程**：[社團資料更新](../runbooks/catalog-data-update.md)

## 權威順序

1. **`CircleRecord.id` 是專案內社團身分的唯一鍵。** 名稱只是顯示與比對線索，不是身分。
2. **`PlacementRecord` 是活動、日期、區域與攤位定位的權威。** 外部頁面的攤位文字不得覆寫它。
3. **`SourceLink` 與 `CircleMedia` 是帶來源的補充資料。** 可失效、可停用，但不改變本地社團身分。
4. **社團自填的 overlay 疊加在快照之上，不取代快照。** 見 [社團自助控制面契約](./circle-portal.md)。
5. **使用者的收藏、群組、備註與行程屬於使用者。** 任何外部匯入都不得覆寫，見 [收藏與走訪規劃契約](./planning.md)。

## 領域模型

以下型別與 `app/circle-records.ts` 同步。欄位變更必須同時更新本文。

```ts
type SourceStatus = "linked" | "stale" | "unavailable" | "unverified";
type SourceContentType = "official" | "circle" | "catalog" | "social" | "media";

type SourceLink = {
  provider: string;
  contentType: SourceContentType;
  label: string;
  url: string;
  fetchedAt: string;
  status: SourceStatus;
};

type CircleMedia = {
  id: string;
  kind: "thumbnail";
  url: string;
  sourceUrl: string;
  provider: string;
  alt: string;
};

type CircleExternalLink = {
  provider: string;
  kind: "social" | "support" | "website" | "announcement" | "catalog" | "store" | "sample";
  url: string;
};

type CircleRecord = {
  id: string;
  sourceRow?: number;
  name: string;
  nameReading?: string;
  description: string;
  categories: string[];
  pen: string;
  work: string;
  creatorTypes: string[];
  ageRatings: string[];
  workTypes: string[];
  referencedWorks: string[];
  saleInfo: string;
  specialTags: string[];
  media: CircleMedia[];
  externalLinks: CircleExternalLink[];
  updatedAt: string;
  sources: SourceLink[];
};

type PlacementRecord = {
  id: string;
  eventId: string;
  circleId: string;
  day: Booth["day"];    // FF47 為 1 | 2 | 3
  area: Booth["hall"];  // 展區代碼；FF47 只有一個展區，見活動地圖契約
  boothCode: string;
  status: "active" | "cancelled" | "moved";
  x: number;
  y: number;
  tone: "coral" | "mint" | "blue" | "amber" | "lilac";
};

/** 讀取模型：一筆社團在一個攤位的投影。`recordId` 在來源 ID 相撞時仍唯一。 */
type CircleViewRecord = Booth & {
  recordId: string;
  sources: SourceLink[];
  circle: CircleRecord;
  placement: PlacementRecord;
};
```

`creatorTypes`、`ageRatings`、`workTypes`、`referencedWorks` 是**已正規化的搜尋 facet**，由資料生成階段建立，UI 只消費不再切割字串。原始標籤與來源值仍保留在 `specialTags` 與 `sources`。

## 社團身分規則

- **一個 `CircleRecord` 可對應多筆 `PlacementRecord`。** 同一份已裁決的 identity evidence 可跨日期、攤位與活動沿用一個 `CircleRecord.id`，各配置保留自己的 `PlacementRecord`。決策見 [ADR-0010](../adr/0010-circle-identity-is-an-allocated-serial.md)。
- **`CircleRecord.id` 是配發式 `c-xxxxxx` 流水號。** `allocations.json` 只增不減、不重排、不重用；名稱、列號與活動變更都不得重算 ID。
- **識別證據與配號分層。** `evidence.json` 可審閱更新目前名稱、歷史別名與跨活動來源；若只有名稱相符、來源衝突或一對多，生成器 fail closed 並輸出人工裁決資料，不自動合併。
- **`legacy-id-map.json` 永久保存舊 FF47 hash ID 對照。** 它由靜態 catalog 按需載入，供 planning schema 3 與舊 `selectedCircle` URL 使用，不進入閱讀端主 bundle。
- **同名不是合併依據。** 沒有人工核對證據時，同名的公開列維持分離。
- **沒有編號攤位的已知社團仍保留在目錄中**，但不虛構地圖位置。

### 模板匹配契約

生成器把 Excel 主資料列（社團模板）與主辦當日攤位清單接起來時：

1. 名稱先做 Unicode NFKC、前後空白與連續空白正規化。
2. 優先以「正規化名稱 + 活動日 + 攤位代碼」比對同一 Excel 列。
3. 只有名稱在主表中唯一時，才允許退回單一名稱匹配。
4. 名稱正規化只用於產生候選，**不回寫原始名稱**；日文、中文、空白與符號差異都保留可追溯的來源值。
5. 投影後的社團數必須恰為模板數（FF47 為 1,336）。高於此數代表有攤位比不到模板而退回位置式身分，屬於必須修的漂移，不是可接受的降級。

## 資訊密度契約

清單卡、完整詳情與地圖側欄從**同一個 `CircleViewRecord`** 投影，只調整密度，不複製資料，也不建立各自的欄位語意。

| 介面 | 任務 | 顯示 |
|---|---|---|
| 清單卡 | 快速掃讀與比較 | 社團名、攤位、主要作品／題材、最多一張代表圖、來源提示、收藏控制 |
| 完整詳情 | 完整閱讀 | 完整介紹、作品／販售資訊、`media[]` 全部圖片、外部來源連結、收藏分類、備註、行程動作 |
| 地圖側欄 | 位置決策 | 社團名、攤位、主要作品、收藏／行程狀態、最多六個外部連結、開啟完整詳情。不複製完整頁面的所有內容 |

- **核心欄位順序在三種介面一致**；缺少的欄位直接省略，不使用空白卡片或虛構內容補位。
- **社團身分不得和特定活動攤位欄位扁平綁死。** 同一社團在不同日期或區域有不同配置時，由 `circleId` 解析對應 `PlacementRecord`。
- **同一攤位有多筆社團時**使用緊密清單切換，不建立巢狀卡片。
- 地圖側欄的代表圖是**純圖片**：整張圖是開啟完整詳情的可聚焦按鈕，圖片上不得疊加作品、販售、攤位、DAY、提示文字或其他互動控制。攤位與日期放在資訊欄。

## 來源標示契約

- 外部圖片、介紹與連結旁必須顯示**提供者名稱或圖示、內容類型與「查看原始來源」連結**；不得呈現無來源圖片。
- 已匯入內容另顯示擷取／匯入時間。`FF47_EVENT.dataUpdatedAt` 是活動資料版本與逐來源 `fetchedAt` 的**單一日期來源**，避免頂部「資料最後更新」與詳情內各來源日期漂移。
- 來源為主辦公開資料時可標示「主辦來源」。**其他來源不得使用「官方」措辭**，除非資料本身可驗證該身分。
- `stale`、`unavailable` 與 `unverified` 使用**文字狀態**，不只靠圖示或色彩。
- 圖片缺少授權、來源 URL 或替代文字時不進入公開顯示；載入失敗時移除媒體區塊並保留文字核心資訊。
- 社團自填內容一律附 `provider: "社團本人"`、`contentType: "circle"`、`status: "unverified"`，顯示為「社團自述／尚未驗證」，且不提供偽造的原始來源連結。

## 驗收條件

- 同一社團的多個攤位從任一介面收藏後，其他配置顯示相同收藏、群組與備註；真正不同的同名社團仍保持分離。
- 投影後的社團數等於模板數；不等於時 build 失敗而非發布出去。
- 沒有來源標示或原始 URL 的外部圖片不會出現在公開社團介面。
- 同一社團的名稱、攤位、來源與收藏／行程狀態在清單、詳情、地圖 slot 與側欄一致，修改後不需重新整理。
- 外部來源無法連線時，本地社團詳情、地圖、收藏與行程仍可完成核心任務。
