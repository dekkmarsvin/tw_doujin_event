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

三種使用者與各自的成功樣貌：[使用者](docs/product/users.md)。

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

P0／P1／P2 與 MVP 完成定義：[交付範圍與完成定義](docs/product/scope.md)。

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
