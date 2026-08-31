# 社團目錄契約

社團身分、活動配置與社團自填內容的權威邊界。

**實作**：[`app/circle-records.ts`](../../app/circle-records.ts)、[`app/circle-overrides.ts`](../../app/circle-overrides.ts)
**身分權威**：`data/circle-identities/allocations.json` + `evidence.json`
**活動資料**：公開 data repo，由 `data/event-data-pins/<event>.json` 固定版本
**流程**：[社團資料更新](../runbooks/catalog-data-update.md)

> **實作狀態（2026-08-30）**：[ADR-0039](../adr/0039-one-data-repo-for-events-and-references.md) 的 event-local 配號已由 [#116](https://github.com/dekkmarsvin/tw_doujin_event/issues/116)（PR #129）實作。`scripts/circle-identity-registry.mjs` 會在既有配號帶有其他活動證據時 fail closed，要求新活動配發新 ID。下方「新活動配號流程」描述的就是目前程式行為，不再是尚未出貨的 ADR 決策。

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

- **已公開發布**的 ID 是只增不減、不重排、不重用的 `c-xxxxxx` 配發序號。尚未公開的候選 registry／pin 沒有 Reader 連結、收藏或認領依賴，可以整組捨棄並重跑；首次公開發布才是不可回頭的邊界。見 [ADR-0010](../adr/0010-circle-identity-is-an-allocated-serial.md) 與 [ADR-0044](../adr/0044-an-accepted-circle-list-is-not-yet-catalogable.md)。
- 同一活動中，經主辦穩定鍵或可追溯主辦證據連結的同一社團可在同日或跨日有多筆 placement，仍使用同一 ID。不同活動不建立 identity linkage。
- `evidence.json` 的正式活動證據為 `{ eventId, kind: "organizer-booth", value: "<day>:<booth>" }`。
- 同名不是合併依據；一個 booth 證據對到多個 ID、官方群組內的 booth 對到不同 ID、或目前名稱與官方名稱漂移時一律 fail closed。
- **已發布名單的變動由人工宣告後套用，不由差異推論**，見 [ADR-0045](../adr/0045-list-changes-are-declared-not-inferred.md)。`circle-identity-groups/2` 的 `transitions` 宣告 `withdrawn`／`moved`／`released`；未宣告的差異維持 fail closed。
- **攤位換手時，新的社團拿到新的 ID。** 前一個社團的 `c-xxxxxx` 留在前一個社團身上——收藏與分享連結帶的正是它，讓 ID 跟著攤位走會使讀者收藏的社團某天變成別人。移動則相反：ID 跟著社團到新攤位。
- 退役的攤位證據保存在 evidence 的 `retiredSources`（`circle-identity-evidence/2`，只在真的有退役時寫入）。
- 已裁決的 migration 例外保存在 `ff47-official-migration-decisions.json`；它是稽核紀錄，不是執行期 fallback。
- 舊 `ff47-<hash>` ID 沒有相容路徑，見 [ADR-0013](../adr/0013-drop-the-legacy-circle-id-compatibility-path.md)。攤位 scoped ID 只由當前 records 即時解析。

### 新活動配號流程

- `c-xxxxxx` 仍由單一全域 ledger 配發；已公開發布的序號永不重用，不同活動不會出現相同 ID。
- 新活動的每個同活動 identity group 配發新 ID；不得因其他活動有相同名稱而沿用或要求 adjudication。
- 一個 identity group 可以包含同活動不同日期的主辦攤位群組，但必須由主辦來源的穩定鍵或人工確認的主辦證據明確連結。名稱只用於 drift 檢查，不得作為跨日合併依據；沒有 grouping 證據時必須 fail closed。
- 同一活動已存在的 reviewed source 重跑必須回到原 ID；一個 identity group 的所有 `<day>:<booth>` sources 只配發一個 ID，並逐一保存 source。
- 現行 repository pipeline 把新活動的 `allocations.json`／`evidence.json` 差異與該活動 pin 放在同一張 main PR；builder 的 evidence exact-coverage gate 不變。
- 首次公開發布前，registry 與 pin 都是候選，可一起捨棄並由同一份 reviewed source 重建；不得把工作樹中間配號誤寫成已發布相容性承諾。公開後若主辦名單退出、換手、移動或重編號，generator 不由差異推論，而要求人工宣告後套用（[ADR-0045](../adr/0045-list-changes-are-declared-not-inferred.md)）；宣告目前寫在 JSON 並以 CLI 套用，把它收進[主辦單位工作區](./organizer-workspace.md)的 UI 仍屬 [#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104)。

上述 main PR、pin 與 generator 是目前的發布實作，不是 Organizer 產品流程的永久限制。[主辦單位工作區](./organizer-workspace.md)已接管建立到送審；發布步驟接上之後，同樣的 evidence、validation 與發布後相容性規則必須成立，且不得把 repository workflow 暴露給主辦單位（[ADR-0046](../adr/0046-approved-organizer-publications-may-merge-app-owned-pull-requests.md)、[#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104)）。

data repo 的 `events/<eventId>/circle-identity-groups.json` 明列每個 identity group 的完整 booth sources：

```json
{
  "schema": "circle-identity-groups/1",
  "eventId": "event-alpha",
  "groups": [
    { "sources": ["1:A01", "1:A02"] },
    {
      "sources": ["1:B01", "2:B01"],
      "linkage": {
        "kind": "organizer-stable-key",
        "value": "application:1234",
        "reference": "https://organizer.example/applications/1234"
      }
    }
  ]
}
```

每個官方 booth source 必須恰好出現一次，同一官方群組不得拆分。合併兩個以上官方群組時，`linkage.kind` 只能是 `organizer-stable-key` 或 `manual-organizer-evidence`，並提供非空 `value` 與 `https` 主辦證據位置；名稱相同本身不符合 linkage。

## 社團 overlay

社團自填資料疊加在 base 之後，不得修改 `id`、`name` 或 placements。有效 overlay 會投影成：

- `provider: "由社團填寫"`
- `contentType: "circle"`
- `label: ""`
- `status: "unverified"`

沒有 overlay 時，所有自填欄位皆為空；「繼承」代表回到這個空的官方 base。代表圖只可能來自社團本人，因此 `media` 為空是常態，介面不得保留空框或佔位圖。

## 發布邊界

- 主 repo 不追蹤真實活動的 `event.json`、`official-booths.json`、`circles.json` 或 `map.json`。
- `npm run build` 使用 repo 內最小 fictional fixture，確保共同 gate 不依賴網路或真實活動資料。
- `npm run build:production` 依 [`data/published-events.json`](../../data/published-events.json) 逐一下載並核對逐檔 SHA-256，再由主辦 booth evidence 生成 v3 catalog，並把**每一個已發布活動** staging 到 `dist`。該檔案是 production 唯一列出活動的地方：新增活動是加一筆 pin 與一個 id，不改 `package.json`、不改 workflow、不新增活動專屬 constant。
- **pin 存在不等於已發布。** 未列在 `published-events.json` 的活動即使已有 pin 也不進入 build，對讀者不存在。這條界線對應 [ADR-0044](../adr/0044-an-accepted-circle-list-is-not-yet-catalogable.md) 的草稿／已發布分界。
- 讀者端的活動選擇器與 `event` 定址由 [ADR-0042](../adr/0042-the-public-entry-is-an-event-chooser.md) 定案並已實作：只有一個已發布活動時直接進入該活動，多個時先顯示選擇器，`?event=` deep link 一律直達。依生命週期分組仍是 P1（[#134](https://github.com/dekkmarsvin/tw_doujin_event/issues/134)）。
- **退出或移動的社團留在 catalog 裡**，而不是消失：它們是 `status` 為 `cancelled` 或 `moved` 的 placement，社團本身仍列在 `circles`。直接刪除會讓收藏與分享連結指向不存在的東西，讀起來像連結壞掉而不是「這個社團沒有參加」。Reader 如何呈現見下方「失效 placement 的呈現」。
- placement id：沒有新主人的攤位保留 `<day>-<code>`，換手的攤位由新主人取得該 id，離開的社團改用帶自己 ID 的形式，因此兩者都仍可被連結定址。
- overlay 無法取得時仍顯示完整的官方名稱與攤位 base；不得把 overlay 當成目錄存在的前提。

## 呈現契約

清單卡、完整詳情、地圖側欄與地圖 slot 都從同一個 `CircleViewRecord` 投影：

- 名稱與攤位在所有介面一致。
- 缺少作品、筆名、販售資訊或圖片時省略對應區塊，不補寫推測內容。
- 使用者選取、收藏或規劃的是 canonical circle ID；placement 只決定這次活動的日期與攤位。
- 活動主辦資料標示為「活動主辦單位」；社團補充資料標示為 `由社團填寫`。來源列不顯示驗證狀態或信任措辭（[ADR-0036](../adr/0036-provenance-labels-name-the-source-not-its-trust-level.md)）。
- 主要創作類別的篩選選項一律由 active event 的 `circleCategories` 投影，不保留工作簿分類或 UI 常數。

### 失效 placement 的呈現

`status` 不是 `active` 的 placement 在讀者端一律以文字說明，不只靠顏色或淡化（[#140](https://github.com/dekkmarsvin/tw_doujin_event/issues/140)）：

- 用詞只有兩種：`cancelled` 是「已取消參展」，`moved` 是「已移動攤位」。搜尋結果、社團詳細資訊、當日行程與地圖 slot 共用同一組字。
- **社團詳細資訊**說明這個攤位不再是目的地。`moved` 只有在同一活動內找得到該社團的 `active` placement 時才提供前往新攤位的操作；找不到就只說主辦沒有公布新位置，**不推測**新位置，也不新增轉址欄位。
- **地圖 slot** 只有在該攤位號沒有任何 `active` placement 時才整格標為失效；換手的攤位仍是有效目的地，由新主人的 placement 呈現。
- **收藏不因失效被刪除或改指其他社團**：收藏掛在 canonical circle ID 上，退出或換手都不改變它。
- **既有行程**顯示該社團時，同時顯示行程狀態與失效狀態；失效不改寫行程資料本身。
- 多 placement 的社團在當日行程與「下一站」解析到仍可前往的 `active` placement。

## 驗收條件

- fixture 與 pinned production build 都通過 `event-data:check`。
- 每個 placement 都指向唯一存在的 allocated circle ID，且每個官方 booth evidence 恰好產生一筆 placement。
- base payload 不含任何工作簿時代欄位或第三方個人檔案內容。
- overlay 不會移動、改名或拆分社團，且移除 overlay 後回到可完整使用的官方 base。
- 同一 ID 的多個 placement 在清單、詳情、地圖、收藏與行程中維持同一社團狀態。
- 同一 placement 的 `status` 在搜尋、詳情、地圖與行程的語意一致，且都不只以顏色表達。
