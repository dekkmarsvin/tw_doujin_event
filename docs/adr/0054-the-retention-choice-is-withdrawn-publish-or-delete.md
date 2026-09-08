# ADR-0054：保存期限選項退場，社團只決定公開與否，其餘靠手動刪除

- **狀態**：Accepted
- **日期**：2026-09-08
- **取代**：[ADR-0018](./0018-retention-is-the-circles-choice.md) 的核心決策「社團自述資料的保存期限，由社團本人在填寫時選擇」，連同它對介面的三項要求（兩個選項並列、不預選、不得收進摺疊）。該 ADR 對**已經帶著選擇的資料列**所定下的實作約束——清除是刪除資料列而非旗標、期限跟著資料列走、清除跑在獨立排程 Worker、稽核只記錄事件不留內容——全部維持有效
- **延續**：[ADR-0019](./0019-personal-data-requests-go-to-the-mailbox-not-the-issue-tracker.md)、[ADR-0020](./0020-self-service-deletion-reuses-the-existing-ownership-chain.md)、[ADR-0041](./0041-scope-is-bounded-by-shippable-features.md)
- **相關 issue**：[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30)、[#197](https://github.com/dekkmarsvin/tw_doujin_event/issues/197)
- **相關契約**：[社團自助控制面契約](../contracts/circle-portal.md)、[資料 inventory](../contracts/data-inventory.md)

## 脈絡

ADR-0018 給社團兩個獨立的座標軸：活動結束後還公不公開（`post_event_hidden`），以及這筆資料還留多久（`retention_choice`，「保留」或「活動結束滿 90 天刪除」）。兩軸都做完了，也都有測試。

問題不在實作，在於**它要求填表的人先理解一個生命週期模型，才能回答第二題**。第二題的完整語意是「前 90 天照常公開，然後整列連同代管圖片一起消失」——這句話沒有辦法用一個短標籤講完，於是介面上長出一段解釋；而寫出解釋，正是 [ADR-0024](./0024-user-facing-copy-uses-minimum-necessary-disclosure.md) 說要避免的形狀。一個必須靠說明才成立的選項，通常代表選項本身不該存在。

維運端的判斷更直接：**資料生命週期管理已經超出單人維運專案能長期負責的範疇。** 兩個座標軸意味著四種組合、四種要一直維持正確的行為，而其中一種（等待期間仍然公開的待刪資料）永遠只存在於少數資料列上，最容易在後續改動裡默默壞掉而沒有人發現。[ADR-0041](./0041-scope-is-bounded-by-shippable-features.md) 的原則在這裡適用：範圍以能長期撐住的功能為界。

[#197](https://github.com/dekkmarsvin/tw_doujin_event/issues/197) 的文案收斂提案要求「不要把兩個概念重新合併」，本 ADR 撤銷該提案的這一節。

## 決策

**社團在控制面只回答一個問題：活動結束後要不要繼續公開。** 選項是「繼續公開」（預設）與「不再公開」，寫入即生效。要更早或更徹底消失的社團，用同一頁的「刪除資料」自行刪除（[ADR-0020](./0020-self-service-deletion-reuses-the-existing-ownership-chain.md)），或寫信給維運信箱（[ADR-0019](./0019-personal-data-requests-go-to-the-mailbox-not-the-issue-tracker.md)）。

### 一、預設是「繼續公開」，而且預設是正當的

ADR-0018 主張不預選任何一項，理由是不可逆的那一邊不能當預設。這個顧慮在剩下的這一題上不成立：**兩個答案都可逆**，隨時可以改回來，改了下一次重建公開文件就生效。逼一個答案都無害的人表態，只是多一道手續。

### 二、欄位、排程清除與 API 原地保留，不做 migration

`circle_overrides.retention_choice` 與 `retention_expires_at` 保留，`purgeExpiredOverrides` 繼續每天跑，`PUT /api/circle/:circleId/overrides` 繼續接受 `retention`。控制面只是不再送這個欄位，因此新資料列的值一律是 NULL，語意同「不主動刪除」。

**已經選過「活動後清除」的資料列照原到期日刪除。** 這是刻意的：那是當事人做過的決定，撤銷選項不等於撤銷別人的選擇。代價要認——那些社團在介面上看不到這個待刪狀態，也改不回來。維運端可以直接查 `retention_expires_at` 找出這些列；數量若不是零，處理方式（通知、清成 NULL、或就讓它到期）是逐案的維運決定，不寫進本 ADR。

移除機制本身比留著貴：刪 schema 要 migration，刪 Worker 要改部署單位，而留著不會產生任何新的到期列。

### 三、刪除入口可以摺疊，但必須無條件可達

自助刪除現在是「不再持有」的唯一路徑，它的可及性因此比以前更重要。介面上它預設收合（`<details>`），但必須留在編輯頁本身、一次點擊可展開、不得移到另一個流程或另一個頁面之後，也不得附加額外條件。既有的輸入社團代號確認步驟不變。

摺疊與 ADR-0018 禁止的「把清除收進摺疊」不是同一件事：那一條禁止的是把**兩個並列選項中不利的那個**藏起來，讓預設變成所有人的實際答案；這裡收合的是一個獨立的、不可逆的動作，展開與否不影響任何預設值。

### 四、#30 的驗收條件對這一類資料不再成立

[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30) 要求「每一類資料都有保存期限」。**社團自述的補充資料從此沒有期限**，明講出來而不是留給日後的人推敲。憑證與紀錄類資料的期限不受影響，仍由 [ADR-0021](./0021-credentials-expire-and-are-purged-records-are-kept.md) 與 [ADR-0022](./0022-expiry-runs-in-a-separate-cron-worker.md) 管，`db/retention-purge.ts` 的 `RETENTION_WINDOWS` 仍是權威。

## 這個決策沒有解決什麼

- **不處理「填完就再也沒回來過」的資料。** 那正是 ADR-0018 想解決的問題，本 ADR 承認它沒有解法，只有當事人自己動手或寫信。
- **不改變公開文件的行為。** `listLiveOverrides` 本來就不看這兩個欄位。
- **不決定既有 `purge` 資料列要怎麼處理。**

## 後果

- 填表少一題，介面少一段必須存在的解釋。
- **多數補充資料會無限期留著**，直到當事人自己刪除。這是刻意的取捨，不是疏漏。
- 個資請求的壓力回到維運信箱（ADR-0019）與自助刪除（ADR-0020）。
- 資料庫欄位與排程清除留在原地：日後若要把這一題加回來，schema 不必重做。
