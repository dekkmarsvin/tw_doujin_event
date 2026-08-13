# 收藏與走訪規劃契約

把「記住感興趣的社團」與「安排活動當天怎麼走」連成可回顧的流程，同時保留兩者的語意邊界。收藏是長期偏好與備註的容器；行程、下一站與已走訪是特定活動中的執行狀態。

**實作**：[`app/planning-store.ts`](../../app/planning-store.ts)、[`app/use-planning.ts`](../../app/use-planning.ts)、[`app/planning-tools.tsx`](../../app/planning-tools.tsx)、[`app/planning-transfer.ts`](../../app/planning-transfer.ts)
**測試**：`tests/planning-store.test.mjs`、`tests/planning-transfer.test.mjs`

規劃資料只儲存在使用者當下的瀏覽器，不跨裝置同步。這是刻意的隱私姿態，不是尚未完成的功能——決策與代價見 [ADR-0002](../adr/0002-planning-data-stays-on-device.md)。

## 責任邊界

- 規劃 store 是收藏、群組與行程的**唯一讀寫 seam**；清單卡、完整詳情與地圖不得各自保存 `isFavorite`。
- 行程狀態不因收藏切換而自動新增或移除項目。
- 頁面 controller 把 store 狀態投影到社團清單、詳情與地圖 renderer；renderer 只呈現狀態並回報互動。
- UI 元件負責顯示與收集意圖，不直接理解 `localStorage` key、序列化版本或未來的帳號 API。

## 領域模型

以下型別與 `app/planning-store.ts` 同步。欄位變更必須同時更新本文。

```ts
const PLANNING_SCHEMA_VERSION = 2;
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
  schemaVersion: 2;
  favoriteGroups: FavoriteGroup[];
  favorites: FavoriteRecord[];
  visitPlans: VisitPlanEntry[];
};
```

## 不變量

- `FavoriteRecord` 以 `eventId + circleId` 唯一。**記錄存在即代表已收藏**，不另存容易失真的 `isFavorite`。
- `FavoriteGroup.name` 去除前後空白後必須非空；顏色可重複，且**不得作為群組識別鍵**。所有色點旁都要顯示群組名稱。
- `circleId` 必須是 canonical circle ID，以 `CIRCLE_CATALOG_BY_ID` / `isKnownCircleId()` 核對——不是以 placement `recordId` 為 key 的 `CIRCLE_RECORDS_BY_ID`。用錯 seam 會讓有效收藏被資料管理誤列為「目前無法匹配」。
- 同一攤位的多個社團以不同 `circleId` 建立獨立收藏與備註，不因 booth code 相同而合併。
- 同一活動最多一筆 `status = "next"`。設定新的下一站時，原下一站回到 `planned`，且**不取消其收藏**。
- **加入行程一律建立 `planned`。** 只有「設為下一站」可建立或轉移 `next`；移除或走訪下一站後不自動指定替代下一站。決策見 [ADR-0004](../adr/0004-plan-and-next-stop-are-separate-actions.md)。
- `routeOrder` 只對同一活動的行程項目有意義；收藏列表排序不得反向改寫行程順序。每次移動後壓縮為 0 起始的連續整數。
- `budget` 是非負整數新台幣或 `null`；`purchaseMemo` 記錄預計購買品項。每日行程彙整已填寫攤數與預算總額。
- 刪除收藏群組前必須讓使用者選擇移到其他群組或變成未分類，不得連帶靜默刪除收藏。
- **孤兒不靜默丟棄。** catalog 找不到對應社團時仍保留收藏與行程；管理介面顯示未匹配 ID、備註與狀態，並允許個別移除或匯出。

## 儲存與版本

- 以 versioned `localStorage` 文件保存於 `PLANNING_STORAGE_KEY`；讀取時先驗證與遷移，再提供給 UI。
- 寫入使用單一 transaction 或等效原子更新，避免群組、收藏與行程在多個 key 之間部分成功。
- **schema 1 → 2 遷移**：schema 1 的 placement-scoped ID 會先合併備註再遷移到 canonical circle ID。收藏衝突保留所有不同備註，並採最近更新的群組與時間；行程依日期合併到同一社團。不靜默清空本機資料。
- **遷移時機**：舊版 ID 遷移必須在社團快照可用後才執行並寫回。不得在空目錄上判定孤立，也不得凍結未遷移的 ID。
- `circleId` 是關聯鍵；社團名稱、攤位與圖片**不複製進規劃資料**，顯示時從目前 `CircleRecord` 解析。
- 不相容或損壞的內容必須保留原始字串、停止覆寫並提供下載。寫入失敗時保留本分頁狀態，顯示儲存異常與匯出備份指引。
- 「清除所有規劃資料」必須先列出收藏、備註與行程的受影響數量並再次確認；完成後不得留下無法管理的孤兒群組或行程項目。

## 核心互動

### 收藏

1. 使用者在清單、詳情或地圖側欄切換收藏。
2. 首次收藏立即建立 `FavoriteRecord`，預設未分類，並顯示可選的群組與備註入口。
3. 修改群組或備註後，所有介面立即反映相同結果。
4. 取消收藏後顯示**七秒 Undo**。Undo 以原記錄完整恢復 `groupId`、`memo`、建立與更新時間，不因有備註或分類而降級，且不改變行程。

### 收藏分類

- 每個分類同時顯示名稱與色彩；色彩只協助掃讀，不承擔語意。
- 使用者可新增、改名、改色、排序與刪除分類，並支援來源到目標的批次搬移。
- 篩選結果顯示群組名稱與項目數；空群組仍可管理，但不製造無內容卡片。

### 走訪規劃

- 「加入行程」建立 `planned`；「設為下一站」建立或更新為 `next`；「標為已走訪」更新為 `visited`。
- 收藏不是加入行程的前提，加入行程也不強制收藏。介面可在同一規劃區呈現兩者，但**動作標籤必須分開**。
- 行程可直接拖曳排序，並保留可聚焦的往前／往後按鈕。移除行程不刪收藏、群組或備註。
- 地圖用形狀、圖示與文字輔助顯示 planned、next、visited，不只使用顏色。

### 導航模式

導航模式是**可隨時退出的暫時投影**，不是另一種模式狀態：

- 地圖只顯示所選日期的行程攤位。
- 桌機左欄顯示完整行程、購買項目與預算，優先聚焦 `next` 或第一個未走訪項目，並顯示已走訪／剩餘數。
- **不得清空使用者原本的搜尋與進階篩選。**
- 手機隱藏重複的發布 revision 與下一站浮條，保留可辨識的地圖視野。
- 不進行 GPS 定位或自動路徑推算。

## 跨介面一致性

| 操作來源 | 必須同步的介面 |
| --- | --- |
| 社團清單收藏 | 完整詳情、地圖 slot、地圖側欄、收藏清單 |
| 詳情修改群組／備註 | 清單收藏提示、地圖側欄、收藏清單 |
| 地圖設為下一站 | 行程清單、所有對應地圖狀態、社團詳情 |
| 行程調整順序或標為已走訪 | 行程清單、地圖 slot、地圖側欄 |

同一分頁內使用共享 store 或訂閱；多分頁使用 `storage` 事件與同分頁自訂事件 `PLANNING_CHANGED_EVENT`。同步失敗時以明確狀態提示，不以最後一次渲染的局部狀態覆寫 store。

## 匯出與匯入分期

- **現行（P0／P1）**：只開放**復原用途的安全匯出**——版本化 JSON 與 CSV v1，包含 schema version、群組、收藏、備註與行程，不含瀏覽歷程或任何憑證。CSV 對可能被試算表解讀為公式的值安全轉義。
- **一般介面不顯示匯入入口。** JSON／CSV 匯入、衝突預覽與寫入 UI 屬 P2，格式與流程見 [資料匯入契約](./data-import.md)。決策見 [ADR-0005](../adr/0005-import-stays-p2-export-only.md)。
- **P2 另含**：登入後跨裝置同步、分享規劃與協作清單。導入前需另行定義隱私、衝突解決與刪除政策。

## 驗收條件

- 任一介面收藏社團後，其他已開啟介面不需重新整理即可看到相同收藏、群組與備註。
- 收藏分類在所有位置都有文字名稱；關閉色彩後仍能辨識。
- 第一次加入行程後顯示「待前往」，下一站提示不出現；按「設為下一站」後才切換。
- 取消含備註的收藏不會無提示地遺失使用者輸入，七秒內可完整復原。
- 設定新下一站只改變同活動的行程狀態，不新增、移除或重新分類收藏。
- 重新載入後可恢復資料；schema 1 資料可遷移，且遷移不丟失備註。
- catalog 找不到對應社團時，管理介面仍可看見未匹配收藏／行程的 ID、備註或狀態並個別移除；匯出保留原記錄。
- 清除全部資料前可看見受影響數量，取消確認不會改變任何資料。
- 匯出後在空白瀏覽器環境重新匯入（P2 實作後），可還原群組、收藏、備註與行程，並回報無法匹配的社團。
