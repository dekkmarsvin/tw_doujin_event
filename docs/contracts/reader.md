# Reader 契約

讀者端（`/` 的地圖與逛品書、活動與社團介紹頁）的行為契約。資料由已發布的活動版本與社團補充資料組成，讀者不需登入。

## 社團目錄

社團身分、活動配置與社團自填內容的權威邊界。

**實作**：[`app/circle-records.ts`](../../app/circle-records.ts)、[`app/circle-overrides.ts`](../../app/circle-overrides.ts)
**身分權威**：活動資料 bucket 的 `registry/<version>/allocations.json` + `evidence.json`
**活動資料**：活動資料 bucket，見[部署 runbook](../runbooks/deployment.md#活動資料r2)
**流程**：[主辦單位工作區](./organizer-workspace.md)

### 權威順序

公開社團資料只有兩個組成：各活動主辦官方說明頁面建立的 reviewed base，以及社團本人經驗證後自填的 overlay。工作簿、社群試算表與其他第三方資料不具輸入、fallback 或補充地位。

1. `CircleRecord.id` 是專案內社團身分的唯一鍵；名稱不是身分。
2. 活動主辦資料決定社團名稱、日期、展區與攤位配置。
3. 活動定義選取 pinned category catalog；parser 投影出的 `circleCategories` 固定主辦公布的分類字彙與來源，但不表示主辦已替個別社團分類。
4. 社團本人只透過 `circle-overrides/1` 提供自己在該分類字彙中的一項主要類別、筆名、販售資訊、作品 facet、連結與代表圖。
5. 收藏、群組、備註與行程屬於使用者，不由 catalog 或 overlay 覆寫。

「逛品書」沿用這份權威邊界：僅將目前範圍與公開條件下的配置依 `CircleRecord.id` 聚合，不按名稱、共攤位置或圖片猜測身分或題材；代表圖不充作本次品書。有／無品書社團均能被找到，詳見[品書瀏覽契約](./reader.md#品書瀏覽)。

第三方工作簿不再是輸入、fallback 或補充來源。官方資料與 identity evidence 對不上時，build 必須失敗並要求審閱，不得用名稱猜測或虛構社團內容。

### 靜態 base：`circle-catalog/3`

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

### 身分規則

`official-booths.json` 的 `schemaVersion: 1` 群組保留 `codes[]`／`name`，並可帶已宣告的 `areaId`。新的 Organizer publication 必須從核准列逐筆固定 areaId，catalog 按此配置展區；不再把新活動全部攤位投到第一個展區。既有未帶 areaId 的 pinned 資料沿用原本第一展區相容讀取，bytes 不改寫。未知展區拒絕；場地由 event-definition 的唯一展區指派解析，不從 booth code 猜測。

- **已公開發布**的 ID 是只增不減、不重排、不重用的 `c-xxxxxx` 配發序號。尚未公開的候選 registry／pin 沒有 Reader 連結、收藏或認領依賴，可以整組捨棄並重跑；首次公開發布才是不可回頭的邊界。見 [ADR-0010](../adr/0010-circle-identity-is-an-allocated-serial.md) 與 [ADR-0044](../adr/0044-an-accepted-circle-list-is-not-yet-catalogable.md)。
- 同一活動中，經主辦穩定鍵或可追溯主辦證據連結的同一社團可在同日或跨日有多筆 placement，仍使用同一 ID。不同活動不建立 identity linkage。
- `evidence.json` 的正式活動證據為 `{ eventId, kind: "organizer-booth", value: "<day>:<booth>" }`。
- 名稱相同本身不是合併依據；新活動由主辦在預覽確認的跨日分組依 [ADR-0071](../adr/0071-organizer-review-confirms-cross-day-circle-grouping.md) 保存為明確 linkage；一個 booth 證據對到多個 ID、官方群組內的 booth 對到不同 ID、或目前名稱與官方名稱漂移時一律 fail closed。
- **已發布名單的變動由人工宣告後套用，不由差異推論**，見 [ADR-0045](../adr/0045-list-changes-are-declared-not-inferred.md)。`circle-identity-groups/2` 的 `transitions` 宣告 `withdrawn`／`moved`／`released`；未宣告的差異維持 fail closed。
- **攤位換手時，新的社團拿到新的 ID。** 前一個社團的 `c-xxxxxx` 留在前一個社團身上——收藏與分享連結帶的正是它，讓 ID 跟著攤位走會使讀者收藏的社團某天變成別人。移動則相反：ID 跟著社團到新攤位。
- 退役的攤位證據保存在 evidence 的 `retiredSources`（`circle-identity-evidence/2`，只在真的有退役時寫入）。
- 來源的唯一性限制現任歸屬；同一攤位換手後，原社團的退役證據可與新社團的現任來源共存，連續換手可保留多位舊社團。這些已發布結果可以作為下一次明確修正的 baseline，不重播已套用的 transitions。
- 同一社團移回舊攤位再移出時，evidence 保留歷次退役宣告；Reader 每個社團／攤位只投影最新退役狀態，攤位沿用大小寫不敏感的 location 比對。如果該社團目前仍持有此攤，僅投影 active，不同時呈現其歷史失效 placement。其他舊社團仍保留各自的失效 placement 與 Circle ID。
- 新修正的 transition 以選填 `areaId` 固定 baseline 來源展區，並保存於 `retirement.areaId`；Reader 依該展區投影，未知展區拒絕。舊宣告未含 `areaId` 時沿用第一展區，不猜補或改寫歷史 pin。
- 舊 `ff47-<hash>` ID 沒有相容路徑，見 [ADR-0013](../adr/0013-drop-the-legacy-circle-id-compatibility-path.md)。攤位 scoped ID 只由當前 records 即時解析。

#### 新活動配號流程

- `c-xxxxxx` 仍由單一全域 ledger 配發；已公開發布的序號永不重用，不同活動不會出現相同 ID。
- 新活動的每個同活動 identity group 配發新 ID；不得因其他活動有相同名稱而沿用或要求 adjudication。
- 一個 identity group 可以包含同活動不同日期的主辦攤位群組，但必須由主辦來源的穩定鍵或人工確認的主辦證據明確連結。主辦匯入預覽可按跨日同名自動分組並確認，核准 snapshot 固定此宣告與來源（ADR-0071）；一般 generator 不從名稱自行猜測，沒有 grouping 證據時仍 fail closed。
- 同一活動已存在的 reviewed source 重跑必須回到原 ID；一個 identity group 的所有 `<day>:<booth>` sources 只配發一個 ID，並逐一保存 source。
- 核准發布時，新活動的配號與 evidence 和活動檔案一起寫入活動資料 bucket 的新版本（#546）。
- 公開後若主辦名單退出、換手、移動或重編號，generator 不由差異推論，而要求人工宣告後套用（[ADR-0045](../adr/0045-list-changes-are-declared-not-inferred.md)）；宣告由[主辦單位工作區的修正候選](./organizer-workspace.md#已發布名單的明確修正宣告)填寫。

[主辦單位工作區](./organizer-workspace.md)核准後直接發布到活動資料 bucket；evidence、validation 與發布後相容性規則一樣成立。

活動資料 bucket 中各版本的 `circle-identity-groups.json`（發布輸入，不對外提供）明列每個 identity group 的完整 booth sources：

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

每個官方 booth source 必須恰好出現一次，同一官方群組不得拆分。合併兩個以上官方群組時，`linkage.kind` 只能是 `organizer-stable-key` 或 `manual-organizer-evidence`，並提供非空 `value` 與 `https` 主辦證據位置；名稱相同本身不符合 linkage；主辦在匯入預覽確認的跨日分組使用 `manual-organizer-evidence`，reference 指向核准官方來源。

### 社團 overlay

社團自填資料疊加在 base 之後，不得修改 `id`、`name` 或 placements。有效 overlay 會投影成：

- `provider: "由社團填寫"`
- `contentType: "circle"`
- `label: ""`
- `status: "unverified"`

沒有 overlay 時，所有自填欄位皆為空；「繼承」代表回到這個空的官方 base。代表圖只可能來自社團本人，因此 `media` 為空是常態，介面不得保留空框或佔位圖。

`media` 有兩種：`thumbnail` 是社團的一張代表圖，`catalog` 是本次品書的頁面（帶卡片預覽圖與可閱讀圖的寬高），依社團排定的順序排在代表圖之後。清單卡與地圖格子只使用代表圖，**永遠不以品書頁面代替**；品書不裁切（[ADR-0072](../adr/0072-sale-sheet-pages-are-prepared-in-the-browser-and-hosted-as-a-set.md)）。

### 發布邊界

- 主 repo 不追蹤真實活動的 `event.json`、`official-booths.json`、`circles.json` 或 `map.json`。
- `npm run build` 使用 repo 內最小 fictional fixture，確保共同 gate 不依賴網路或真實活動資料。
- 已發布的活動與讀者看到的順序只由活動資料 bucket 的 `index.json` 決定，部署的 build 不含活動資料。
- **只有經核准發布的活動會出現在 `index.json`。** 草稿與送審中的候選對讀者不存在，對應 [ADR-0044](../adr/0044-an-accepted-circle-list-is-not-yet-catalogable.md) 的草稿／已發布分界。
- 讀者端的活動選擇器與 `event` 定址由 [ADR-0042](../adr/0042-the-public-entry-is-an-event-chooser.md) 定案並已實作：只有一個已發布活動時直接進入該活動，多個時先顯示選擇器，`?event=` deep link 一律直達。依日期狀態分組見 [URL 檢視狀態契約](./reader.md#規則)。
- **退出或移動的社團留在 catalog 裡**，而不是消失：它們是 `status` 為 `cancelled` 或 `moved` 的 placement，社團本身仍列在 `circles`。直接刪除會讓收藏與分享連結指向不存在的東西，讀起來像連結壞掉而不是「這個社團沒有參加」。Reader 如何呈現見下方「失效 placement 的呈現」。
- placement id：沒有新主人的攤位保留 `<day>-<code>`，換手的攤位由新主人取得該 id，離開的社團改用帶自己 ID 的形式，因此兩者都仍可被連結定址。
- overlay 無法取得時仍顯示完整的官方名稱與攤位 base；不得把 overlay 當成目錄存在的前提。

### 呈現契約

清單卡、完整詳情、地圖側欄、地圖 slot 與社團介紹頁都從同一個 `CircleViewRecord` 投影：

- 名稱與攤位在所有介面一致。
- 缺少作品、筆名、販售資訊或圖片時省略對應區塊，不補寫推測內容。
- 使用者選取、收藏或規劃的是 canonical circle ID；placement 只決定這次活動的日期與攤位。
- 活動主辦資料標示為「活動主辦單位」；社團補充資料標示為 `由社團填寫`。來源列不顯示驗證狀態或信任措辭（[ADR-0036](../adr/0036-provenance-labels-name-the-source-not-its-trust-level.md)）。
- 主要創作類別的篩選選項一律由 active event 的 `circleCategories` 投影，不保留工作簿分類或 UI 常數。
- **介面語言只翻譯站方固定標籤。** 連結種類、來源列與「全部類別」等站方固定選項依介面語言顯示，篩選與儲存仍使用原值；活動、社團、場地、展區名稱、官方分類、作者、簡介與社團自填內容一律顯示原始登記，未知或舊選項保留原值。

#### 社團介紹頁

`circlePath(eventId, circleId)` 是社團可以拿去分享的本次出展頁，一個社團一頁，涵蓋它在這場活動的全部日期、攤位與場地。靜態部分與載入方式見[資料傳輸與離線契約](./reader.md#社團介紹頁的頁面腳本)。

- 依序呈現：社團名稱、活動日期與場館、收藏與分享；參展攤位卡；社團填寫的內容（本次品書、販售資訊、作者與作品、代表圖、連結，最後是 `由社團填寫` 與最後更新日期）。欄位標籤與社團編輯器相同。
- **參展攤位以卡片呈現，一張卡是一個活動日的一個地點。** 同一天同一地點的攤位並列在同一張卡，攤位代碼放大並帶該攤位在地圖上的分類色；卡片寫出日期、場館、使用空間與展區，附「在地圖查看」。已取消或已移動的攤位另成一張卡，寫出狀態文字、代碼不帶分類色。卡片依日期排序，同日可前往的卡片在前。這些都是靜態 HTML，不需要腳本。
- 收藏與分享在社團名稱下方；540px 以下固定在畫面底部。分享在支援系統分享的瀏覽器開啟分享面板，否則複製這一頁的網址。
- 本次品書排在社團填寫內容的最前面，每張以不超過原尺寸的大小完整顯示並預留尺寸，點圖片即開啟原圖，不另設連結；單張載入失敗只影響那一張，以文字說明。
- 代表圖完整顯示，不裁切，點圖片同樣開啟原圖；載入失敗時以文字說明，不留空框。
- **行程只能加入社團實際可前往的日期。** 「加入這天行程」放在每個可前往活動日的第一張攤位卡上，一天一個；按鈕的可讀名稱附上日期。已取消或已移動的攤位卡不提供，完全沒有可前往日期時頁面上就沒有這個動作，卡片的狀態文字說明原因。不以「今天」或第一筆配置代替讀者的選擇。
- 收藏、取消收藏的七秒復原與行程都寫入同一個 planning store，與地圖一致；頁面不另存狀態。
- 頁尾提供「認領／管理資料」連結，帶入活動及社團。

#### 失效 placement 的呈現

`status` 不是 `active` 的 placement 在讀者端一律以文字說明，不只靠顏色或淡化（[#140](https://github.com/dekkmarsvin/tw_doujin_event/issues/140)）：

- 用詞只有兩種：`cancelled` 是「已取消參展」，`moved` 是「已移動攤位」。搜尋結果、社團詳細資訊、當日行程與地圖 slot 共用同一組字。
- **社團詳細資訊**說明這個攤位不再是目的地。`moved` 只有在同一活動內找得到該社團的 `active` placement 時才提供前往新攤位的操作；找不到就只說主辦沒有公布新位置，**不推測**新位置，也不新增轉址欄位。
- **地圖 slot** 只有在該攤位號沒有任何 `active` placement 時才整格標為失效；換手的攤位仍是有效目的地，由新主人的 placement 呈現。
- **收藏不因失效被刪除或改指其他社團**：收藏掛在 canonical circle ID 上，退出或換手都不改變它。
- **既有行程**顯示該社團時，同時顯示行程狀態與失效狀態；失效不改寫行程資料本身。
- 多 placement 的社團在當日行程與「下一站」解析到仍可前往的 `active` placement。

### 驗收條件

- fixture 與 pinned production build 都通過 `event-data:check`。
- 每個 placement 都指向唯一存在的 allocated circle ID，且每個官方 booth evidence 恰好產生一筆 placement。
- base payload 不含任何工作簿時代欄位或第三方個人檔案內容。
- overlay 不會移動、改名或拆分社團，且移除 overlay 後回到可完整使用的官方 base。
- 同一 ID 的多個 placement 在清單、詳情、地圖、收藏與行程中維持同一社團狀態。
- 同一 placement 的 `status` 在搜尋、詳情、地圖與行程的語意一致，且都不只以顏色表達。

## 活動地圖

公開閱讀端的向量地圖：資料不變量、renderer 邊界、互動與縮放規則。

**實作**：`app/map-shape-geometry.ts`、`app/map-shape-drawing.tsx`
**測試**：`tests/map-shape-geometry.test.mjs`
**實作**：[`app/map-annotations.ts`](../../app/map-annotations.ts)、[`app/map-annotation-drawing.tsx`](../../app/map-annotation-drawing.tsx)、[`app/staged-event-data.ts`](../../app/staged-event-data.ts)
**測試**：`tests/map-annotations.test.mjs`、`tests/map-contribution-draft.test.mjs`、`tests/map-contribution-handlers.test.mjs`、`tests/publication-artifacts.test.mjs`

**實作**：[`app/accessible-event-map-renderer.tsx`](../../app/accessible-event-map-renderer.tsx)、[`app/event-map.ts`](../../app/event-map.ts)、[`app/map-viewport.ts`](../../app/map-viewport.ts)、[`app/use-map-viewport.ts`](../../app/use-map-viewport.ts)、[`app/map-label-presentation.ts`](../../app/map-label-presentation.ts)、[`app/map-marker-presentation.ts`](../../app/map-marker-presentation.ts)、[`app/map-marker-icons.tsx`](../../app/map-marker-icons.tsx)、[`app/map-facility-directory.ts`](../../app/map-facility-directory.ts)、[`app/map-facility-panel.tsx`](../../app/map-facility-panel.tsx)、[`app/map-view-state.ts`](../../app/map-view-state.ts)
**測試**：`tests/map-viewport.test.mjs`、`tests/map-desktop-geometry.test.mjs`、`tests/map-label-renderer.test.mjs`、`tests/map-marker-presentation.test.mjs`、`tests/map-view-state.test.mjs`、`tests/map-import.test.mjs`、`tests/browser/map-viewport.mjs`
**活動資料**：`map.json`（只有一組「活動日 × 場地」，或尚未改用 scoped map 的既有活動）或 `map-manifest.json` + `maps/<periodKey>/<venueSpaceId>.json`（多組），存在活動資料 bucket 的版本目錄，讀者依 `index.json` 列出的版本讀取
**流程**：[地圖 authoring](../runbooks/map-authoring.md)

一般使用者不上傳圖片、看不到管理入口。公開頁面只讀取隨 build 發布的已驗證靜態快照——決策見 [ADR-0008](../adr/0008-static-public-reading-path.md)。原始配置圖只供 authoring 階段辨識與對照，**不作為前台底圖**。

### 地圖資料不變量

- 座標使用原始配置圖的像素座標；沒有配置圖時使用建立空白地圖時指定的畫布尺寸。`width`、`height` 定義 SVG `viewBox`，所有元素都在同一座標空間。
- `rows[].label` 在同一 layout 中唯一。排號與方向由該活動的 template adapter 決定，不是共用 schema 常數。
- `rows[].labelSide` 為選填的 `above`／`below`／`left`／`right`，指定整排標籤位於上／下／左／右側。缺省維持直排上方、橫排下方；不改攤位幾何、代碼或編號次序。U 形及中斷排以整排外框定位，不依 slots 順序猜側邊。草稿、複製、預覽與 publication 保留設定；既有快照不用遷移，新欄位使用前須由 Pages 與 publication Worker 的共用驗證版本支援。
- slot 掛在排底下（`rows[].slots[]`，`EventMapLayout` 沒有頂層 `slots`）；`code` 在同一 layout 中唯一。slot 保存矩形 `x/y/width/height`，互動使用 slot 而非圖片座標點。
- pillar 必須保存 `x/y/width/height`；access point 必須保存 `kind`（`entrance`、`exit` 或出入兩用的 `both`；`both` 的方向指向場內）、位置與方向。
- `servicePoints` 是**選填**欄位：每個服務設施保存唯一 `id`、`kind`（`toilet`、`accessible-toilet`、`information`、`cloakroom`、`first-aid`、`stairs`、`elevator`、`ticket-office`、`changing-room` 九類固定）、畫布內的 `x/y`，以及選填、40 字以內的 `label`。`ticket-office` 為售票處（票券圖示）、`changing-room` 為更衣室（上衣圖示），與 `cloakroom` 寄物處（衣架圖示）分開；更衣與寄物合用區可分別放置兩種設施點並命名。編輯器、Reader 與設施清單共用圖示及名稱。服務設施出現以前發布的快照沒有這個欄位，不需遷移；沒有服務設施的 layout 也不必帶空陣列。舊七類資料維持有效，新種類須由已支援的草稿 API、Reader 與 publication Worker 一起消費。
- `areaRegions` 是選填欄位：每塊保存唯一 `id`、所屬的匯入 `areaId`、固定淡色 palette 的 `color` 與至少三個畫布內 `points`。同一展區可有多塊不規則範圍，顏色必須一致；核准前以該活動日 × 場地所宣告的展區代碼驗證。舊地圖沒有此欄位仍有效。
- `spaceMarks` 是選填的獨立保留／取消格集合：每格保存集合內唯一 `id`、`kind`（`reserved` 保留空桌／`cancelled` 取消攤位）與畫布內有效 `rect`，不含攤位代碼或社團資料。它不計入攤位覆蓋、社團數、搜尋、收藏、行程或設施清單，也不能抵銷 `missing_booth`；仍有有效配置時須先按既有流程修正名單。舊圖無此欄位時維持原樣；草稿、地圖複製、preview 與 publication 保留新集合，新內容使用前須由 Pages 與 publication Worker 共同支援。
- layout JSON 必須通過 `validateEventMapLayout` 才能進入 renderer 或持久化層。
- `notes` 與 `paths` 為選填獨立集合，舊圖沒有它們仍有效。`notes[]` 保存集合內唯一 `id`、非空純文字 `text` 與有效畫布內 `rect`；文字最多 120 字、3 行（換行為 `\n`），控制字元拒絕，HTML 只當文字。`paths[]` 保存集合內唯一 `id` 與依方向排序的 2–100 個有限、畫布內 `points`，相鄰點不可重複，箭頭沿最後一段指向末點。沒有任意 SVG、HTML、圖片或外部連結欄位。草稿嚴格拒絕未知欄位與不合長度／幾何限制的資料。
- 短註記可含官方時段原文，例如「社團入場 9:30–10:30」，它只屬於這張活動日 × 場地地圖的人工維護文字；不解析時間、不同步其他活動日或活動資料、不依時間切換、不產生提醒。複製保留原文，主辦須核對新活動日，修改複本不回寫來源。註記與箭頭不進設施目錄、不計攤位覆蓋或產生社團操作。
- 草稿可保存尚未移開攤位的註記；編輯器提示文字矩形與攤位重疊、折線或箭頭頭部穿過攤位。送審、候選 publication 與 staged artifact 以同一 `annotationBoothConflicts` 拒絕這些碰撞，須由作者調整，不以 Reader 靜默刪除動線資訊。合格內容經 clone／history／縮放／preview／publication 保留，新內容使用前須由 Pages 與 publication Worker 一起支援。
- **FF47 adapter 完整性規則**：23 排（A–W）、988 格（A 22、B–V 21×44、W 42）、28 根柱子、5 個出入口。其他活動只套用自己的 adapter 或通用 layout 驗證。

### 快照的來源語意

已發布快照的 `sourceName` 與 `confidence` 一起說明這份 layout 是怎麼來的：

- **`sourceName` 是必填的可追溯欄位，不是檔名欄位。** 由 authoring 介面的「來源說明」提供，上傳配置圖時預填檔名，人工繪製時由維護者自行填寫（例：`描摹自 2025_FFK_map.jpg`）。空白不得發布。
- **`confidence` 只有在來源是圖片辨識時才是辨識信心。** 人工繪製與描摹一律送 `1`，並在 authoring 介面標示為「人工繪製」。
- 因此**已發布快照本身無法區分人工繪製與滿分辨識**，追溯只靠 `sourceName` 的文字。要在資料層真正區分，需要另加 provenance 欄位；該取捨與延後理由見 [ADR-0035](../adr/0035-new-event-onboarding-is-data-driven.md)。
- **辨識是選配。** 沒有註冊辨識 adapter 的 template 仍可 authoring：上傳的配置圖成為描摹底圖，攤位由「新增一排」建立。缺少 adapter 不是錯誤狀態。

**場館、場地與展區是三件事**，見 [`CONTEXT.md`](../../CONTEXT.md)。場館與場地名稱由 event definition 選取的 pinned reference records 投影；展區是活動在某個場地內定義的攤位／展示分區。**契約不寫死當期名稱**——那是每場活動各自的 verified reference data。

Reader 只切換場地，不提供展區篩選。每個活動日 × 場地顯示該場地全部展區的攤位；`areaMode` 仍描述名單是否分區，不決定 Reader 控制項。展區代碼保持來源資料，選填顯示別名只改畫面名稱。FF47 的 `ALL`、`A`、`B` 仍是同一個場地的資料代碼，不會拆成場地。

**地圖 artifact 的單位是「活動日 × 場地」，不是場地。** 同一個場地可能隔夜重新配置——CWT*K51 高雄場兩天的攤位排法與格數都不同——所以「幾份地圖」由這兩者的組合數決定，見 [`eventUsesScopedMaps()`](../../app/event-catalog.ts)。它與 `eventUsesVenueSpaceSwitcher()` 是兩件事：後者只決定 reader 要不要出現場地切換，單一場地的活動無論幾天都是 false。

形狀由 [`app/event-map-manifest.ts`](../../app/event-map-manifest.ts) 與 [`app/staged-event-data.ts`](../../app/staged-event-data.ts) 決定：

- **只有一組「活動日 × 場地」**：一份 event-level `map.json`。
- **多組**：`map-manifest.json`（`event-map-manifest/1`）列出每一組及其 `maps/<periodKey>/<venueSpaceId>.json` 路徑。reader 依目前的 period 與 venue space 取用對應的一份。
- **多組但沒有 manifest**：退回單一 `map.json`，視為每一天共用同一份配置。這是 scoped map 出現以前發布的活動（FF47 與 fixtures）的形狀，**不是**可以省略 manifest 的許可。

manifest 一旦存在，規則就是 fail closed：`eventId` 必須與活動相符，`path` 必須恰好等於由 scope 推導出的路徑，scope 不得重複，且必須**恰好覆蓋**每個活動日 × 每個場地一次。缺一份、多一份或路徑不符都在 staging 階段就失敗，不會產生一份假裝涵蓋多組 scope 的 layout。多場地的活動仍然**必須**提供 manifest；退回 `map.json` 只適用於單一場地。

`Booth["hall"]` 存的也是展區代碼，不是場館。欄位名是讀取模型的歷史遺留；公開 catalog v3 使用 `placement.area`，文件一律用「展區」。

資料模型不得把 FF47 的 A–W、988 格或特定場館幾何當成所有活動的固定規則。

### Renderer 邊界

文字註記及折線採編輯器與 Reader 共用 drawing，完整純文字與箭頭方向都有可讀名稱。它們置於攤位下層且 `pointer-events:none`，不攔截攤位操作；文字依實際地圖倍率及 Reader 字級縮放，必要時縮字以保留全文，多行總高與文字寬度始終在作者指定矩形內。放大有螢幕字級上限，不改地圖座標或時間字串。

`AccessibleEventMapRenderer` 是深模組，穩定 interface 只接受已整理好的顯示資料與選取事件：

```ts
type AccessibleEventMapRendererProps = {
  eventName: string;
  layout: EventMapLayout;
  slots: Record<string, MapSlotView>;
  showMedia?: boolean;
  showAreaRegions?: boolean;
  areaLabels?: Record<string, string>;
  labelPresentation?: { screenScale: number; targetPx: number; paddingPx: number };
  markerPresentation?: { screenScale: number; fontScale: number };
  locatedMarker?: string | null;
  onFocusCode?: (code: string | null) => void;
  onSelect: (code: string) => void;
};
```

- `slots[boothCode]` 已包含標籤、可讀名稱、色調，以及 selected、favorite、planned、next、visited 顯示狀態。
- 展區底色在 floor 上、攤位與設施下，無 pointer 事件；範圍有代碼與名稱的可讀標示，名稱也畫在圖面，不能只靠顏色辨識。Reader 低／中倍率顯示，145% 起隱藏，縮回即恢復，不調整視域。
- `retired` 只在該攤位號沒有任何 `active` placement 時帶 `cancelled` 或 `moved`；renderer 以形狀區分兩者（取消是叉、移動是箭頭），文字說明由 controller 投影進 `label` 與 `ariaLabel`，**不以顏色作為唯一狀態表達**。換手的攤位不算失效，仍由新主人的 placement 呈現。placement 狀態的完整語意見 [circle catalog 契約](./reader.md#社團目錄)。
- **renderer 不自行讀取社團資料、規劃 store 或 URL**，也不寫入產品狀態。
- 頁面 controller 負責把 URL、社團資料、收藏與行程投影成 renderer props，並在 `onSelect` 後同步 URL 與詳情。
- 桌機傳入 layout 單位到 CSS px 的實際比例與標籤策略；手機不傳 `labelPresentation`，攤位代碼沿用舊顯示策略。`markerPresentation` 兩種斷點都傳入同一個比例與字級倍率，只管出入口、排標籤與非一般攤位區名稱（見[設施標示](#設施標示)）；沒有傳入的預覽以一個 layout 單位當一個 px。renderer 不量測 DOM，焦點通知不修改 URL 或選取。
- `locatedMarker` 是讀者剛從設施清單定位的標示鍵（`access:<id>`、`landmark:<id>`），renderer 為它畫外框；何時清除由頁面 controller 決定。
- 這個邊界讓地圖可獨立測試，也讓同一份 layout 未來能投影出 minimap 而不維護第二套座標。

### 互動契約

- **SVG slot 本身是互動元素。** 禁止在圖片上疊 HTML 按鈕。
- **鍵盤**：攤位使用單一 Tab 入口的 roving focus，限制大量 Tab 停靠點；方向鍵依幾何鄰近攤位移動，Enter／Space 開啟。
- 選取攤位移入前景圖層後保留鍵盤焦點；桌機固定提示優先顯示使用者移動的鍵盤焦點代碼，離開 SVG 後恢復選取代碼。**提示只用一個狀態詞彙**「已選取」，不另寫「鍵盤焦點」。取消選取後的程式焦點還原是例外：提示回到「選取攤位查看社團」，不重新宣告已選取；下一次使用者移動焦點再提示完整代碼。
- **可讀名稱**：可互動 slot 的 `aria-label` 必須包含攤位、社團、類別**以及所有目前規劃狀態**（已收藏、待前往、下一站、已走訪）。視覺標記與文字狀態由同一投影產生，狀態變更後即時更新。
- **指標與觸控**：滑鼠拖曳平移、游標中心滾輪縮放、觸控單指平移與雙指縮放（pointer capture）。空白地圖區支援拖曳；攤位本身保留點按，不觸發背景拖曳。
- 地圖容器與 SVG 文字套用不可選取規則，並由 `selectstart` 防線阻止拖曳時產生文字反白。
- **固定控制器**（放大、縮小、重設、指南針）固定在地圖邊緣，不隨 SVG 縮放。重設回到完整可用範圍。
- 桌機的「查看全場」收起詳情、恢復 fit，保留選取、分享 URL 與規劃資料。桌機詳情 X／Escape、手機摘要「取消選取」／Escape 則取消選取與未完成定位、移除社團及攤位 URL 參數，保留視域及其他條件；詳情與手機摘要收合列都消失。焦點回觸發來源，SVG 因圖層變更被替換時回同一攤位，來源不可見時退回作用中工作入口。手機把手收合仍保留選取、URL 與可重開的社團列；探索／行程的「收起」只收合工作面板。回結果恢復列表捲動及焦點；完整資訊 X／Escape／遮罩返回原摘要或詳情、保留選取及觸發焦點。見 [ADR-0063](../adr/0063-reader-dismissal-clears-selection.md)。
- 手機完整資訊在同一底部面板展開；收合、摘要、完整三段均保留橫向把手，可拖曳、點按或使用上下方向鍵。完整內容獨立捲動，把手收合保留選取；取消選取仍依 ADR-0063。桌機完整資訊沿用 dialog。
- `prefers-reduced-motion` 時停用轉場；拖曳與縮放維持直接跟手，不加入彈性或慣性動畫。
- **點兩下放大**：在空白地圖區於 350ms 內、24px 內點兩下（滑鼠或觸控皆同），以第二下的位置為中心放大一級，級距與放大按鈕相同；已到上限時不動作。按下後移動超過 3px 算拖曳，不算點按；攤位、按鈕與浮層上的點按不計入，所以攤位點兩下仍是選取。
- **設施清單**：地圖有具名出入口、服務設施或具名非一般攤位區時，固定控制器多一個「設施」按鈕；沒有就不顯示。清單列出每個具名出入口、每個服務設施（依類型排在一起，沒有名稱的以類型稱呼），以及名稱只出現一次的非一般攤位區；多個區塊共用的名稱（例如一整片「企業攤」）只在圖例說明一次。圖例只列這張地圖畫出的東西（入口、出口、出入兩用、各類服務設施、柱子、共用名稱）。開啟時焦點移到第一項；Escape 關閉並回焦按鈕；外部按壓關閉清單但不攔下那次地圖操作，按壓結束時焦點若沒有移到別處（攤位、欄位、按鈕）就回到按鈕。選一項後關閉清單、回焦按鈕，地圖**只移動不改倍率**把該設施移到可用矩形中央並畫外框；不改攤位選取、URL 或規劃資料。外框保留到下一次地圖操作（按下地圖、滾輪、縮放按鈕、查看全場、選取攤位）；換日、換場地、上一頁恢復都清除外框並關閉清單。手機的按鈕在「查看全場」左側，不加高右側控制欄；開啟清單時工作面板先收合，面板展開到最高段時清單關閉。

#### 設施標示

出入口與服務設施徽章，以及出入口、服務設施、排標籤與非一般攤位區名稱，都以**螢幕 px** 繪製：renderer 在 layout 錨點放一個抵銷縮放的群組，大小不隨地圖倍率改變。尺寸與取捨在 [`layoutMapMarkerLabels()`](../../app/map-marker-presentation.ts) 一處決定，不量測 DOM。

- **出入口徽章固定 22px**：入口是圓形、出口是方形、出入兩用是菱形，箭頭指出通行方向（出入兩用是雙向箭頭），**形狀本身區分三者**，不只靠顏色。徽章在任何倍率都畫，不參與隱藏。
- **服務設施徽章固定 21px**：同一個圓角方形，以內部圖示區分類型（廁所 WC、無障礙輪椅、服務台 i、寄物衣架、醫護十字、樓梯、電梯上下箭頭），不以顏色區分。只有自己的名稱才畫在徽章下方；沒有名稱的只畫徽章。
- **名稱有螢幕字級上下限**，下限與上限都乘上讀者的字級倍率：出入口 11–14px、排標籤 12–28px、非一般攤位區 11–28px。出入口與排標籤在上下限之間沿用原本的 layout 字級（10、22 單位），因此一般放大下的比例不變；非一般攤位區名稱依區塊大小決定：放得下時至少 16px，區塊更大時取可容納字級的六成，隨區塊大小與倍率縮放。
- **出入口名稱放在朝場外那一側**：入口與出入兩用在箭頭後方、出口在箭頭前方；排標籤從整排外框的 13 單位間隔起算，在所選側往外長，字變大也不壓到自己的攤位。名稱靠近圖面邊緣時沿自己那一側滑回圖面內，不往徽章或本排攤位方向移。出入口與服務設施的名稱滑回後仍超出圖面（例如徽章貼著圖面下緣、名稱畫在下方）時，改放到徽章另一側，照常參與下面的重疊檢查；兩側都放不下才不畫。排標籤不換側；所選側無法容納完整文字時不畫，排號仍保留在攤位可讀名稱中。非一般攤位區名稱也沒有另一側可換。
- **非一般攤位區名稱必須放得進自己的區塊**（多邊形以文字框實際落在形狀內判斷）：放不下時先縮字，縮到下限仍放不下就不畫。單行之外，也比較分成兩、三行與一字一行直排；換排法能讓字明顯變大（至少 1.25 倍）才採用，所以瘦長區塊自動直排，已達上限的名稱不拆行。連續英數字（WC、B1、14:30）不拆開。
- **名稱不互相重疊**：出入口與服務設施徽章先佔位，再依「出入口、排標籤、服務設施、非一般攤位區」的順序放名稱，會與已放置者重疊的就不畫。寬度以字元數保守估計，寧可少畫一個也不畫出重疊。
- 被省略的名稱仍在可讀名稱中：出入口、服務設施與具名區塊各自是 `role="img"`，名稱含類型（「一般入口，入口」、「北側，醫護站」，沒有名稱的服務設施就是「廁所」）；排號已在每一格攤位的可讀名稱裡。名稱加淺色描邊，壓在攤位上仍可辨認。

#### Slot 視覺狀態

未配置攤位低對比；有社團的攤位採分類色淡底；selected 使用實色與 3px 深色描邊；favorite 加入珊瑚圓點；next 加入深墨箭頭。**任何狀態都不得只靠顏色表達**，必須有形狀或文字補充。

保留／取消格與一般攤位分開：保留空桌用虛線外框及「空桌」，取消攤位用交叉線及「取消」，完整可讀名稱分別為「保留空桌」與「取消攤位」。Editor、Reader 預覽及公開圖共用繪製規則；短文字限在格內，隨倍率保持有界字級，格子太小時仍由線型區分。Reader 標記位於一般攤位下層、不接受指標及鍵盤攤位操作；即使標記畫在現有攤位位置，也不會改寫其社團狀態或遮掉攤位控制。

### 縮放契約

- **最大放大倍率 600%。**
- **首次開啟採全場 fit，不使用固定 125%。** 不等待規劃資料，也不自動跳到收藏、下一站或行程第一站。
- **最小倍率是動態下限**：桌機為 `min(rect.width / floorWidth, rect.height / floorHeight, 6)`，矩形本身已對 map 邊界與固定工具各留 16px，內部不再加 padding；手機亦使用矩形 fit，扣除右側控制欄、頂部工具與收合底部預留（實測 dock 導航高度加 58px（14px 把手與 44px 社團列）），對邊界與工具保留 16px。桌機矩形扣除固定頂部工具與底部控制。查看全場、按鈕、滾輪與雙指縮放共用下限，查看全場把完整 layout 置中於該矩形。
- 桌機 fit 使用詳情收起時的工具尺寸，由不參與焦點與可存取樹的測量容器取得；詳情開關不改變下限。761–1050px 開啟詳情時暫時收起 248px 左欄，fit 仍用左欄可見時的寬度與工具尺寸，避免欄位收合被當成視窗 resize。選取定位另用實際擴大的畫布扣除詳情與工具尺寸，保留倍率。回搜尋／回行程取消選取並恢復清單捲動及來源焦點；若選取時焦點原在被隱藏的左欄，移至詳情的返回按鈕。重新輸入搜尋會恢復結果欄，沿用既有選取保留規則。手機選取矩形扣除實際面板與右側縮放控制，面板開關不改 fit 下限；查看全場先收合。所有 rect 與 floor inset 均為 map 本地 CSS px。
- 視窗尺寸改變時，原本位於 fit（差小於 0.006）則重新 fit；手動視域保留中心的 layout 座標，倍率僅在低於新下限時夾值，不持續吸回 selected。
- 初始化依實際 artifact 路徑與 revision 分域。多日期共用 `map.json` 時換日保留視域；真正換 artifact 才重新 fit。載入失敗不使用舊 map，重試成功後才計算幾何。
- 選取等待 React commit 與有效尺寸後單次定位；零尺寸暫緩並只保留最後請求。有效 URL 晚到只定位、不改倍率；其間有手動操作則恢復選取但取消自動定位。過期 scope 回應不套用。
- **145% 起顯示具可追溯來源的社團縮圖並隱藏展區範圍底色**；低於門檻恢復展區底色與高辨識度的攤位色塊、代碼。縮圖不得超出攤位格，以免遮住相鄰攤位。
- **沒有縮圖的攤位在任何倍率都畫成一般攤位格**：色塊、可容納時的置中代碼與狀態標記，不留空白媒體區。依 [ADR-0012](../adr/0012-first-party-sources-only.md) 退場工作簿縮圖索引後這是常態。
- 桌機格內數字目標為 12 CSS px，較大／最大字級為 13.44／14.88px；每邊保留 2px，按字元數與行高 1.2 的保守估算限制字級，並以 slot clip 防止溢出。**代碼在任何倍率都畫**，格子太小只會把字縮小，不會省略；標籤帶小到裝不下 2px 內距時內距讓步。縮圖出現只改版型：無圖時代碼置中於全格，有圖時移入底部 38% 遮罩帶並與遮罩共用同一個常數。排標、狀態與完整 aria-label 不受字級影響；fit 不承諾格內數字可讀。
- **200% 以上固定控制器以 25% 級距縮放**，讓使用者能快速進入可辨識縮圖的倍率。
- **選取後只移動不改倍率**：搜尋結果、URL 或地圖選取攤位後，地圖只移動至對應座標並保留使用者目前倍率，不回彈到預設倍率。使用者當次搜尋得到單一結果可自動開啟詳情；恢復無選取的 URL 不自動開啟。

### 使用者流程

1. 選擇活動與日期。活動跨多個場地時顯示場地切換；每個場地都顯示全部攤位，不顯示展區篩選。
2. 以拖曳、滾輪、觸控手勢或固定控制器平移和縮放；「重設」回到完整可用範圍。
3. 搜尋攤位代碼或社團名稱，選取結果後地圖直接移動到對應攤位。
4. 點選攤位後同步高亮 SVG slot、更新 URL，並開啟同一份社團資料的地圖側欄。共用攤位以緊密清單切換社團；側欄代表圖可直接開啟完整詳情。
5. 收藏、分類、備註、加入行程或設為下一站後，地圖、側欄、清單與完整詳情立即同步。
6. 從社團或收藏清單點「在地圖查看」時，直接恢復正確日期、區域、攤位與詳情，不要求再次搜尋。

### 命名

一般介面與輔助科技名稱使用「**社團攤位配置圖**」或「活動地圖」。「向量」是內部渲染技術，不作為使用者可見的地圖名稱。

### 目前不做

- **minimap 與多館總覽。** 單一場館且完整地圖可直接理解時不強制加入；未來若活動包含多館或分層場域，minimap 仍須與主地圖共用同一 layout 投影，不建立第二份座標資料。
- 對非一般攤位文字做 OCR。
- 將原始配置圖作為一般使用者地圖底圖。
- 圖磚式地圖（Leaflet 等）。見 [ADR-0001](../adr/0001-adopt-webcatalog-patterns-selectively.md)。

### 驗收條件

- 手機工具選單的字級、資料管理與使用說明須位於地圖控制及工作面板上方且可點擊；資料管理的模態視窗仍位於頁首上方。工具選單關閉時恢復原頁首層級，完整工作面板把手保持可操作。使用說明完整留在視窗內，短螢幕可捲動閱讀，關閉按鈕可操作；關於文字使用通用的「活動主辦單位」。選單在焦點位於其中時支援 Escape 並回焦工具觸發器；外部按壓關閉選單且保留該次地圖操作。
- 手機摘要加入／移出行程後提供短暫文字 status；儲存異常時不顯示成功。把手觸控範圍至少 44px 高且不攔截回結果／收起按鈕；細線外觀不代表命中區高度。

- FF47 原圖辨識結果包含 23 排：A–W；A–V 縱向、W 橫向，slot 總數 988，柱子與 5 個出入口在 SVG 中可見。
- 靜態快照發布後，另一個全新瀏覽器工作階段不需圖片、Worker 或 D1 即可取得同一 event map。
- 前台 DOM 不含作為地圖底圖的配置圖 `<img>`。
- 從社團清單點「在地圖查看」會直接顯示正確日期、區域、攤位高亮與對應詳情。
- 以含日期、區域及社團 ID 的網址開啟時，對應攤位被選取並顯示詳情；瀏覽器上一頁不會被平移／縮放事件淹沒。
- 使用滑鼠、觸控與鍵盤皆能選取攤位；螢幕閱讀器可讀出「A03、社團名、已收藏、下一站」等組合。
- 縮放後仍可回到完整場館範圍；縮小到邊界時場館四邊均在可視區內。
- 收藏群組改變後，地圖、清單與詳情不需重新整理便同步更新。
- 前台不顯示 A–K／L–W 區域切換。
- 外部內容缺少或載入失敗時，已發布向量地圖、社團核心資訊與收藏操作仍可使用。

### 場館與非攤位多邊形

`floor` 及 `landmarks[].rect` 可選填 `points`（3–200 個有限座標頂點），涵蓋場館外框、企業攤、舞台與其他區域。既有 `x/y/width/height` 必須等於頂點的外接矩形；缺省 `points` 時仍為原矩形。一般攤位、柱子及保留／取消格維持矩形，服務設施與出入口維持座標點。

多邊形不得有自交、重複頂點、反折重疊邊、零面積或超出畫布。移動、縮放與畫布變更同步更新頂點與外接矩形，草稿、預覽與 publication 使用同一形狀。公開 renderer 與編輯器共用形狀繪製；Reader viewBox 仍使用畫布尺寸。凹形區域的名稱與設施定位採區內錨點；名稱的完整文字範圍須能放入該區，否則沿用設施清單定位。既有 pin 與核准 snapshot 不重寫。

## 搜尋、篩選與顯示設定

三組條件的責任切分。它們常被誤放在同一個面板裡，因此邊界必須明寫：**搜尋改變結果集合，規劃篩選投影使用者資料，顯示設定只改變呈現。**

**實作**：[`app/circle-search.ts`](../../app/circle-search.ts)、[`app/advanced-circle-search.tsx`](../../app/advanced-circle-search.tsx)、[`app/display-filter-controls.tsx`](../../app/display-filter-controls.tsx)、[`app/work-topic-aliases.ts`](../../app/work-topic-aliases.ts)
**測試**：`tests/circle-search.test.mjs`、`tests/catalog-browse.test.mjs`
**URL 參數**：見 [URL 檢視狀態契約](./reader.md#url-檢視狀態)

責任拆分的決策見 [ADR-0006](../adr/0006-split-search-planning-filter-and-display.md)。在此之前這三組條件都塞在一個叫「進階篩選與顯示」的入口下，使用者以為能依作品找社團，打開卻看到收藏管理條件。

### 一、探索搜尋（常駐）

「逛品書」與地圖透過 `public-circle-search.ts`／`public-search-url.ts` 共用公開條件語意；不套用私人規劃篩選。瀏覽以社團 ID 聚合，地圖仍以配置呈現；同範圍、同公開條件下兩者的社團集合一致。瀏覽的版面、計數與圖片空狀態見[品書瀏覽契約](./reader.md#品書瀏覽)。

搜尋社團名、作品名、題材與介紹內容，回傳可比較的結果清單。

- 搜尋欄附近必須顯示**目前活動、日期、區域、篩選摘要與結果數**，不讓使用者猜測搜尋範圍。
- 搜尋摘要分別顯示符合全部條件的社團數與結果筆數：社團依 `CircleRecord.id` 去重，結果仍是一筆 placement 一列，同團多攤、共攤及失效配置不因統計而合併或移除。「已顯示／剩餘 N 筆」按結果列計數，不因分頁改變總社團數。
- 社團主題旁的數字是目前活動日、場地與所選展區內的相異社團數，不隨關鍵字、主題或規劃篩選縮減。「全部類別」包含未分類社團且每個 ID 只計一次；同名不同 ID 仍分開計數。桌機與手機使用同一份 projection。
- 頂部只有一個搜尋入口；桌機日期、場地及適用展區位於地圖工具群，社團主題與詳細搜尋位於左欄「探索」。類別選項由活動定義固定的主辦分類目錄產生，不讀取已退役的工作簿分類。詳細搜尋**不重複製造第二套日期、展區或主題類別模型**。
- 桌機探索／行程維持掛載並保留各自條件與捲動；搜尋變更切回探索、結果回頂部，保留已選社團。導航中開始搜尋會退出導航以呈現搜尋投影；單純切回探索頁籤不退出導航。
- 大量結果使用分頁或漸進載入，保留目前查詢與捲動位置；不得一次渲染全部結果造成介面失去回應。
- 空結果顯示已套用條件、清除個別條件與清除全部的操作，並**保留原查詢**，避免只能返回重打。
- `Command/Ctrl + K` 聚焦搜尋欄；快捷鍵提示在手機隱藏。

#### 地圖定位搜尋

另一條路徑：搜尋攤位代碼或社團名。結果選取後直接移動到對應攤位並**保留目前倍率**，見[活動地圖契約](./reader.md#縮放契約)。

### 二、詳細搜尋（草稿後套用）

只呈現**社團與作品內容**條件，不含任何收藏或行程條件。

條件包含：創作內容、作品名稱／題材（浮動建議）、作品取向（男性向／女性向／一般向）、全年齡／R15／R18 分級、多主題 AND／OR 與排除主題；結果附命中原因說明。

#### 互動契約

1. 開啟時看到目前已套用的搜尋條件，**不看到收藏群組或行程狀態**。
2. 面板內修改先保存為草稿；按「套用」後才更新結果與 URL。
3. 「取消」或關閉時捨棄未套用草稿。
4. 套用後在結果區顯示每個條件的文字 chip，可逐項清除。搜尋結果標題右側提供**只重設詳細搜尋條件**的操作——不影響一般關鍵字、日期、展區或收藏狀態。
5. 空結果保留原搜尋條件，顯示造成零結果的條件並提供逐項或全部清除。
6. 重新整理、分享 URL 與上一頁可恢復已套用條件；草稿不寫入 URL。
7. 鍵盤開啟後焦點進入面板；Tab 不得移到被遮住的背景控制，Escape 關閉後焦點回到觸發按鈕。

#### 多主題與排除

作品題材是**一組條件**，不是一個字串。

- 輸入框只是加入條件的入口，本身不是條件。「加入」與 Enter 把目前文字（或選取的浮動建議）變成一枚**包含**題材，「排除」則變成一枚**排除**題材；按下「套用」時，還留在輸入框裡的文字視為使用者要加入的包含題材，不靜默丟棄。
- **一個題材只能屬於一邊。** 加入到其中一邊會從另一邊移除——同時要求與排除必然是空結果，而畫面沒有辦法解釋這個空結果。
- **兩枚以上才出現組合方式**：「符合任一」（預設）或「全部符合」。只有一枚題材時兩者等價，因此不顯示，也不寫進 URL。
- **排除優先於包含。** 同時列在想看與不想看題材下的社團，是使用者說了不要看的那一個。
- 別名擴展對包含與排除**一體適用**：排除「ウマ娘」也會排除標為「賽馬娘」的社團。
- 重複與只差空白／連字號的拼法會收斂成同一枚題材，否則在「全部符合」下會把合理查詢變成零結果。
- 每一枚題材在結果區都是一枚**可個別清除**的 chip；「已套用 N 項」把每枚題材各算一項。

#### 命中原因

結果卡在「資訊清單」密度下說明**這一筆為什麼在結果裡**：

- 關鍵字命中哪一類欄位——攤位代碼、社團名、作品、類別、標籤、介紹、連結——而不只是「命中」。這正是「搜尋『蔚藍檔案』不因社團介紹中的偶然文字造成難以解釋的結果」這條驗收條件要的可辨識性。
- 每一枚實際命中的包含題材各列一項；套用中的創作內容列一項。
- **緊湊掃讀密度不顯示命中原因**：那是掃讀模式，不是追問模式。
- 命中原因只針對**目前可見的結果集合**計算，不是每張卡自己重算別名擴展。

#### 資料規則

- 搜尋投影直接使用資料生成階段已正規化的 `CircleRecord.circleCategory`、`creatorTypes`、`referencedWorks`、`workTypes`、`ageRatings`。`circleCategory` 是單一主題類別，其餘仍可為多值。**UI 不即時猜測或切割字串**。
- `creatorTypes`、`workTypes`、`ageRatings` 的可寫入值由 [`app/circle-overrides.ts`](../../app/circle-overrides.ts) 的固定選項決定，搜尋面板讀同一份清單，兩邊不會出現對不上的選項（[ADR-0051](../adr/0051-three-circle-facets-move-to-fixed-options.md)）。`ageRatings` 是多值：同時標了全年齡與 R18 的社團，兩種分級條件都要命中。
- 正規化只用於搜尋與聚合；原始名稱、標籤及來源值仍須保留。
- **分級不推測**：`r18=general` 只匹配明確標記為一般的來源，`r18=r15` 只匹配明確 R15；未知與 R15 不得被推測成一般或 R18。資料與 Reader 保留全部分級，各相符條件都能命中，不推導最高分級。
- **跨語別同義名稱由 `work-topic-aliases.ts` 人工核對**擴展查詢，例如「賽馬娘 Pretty Derby」可由「賽馬娘」、「ウマ娘」或「ウマ娘Pretty Derby」找到。**別名不回寫來源資料**，也不得以模糊名稱自動合併不同主題。
- 作品名稱／題材輸入從目前活動資料提供至多六筆浮動建議，支援方向鍵、Enter、Escape 與點按。
- facet 以穩定的 `CircleRecord.id` 為鍵，不以攤位代碼作為社團身分。
- **facet 不是新的資料權威。** 原始社團、配置與來源資料仍依[社團目錄契約](./reader.md#權威順序)管理；facet 只是為了搜尋而建立的投影。

### 三、規劃篩選

只投影使用者的規劃資料，**不得改寫社團或作品資料**：只看收藏、收藏群組、行程狀態。

這組條件與顯示設定一起放在「行程」頁（桌機與手機皆同），不放在詳細搜尋面板裡。它們仍可與搜尋條件自由組合。

### 四、顯示設定

**只允許改變順序或呈現密度，不得改變搜尋結果集合。**

- **密度**：「緊湊掃讀」與「資訊清單」兩種。
- **媒體**：每筆顯示 0、1 或 3 張媒體預覽；只呈現具來源的圖片。完整詳情仍可檢視所有已授權內容。
- **排序**：一般結果可依攤位、名稱或最近更新排序；收藏與行程另支援使用者規劃順序。
- **提交模式**：單一排序可立即套用；多條件側欄使用「套用／取消」，未套用草稿不改變結果或 URL。

### 驗收條件

- 搜尋「蔚藍檔案」可限定只匹配作品／原作，不因社團介紹中的偶然文字造成難以解釋的結果。
- 選擇 R18 時只回傳明確具有 R18 facet 的社團；資料不明不得視為 R18 或一般。
- 同時標了全年齡與 R18 的社團，在「只看全年齡」與「只看 R18」都查得到。
- 全年齡＋R15、R15＋R18、三者並存均在各個已選分級條件命中；未設定／未知值不猜測，R15 條件的 chip、分享網址及重載一致。
- 切換資訊密度、媒體數量或排序不改變結果 ID 集合。
- 收藏群組與行程狀態不出現在詳細搜尋面板，但仍可與搜尋條件組合使用。
- 桌機與手機使用相同的搜尋狀態、URL 與結果集合。
- 詳細搜尋的「重設」只清除詳細搜尋的內容條件，不動關鍵字、日期、展區與收藏狀態。
- 加入兩枚題材並選「全部符合」時，只帶其中一枚的社團不出現；改回「符合任一」後它回到結果中。
- 排除某枚題材後，同時具備該題材與已加入題材的社團不出現；只具備已加入題材的社團仍在。
- 因作品命中與因介紹命中的兩筆結果，在卡片上顯示不同的命中原因。
- 未套用的輸入框文字不寫入 URL；按下「套用」時它成為一枚題材並隨 URL 分享。

## 品書瀏覽

同一活動內，讀者由品書、作品或題材找社團，再收藏並定位正確日期與攤位。

**實作**：`app/catalog-browse-app.tsx`、`app/catalog-browse-projection.ts`、`app/catalog-browse-url.ts`、`app/catalog-browse-history.ts`、`app/reader-navigation.tsx`、`app/reader-planning.tsx`、`app/public-circle-search.ts`、`app/public-search-url.ts`、`app/public-share.ts`
**測試**：`tests/catalog-browse.test.mjs`、[tests/browser/catalog-browse.mjs](../../tests/browser/catalog-browse.mjs)
**決策**：[ADR-0075](../adr/0075-catalog-browse-shares-the-reader-catalog-and-public-search.md)

### 資料與結果

- 使用既有 catalog publication 的 reviewed base + circle overlay，收藏沿用 planning store；不新增資料來源或後端。
- 先套日期、場地及公開條件，再以 `CircleRecord.id` 分組。同名不同 ID、同攤不同社團各自成卡；跨日同 ID 合成一張。不同日期與場地仍保留各筆配置。
- 搜尋、分類、題材別名、排除、任一／全部及逐值分級，與地圖共用 predicate。關閉地圖私人篩選及導航時，在相同公開條件與範圍下，地圖的 distinct circle 集合必須等於品書卡與無品書文字卡的聯集。
- 社團數按 distinct ID；配置數按符合條件的 placement；品書數指有 `media.kind=catalog` 的社團數。代表圖不算品書。
- 以最早有效配置的日曆日期、活動場地順序、自然攤位碼排序；全失效社團排最後。有效配置連到正確 day／venue／circle／booth；moved／cancelled 不推測目的地，不提供錯誤地圖跳轉。
- 題材捷徑來自目前日期／場地的社團 facet 並按 ID 去重，先顯示兩項，可展開其餘項目。套用條件與詳細搜尋草稿分離。

### 圖片、分批與狀態

- 卡片僅讀第一張 catalog 的 `previewUrl`，以既有寬 640px、最高 960px 預覽尺寸保留空間，前端不再次裁切或拉伸；長品書在製作預覽時已有頂端裁切，完整內容由社團出展頁讀原圖。瀏覽頁不預讀完整圖片。
- 品書卡初始 24 張，按「載入更多品書」增加 24 張；無品書文字卡另以 24 筆分批，捲到接近文字區底部時自動載入下一批；鍵盤焦點在文字區內時不自動載入，Tab 能到達「載入更多社團」並以它載入。文字卡不含圖片，所以自動載入不讀取圖片；自動載入等捲動位置還原後才開始，搜尋或範圍變更仍從首批開始。圖片 lazy load；兩區互不重複，無品書社團的數目只寫在文字區標題，品書前不重複提示。
- base／overlay 未完成不顯示零結果；base 失敗與 overlay unavailable 分別提示，重試走既有 publication retry。成功但沒有品書時，區分整場、所選範圍及目前搜尋；搜尋零結果保留條件與可清除入口。
- 單張圖片失敗只替換圖片區塊，出展頁、收藏及配置入口仍可用。分級顯示原本全部明示值，不能以最高分級覆蓋其他值。

### 狀態、分享與導航

- URL 以[URL 契約](./reader.md#品書瀏覽與檢視切換)為準；分享只含已套用公開條件，私人收藏／群組／行程／備註、選取與未套用草稿不外傳。
- 系統分享失敗後嘗試複製文字與連結，再失敗提供手動複製；使用者取消系統分享時不自行複製。分享為動態結果，內容會隨社團公開資料改變。
- 同文件地圖／逛品書切換共用 event-level planning owner，保存未能寫入儲存空間的記憶體資料、錯誤與 7 秒收藏復原；資料管理匯出同一份狀態。跨文件社團頁仍使用既有 localStorage／storage 協定。
- 卡片收藏不建立行程；具體活動日的行程由既有出展頁或地圖加入。
- 760px 以下兩個畫面共用底部「探索／行程／逛品書」，桌機切換在頁首（[ADR-0076](../adr/0076-phones-switch-reader-views-from-the-bottom-bar.md)）。從逛品書點探索回到面板收合的地圖；點行程以該筆 history state 一次性要求展開今日行程，地圖開啟後即清除；在逛品書點逛品書回到頁首。
- browse history entry 保存目前公開 URL、兩區已顯示筆數與 scrollY。返回／前進於資料完成後還原；搜尋或範圍變更重設為首批及頁首。位置資訊不寫入分享 URL，也不新增持久儲存。
- 連續捲動與自動分批載入合併為停止後保存位置；明確導航與 pagehide 立即保存。瀏覽器因頻率或配額拒絕位置保存時，可失去該次位置更新，但不能中斷渲染或清空頁面。
- metadata 使用 browse 專屬 title／description 及活動 canonical；切換時不得殘留社團 canonical 或無效活動 noindex。活動選擇頁、Reader 頁首及活動介紹皆提供入口，不因目前無品書而隱藏。

## 收藏與走訪規劃

把「記住感興趣的社團」與「安排活動當天怎麼走」連成可回顧的流程，同時保留兩者的語意邊界。收藏是長期偏好與備註的容器；行程、下一站與已走訪是特定活動中的執行狀態。

**實作**：[`app/planning-store.ts`](../../app/planning-store.ts)、[`app/use-planning.ts`](../../app/use-planning.ts)、[`app/planning-tools.tsx`](../../app/planning-tools.tsx)、[`app/planning-transfer.ts`](../../app/planning-transfer.ts)、[`app/planning-transfer-panel.tsx`](../../app/planning-transfer-panel.tsx)、[`app/planning-share.ts`](../../app/planning-share.ts)、[`app/planning-share-client.ts`](../../app/planning-share-client.ts)、[`app/planning-share-snapshot.ts`](../../app/planning-share-snapshot.ts)、[`server/shares.ts`](../../server/shares.ts)、[`app/planning-share-panel.tsx`](../../app/planning-share-panel.tsx)、[`app/download-text.ts`](../../app/download-text.ts)、`app/reader-planning.tsx`
**測試**：`tests/planning-store.test.mjs`、`tests/planning-transfer.test.mjs`、`tests/planning-share.test.mjs`、`tests/planning-share-client.test.mjs`、`tests/api-shares.test.mjs`

完整規劃資料儲存在使用者當下的瀏覽器，不跨裝置自動同步。使用者主動分享時，只有[分享行程](#分享行程)定義的精簡 snapshot 送到伺服器；完整資料可由[JSON 備份](#匯出與匯入分期)自行攜帶及復原。裝置端保存的決策與分享例外見 [ADR-0002](../adr/0002-planning-data-stays-on-device.md)、[ADR-0079](../adr/0079-shared-itineraries-use-short-links-and-qr-codes.md)。

### 責任邊界

- 規劃 store 是收藏、群組與行程的**唯一讀寫 seam**；清單卡、完整詳情、地圖與社團介紹頁不得各自保存 `isFavorite`。社團介紹頁與地圖是不同文件，同一瀏覽器內靠同一個 `localStorage` key 與 `storage` 事件保持一致；它可加入的日期見[社團目錄契約](./reader.md#社團介紹頁)。
- 行程狀態不因收藏切換而自動新增或移除項目。
- 同文件的地圖／逛品書及資料管理使用同一個 event-level planning owner。切換視圖保留寫入失敗的記憶體資料、storageError 與取消收藏的 7 秒復原期限，匯出亦讀取這份狀態；跨活動重新掛載。獨立預覽與社團頁維持原有 store 協定。
- 頁面 controller 把 store 狀態投影到社團清單、詳情與地圖 renderer；renderer 只呈現狀態並回報互動。
- UI 元件負責顯示與收集意圖，不直接理解 `localStorage` key、序列化版本或未來的帳號 API。

### 領域模型

以下型別與 `app/planning-store.ts` 同步。欄位變更必須同時更新本文。

```ts
const PLANNING_SCHEMA_VERSION = 3;
const PLANNING_STORAGE_KEY = "event-map-planning-v1";
const PLANNING_CHANGED_EVENT = "event-map-planning-changed";

type FavoriteGroup = {
  id: string;
  name: string;       // 必填；不是 label
  color: string;
  sortOrder: number;
};

type FavoriteRecord = {
  eventId: string;
  circleId: string;
  groupId: string | null;
  memo: string;
  createdAt: string;
  updatedAt: string;
};

type VisitPlanEntry = {
  eventId: string;
  day: string | number;
  circleId: string;
  status: "planned" | "next" | "visited";
  routeOrder: number;
  purchaseMemo: string;
  budget: number | null;
  updatedAt: string;
};

type PlanningDocument = {
  schemaVersion: 3;
  favoriteGroups: FavoriteGroup[];
  favorites: FavoriteRecord[];
  visitPlans: VisitPlanEntry[];
};
```

### 不變量

- `FavoriteRecord` 以 `eventId + circleId` 唯一。**記錄存在即代表已收藏**，不另存容易失真的 `isFavorite`。
- `FavoriteGroup.name` 去除前後空白後必須非空；顏色可重複，且**不得作為群組識別鍵**。所有色點旁都要顯示群組名稱。
- `circleId` 必須是 canonical circle ID，以 `CIRCLE_CATALOG_BY_ID` / `isKnownCircleId()` 核對——不是以 placement `recordId` 為 key 的 `CIRCLE_RECORDS_BY_ID`。用錯 seam 會讓有效收藏被資料管理誤列為「目前無法匹配」。
- 同一攤位的多個社團以不同 `circleId` 建立獨立收藏與備註，不因 booth code 相同而合併。
- 同一活動日最多一筆 `status = "next"`。設定新的下一站時，原下一站回到 `planned`，且**不取消其收藏**。
- **加入行程一律建立 `planned`。** 只有「設為下一站」可建立或轉移 `next`；移除或走訪下一站後不自動指定替代下一站。決策見 [ADR-0004](../adr/0004-plan-and-next-stop-are-separate-actions.md)。
- `routeOrder` 只對同一活動日的行程項目有意義；收藏列表排序不得反向改寫行程順序。每次移動後壓縮為 0 起始的連續整數。
- `budget` 是非負整數新台幣或 `null`；`purchaseMemo` 記錄預計購買品項。每日行程彙整已填寫攤數與預算總額。
- 刪除收藏群組前必須讓使用者選擇移到其他群組或變成未分類，不得連帶靜默刪除收藏。
- **孤兒不靜默丟棄。** catalog 找不到對應社團時仍保留收藏與行程；管理介面顯示未匹配 ID、備註與狀態，並允許個別移除或匯出。

### 儲存與版本

- 以 versioned `localStorage` 文件保存於 `PLANNING_STORAGE_KEY`；讀取時先驗證與遷移，再提供給 UI。
- 寫入使用單一 transaction 或等效原子更新，避免群組、收藏與行程在多個 key 之間部分成功。
- **只讀 schema 3。** schema 1 以攤位位置為鍵、schema 2 以 `ff47-` 內容雜湊為鍵，能把兩者翻成 allocated circle ID 的對照表已移除（[ADR-0013](../adr/0013-drop-the-legacy-circle-id-compatibility-path.md)）。
- **`PLANNING_STORAGE_KEY` 不存在時，另讀一次 `LEGACY_FAVORITES_KEY`（`event-map-favorites`）**：schema 1 之前的裸收藏 ID 陣列，由 `readPreSchemaFavorites()` 包成 schema 3 文件，字串原樣當作 `circleId`，第一次寫入時移除該 key，因此每個瀏覽器最多跑一次。
- **它與 schema 1／2 被拒絕不衝突。** schema 1／2 的鍵需要一份已移除的對照表才能翻譯，這個陣列不需要翻譯；已不存在的 ID 不在此處過濾，交由孤兒規則呈現與匯出。
- **不相容版本保留原始字串並停止覆寫**，回報明確訊息讓使用者仍可匯出。不猜測、不靜默清空。
- schema 3 重讀是 no-op；重試不得重複收藏、備註或行程。
- `circleId` 是關聯鍵；社團名稱、攤位與圖片**不複製進規劃資料**，顯示時從目前 `CircleRecord` 解析。
- 不相容或損壞的內容必須保留原始字串、停止覆寫並提供下載。寫入失敗時保留本分頁狀態，顯示儲存異常與匯出備份指引。
- 「清除所有規劃資料」必須先列出收藏、備註與行程的受影響數量並再次確認；完成後不得留下無法管理的孤兒群組或行程項目。

### 核心互動

#### 收藏

1. 使用者在清單、詳情或地圖側欄切換收藏。
2. 首次收藏立即建立 `FavoriteRecord`，預設未分類，並顯示可選的群組與備註入口。
3. 修改群組或備註後，所有介面立即反映相同結果。
4. 取消收藏後顯示**七秒 Undo**。Undo 以原記錄完整恢復 `groupId`、`memo`、建立與更新時間，不因有備註或分類而降級，且不改變行程。

#### 收藏分類

- 每個分類同時顯示名稱與色彩；色彩只協助掃讀，不承擔語意。
- 使用者可新增、改名、改色、排序與刪除分類，並支援來源到目標的批次搬移。
- 篩選結果顯示群組名稱與項目數；空群組仍可管理，但不製造無內容卡片。

#### 走訪規劃

- 「加入行程」建立 `planned`；「設為下一站」建立或更新為 `next`；「標為已走訪」更新為 `visited`。
- 收藏不是加入行程的前提，加入行程也不強制收藏。介面可在同一規劃區呈現兩者，但**動作標籤必須分開**。
- 行程可直接拖曳排序，並保留可聚焦的往前／往後按鈕。移除行程不刪收藏、群組或備註。
- 地圖用形狀、圖示與文字輔助顯示 planned、next、visited，不只使用顏色。

#### 導航模式

導航模式是**可隨時退出的暫時投影**，不是另一種模式狀態：

- 地圖只顯示所選日期、目前場地內的行程攤位，涵蓋該場地所有展區，不把其他場地的同碼攤位畫入目前地圖。
- 桌機左欄的「行程」頁籤顯示完整行程、購買項目與預算。切頁籤不啟用導航；開始導航切到行程，僅當目標在目前場地時自動定位。明確選取別的場地的行程才切換到該處。
- **不得清空搜尋、進階篩選或隱性改寫展區。** 導航中切探索頁籤仍維持導航投影，開始輸入搜尋才退出。地圖底部退出入口持續可見，不會隨頂部工具捲出畫面。
- 手機隱藏重複的發布 revision 與下一站浮條，保留可辨識的地圖視野。
- 不進行 GPS 定位或自動路徑推算。
- 正常的本機儲存／讀取說明位於資料管理；儲存錯誤在入口旁持续可見。桌機查看全場及詳情收合不修改任何收藏或行程資料。

### 跨介面一致性

| 操作來源 | 必須同步的介面 |
| --- | --- |
| 社團清單收藏 | 完整詳情、地圖 slot、地圖側欄、收藏清單 |
| 詳情修改群組／備註 | 清單收藏提示、地圖側欄、收藏清單 |
| 地圖設為下一站 | 行程清單、所有對應地圖狀態、社團詳情 |
| 行程調整順序或標為已走訪 | 行程清單、地圖 slot、地圖側欄 |

同一分頁內使用共享 store 或訂閱；多分頁使用 `storage` 事件與同分頁自訂事件 `PLANNING_CHANGED_EVENT`。同步失敗時以明確狀態提示，不以最後一次渲染的局部狀態覆寫 store。

### 匯出與匯入分期

- **匯出**：版本化 JSON（完整備份）與 CSV v1，包含 schema version、群組、收藏、備註與行程，不含瀏覽歷程或任何憑證。CSV 對可能被試算表解讀為公式的值安全轉義；CSV 沒有活動日欄位，介面不稱其為完整多日備份。
- **從完整備份復原（#415，[ADR-0078](../adr/0078-own-planning-backups-can-be-imported.md)）**：位於「資料管理」的「完整備份」（匯出備份／從備份復原），用於換瀏覽器、換裝置或復原；一般「帶到手機」與分享走短網址流程。只接受 `circle-plan-json/1`，單檔 10 MiB、20,000 筆。未知版本、破損結構或任何不合法項目整份拒絕並說明原因。寫入前依活動預覽收藏與行程的新增、內容不同筆數及各日行程筆數，並分開「活動資料尚未載入」與「目前無法匹配」；兩者都照原記錄保留為可管理、可再次匯出的孤兒，不建立假社團、不猜測位置、不改到目前活動或第一天。
  - 預設合併並保留目前內容，可明確改採匯入值；重複匯入不重複建立收藏、行程或群組。群組以 id 識別，同 id 不同內容時重新編號並同步更新收藏引用。
  - 完整取代是獨立的危險操作：列出全瀏覽器各活動將被取代的筆數、提供先匯出備份，並二次確認。
  - 取消、解析失敗或未確認時不寫入；預覽與確認都讀取瀏覽器目前保存的資料（含其他分頁剛寫入的內容），預覽後若已改變，重新計算並再次確認。整份透過 store 單次寫入，儲存失敗時不宣稱成功、已保存的資料不變。
  - 瀏覽器保有無法讀取的舊資料（受保護的原始字串）時不開放匯入。
  - 本站未公開的活動無法從閱讀端開啟，其收藏與行程列在「目前無法匹配的規劃資料」，可逐筆移除並隨完整備份匯出。
- **仍屬 P2**：CSV 匯入、外部服務匯入（[ADR-0005](../adr/0005-import-stays-p2-export-only.md)），以及登入後持續同步與協作清單。轉移是單次的，之後兩台裝置各自修改。

### 分享行程

介面語言不屬於規劃資料：`lang` 只出現在網址上，不寫入規劃文件、JSON 備份或分享 snapshot，切換語言也不改寫任何規劃資料。

`/s/:id` 的導向、過期、不存在與找不到活動頁依網址 lang 顯示繁中／英文／日文，省略或無效值為繁中，不採用瀏覽器偏好。HTML lang 與 og:locale 同步，英文／日文導向及返回連結保留 lang；private/no-store、noindex、到期與狀態碼不變。分享 API 在原 error／eventId 等欄位上增補錯誤 code。

- 帶到自己的手機與分享給朋友是同一條流程（[ADR-0079](../adr/0079-shared-itineraries-use-short-links-and-qr-codes.md)）：在本場行程勾選要分享的項目，先看「將分享的內容」，再建立短網址 `/s/<shareId>`，可複製、系統分享或顯示 QR Code。分享前明說連結可被轉傳、到期前無法撤銷或更新。
- snapshot 只有版本、活動 ID、社團 ID、必要的活動日與順序；私人備註、群組、購買項目、預算、已走訪／下一站、帳號、時間戳、社團名稱、攤位號與瀏覽紀錄一律不送出、不保存。
- 接收端開啟短網址先看唯讀預覽，不寫入；社團名稱、攤位與移動／退出狀態由最新公開資料解析，不以同名社團代替未知 ID。按「加入我的行程」才寫入：分享日期仍有攤位的社團加入該日行程（待前往，接在既有順序之後），已存在的保留，不改動既有備註、購買項目、預算、下一站與順序；已移動、已退出、找不到的列出並略過。
- 短網址於活動結束後 30 天到期並由既有 retention purge 刪除整列，不保留任何資料。刪除前的過期連結顯示已過期並可返回該活動；刪除後與不存在的連結相同，顯示「不存在或已過期」並連到活動選擇頁（維護者 2026-10-03 決定）。

### 驗收條件

- 任一介面收藏社團後，其他已開啟介面不需重新整理即可看到相同收藏、群組與備註。
- 收藏分類在所有位置都有文字名稱；關閉色彩後仍能辨識。
- 第一次加入行程後顯示「待前往」，下一站提示不出現；按「設為下一站」後才切換。
- 取消含備註的收藏不會無提示地遺失使用者輸入，七秒內可完整復原。
- 設定新下一站只改變同一活動日的行程狀態，不新增、移除或重新分類收藏。
- 重新載入後可恢復資料；schema 1／2 文件被拒絕但原始字串仍在，重試不丟失或重複備註與行程。
- catalog 找不到對應社團時，管理介面仍可看見未匹配收藏／行程的 ID、備註或狀態並個別移除；匯出保留原記錄。
- 清除全部資料前可看見受影響數量，取消確認不會改變任何資料。
- 完整 JSON 匯出後在空白瀏覽器匯入，可還原各活動、各日的群組、收藏、備註、行程、購買項目與預算及順序，並分開回報活動資料未載入與無法匹配的項目。

## URL 檢視狀態

URL 是跨模組的共享狀態，因此獨立成一份契約：搜尋、地圖、規劃篩選與顯示設定都往同一組查詢參數寫入。任何模組新增可分享狀態，都必須先在這裡登記。

**實作**：`app/public-search-url.ts`（公開條件 codec）、`app/public-circle-search.ts`（公開條件及範圍判斷）、[`app/event-url-state.ts`](../../app/event-url-state.ts)（schema、defaults、codec、活動解析與 history intent）、[`app/event-entry.tsx`](../../app/event-entry.tsx)（選擇器與讀者畫面的分流）、[`app/event-chooser.tsx`](../../app/event-chooser.tsx) 與 [`app/event-calendar.ts`](../../app/event-calendar.ts)（活動日期、排序及分組）、[`app/map-view-state.ts`](../../app/map-view-state.ts)（選取解析）、[`app/event-workspace-projection.ts`](../../app/event-workspace-projection.ts)（共享衍生狀態）、[`app/seo.ts`](../../app/seo.ts)、[`app/static-discovery.ts`](../../app/static-discovery.ts)、[`scripts/build-discovery-pages.mjs`](../../scripts/build-discovery-pages.mjs)（搜尋入口與 metadata）、[`app/i18n/locale.ts`](../../app/i18n/locale.ts)、[`app/i18n/locale-browser.ts`](../../app/i18n/locale-browser.ts)、[`app/i18n/locale-context.tsx`](../../app/i18n/locale-context.tsx)（介面語言）
**測試**：`tests/event-url-state.test.mjs`、`tests/event-chooser-component.test.mjs`、[tests/browser/reader-event-chooser.mjs](../../tests/browser/reader-event-chooser.mjs)、`tests/map-view-state.test.mjs`、`tests/event-workspace-projection.test.mjs`、`tests/seo.test.mjs`、`tests/discovery-artifact.test.mjs`

Reader 的互動與可還原狀態都掛在根路徑的 query string，不建立會和 Pages `index.html` 正規化衝突的 SPA rewrite。公開介紹頁使用下述真正的靜態目錄，不承載 Reader 互動狀態。

### 搜尋入口與主要網址

公開活動介紹使用 `/events/<eventId>/`，社團在該活動的介紹使用 `/events/<eventId>/circles/<circleId>/`，社團與主辦的功能介紹使用 `/portal/`（段落錨點 `#circle`、`#organizer`）。它們是在 build 時從同一份已發布活動／reviewed base 產生的 `index.html`，不是 SPA fallback。社團頁集中呈現跨日、多攤位與已移動／已取消狀態；每筆配置以既有 query URL 回到正確日期、場地與攤位。未知靜態路徑沿用真實 404。

- 首頁提供活動地圖與活動介紹的 href；每個活動介紹列出全部有配置的社團 href，不依賴「載入更多」。多日活動的名單依活動日分段（依日曆日期排序，標題為「11月7日（六）」格式與當日社團數），社團在每個有配置的活動日各列一次、連到同一張社團頁；當天只有失效配置時依社團的最終狀態附上用詞：活動其他地方仍有有效配置為「已移動攤位」，完全沒有有效配置為「已取消參展」。單日活動只有一份名單。Reader 清單的一般點擊保持地圖選取，修改鍵／新分頁可開啟靜態社團頁。
- 首頁 canonical 為正式網域 `/`；Reader 有效活動指向活動介紹，已解析且有效的社團選取指向該社團介紹。未驗證的 query 值不產生社團 canonical。篩選、排序、收藏及日／攤位選取不另建索引頁，原 URL 與還原語意不變。
- 不存在或未發布活動仍顯示 fail-closed 提示，渲染後加 noindex；切回有效活動／首頁時清除。控制面的 noindex 不由 Reader 管理。
- 共用 Reader 原始 HTML 提供品牌 metadata 與活動摘要，不硬寫首頁 canonical／og:url 給所有 query。React 啟動後取代摘要；活動／社團介紹的原始 HTML 則已有專屬 metadata、絕對 canonical 與 OG／Twitter Card；分享圖的規則見[資料傳輸契約](./reader.md#公開搜尋介紹頁)。
- 活動有別稱時（[ADR-0068](../adr/0068-published-event-settings-are-declared-amendments.md)），活動介紹的 title 在正式名稱後以括號附第一個別稱，description 與可見內容列出全部別稱，Event JSON-LD 以 `alternateName` 列出同一份清單；社團介紹的 title 以第一個別稱作為活動短稱。Reader 對同一活動／社團套用同一份 metadata。沒有別稱的活動輸出不變；首頁活動清單與地圖畫面維持正式名稱。
- 社團介紹的 title 為「社團名稱｜活動短稱 M/D 攤位、攤位｜場刊 Map」，只取有效配置：日期與攤位取最早一個有效配置那一天。完全沒有有效配置時，改用最早一筆失效配置的活動日與攤位並附「已移動攤位」或「已取消參展」，網址與 canonical 不變。description 依活動日列出全部攤位，失效配置帶同樣的狀態用詞，日期寫成完整年月日；活動介紹的 description 也使用完整年月日。社團介紹的攤位列不論活動以 ISO 或月日標籤發布，日期都寫成「11月7日（六）」。活動介紹名單中同名的社團以同一組日期與攤位區分。Reader 選取社團時以同一份已審核配置產生相同的 title 與 description（[circle catalog 契約](./reader.md#社團目錄)的失效配置呈現）。
- sitemap 僅列首頁、已發布活動及其有配置的社團介紹，不列 Reader 互動變體、控制面或個人資料；隨同一次 build 更新。不捏造 lastmod。
- Pages production origin 繼續可用於 smoke，canonical 指向正式網域。canonical 是搜尋提示，不保證搜尋引擎收錄或選擇結果。

### 參數

| 參數 | 負責模組 | 說明 |
|---|---|---|
| `event` | 活動 | 目前活動 ID，永遠寫出。只接受已發布活動 |
| `view` | 閱讀方式 | `browse` 為逛品書；省略或未知值為地圖 |
| `day` | 活動 | 地圖永遠寫出；browse 省略代表全部日期 |
| `area`／`hall` | 舊連結相容 | 只在讀取時用已宣告的展區代碼推定場地；不做篩選，重新序列化時移除 |
| `venueSpaceId` | 活動 | 場地 stable ID；地圖只有活動分配多個場地時寫出；browse 省略代表全部場地 |
| `query` | 探索搜尋 | 一般關鍵字 |
| `genre` | 探索搜尋 | 社團主題；值為目前活動分類目錄中的顯示名稱 |
| `creator` | 詳細搜尋 | 創作內容 |
| `work` | 詳細搜尋 | 作品名稱／題材。**可重複**，一枚題材一個參數 |
| `workMode` | 詳細搜尋 | 多枚題材的組合方式；只有 `all` 會寫出，`any` 是預設 |
| `workExclude` | 詳細搜尋 | 排除的作品名稱／題材。**可重複** |
| `workType` | 詳細搜尋 | 作品取向；`male`、`female` 或 `general`。退役的 `original`／`derivative` 視為未設定 |
| `r18` | 詳細搜尋 | 分級；`include` 為 R18、`r15` 為 R15、`general`（舊 `exclude` 別名）只匹配明確一般分級；逐值匹配，無最高分級推導 |
| `favorite` | 規劃篩選 | `1` 代表只看收藏 |
| `favoriteGroup` | 規劃篩選 | 收藏群組 ID |
| `visit` | 規劃篩選 | 行程狀態 |
| `sort` | 顯示設定 | 結果排序 |
| `density` | 顯示設定 | 資訊密度 |
| `media` | 顯示設定 | 每筆媒體數 |
| `selectedCircle` | 地圖／詳情 | canonical `CircleRecord.id` |
| `selectedBooth` | 地圖／詳情 | 實際 `PlacementRecord` 的攤位代碼 |
| `share` | 分享行程 | 短網址 snapshot ID；讀取後移除 |
| `lang` | 介面語言 | `en`、`ja`；繁體中文省略。只決定介面語言，不是檢視狀態 |

**分享清單 `share`**：短網址 `/s/<shareId>` 帶讀者到 `/?event=<id>&share=<shareId>`。閱讀端只在啟動時讀取一次，取得 snapshot 後顯示唯讀預覽，並自 URL 移除；不寫入其他參數，也不影響 `selectedCircle` 等狀態。格式與到期見[收藏與走訪規劃契約](./reader.md#分享行程)與 [ADR-0079](../adr/0079-shared-itineraries-use-short-links-and-qr-codes.md)。

**介面語言 `lang`**：有效值決定這次顯示的介面語言，優先於這個瀏覽器明確選過的語言，再依序是瀏覽器語言偏好與繁體中文；大小寫不同的正式值視同有效，其他值忽略，不改寫網址。區域形式只在讀取瀏覽器偏好時對應（`zh-TW`、`zh-HK` → 繁體中文，`en-*` → 英文，`ja-*` → 日文），簡體中文與其他語言回到下一順位。站內連結在英文、日文時帶 `lang`，繁體中文省略；切換語言以 replace 改寫目前網址並保留其他參數與 hash，不新增歷史紀錄，也不重新掛載讀者畫面或規劃資料。只有使用者明確切換才記住選擇；他人分享或郵件連結的 `lang` 只影響當次顯示。`lang` 不進入規劃資料、備份或分享 snapshot。

地圖除 `event`、`day` 外，**參數在等於預設值時從 URL 移除**，不留下無意義的殘留條件；多場地活動必須寫出 `venueSpaceId`，避免舊展區代碼或排序改變造成歸屬歧義。新網址不寫 `area`／`hall`。browse 的全範圍例外如下。

### 品書瀏覽與檢視切換

`/?event=<id>&view=browse` 預設全部日期及全部場地，不指定選取。明示有效 day／venueSpaceId 才限縮；明示無效值依地圖規則回到活動預設，舊 area／hall 僅推定場地。公開搜尋仍使用上述 query／genre／creator／work／workMode／workExclude／workType／r18。

地圖切到 browse 時帶入目前日期、場地及公開條件；browse 切回地圖時，指定範圍照用，全範圍部分取活動定義的預設值。兩方向均由白名單重建 URL，不攜帶私人規劃篩選、selectedCircle／selectedBooth、顯示設定、hash 或未套用草稿；卡片的個別配置連結則使用既有精確地圖定位網址。

一般點擊保持同文件 Reader，修改鍵及新分頁保持標準連結。原生前進／返回恢復 view、搜尋及範圍；browse entry 的已載入筆數與捲動位置存在 history.state，不進分享網址。詳細行為見[品書瀏覽契約](./reader.md#品書瀏覽)。browse title／description 描述逛品書，canonical 永遠為活動介紹頁；不另增 sitemap URL。

### 規則

- **活動選擇頁只呈現已發布活動。** 依「舉辦中 → 即將到來 → 過往活動」分組，舉辦中與即將到來按開始日期由早到晚（最快開始的即將到來活動在該組最上方）、過往活動按結束日期由新到舊排序，與控制面的活動選單同一順序，同日以活動 ID 固定順序；不顯示空群組，零活動時顯示「目前沒有公開活動」。分類使用 `Asia/Taipei` 日曆日，包含首日與末日及中間的夜間；開著頁面每分鐘及重新可見時更新。這是日期狀態，不代表現場開放入場。
- **選擇頁日期由已有資料推導。** 使用逐日 ISO 日期，並相容既有「月日・星期」標示；舊標示的年份由 `eventEndsAt` 的台灣結束日期定位，跨年回推。顯示單日 `YYYY.mm.dd`、同月 `YYYY.mm.dd–dd`、跨月 `YYYY.mm.dd–mm.dd`、跨年 `YYYY.mm.dd–YYYY.mm.dd`（en dash，#488）。不修改原始 `dateRangeLabel` 或地圖內日期文案。無法解析的日期保留原文；結束日期已過可歸入過往，否則置於「日期待確認」，不捏造開始日期。分組不新增 URL／schema 欄位，也不攔截原有 deep link。

- **`selectedCircle` 與 `selectedBooth` 必須互相驗證。** 兩者都在時取交集；只有 `selectedCircle` 時取該社團在該日的第一筆配置；無效或已變更的關聯降級為只開啟仍有效的活動與區域，**不顯示錯誤社團**。
- **攤位範圍 deep link 在 selection seam 解析。** `selectedCircle` 若帶的是攤位範圍 ID（`1-e19`、`1-e19-0`），先從 records 解析為 allocated ID，再與日期／攤位取交集；成功恢復後只會重新序列化 canonical `c-*`。舊的 `ff47-<hash>` ID 已無相容路徑，解析不到就 fail closed（[ADR-0013](../adr/0013-drop-the-legacy-circle-id-compatibility-path.md)）。
- **`event` 先於其他所有參數解析。** 它是唯一決定「其餘參數在講哪一場活動」的參數，因此不能像未知的 `day` 或 `genre` 那樣退回預設值。`resolveUrlEvent` 有三種結果：

| URL | 結果 |
|---|---|
| `event` 指向已發布活動 | 進入該活動 |
| 沒有 `event`，且只有一場已發布活動 | 進入該活動 |
| 沒有 `event`，且有多場已發布活動 | 顯示活動選擇器（[ADR-0042](../adr/0042-the-public-entry-is-an-event-chooser.md)） |
| `event` 指向未發布或不存在的活動 | **fail closed**：顯示選擇器並說明該連結無法開啟，不改用其他活動作答 |

  最後一列是刻意的：在別人分享的連結底下安靜地端出另一場活動的地圖，比誠實說「這個連結打不開」更糟。未發布活動不出現在選擇器，也不能由 `event` 定址。

- **已發布活動的既有連結永遠有效。** 新增活動不得讓既有 `?event=…&day=…&selectedCircle=…` 解析到不同畫面。檢視連結還原的是公開瀏覽狀態；私人規劃的備份復原與精簡行程分享另依[收藏與走訪規劃契約](./reader.md#收藏與走訪規劃)。
- **一次只呈現一場活動。** codec 與 workspace projection 都接受 event definition；選定活動後，篩選、選取與 planning 都在該活動範圍內，不跨活動洩漏。切換活動會以新的活動定義重新掛載讀者畫面，不沿用上一場的日期或展區。
- **defaults 從 event definition 推導。** `day`、genre 與場地預設取活動定義的第一筆，不在 codec 內硬編碼 FF47 的值；所選場地顯示全部攤位。
- **場地是唯一的地圖分區選擇。** 有效的 `venueSpaceId` 優先；否則舊 `area`／`hall` 若是活動已宣告的展區代碼，可推定所屬場地；再否則回到預設場地。舊碼不縮小結果範圍，`area=ALL` 不憑空指定場地。單一場地活動移除殘留的 `venueSpaceId`。日期、搜尋、行程與選取仍照常恢復。
- `genre` 只接受目前活動的衍生分類字彙；舊工作簿類別或其他活動的值一律回到「全部類別」，不跨活動猜測對應。
- **恢復時機**：初始化、重新整理與 `popstate` 必須恢復篩選及選取。地圖資料延後完成時，以保存的攤位代碼定位並保留倍率；使用者已手動操作則取消過時的自動定位，仍恢復有效選取。
- **延後套用選取**：可分享連結的社團與攤位選取要等社團快照可解析後才套用。**在此之前不得改寫 URL**，否則會把使用者分享的深層連結洗掉。
- **不寫入 URL 的狀態**：hover、拖曳中的 viewport、動畫進度、尚未套用的篩選草稿、詳細搜尋題材輸入框裡尚未加入的文字，以及桌機探索／行程頁籤和詳情展開狀態。手機從逛品書前往行程時的「展開今日行程」只存在該筆 history state，地圖開啟後即清除。
- 桌機詳情 X／Escape 與手機摘要「取消選取」／Escape 移除 `selectedCircle`／`selectedBooth`，建立一筆歷史並保留日期、搜尋、篩選及視域。重新整理不因唯一搜尋結果而重新選取；自動選取只由使用者當次搜尋觸發。查看全場、手機把手收合、回結果及工作入口切換仍保留選取。完整資訊 X／Escape／遮罩只返回原摘要或詳情，保留選取及 URL、不新增歷史。前進／後退恢復有效選取並開詳情，無選取則收起，不另 push。決策見 [ADR-0063](../adr/0063-reader-dismissal-clears-selection.md)。
- 多場活動時，桌機與手機的活動名稱整區以「切換活動」連結返回根路徑的選擇頁，清除目前 query string 及 hash；這是新的導覽歷史，不依賴上一頁存在。選另一場不帶入舊條件，瀏覽器上一頁可回原活動 URL 狀態；只有一場時不顯示切換入口。本機收藏、行程與字級設定保留。
- **多值條件用重複參數，不用分隔字元。** `work` 與 `workExclude` 各自 `getAll`／`append`；作品名稱本身可能含逗號或斜線，分隔字元會讓一個題材把自己拆成兩個條件。空白與只差空白／連字號的重複拼法在解析時就收斂。
- **歷史紀錄**：只有使用者透過明確操作改變選取或篩選時才建立歷史紀錄；連續平移與縮放不得淹沒瀏覽器上一頁。
- **桌機與手機使用相同的 URL 狀態與結果集合**，不建立第二套參數語意。
- 搜尋結果、地圖 markers、selection、planning、active filters 與桌機／手機 panels 都消費同一份 event-scoped workspace projection；rendering 與 pointer gestures 不進入該 domain seam。
- 同社團當日多攤位的行程／下一站／導航預設使用快照順序中的第一筆 active 配置，active 優先於已異動配置；不承諾重新排序快照後仍選同一預設攤位。啟用導航時，若目前選取是目標社團同日的有效攤位，保留該選取與 `selectedBooth`，不跳到相鄰攤位。此偏好不新增持久化欄位。

### 驗收條件

- 複製任一 URL 到新瀏覽器工作階段後，可恢復有效的查詢、篩選與選取。
- 套用詳細搜尋後重新整理，詳細搜尋參數與結果都還在；未套用的草稿不在 URL 裡。
- 多枚 `work` 與 `workExclude` 依原順序還原；只有一枚題材時不留下 `workMode` 殘留。
- 舊的單一 `work=X` 連結仍還原成一枚題材，不需要相容分支。
- 深層連結（含 `selectedCircle`）在快照載入完成前不被改寫。
- 切換資訊密度、媒體數量或排序會更新 URL，但不改變結果 ID 集合。
- 瀏覽器上一頁可逐步退回明確的操作，不會退回到平移或縮放的中間狀態。

## 資料傳輸與離線

公開閱讀端如何取得場刊與地圖資料、載入時的介面行為，以及離線可用範圍。

**實作**：[`app/catalog-publication.ts`](../../app/catalog-publication.ts)、[`app/static-circle-catalog-client.ts`](../../app/static-circle-catalog-client.ts)、[`app/static-event-map-client.ts`](../../app/static-event-map-client.ts)、[`app/static-circle-overrides-client.ts`](../../app/static-circle-overrides-client.ts)、[`app/use-circle-catalog.ts`](../../app/use-circle-catalog.ts)、[`app/service-worker-source.js`](../../app/service-worker-source.js)、[`app/offline-readiness.ts`](../../app/offline-readiness.ts)、[`app/offline-prep-dialog.tsx`](../../app/offline-prep-dialog.tsx)、[`scripts/build-service-worker.mjs`](../../scripts/build-service-worker.mjs)、[`app/static-discovery.ts`](../../app/static-discovery.ts)、[`scripts/build-discovery-pages.mjs`](../../scripts/build-discovery-pages.mjs)、[`app/circle-page-data.ts`](../../app/circle-page-data.ts)、[`app/circle-page/`](../../app/circle-page)
**實作**：`app/public-page-locale.ts`、`app/public-page-messages.ts`、`public-page-main.ts`、`public-page.html`、`scripts/build-privacy-page.mjs`
**測試**：`tests/catalog-publication.test.mjs`、`tests/service-worker.test.mjs`、`tests/public-artifact.test.mjs`、`tests/seo.test.mjs`、`tests/discovery-artifact.test.mjs`、`tests/circle-page.test.mjs`、`tests/offline-readiness.test.mjs`、`tests/multi-space-event-map.test.mjs`、`tests/browser/circle-page.mjs`、`tests/browser/reader-offline-prep.mjs`
**設定**：[`public/_headers`](../../public/_headers)、[`public/_routes.json`](../../public/_routes.json)、[`functions/_html-security.ts`](../../functions/_html-security.ts)

### 公開搜尋介紹頁

「逛品書」使用 Reader 原有 publication，一次載入同活動 base 與 overlay，沒有逐卡查詢或新增輪詢。卡片以既有 preview URL 延遲載入，完整圖片只在社團出展頁讀取；不新增懶載入路由、Service Worker 策略或 precache 名單特例。返回時可重取 overlay，分享結果隨現行公開內容更新；驗收邊界見[品書瀏覽契約](./reader.md#品書瀏覽)。

活動及社團介紹 HTML、首頁未執行 JS 的活動摘要與 sitemap 由 Function 依目前發布的版本即時產生（[`functions/_discovery.ts`](../../functions/_discovery.ts)、[`functions/_published-events-html.ts`](../../functions/_published-events-html.ts)，#546），每個版本在同一個 isolate 只產生一次；build 只記錄頁面腳本的資產標籤（`discovery-assets.json`）。HTML 僅投影 reviewed base 的社團名稱、配置及活動 reference；不讀取或靜態保存社團 overlay、圖片、聯絡資料、收藏或行程。新增或更正已發布活動只換發布版本，不需要重新 build。

介紹頁 HTML 經既有 Function 加上每次回應的 CSP nonce（ADR-0074）。社團頁另依 [ADR-0077](../adr/0077-circle-share-images-follow-published-media.md) 唯讀取得分享縮圖，不重建 overlay 或寫入資料。Event JSON-LD 僅使用可解析的活動日日期與既有場館／主辦名稱、網址，活動有別稱時以 `alternateName` 列出；`image` 使用活動圖片（[ADR-0070](../adr/0070-event-images-are-published-by-approval-under-their-hash.md)），沒有時使用下段的品牌分享圖。pinned 場館記錄有地址時，`location[].address` 輸出 `PostalAddress`：從官方地址文字拆出郵遞區號、縣市（`addressRegion`）、鄉鎮市區（`addressLocality`）與其餘街道（`streetAddress`），`addressCountry` 為 `TW`，拆不出縣市時整段作為 `streetAddress`。地址只出現在 JSON-LD，不加到頁面文字。沒有地址的舊 pin 省略地址；售票、表演者、活動狀態與開場時間沒有資料，一律省略，不保證 rich result 資格。

FF47 的舊資料沒有 Organizer 候選及身分分組檔。除原始固定 pin 外，僅允許 #395 的固定地址補齊 pin `44c437efc9133e1a37a68b93f3ed3e49175684e2` 省略分組檔；其七份非場館檔案 bytes 與原 pin 相同，場館只補上已公開的地址及出處。其他新 commit／活動仍須提供分組檔；本次不建立候選、不變更既有身分、攤位或歷史核准紀錄。

首頁、介紹頁的 build 產物與 Reader 啟動後的 head 預設以絕對網址指向品牌分享圖 `/share-card.png`（1200×630 PNG，維護者選定的 C 版），並使用 `summary_large_image`。有活動圖片時，活動介紹頁與 Reader 的活動畫面使用活動圖片及其尺寸。社團頁 GET 回應使用該社團已儲存的分享縮圖選擇；代表圖尺寸未知時移除尺寸 metadata，未選圖或所選內容已不公開時回到品牌圖。多數分享平台不接受 SVG，所以不用站台圖示。分享圖供其他平台的伺服器抓取，不加入 Service Worker precache。

首頁原始 HTML 另帶一份 `WebSite` JSON-LD（`name`「場刊 Map」、`url` 正式網域首頁），供搜尋結果顯示網站名稱；Reader 啟動後不另外插入。介紹頁的站內連結都是最終網址（例如頁尾連到 `/privacy/`），不經轉址。

`/portal/` 是給社團與主辦的功能介紹頁，同一次 build 由 `portalIntroPage()` 產生並列入 sitemap，以 `publicPage` 頁面腳本提供語言切換，HTML 同樣經 Function 加 CSP nonce；`_routes.json` 只包含頁面本身，`/portal/media/` 的示範動圖是靜態資產，不呼叫 Function。示範動圖為循環播放的 WebP，各附一張靜態畫格，`prefers-reduced-motion: reduce` 時改用靜態畫格；所有示範檔案須存在且尺寸一致，否則 build 失敗。這些檔案由維護者以 `scripts/capture-portal-demos.mjs` 對本機隔離環境與虛構 sample 資料重新錄製，不含真實社團或帳號資料。所有介紹頁頁尾連到 `/portal/` 與對應語言的隱私告知。

活動、社團與入口介紹頁的無 JS 內容維持繁中與官方原文；頁面腳本依共用語言優先序翻譯系統標籤、日期及瀏覽器標題，並同步靜態外層與 React 社團內容。明確切換只更新 URL 與瀏覽器偏好；收藏、行程及原始內容不變，分享與站內導覽延續語言。社團名稱、官方分類、作品／題材及自填標籤保持原文；站方固定選項只翻譯呈現 label。canonical／sitemap 維持單一網址，不新增三份活動／社團 SEO 頁面。

隱私告知由同一 build 產生 `/privacy/`、`/privacy/en/`、`/privacy/ja/`，各自無 JS 可讀並互相連結；譯文對應同一份政策，不新增承諾。404 以三語靜態內容提供返回入口。

介紹頁不加入地圖離線 precache，導覽仍 network-only；它們不得寫入 Reader 的離線 shell。社團介紹頁腳本自己的資產同樣不進 precache（`scripts/build-service-worker.mjs` 與 `tests/public-artifact.test.mjs` 把關），與 Reader 共用的 chunk 除外。原 query 地圖仍使用既有離線行為。介紹頁 HTML 為 `private, no-store`；sitemap 的公開 HTTP 快取最多 5 分鐘後重新驗證；這不新增輪詢。

#### 社團介紹頁的頁面腳本

社團介紹頁（`circlePath`）是可分享的出展頁。靜態 HTML 已列出社團名稱、每一筆配置與「在地圖查看」；未執行 JS 時仍是完整的官方頁面。頁面另外載入自己的入口 `circlePage`（Vite 以 `circle-page.html` 為模板建置，discovery build 把資產標籤複製到每個社團頁後移除模板），只做靜態 HTML 做不到的兩件事：

- **即時讀取社團填寫的內容。** 經既有的 `/data/events/:eventId/overrides.json` 讀取，與地圖使用同一條路徑、同一個 publication module 與同一個 `buildCircleCatalog` 投影；不是新的公開讀取路徑。可撤下的社團內容因此不會寫進 build 產物。每次開啟頁面讀一次 overlay，不輪詢；已開啟頁面的更新時機同下方「更新可見性」。頁面腳本使用自己的 publication instance，同樣接上切回前景／恢復連線的 overlay 重讀，並在名稱上方顯示 overlay 的活動公告。
- **收藏、行程與分享。** 收藏與行程經既有 planning store 寫入，與地圖是同一份資料，見[收藏與走訪規劃契約](./reader.md#責任邊界)；逐日的「加入這天行程」填進靜態攤位卡預留的位置。分享只使用瀏覽器的系統分享或剪貼簿，不送出任何請求。

頁面腳本需要的官方資料不另外請求：該社團在 reviewed base 中的名稱與全部 placement，以 `circle-catalog/3` 格式（只有這一個社團）寫在 HTML 的 `application/json` 區塊（`#circle-page-data`）。欄位逐一複製，不帶其他屬性；`day` 保持原型別，行程才會與地圖寫入的鍵一致。整份 `circles.json` 不因開啟一個社團頁而下載。

載入行為沿用下方「base first、overlay optional」：overlay 讀取中顯示保留版面的 skeleton；讀取失敗時保留官方配置，明說社團介紹暫時無法顯示並提供重新讀取，不表示成社團沒有填寫；overlay 可用但該社團沒有內容時不顯示介紹區塊，也不放佔位圖。頁面腳本不載入 session、Turnstile 或任何寫入端點。

### Payload 邊界

- **場刊與地圖是版本化快照**（`circles.json`，加上 `map.json` 或 `map-manifest.json` + `maps/<periodKey>/<venueSpaceId>.json`），存在活動資料 bucket，由 [`functions/_event-data.ts`](../../functions/_event-data.ts) 依 `index.json` 指向的版本提供，**不打包進 JS bundle**。`index.json` 是唯一的版本指標：發布先寫完新版本的所有檔案，最後才改 `index.json`，讀者只會看到舊版或新版。部署的 Reader 以頁面載入時的版本讀 `/data/events/<eventId>/v/<version>/…`，每個版本的檔案各有網址，離線快取因此不會把一個版本的場刊和另一個版本的地圖配在一起；舊的 `/data/events/<eventId>/…` 仍提供目前版本。開發伺服器的 staged 資料沒有版本，沿用原路徑。
- **已發布活動清單**（每場的活動定義、reference records 與目前版本）由 middleware 以 `<script type="application/json" id="published-events">` 資料區塊寫進每個會執行程式的 HTML；`app/event-catalog.ts` 同步讀取。部署的 bundle 不內含任何活動；開發伺服器與 fixture build 仍以 Vite `define` 帶入 staged 活動。讀不到 `index.json` 時 HTML 回 503，不以空清單或 fixture 冒充。
- 公開 bundle 只承載介面與投影邏輯。**場刊資料字面值不得回流到 bundle**，由測試把關。
- 公開產物不得包含 `_worker.js` 或 server bundle。理由與整體取捨見 [ADR-0008](../adr/0008-static-public-reading-path.md)。
- 社團補充資料由 `/data/events/:eventId/overrides.json` 這個 Pages Function 提供，疊加在快照之上。
- request、base payload、overlay payload 與 event config 的 `eventId` 必須一致；任何 mismatch fail closed。store、listener、in-flight request 與 server catalog cache 都按 event 分區。

### 載入行為

- **Shell First**：首屏必須先畫出頂部列、日期、篩選與面板結構。
- **Skeleton 而非 spinner**：搜尋結果在快照載入前顯示保留版面的 skeleton 與「正在讀取社團資料…」，不得以空白畫面或孤立 spinner 代替。
- **篩選詞彙先到**：創作類別等篩選選項屬於活動定義，必須在快照抵達前就可見。只有依賴資料的計數可以稍後補上。
- **延後套用選取**：可分享連結的社團與攤位選取在快照可解析後才套用；在此之前不得改寫 URL。見 [URL 檢視狀態契約](./reader.md#url-檢視狀態)。
- **規劃閘門**：收藏與行程只在快照可用後才判定社團是否存在，不得在空目錄上判定孤立。見 [收藏與走訪規劃契約](./reader.md#儲存與版本)。
- **失敗狀態**：快照讀取失敗時保留介面結構，明確說明是**社團資料讀取失敗**並提示重新整理。**不得偽裝成「查無結果」。**
- **base first、overlay optional**：reviewed base 驗證成功就先進入 ready；overlay 的離線、Access、500、格式或 event mismatch 只將 overlay 標成 unavailable，完整 base 不進入 error。重試按 event 執行，不會鎖住其他活動。

### 離線

站台註冊 Service Worker 作為離線 shell：

| 資源 | 策略 |
|---|---|
| 閱讀端導覽（`/`、`/index.html`） | network-first，回退已快取 shell |
| 其他導覽（`/circle`、`/organizer`、`/privacy`） | network-only；不讀也不寫 shell 快取 |
| `/data/events/*`（`circles.json`、地圖 artifacts） | stale-while-revalidate |
| Function `/data/events/:eventId/overrides.json` | network-only；失敗時 publication module 使用 reviewed base |
| 公開頁首樣式 `/site-header.css` | stale-while-revalidate；只儲存 CSS 回應 |
| 雜湊資產 | cache-first |

- precache 清單由 build 時產生，**只涵蓋 `index.html` 實際載入的資源**，不含社團入口。活動資料不在 build 裡：Service Worker 安裝時讀 `/data/events/index.json`，另外快取其中每個活動目前版本的檔案；之後的更新由 stale-while-revalidate 帶入。
- **只有閱讀端自己的路徑可以更新 shell 快取。** `/circle`、`/organizer` 與 `/privacy` 是各自獨立的文件，其資產刻意不進 precache；若把它們的回應寫進 shell，下一次離線啟動閱讀端就會拿到入口文件而不是地圖，且缺少從未快取的資產。閱讀端狀態全部放在 query parameter，因此閱讀端就是這兩條路徑。
- **絕不把被重新導向的回應當成 shell 或場刊快取。**
- 展場離線可重新載入並繼續使用已下載的場刊、地圖、字型與介面。只發布單一 `map.json` 的分日活動，離線時 manifest 請求在網路層失敗，與 404 相同改讀 `map.json`。
- **離線使用（#415）**：「使用說明」的「離線使用」說明開過的活動會自動存好官方場刊與地圖，以及需要網路的內容（社團自填介紹與品書圖、外部連結），並提供「確認這天可離線使用」，明示活動、日期與場地。沿用既有 Service Worker 與 cache：核對該日所需的 shell、目前頁面載入的資產、`circles.json`、地圖 manifest 與該範圍的地圖，缺少的以與 Worker 相同的條件補抓，**再核對一次才標為已就緒**；曾載入過或曾按過按鈕都不是就緒證據。部分失敗顯示可重試；不支援或同時存在多個版本快取時請使用者重新整理。不新增 Worker、排程或下載平台。
- **介面語言跟隨閱讀端 bundle。** 閱讀端的三語字典以靜態 import 打包在閱讀端資產內，不依語言另拆動態 chunk，因此已準備離線的活動在離線時也能切換語言；社團與主辦入口的字典不得進入閱讀端 precache。
- **離線範圍只涵蓋自家靜態產物。** 外部社團縮圖與外部連結不快取；離線時維持既有的降級狀態，不得改以本地內容假冒。
- 提供 web app manifest 與可遮罩圖示，讓使用者能在展前把工具加入主畫面。**安裝與否不改變任何核心流程。**

### 分享短網址

`POST /api/shares` 建立匿名 snapshot；`GET /api/shares/<shareId>` 回 snapshot（`private`，最多 60 秒）、不存在 404、過期 410；`GET /s/<shareId>` 由 Function 回應含活動名稱與項目數的 `og:title`／`og:description`、固定 `/share-card.png`、`noindex` 與 refresh 到 `/?event=<id>&share=<shareId>`。三者都不進 Service Worker precache，離線時不可用。格式與保存見[收藏與走訪規劃契約](./reader.md#分享行程)與[資料 inventory](./data-inventory.md)。

### 快取標頭

靜態資產由 `public/_headers` 設定；HTML 由 Functions 加上 CSP nonce 與 `private, no-store`，不沿用靜態 HTML 快取時間：

| 路徑 | Cache-Control |
|---|---|
| `/assets/*` | `public, max-age=31536000, immutable`（檔名含 content hash） |
| `/data/events/*` | `public, max-age=60, must-revalidate` + R2 ETag |
| Function `/data/events/:eventId/overrides.json` | `public, max-age=60, must-revalidate` + strong ETag（Function response 明確覆寫 static `_headers` 規則） |
| R2 代管縮圖 | `public, max-age=31536000, immutable`（URL 含內容 SHA-256） |
| `/sw.js` | `no-cache`（另帶 `Service-Worker-Allowed: /`） |
| `/manifest.webmanifest` | `public, max-age=3600` |
| `/share-card.png` | `public, max-age=86400`（網址固定，換圖後最多一天更新） |

#### 更新可見性

上述 `max-age` 是 HTTP 快取有效期，不是輪詢間隔。地圖、逛品書與社團介紹頁在每個活動初次載入時取得 base 與 overlay；之後在頁面 `visibilitychange` 轉為可見及 `online` 事件時只重讀 overlay，不重取 base、不設定時器，重疊的觸發按活動合併成一次請求。重讀使用預設 fetch cache 模式：overlay 快取仍有效時可沿用舊內容；快取到期後的下一次觸發才向伺服器驗證並套用結果（社團補充資料、takedown 與活動公告的發布／清除都一樣）。快取到期本身不觸發更新，持續停留前景的頁面不保證在一分鐘內看到儲存或撤下結果。重讀失敗時保留目前畫面，不新增錯誤狀態。Service Worker 不保存 overlay，初次取得 overlay 失敗時使用完整 reviewed base，不顯示活動公告。

已開啟頁面的更新方式依 [#538](https://github.com/dekkmarsvin/tw_doujin_event/issues/538) 的維護者決策 2 採「切回前景或恢復連線時重讀」，不採定時輪詢；[#48](https://github.com/dekkmarsvin/tw_doujin_event/issues/48) 原本「約一分鐘內對已開啟頁面可見」的要求以此取代。成本比較見 #538。

overlay 文件最外層可帶選填的 `notice`（`kind`：`info`／`important`、`text`、選填 https `url`、伺服器寫入的 `updatedAt`），沒有公告時不寫出這個鍵，schema 版本不變。Client 對格式錯誤的 `notice` 只丟棄公告，其餘 overlay 照常套用；不認得 `notice` 的舊 client 照常使用 overlay。

**overlay 的每一次 revalidation 都是一次 Function 呼叫，包含回 304 的那些。** strong ETag 省的是頻寬，不是請求數：304 的分支在 Function 內部，且在算出 ETag 之前已經讀過一次 D1。Cloudflare 的邊緣不會在 Function 之前擋下這些請求——Workers Cache 是 `wrangler.jsonc` 的 `cache.enabled` 選項，目前沒有開；zone 層的預設快取副檔名清單也不含 `.json`。

計費方案的歷史判斷見 [ADR-0065](../adr/0065-cost-reasoning-uses-the-workers-paid-basis.md)，不在此複製費率或從快取有效期推算活躍讀者數。

Cloudflare 沒有提供降低帳號用量上限或模擬 Error 1027 的測試介面，也不以受控實驗消耗正式帳號用量。部署流程以 Pages project API 驗證並設定 production／preview 的 `fail_open: true`；這是可重複驗收的配置契約，與方案層級無關，維持有效。

不以耗盡配額實驗作發布 gate、部署配置採 fail-open 的決策仍有效（[ADR-0031](../adr/0031-quota-exhaustion-is-not-a-release-gate.md)）；舊有 Free 成本前提的取代關係見 ADR-0065。

公開場刊／地圖與資產不得新增 Pages Function 讀取路徑。HTML nonce 是 [ADR-0074](../adr/0074-html-responses-carry-per-request-csp-nonces.md) 的例外，每次 HTML 網路請求計入同一份帳號 Function 用量，但不查 D1／R2。社團縮圖已使用獨立的 production／preview R2 bucket 與 custom domain，不走 Function（[ADR-0017](../adr/0017-thumbnails-are-self-hosted-with-external-urls-kept.md)）。

同一份 `_headers` 也設定 CSP、`Permissions-Policy`（關閉相機、麥克風、定位）、`Referrer-Policy`、`X-Content-Type-Options` 與 `X-Frame-Options`。`img-src` 允許 `'self'`、`data:` 與 `https:`——寫入驗證接受任何 https 圖片位址（[ADR-0052](../adr/0052-thumbnail-addresses-are-checked-as-images-not-hosts.md)），CSP 若比它窄，存得進去的圖片會在讀者瀏覽器被擋掉。兩者一致由 `tests/circle-overrides.test.mjs` 把關，見[社團自助控制面契約](./circle-portal.md#媒體安全)。

`/circle*` 與 `/organizer*` 各有一份放寬的 CSP：`script-src` 與 `frame-src` 加入 `https://challenges.cloudflare.com`，供登入表單的 Turnstile 使用（[ADR-0016](../adr/0016-human-verification-guards-the-mailer.md)）。兩份內容相同。**閱讀端的策略不變**——Turnstile 是本站程式碼唯一載入的第三方 script，且只在這兩個登入入口。三份策略都放行的 `https://static.cloudflareinsights.com` 是正式網域由 Cloudflare 自動注入的 Web Analytics beacon，見[資料 inventory](./data-inventory.md#第三方)。Cloudflare 對多條命中的 `_headers` 規則採合併而非覆寫，所以該區塊先以 `! Content-Security-Policy` 移除站台層的策略再重新宣告；兩份策略同時生效會被瀏覽器取交集，反而擋掉元件。兩個入口的策略關係（站台層 + 恰好兩個 Turnstile 來源）由 `tests/circle-overrides.test.mjs` 斷言。

HTML 的 Functions policy 與三份靜態 policy 除 nonce 外一致，由 `tests/html-security.test.mjs` 把關。HTML 不做通用 script nonce 重寫，只讓 Cloudflare 採用 CSP header 的 nonce；私人圖片 API 保留 sandbox policy。靜態政策仍作 fail-open 備援。

Service Worker 只攔截同源請求，`challenges.cloudflare.com` 直接落到網路。Reader 離線 shell 保存完整 Response，使 body 與 nonce policy 配對；不獨立刷新 CSP nonce。每次線上 HTML 回應產生新 nonce，並移除資產 ETag／Last-Modified，禁止 CDN 與 HTTP 快取。

`/admin*` 僅增加 `X-Robots-Tag: noindex, nofollow`，沿用全站 CSP；它沒有登入表單，不需放寬 Turnstile 來源。`/circle`、`/organizer`、`/admin` 的專用資產都不進 Reader precache。

### 驗收條件

- `dist/index.html` 存在；`dist/_worker.js` 與 `dist/server/index.js` 不存在。
- 部署的 `dist` 不含 `data/events/`，bundle 不內含已發布活動。
- `/data/events/<event>/<file>` 與 `/data/events/<event>/v/<version>/<file>` 只提供 `index.json` 列出的目前版本檔案；被取代的版本、未列出的檔案、未發布的活動與路徑穿越一律 404，撤下或更正立即生效。
- 主 bundle 不含場刊資料字面值。
- 公開 bundle 不包含 `/api/events/`、地圖管理匯入器或管理發布文案。
- Service Worker 安裝時以版本化網址快取 `index.json` 列出的**每一個**已發布活動的全部檔案。選了第二場活動再離線的讀者不得拿到空殼。
- `dist/_headers` 與 `dist/_routes.json` 存在；Functions 涵蓋 HTML、API、`/data/events/*` 與 `/sitemap.xml`，資產與字型直送。
- 全新瀏覽器工作階段不需圖片或 D1 即可取得同一份場刊與地圖。
- 離線重新載入後，已下載的場刊、地圖、字型與介面仍可運作；縮圖不可用時維持文字卡。

## 資料匯入範圍

**實作**：[`app/planning-transfer.ts`](../../app/planning-transfer.ts)、[`app/planning-transfer-panel.tsx`](../../app/planning-transfer-panel.tsx)
**測試**：`tests/planning-transfer.test.mjs`

不同資料入口由各自契約定義，本文只提供索引，不另定一套比對、預覽或寫入流程。

| 入口 | 現行契約 |
|---|---|
| 讀者的完整 JSON 備份復原 | [收藏與走訪規劃：匯出與匯入分期](./reader.md#匯出與匯入分期)，包含格式、驗證、衝突處理與未匹配資料保留 |
| 接收分享行程 | [收藏與走訪規劃：分享行程](./reader.md#分享行程)，包含唯讀預覽、確認加入及私人欄位邊界 |
| 主辦匯入官方攤位資料 | [主辦單位工作區](./organizer-workspace.md)，使用獨立的官方名單格式與候選發布流程 |

讀者 CSV 匯入與外部服務授權／內容匯入仍未開放，分期依 [ADR-0005](../adr/0005-import-stays-p2-export-only.md) 及 [ADR-0078](../adr/0078-own-planning-backups-can-be-imported.md)。既有 parser 不代表公開介面已支援。

舊外部服務匯入提案中的 `ImportPreview`、身分比對、OAuth、批次紀錄及 CSV 往返要求，不是現行產品契約。[原提案保留於固定版本](https://github.com/dekkmarsvin/tw_doujin_event/blob/dbd0301227a8f89380ca8fd40ac09bea217c19f5/docs/contracts/data-import.md)，只供理解歷史取捨；重新啟動時需另立需求，依當時的實作與已接受決策評估，不以該提案直接驗收。
