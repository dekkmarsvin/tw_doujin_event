# ADR-0043：Circle portal 是通用入口，claim 逐活動隔離

- 狀態：已定案（2026-08-30）
- 相關 issue：[#136](https://github.com/dekkmarsvin/tw_doujin_event/issues/136)、[#119](https://github.com/dekkmarsvin/tw_doujin_event/issues/119)、[#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104)
- 延續：[ADR-0016](./0016-human-verification-guards-the-mailer.md)、[ADR-0020](./0020-self-service-deletion-reuses-the-existing-ownership-chain.md)、[ADR-0027](./0027-personal-data-lifecycle-and-account-deletion.md)、[ADR-0039](./0039-one-data-repo-for-events-and-references.md)、[ADR-0041](./0041-scope-is-bounded-by-shippable-features.md)

## 問題

新的 Map-first PRD 把 Circle self-service 列為 P0：社團本人必須能找到自己的官方條目、認領，並維護 Circle Cut、簡介、作者、SNS 與 Tag。

目前 `/circle` 仍由單一 `EVENT_ID` 決定可服務哪一場活動。這表示第二場活動即使已經能在 Reader 端公開，Circle 仍可能要等維護者改設定或重新部署才能使用，與「新活動不依賴 maintainer 手動切換」的方向衝突。

資料層已經大量帶有 `event_id`；缺口主要在入口與授權範圍仍把一場活動當成全域常數。

## 決策

### 1. `/circle` 是跨活動共用的入口

新活動不建立另一套 Circle portal，也不要求每場活動更新一組部署設定。

`EVENT_ID` 若暫時保留，只能是預設值或 migration fallback；不能再決定整個控制面唯一可操作的活動。

### 2. 登入先處理帳號，活動選擇在登入後

帳號是跨活動的身份；claim 才是逐活動的授權。

基本流程：

```text
登入
→ 選擇活動（必要時）
→ 查看該活動的 claim / Circle
→ 維護 Circle-owned data
```

若使用者只有一個可操作活動，可以直接進入，不強迫多一次選擇。

### 3. claim 與 ownership 一律逐活動判斷

Activity A 的 claim 不授權 Activity B。

同一帳號可以在不同活動各自持有 claim，但每一次授權都必須使用請求實際指定的 `eventId`。

不得因為上一場活動認領過同名社團，就自動取得下一場活動的 ownership。

### 4. Circle-owned 與 Organizer-owned data 邊界不變

Circle 可以維護自己的補充資料，但不能修改：

- Event / EventDay
- Space / booth code
- Organizer 公布的 placement
- Organizer 官方分類與配置

多活動支援不能成為放寬 ownership boundary 的理由。

### 5. 已發布活動的 Circle 補充資料必須可被 Reader 讀取

Reader 指向哪一個 published event，就應讀取該 event 的 Circle-owned override；不能因為它不是單一預設 `EVENT_ID` 就靜默缺資料。

published event collection 的來源與 Reader addressing 由 [#119](https://github.com/dekkmarsvin/tw_doujin_event/issues/119) 負責；本 ADR 只要求 Circle portal 與公開 override consumption 使用同一個活動範圍。

### 6. 活動後狀態逐活動計算

活動期間／活動後顯示與 retention 必須依該筆資料所屬活動判斷，不用單一全域活動時間套用所有資料。

## 安全邊界

- 授權判斷不得用「預設活動」fallback 取代請求實際活動。
- A 活動的 owner 對 B 活動寫入必須被拒絕。
- 不改變真人驗證、magic link、session 與帳號刪除的基本模型，除非它們直接阻塞多活動定址。
- 不做跨活動 Circle identity 自動 linkage。

## 與既有進階功能的關係

專案已存在 map contributor / revision / review 等能力，但它們不是本 ADR 的產品主體。

多活動改動只要求既有能力不要因此被破壞；**不在本 ADR 新增 map contributor 的跨活動授權模型，也不把 map contribution contract 當作 #136 的完成條件。**

## 後果

- #136 負責 Circle multi-event UI、ownership isolation 與管理介面的活動維度。
- #119 必須讓 production 可定址多個 published events；Circle portal 消費同一個活動集合，而不是另造一套活動 registry。
- #141、#143 等既有 claim lifecycle bug 仍獨立修復，不因多活動工作延後。
- 新活動不再需要維護者修改 `wrangler.jsonc` 或重新部署 Circle portal 才能讓社團使用。

## 不在本 ADR 範圍

- 不決定活動選擇 UI 的視覺版面。
- 不做上一場 claim 自動沿用。
- 不設計跨活動 Circle Profile；那屬 P1。
- 不擴張 map contributor / revision / review workflow。
- 不定義 Organizer 建立與發布活動的完整 UI；由 #104 負責。
