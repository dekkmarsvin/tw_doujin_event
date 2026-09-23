# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

提供一個以互動場地地圖為核心的台灣同人活動 Web Catalog，將「活動在哪裡、社團有什麼、讀者要去哪裡」放在同一個產品流程裡。

產品核心不是活動 ERP、社群平台或完整電子場刊，而是 **Event × Circle × Space** 三者的可搜尋、可定位、可維護關係：

- 活動主辦回答：**誰在哪裡**。
- 參展社團補充：**我是誰、會帶什麼**。
- 一般讀者完成：**我要去哪裡、現場怎麼找到**。

成功代表讀者不需要在社團名單、配置圖與社團 SNS 之間反覆人工比對；社團可以自行補充自己的展示資訊；主辦或維運者可以不修改程式、不操作 Git、不依賴 agent 建立下一場活動。

## Users

| 使用者 | 任務與成功結果 |
|---|---|
| Reader／一般參加者 | 展前搜尋、收藏與規劃，現場以手機定位攤位；不用自行比對社團名單、配置圖與 SNS。P0 不要求登入。 |
| Circle／參展社團及其管理者 | 找到並認領官方條目，補充代表圖、介紹、作者、連結與標籤；不能改寫主辦的攤位配置。 |
| Organizer／活動主辦或維運者 | 經 UI 建立活動、設定日期與場館、匯入名單、檢查、預覽及發布；不需要學會 repository 工作流程。 |

## Positioning

這不是「社團名錄再附上一張地圖」，而是 **Map First** 的活動探索工具。

主要資訊流必須保持雙向：

```text
Search → Circle → Map
Map → Space → Circle
Favorite → Map Highlight
```

產品可以參考 Comike WebCatalog / NAVIO 的熟悉互動模式，但只採用能直接改善活動、社團與攤位位置關係的部分。

## Core User Tasks

1. **搜尋社團與攤位**：依社團名、作者、攤位號、作品 / Genre / Tag 找到目標。
2. **從資訊定位地圖**：搜尋結果與社團詳細資訊可以直接定位正確日期、區域與攤位。
3. **從地圖理解社團**：點擊攤位即可查看社團卡片與必要資訊。
4. **收藏並在地圖辨識**：Reader 可以把想去的社團收藏，收藏必須直接反映在地圖，而不是獨立孤立清單。
5. **社團維護自己的補充資料**：Circle 可以認領並修改自己的 Circle Cut、簡介、作者、SNS、Tag 等內容；不能修改活動、日期、攤位號與官方配置。
6. **Organizer 無程式建立活動**：Organizer 可以透過 UI 建立活動、選擇場館、匯入社團資料、檢查、預覽並發布。
   主辦、獲授權人員與有官方來源的資料整理者可申請建置，經管理者逐案核准後取得工作區權限；核准申請不代表官方認證或活動已發布。公開申請入口的啟用條件見[部署 runbook](docs/runbooks/deployment.md#organizer-發布)。
7. **重複使用場館資料**：Venue / Floor / Area / 固定設施不與單一活動綁死，下一場活動可以重用。

## Product Data Boundary

核心資料模型優先維持以下關係：

```text
Venue
Event
EventDay
Area
Space
Circle
CircleParticipation
CircleProfile
Favorite
```

其中：

```text
CircleParticipation = Circle + Event + EventDay + Space
```

### Venue 與 Event 分離

場館是長期可重用的物理資料；活動是對場館與攤位配置的一次使用。

不得為每一場活動重新複製一整套場館結構，也不得把 FF47 的場館、展區、A–W 排號或固定格數當成產品常數。

### 地圖分層

**Venue Layer** 保存相對固定的物理資訊，例如：

- 樓層 / Hall / Area
- 牆與主要走道
- 出入口
- 樓梯 / 電梯
- 廁所
- 緊急出口
- 固定服務設施

**Event Layer** 保存每場活動變動的資訊，例如：

- 攤位與攤位號
- Genre 區域
- 活動本部
- 一般 / 社團入口
- 臨時排隊區或寄物區

## Ownership Boundary

哪些欄位屬於主辦、哪些屬於社團，以[社團自助控制面契約](docs/contracts/circle-portal.md#可編輯範圍)與[主辦單位工作區契約](docs/contracts/organizer-workspace.md)為準。

## Scope

以下是產品優先級，不是功能實作狀態表；現行行為與驗收條件見[契約索引](docs/contracts/INDEX.md)，待辦與進度由 GitHub issues 維護。

### P0 — Core Scope

產品成立所需的最小閉環：

| 使用者 | 範圍 |
|---|---|
| Reader | 互動地圖拖曳、縮放及攤位點選；日期、樓層／Hall／Area 切換；社團名、作者、攤位號搜尋及 Genre／Tag 篩選；社團卡片、詳情、Circle Cut 與 SNS／Website 連結；收藏及地圖標示；活動／社團／攤位分享 URL；Mobile-first 操作。 |
| Circle | 認領社團、查看官方活動／日期／攤位；修改 Circle Cut、簡介、作者、SNS／Website／Pixiv、Tag 與成人向標示；預覽公開結果及顯示最後更新時間。 |
| Organizer | 建立／修改多日活動；選擇與管理 Venue／Floor／Area、建立與維護 Space；CSV／XLSX 匯入、預覽、必要欄位／重複攤位／不存在 Day 或 Space 檢查；錯誤匯入不留下部分正式狀態；草稿、預覽、公開；修正 Organizer-owned data；管理入口、出口、廁所、本部等必要 POI。 |

### P1 — Convenience Scope

P0 穩定後才優先考慮：

| 使用者 | 範圍 |
|---|---|
| Reader | 個人 Memo、收藏分類／顏色、已逛／未逛、頒布物名稱搜尋、逛攤清單、收藏依配置排序、分享清單、PWA／離線地圖。 |
| Circle | 頒布物與圖片、新刊／既刊、完售與暫時離席標示、複製上一場資料、跨活動 Circle Profile、多人共同管理。 |
| Organizer | 複製活動、視覺化場地 Editor、拖放攤位、匯入欄位 Mapping 與 Diff、版本／回滾、多管理員、活動封存。 |

### P2 — Optional Scope

只有實際需求成立後才考慮：PDF／列印地圖、CSV 收藏匯出、自動路線排序、社團更新通知、收藏跨裝置同步、跨活動追蹤社團、使用／收藏統計、QR Code 分享、公開 API／Open Data Export。

已存在且穩定的能力不因優先級較低而立即刪除，例如行程預算、地圖貢獻、publication workflow 或 CSV 匯出；它們也不自動構成擴充理由。新工作須對應 P0／P1 或明確使用者需求；維護成本過高時可另提簡化或退役，不能為維持內部流程而阻止 Organizer 無程式建立活動。

### MVP Definition of Done

| 使用者 | 完整旅程 |
|---|---|
| Reader | 開啟活動 → 搜尋社團／作者／攤位 → 定位地圖 → 查看 Circle Cut 與必要資訊 → 收藏 → 在地圖看見收藏。 |
| Circle | 找到自己的官方條目 → 認領 → 修改 Circle Cut 與簡介、加入連結及 Tag → 在公開頁看見更新。 |
| Organizer | 登入 → 建立活動 → 選擇既有 Venue → 設定日期 → 匯入社團資料 → 修正錯誤 → 預覽互動地圖 → 發布。 |

Organizer 的完成目標是正常新增一場活動時，不需要任何人工技術操作；逐項清單、統計區間與證據要求見[專案工作流程](docs/runbooks/project-workflow.md#6-留下完整驗收證據)。內部系統可使用 repository、pin、CI 與 review，但不得要求主辦手動操作它們。

## Explicit Non-Goals

以下功能不屬於目前產品 Roadmap。若未來要做，應另立需求與成本評估，不直接擴張既有功能：

### 活動 ERP / 商業營運

- 社團報名
- 抽選
- 攤位費
- 活動票務
- 金流
- 電子發票
- 活動財務

### 商品 / 電商

- POS
- SKU
- 完整庫存數量
- 即時庫存同步
- 購物車
- 預購 / 付款
- 物流 / 宅配

### 社群

- 私訊
- 留言
- 討論區
- Followers
- Timeline
- Like

### 高複雜自動化

- SNS 自動爬蟲
- AI 圖片辨識建立資料
- AI 自動生成社團資料
- AI 攤位推薦
- 即時人流分析
- 即時路徑導航

## Operating Context

- 正式公開入口：<https://map.kotoban.top/>。
- 一般閱讀公開、不要求登入。
- Circle / Organizer 寫入介面必須驗證身分與資料權限。
- 產品支援桌面與行動瀏覽器，但 Reader UI 以 Mobile First 為原則。
- 收藏 P0 優先存在瀏覽器本機，不因收藏需求引入完整會員系統。
- 公開地圖使用可互動的結構化 / 向量資料，不以只能觀看的配置圖圖片取代核心互動。
- 地圖與社團可分享狀態應由 URL 還原。
- 資料來源長期以活動主辦公開資料與社團本人自填為主。

## Product Decision Gate

所有新功能在排入 backlog 前至少回答：

> 這個功能是否直接改善「活動、社團、攤位位置」三者之間的關係，或明確降低 Organizer 建立下一場活動的人工維護成本？

若答案是否定的，預設不加入。

優先順序：

```text
P0 完整閉環
→ Organizer no-code onboarding
→ Reader 現場體驗
→ Circle self-service
→ P1 convenience
→ P2 optional
```

不要以「技術上已經有 schema / contract / module」作為繼續擴充的充分理由。

## Brand Commitments

對外文案規則見[對外文案](docs/design/copy.md)；視覺規則見 [`DESIGN.md`](DESIGN.md)。

## One-line Definition

> 讓一般參加者透過互動地圖探索與規劃同人活動攤位，讓參展社團自行補充自己的展示資訊，並讓活動主辦透過資料匯入與圖形化介面，在不修改程式、不操作 Git、不依賴 agent 的情況下建立及維護活動地圖。
