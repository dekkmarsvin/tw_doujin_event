# ADR-0042：公開入口是活動選擇器，活動依生命週期分層

- 狀態：已定案（2026-08-30）
- **取代**：[URL 檢視狀態契約](../contracts/url-state.md)「加入第二個活動前不先顯示活動選擇器」一句
- 相關 issue：[#119](https://github.com/dekkmarsvin/tw_doujin_event/issues/119)、[#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104)
- 延續：[ADR-0028](./0028-versioned-json-event-definitions.md)、[ADR-0035](./0035-new-event-onboarding-is-data-driven.md)、[ADR-0039](./0039-one-data-repo-for-events-and-references.md)、[ADR-0041](./0041-scope-is-bounded-by-shippable-features.md)

## 問題

[#119](https://github.com/dekkmarsvin/tw_doujin_event/issues/119) 要把 production event selection 從硬編 FF47 改成資料驅動，但它的驗收條件全部只講 build 端：加入第二個活動不改 `package.json`、不改 workflow、不新增活動專屬常數。**它沒有回答讀者端會看到什麼。**

這不是遺漏，是當時的預設立場。[URL 檢視狀態契約](../contracts/url-state.md)明寫「採多活動資料模型、單一 active-event UI……加入第二個活動前不先顯示活動選擇器」，程式也照這個立場寫：`app/event-catalog.ts` 的 `ACTIVE_EVENT = EVENT_DEFINITIONS[0]`，`vite.pages.config.ts` 只把一個 staged 活動編進 bundle。

在只有一場活動時這是對的——多做一個只有一個選項的選擇器是純粹的成本。第二場活動一到，同一個立場產生兩個都不能接受的結果：新活動**取代** FF47，舊活動的分享連結全部失效；或是兩場並存卻沒有入口，讀者只能靠手改 URL 的 `event` 參數在活動之間移動。

`#119` 若在這個問題未定案時實作，會做出一個 build 端支援多活動、讀者端只看得到一場的系統。那不是可以「之後再補 UI」的中間狀態——它會先讓一批 FF47 連結壞掉。

## 決策

### 1. 公開入口是活動選擇器，不是單一 active event

讀者端從「一個寫死的當期活動」改為「多個已發布活動，由讀者選一個進入」。`ACTIVE_EVENT` 不再是產品概念，只保留為「沒有指定時的預設」。

### 2. 既有分享連結不得失效

FF47 的 `?event=ff47&day=…&selectedCircle=…` 在第二場活動上線後必須解析到同一個畫面。這是硬約束，不是最佳努力：連結是本站唯一的跨裝置狀態轉移方式（[ADR-0002](./0002-planning-data-stays-on-device.md) 讓規劃資料留在裝置上），壞掉的連結沒有補救路徑。

`event` 參數目前遇到非 active event 會整份 fail closed 回預設；這個行為在多活動下必須改成「解析到該活動」，只有**未發布**的活動才 fail closed。

### 3. 分層依生命週期：即將舉辦／正在舉行／已經結束

活動清單依這三層排序與分組。這是讀者實際的意圖差異：正在舉行的活動要的是現場導航，即將舉辦的要的是展前規劃，已結束的要的是回顧與收藏。單一扁平清單會讓最常用的那一場沉在中間。

### 4. 生命週期由資料算出，不由人工旗標維護

分層是 `event.json` 的時間欄位加上當下時間的函數，不是維護者要記得翻的狀態欄位。人工旗標會在活動開始的那個早上是錯的，而那正是它最重要的時刻。

**這需要 schema 變更。** `event-definition/3` 有 `eventEndsAt`（已用於社團端 during/after 相位與 [ADR-0018](./0018-retention-is-the-circles-choice.md) 的保存期限起算），但**沒有任何開始時間**：`days[].dateLabel` 與 `dateRangeLabel` 都是顯示字串，不可計算。因此：

- 「已經結束」今天就算得出來。
- 「正在舉行」與「即將舉辦」的分界算不出來，需要 `event-definition/4` 補上開始時間。

### 5. 分兩批交付，選擇器先行

依 [ADR-0041](./0041-scope-is-bounded-by-shippable-features.md) 決策 1，只有擋住第二場活動的部分現在做：

| 批次 | 內容 | 何時 |
|---|---|---|
| 一 | 多活動 bundle、活動選擇器、`event` 參數解析到指定活動、既有連結不失效 | 併入 #119，擋住第二場活動 |
| 二 | 首次進入的引導入口、三層生命週期分類、`event-definition/4` 的開始時間 | 另開 issue，不擋第二場活動 |

批次一**不含**引導入口，也不含三層分類：兩場活動用一個選擇器就夠，分層的價值要到活動數量夠多才出現，而它還帶著一次 schema 版本升級與所有既有 pin 的重新產生。

批次一仍必須讓批次二可加：選擇器讀的是「已發布活動集合」，不是寫死的兩筆。

### 6. 未發布的活動不出現在任何公開端

選擇器只列出 production build 納入的活動。候選活動的定址仍是控制面的事（#113 已關閉，需要時重開），不因為讀者端有了選擇器就放寬。

## 後果

- **#119 的範圍變大且變明確。** 它從「build 端不硬編」變成「build 端不硬編 **且** 讀者端有入口」。這是本 ADR 刻意接受的成本：拆成兩張票會產生一個讓 FF47 連結失效的中間狀態。
- **`docs/contracts/url-state.md` 的「不先顯示活動選擇器」一句失效**，由實作 #119 的 PR 在同一個 commit 改寫，連同 `event` 參數的 fail-closed 語意。
- **`event-definition/4` 是批次二的第一道工作，不是順手改。** 它要動 data repo 的 `event.json`、parser、generator wizard 與每一場活動的 pin。批次二的 issue 必須把它寫成前置，否則它會在中途冒出來變成範圍外的新模組（ADR-0040 決策 3 要避免的正是這個）。
- **`ACTIVE_EVENT` 不會消失。** Pages Functions 的 `EVENT_ID`（`functions/_portal.ts:253`）決定社團控制面服務哪一場活動的 overlay，那是寫入端的範圍，不隨讀者的選擇改變。讀者端的多活動與控制面的單活動是兩件事，本 ADR 只動前者。
- 代價：在只有兩場活動時，選擇器對讀者是多一次點擊。可接受——替代方案是壞掉的連結。

## 不在本 ADR 範圍

- 不決定選擇器的版面、位置或是否為獨立路由；那是 [`DESIGN.md`](../../DESIGN.md) 與實作 PR 的事。
- 不決定活動之間是否共用收藏與行程。規劃資料已按 `eventId` 分區（[收藏與走訪規劃契約](../contracts/planning.md)），跨活動彙整是另一個問題。
- 不改變控制面的單活動假設，也不重開 #113。
- 不決定活動數量成長後是否需要搜尋或分頁。
