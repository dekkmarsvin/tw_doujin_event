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

### 1. 一般讀者 / Reader

Fancy Frontier 與其他台灣同人活動的一般參加者。主要在活動前搜尋、收藏與規劃，活動現場以手機定位下一個攤位。

Reader 的核心流程：

```text
搜尋或瀏覽
→ 找到社團
→ 查看攤位與社團資訊
→ 收藏
→ 收藏直接反映在地圖
→ 現場定位
```

P0 不要求 Reader 登入；收藏可保留在瀏覽器本機。

### 2. 參展社團 / Circle

參展社團本人或其管理者。主辦已經提供活動、日期與攤位等官方資料；社團只補充自己的內容，不建立或改寫官方配置。

Circle 的核心流程：

```text
找到自己的官方條目
→ 認領
→ 補充 Circle Cut / 簡介 / 作者 / SNS / Tag
→ 預覽
→ 公開
```

### 3. 活動主辦 / 維運 / Organizer

建立與維護活動資料的人。Organizer 的產品目標不是學會 repository workflow，而是透過 UI 完成活動建立、資料匯入、檢查、預覽與發布。

Organizer 的核心流程：

```text
建立活動
→ 設定日期
→ 選擇既有場館
→ 設定區域 / 攤位配置
→ 匯入 CSV / XLSX 社團資料
→ 驗證
→ 預覽
→ 發布
```

**P0 完成定義：以上流程不得要求修改 source code、手動編輯 production JSON/YAML、操作 Git、執行 CLI 或依賴 AI agent。**

既有 repository、pin、CI、review 等流程可以暫時作為內部發布實作，但不能被視為 Organizer 產品流程的最終完成狀態。

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

### Organizer-owned Data

只有 Organizer / 維運者可修改：

- Event / EventDay
- Venue assignment
- Area / Space
- 攤位號與配置
- 官方分類
- 主辦公布的社團名稱與 placement

### Circle-owned Data

Circle 本人可修改：

- Circle Cut
- 社團簡介
- 作者名稱
- SNS / Website / Pixiv
- Tag
- 成人向標示
- 頒布物補充資料（P1）

社團補充資料應清楚標示來源為社團本人，但介面只需提供使用者判斷所需的最小資訊，不加入不影響操作的額外免責或風險說明。

## P0 — Core Scope

P0 是產品成立所需的最小閉環；新增工作優先服務以下功能。

### Reader

- 互動地圖：拖曳、縮放、點擊攤位
- 日期切換
- 樓層 / Hall / Area 切換
- 社團名稱搜尋
- 作者名稱搜尋
- 攤位號搜尋
- Genre / Tag 篩選
- 社團卡片 / 詳細資訊
- Circle Cut
- SNS / Website 外部連結
- 收藏
- 收藏直接標示於地圖
- 可分享的活動 / 社團 / 攤位 URL state
- Mobile-first 操作

### Circle

- 社團認領
- 查看官方活動 / 日期 / 攤位資料
- 修改 Circle Cut
- 修改簡介
- 修改作者
- 修改 SNS / Website / Pixiv
- 修改 Tag
- 成人向標示
- 預覽公開結果
- 顯示最後更新時間

### Organizer

- 建立 / 修改活動
- 多日活動
- 選擇 / 管理 Venue、Floor、Area
- 建立 / 維護 Space
- CSV / XLSX 匯入社團資料
- 匯入前預覽
- 必要欄位驗證
- 重複攤位檢查
- 不存在的 Day / Space 檢查
- 避免錯誤匯入留下部分正式狀態
- 草稿 / 預覽 / 公開
- 修正 Organizer-owned data
- 管理入口、出口、廁所、本部等必要 POI

## P1 — Convenience Scope

P0 穩定後才優先考慮：

### Reader

- 個人 Memo
- 收藏分類 / 顏色
- 已逛 / 未逛
- 頒布物名稱搜尋
- 我的逛攤清單
- 收藏依配置排序
- 分享逛攤清單
- PWA / Offline Map

### Circle

- 頒布物與圖片
- 新刊 / 既刊
- 完售標示
- 暫時離席
- 複製上一場社團資料
- 跨活動 Circle Profile
- 多位成員共同管理

### Organizer

- 複製上一場活動
- 視覺化場地 Editor
- Drag & Drop 攤位
- 匯入欄位 Mapping
- Import Diff
- Version / rollback
- 多管理員
- 活動封存

## P2 — Optional Scope

只有在有實際需求時再做：

- PDF / 列印地圖
- CSV 收藏匯出
- 自動逛攤路線排序
- 社團更新通知
- 收藏跨裝置同步
- 跨活動追蹤社團
- 使用 / 收藏統計
- QR Code 分享
- 公開 API / Open Data Export

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

## Existing Features Outside the New Priority

既有程式可能已實作超過本文件 P0 / P1 的能力，例如進階行程、購物預算、地圖 contribution/revision、複雜 provenance / publication workflow 等。

本文件不要求為了「符合新 PRD」立即刪除已穩定存在的功能；但：

1. 它們不得自動成為後續新工作的優先理由。
2. 新 issue 必須能對應 P0 / P1 或有明確使用者需求。
3. 若維護成本持續高於使用價值，可以另外提出簡化或退役。
4. 不應為維持內部流程而阻止 Organizer 無程式建立新活動的產品目標。

## Success Outcomes

### Reader

- 不需要人工把社團名單與配置圖交叉比對。
- 搜尋結果可以一個操作直接定位攤位。
- 收藏後立即能在地圖辨識位置。
- 手機上能在搜尋、社團資訊與地圖之間快速切換。

### Circle

- 可以找到並認領自己的官方條目。
- 可以自行維護自己的展示資訊，而不需要請網站維運者代改。
- 不能誤改 Organizer-owned placement。

### Organizer

最重要的成功指標：

> **建立下一場活動需要的 production code 修改次數 = 0。**

且最終產品流程同時滿足：

- Git 操作 = 0
- CLI 操作 = 0
- AI Agent 依賴 = 0
- 新活動新增 repository = 0
- 新活動新增 PAT / secret = 0

內部實作若仍暫時需要 repository review，應被視為待收斂的 implementation detail，而不是產品能力完成。

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

## MVP Definition of Done

### Organizer

一名未接觸 repository 的活動管理者可以：

1. 登入管理介面。
2. 建立活動。
3. 選擇既有 Venue。
4. 建立活動日期。
5. 匯入社團資料。
6. 修正匯入錯誤。
7. 預覽互動地圖。
8. 發布活動。

全程不修改程式、不操作 Git、不執行 CLI、不使用 agent。

### Reader

可以：

1. 打開活動。
2. 搜尋社團 / 作者 / 攤位。
3. 定位到地圖。
4. 查看 Circle Cut 與必要資料。
5. 收藏。
6. 在地圖看到收藏位置。

### Circle

可以：

1. 找到自己的社團。
2. 完成認領。
3. 修改 Circle Cut。
4. 修改社團簡介。
5. 新增外部連結與 Tag。
6. 在公開頁看到更新。

## Brand Commitments

- 面向台灣同人活動使用情境，文字以清楚、短而可操作為優先。
- 不用技術實作細節取代使用者任務。
- 不以過度風險揭露、免責文字或「可核對」等維運語言干擾一般使用者。
- 資料來源只顯示完成判斷所需資訊，例如「主辦單位／匯入日期／來源連結」或「由社團填寫／最後更新日」。
- 狀態不能只靠顏色表達。
- 手機現場使用的操作密度與地圖視野優先於桌面式後台資訊量。

## One-line Definition

> 讓一般參加者透過互動地圖探索與規劃同人活動攤位，讓參展社團自行補充自己的展示資訊，並讓活動主辦透過資料匯入與圖形化介面，在不修改程式、不操作 Git、不依賴 agent 的情況下建立及維護活動地圖。
