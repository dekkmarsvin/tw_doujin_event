# 社團資料來源與匯入模組設計

## 目的與範圍

本模組定義社團核心資料、活動攤位配置、外部內容來源與使用者匯入之間的邊界。目標不是複製外部場刊，而是在資料來源透明、可回復且不靜默覆寫的前提下，補充作品圖片、介紹與原始連結。

P0 以專案維護的社團與活動資料支援核心瀏覽，P1 完善來源顯示與失效降級。CSV、外部收藏匯入、OAuth 與同步都屬 P2；授權登入不得自動開始匯入或同步。

**本文的「登入」一律指使用者為了匯入而授權外部服務（pixiv 等），此範圍仍屬 P2、尚未實作。** 這與另一種已經上線的身分無關：社團為了維護**自己的**公開資料，在獨立入口 `/circle` 以 email 一次性連結登入。兩者的資料流方向相反——前者把外部內容拉進本站，後者由當事人直接在本站填寫自己的資料，不涉及任何外部服務授權，也不觸碰使用者的收藏與行程。社團自助維護的設計見 `DESIGN.md` 的 Circle Self-Service Control Plane 一節。

## 資料權威與領域模型

```ts
type CircleRecord = {
  id: string;
  name: string;
  nameReading?: string;
  description?: string;
  categories: string[];
  updatedAt: string;
};

type PlacementRecord = {
  eventId: string;
  circleId: string;
  day: string;
  area: string;
  boothCode: string;
  status: "active" | "cancelled" | "moved";
};

type SourceLink = {
  provider: string;
  contentType: "official" | "circle" | "catalog" | "social" | "media";
  url: string;
  externalId?: string;
  fetchedAt?: string;
  status: "linked" | "stale" | "unavailable" | "unverified";
};

type ExternalContent = {
  id: string;
  circleId: string;
  source: SourceLink;
  kind: "description" | "image" | "work" | "link";
  value: string;
};
```

### 權威順序

1. `CircleRecord.id` 是專案內社團身分的唯一鍵；名稱只是顯示與比對線索。
2. `PlacementRecord` 是活動、日期、區域與攤位定位的權威；外部頁面的攤位文字不得直接覆寫。
3. `SourceLink` 與 `ExternalContent` 是帶來源的補充資料；可停用或失效，但不改變本地社團身分。
4. 使用者收藏、群組、備註與行程屬於使用者資料，外部匯入不得覆寫，交換規則見 `favorites-and-visit-planning-design.md`。

## 身分比對規則

- 優先使用已保存的 `provider + externalId` 對應，其次使用活動提供的穩定識別碼，再其次才以名稱、日期與攤位組合產生候選。
- 同名不是自動合併依據。比對結果分成 `matched`、`ambiguous`、`new` 與 `invalid`；只有 `matched` 可進入預設寫入集合。
- `ambiguous` 必須顯示所有候選、比對依據與差異，讓使用者手動選擇或略過。
- 名稱正規化只用於產生候選，不得回寫原始名稱；日文、中文、空白與符號差異都保留可追溯的來源值。
- 一個社團可有多個 `SourceLink`；同一外部識別碼不可同時指向多個本地社團，除非先解除舊關聯並確認。

## 資訊顯示契約

- 清單卡、完整詳情與地圖側欄從同一 `CircleRecord` 組合 `PlacementRecord` 與外部內容，只調整密度，不複製資料。
- 每個外部圖片或文字區塊顯示提供者、內容類型與原始連結；已匯入內容另顯示匯入／擷取時間。
- 來源為主辦公開資料時可標示「主辦來源」；其他來源不得使用「官方」措辭，除非資料本身可驗證該身分。
- 圖片缺少授權、來源 URL 或替代文字時不進入公開顯示；載入失敗時移除媒體區塊並保留文字核心資訊。
- `stale`、`unavailable` 與 `unverified` 使用文字狀態，不只靠圖示或色彩。

## 匯入批次與預覽

```ts
type ImportBatch = {
  id: string;
  schemaVersion: string;
  sourceProvider: string;
  createdAt: string;
  rows: ImportCandidate[];
};

type ImportPreview = {
  matched: ImportCandidate[];
  ambiguous: ImportCandidate[];
  newRecords: ImportCandidate[];
  invalid: ImportError[];
  conflicts: ImportConflict[];
};
```

### 匯入流程

1. 使用者主動選擇檔案或連接來源；畫面先顯示格式、來源、預估筆數與將寫入的資料種類。
2. parser 驗證 schema version、必要欄位、編碼、URL 與列數，任何解析錯誤都不得直接改變正式資料。
3. matcher 依身分比對規則產生 `ImportPreview`，分開顯示可匹配、需人工判斷、新資料、無效列與欄位衝突。
4. 使用者逐類選擇略過、建立關聯、補充或覆寫允許欄位；本地核心欄位預設保留。
5. 確認畫面再次列出實際新增、更新、略過與衝突數，使用者按「確認匯入」後才寫入。
6. 寫入保存 batch ID、來源、時間、決策與逐列結果；失敗時可重試未完成列，不重複已成功寫入。

### 衝突策略

- 本地 `CircleRecord.id`、`PlacementRecord` 與使用者規劃資料不可由一般外部匯入覆寫。
- 外部內容以 `provider + externalId + kind` 去重；相同來源的新版本可更新其自己的內容，但不得改寫另一提供者資料。
- 需要覆寫本地描述時，預覽並列目前值、匯入值、來源與更新時間，預設選擇保留目前值。
- 匯入成功後提供摘要與可復原批次；若儲存層無法支援可靠 rollback，P2 不得開放覆寫，只能新增來源關聯。

## CSV 交換格式 v1

CSV v1 用於使用者規劃資料的可攜交換，不等同外部服務完整備份。UTF-8、首列欄名，欄位如下：

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `schema_version` | 是 | 固定為 `circle-plan-csv/1` |
| `event_id` | 否 | 行程所屬活動；只有收藏時可空白 |
| `circle_id` | 是 | 專案內社團 ID；無法匹配時列入預覽 |
| `group_label` | 否 | 收藏分類名稱；同名群組由使用者確認合併 |
| `memo` | 否 | 使用者備註，保留換行與 UTF-8 內容 |
| `visit_status` | 否 | `planned`、`next` 或 `visited` |
| `route_order` | 否 | 同活動內的正整數順序 |
| `source_provider` | 否 | 協助核對的來源名稱，不作身分唯一鍵 |
| `source_url` | 否 | 可驗證的 HTTPS 原始連結 |

- parser 必須拒絕未知 schema version、公式注入風險值與不合法 URL，並對每列提供錯誤位置。
- 匯出會在可能被試算表解讀為公式的文字前安全轉義；重新匯入時依版本規則還原。
- CSV v1 單檔上限為 10 MiB、20,000 筆資料列；超過時整批拒絕並提示拆檔，不進入部分預覽。上限可在新 schema version 經瀏覽器記憶體測試後調整；WebCatalog 觀察到的 30MB 不直接沿用。

## 外部服務串接

- P2 的第一個里程碑只支援使用者啟動的檔案匯入或公開 URL 擷取，並遵守來源服務條款、robots 與授權限制。
- OAuth 連接、token refresh、解除連接與背景同步同屬 P2 的後續里程碑。登入成功只代表授權完成，不得自動匯入或覆寫。
- 每個 provider adapter 只負責驗證授權、取得原始資料與轉成候選格式；身分比對、衝突預覽與寫入由共用 import service 負責。
- 解除外部服務時刪除 token；是否保留已匯入內容由使用者選擇，並清楚說明來源可能不再更新。
- API 失敗、限流或來源停用時顯示最後成功時間與可重試狀態，不讓空白畫面取代本地核心資料。

## 安全與隱私

- 不在前端 bundle、CSV、log 或匯入摘要保存 access token、cookie 或第三方帳號密碼。
- 匯入的 HTML 一律視為不可信內容，轉為允許的純文字／結構欄位；URL 與圖片來源需驗證協定與允許的載入政策。
- 預覽遮蔽非必要的個人資料，log 只記錄 batch、provider、列號、決策與錯誤類型。
- 使用者可刪除某一來源的所有關聯與內容；刪除前顯示受影響筆數，完成後提供可核對摘要。

## P0、P1、P2 邊界

- **P0：** 本地 `CircleRecord`、`PlacementRecord`、基本來源標示與原始連結，以及本機規劃資料的復原用安全匯出；不開放匯入。
- **P1：** 一致的來源元件、更新時間、同步狀態與外部內容失效降級；不包含資料匯入。
- **P2：** versioned CSV 匯入、檔案解析、身分候選、衝突預覽、明確確認、批次摘要、可復原寫入、OAuth provider adapters、手動同步，以及經使用者明確啟用的排程同步。付費牆或時限解鎖不在範圍內。

## 驗收條件

- 沒有來源標示或原始 URL 的外部圖片不會出現在公開社團介面。
- 同名社團匯入時不會自動合併；使用者能在預覽中看見候選與差異。
- 匯入在確認前不改變正式資料，確認畫面列出新增、更新、略過、衝突與錯誤數。
- 外部匯入不會覆寫攤位配置、收藏、群組、備註或行程。
- 重複匯入同一批資料不會產生重複來源內容；逐列失敗可安全重試。
- 外部來源無法連線時，本地社團詳情、向量地圖、收藏與行程仍可完成核心任務。
- CSV v1 可往返保留群組名稱、備註與行程狀態；未知版本與危險內容會被拒絕並回報列號。
