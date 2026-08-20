# ADR-0018：保存期限由社團自己選，選了清除就真的刪除

- 狀態：已定案（2026-08-20）
- 相關契約：[社團自助控制面契約](../contracts/circle-portal.md)
- 相關 ADR：[ADR-0017](./0017-thumbnails-are-self-hosted-with-external-urls-kept.md)、[ADR-0020](./0020-self-service-deletion-reuses-the-existing-ownership-chain.md)、[ADR-0021](./0021-credentials-expire-and-are-purged-records-are-kept.md)、[ADR-0022](./0022-expiry-runs-in-a-separate-cron-worker.md)
- 相關 issue：[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30)

## 脈絡

[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30) 要求每一類資料都有保存期限。[基礎研究](../research/data-collection-policies-in-comparable-projects.md)查過的 17 個對象裡，同人圈六個沒有一個寫出期限，所以**體例參考不能往同業找**；能抄的形狀來自 Wikimedia（保存期限是一張表，`Indefinitely` 是表裡一個正當的值）與 Indico（期限做成資料庫欄位加週期任務，不是文件裡的一句話）。

現況要先講清楚，因為它和直覺不一樣：

- `circle_overrides.post_event_hidden` 只在活動結束後**重建公開文件時把該列濾掉**（`db/identity-repository.ts` 的 `listLiveOverrides`）。資料列本身留著，永遠。
- 管理者撤下同樣是改狀態，不是刪除。
- `db/identity-repository.ts` 裡只有兩處 `DELETE FROM`：依 email 刪管理者，以及測試用的整表清空。**本站目前沒有任何依到期時間清除資料的機制。**

也就是說「活動後退出」目前的語意是**不再公開**，不是**不再持有**。這兩件事對填表的人來說不是同一件事，而目前的介面沒有讓他們分開表達。

研究裡的 Mastodon issue #19774 是這件事的反面教材：政策範本寫死 90 天，預設設定卻不落實。**期限寫在文件裡而機制不存在，等於沒有期限。**

## 決策

**社團自述資料的保存期限，由社團本人在填寫時選擇。兩個值：**

| 選項 | 活動結束後 | 活動結束滿 90 天 |
|---|---|---|
| **保留** | 繼續公開，不主動刪除 | 不動作 |
| **活動後清除** | 繼續公開 | 系統刪除該筆補充資料 |

**選了清除的資料在等待刪除的期間維持公開。** 90 天是資料的壽命上限，不是提前下架——一個把攤位資訊留到活動後給讀者查的社團，不必為了「之後要刪掉」而提早消失。

**要更早消失的人不必等。** 社團隨時可以在控制面自行刪除（[ADR-0020](./0020-self-service-deletion-reuses-the-existing-ownership-chain.md)），或寫信要求協助（[ADR-0019](./0019-personal-data-requests-go-to-the-mailbox-not-the-issue-tracker.md)）。期限管的是「沒有人再回來處理」的那些資料。

### 這與既有的「活動後退出」是兩個座標軸

`post_event_hidden` 管的是**活動結束後還公不公開**，本 ADR 的選項管的是**這筆資料還留多久**。兩者獨立，四種組合裡三種都有人會用：公開且保留、公開但 90 天後刪除、活動後即下架且保留（例如自己還想登入看）。既有的退出行為與它的測試不受本 ADR 影響。

### 預設是「保留」

不可逆的那一邊不能當預設。把預設設成清除，等於替所有沒有表態的社團做出一個事後無法還原的決定；把預設設成保留，代價只是資料多留著，而那個代價隨時可以由社團本人或維運端消除。

代價要認：這表示多數資料實際上會留著。這是刻意的，不是疏漏——**本站要對得起的是「社團說了算」，不是「留得越少越好」**。介面上兩個選項並列、同樣清楚，不得把清除藏進進階設定。

### 三個實作時不能選錯的約束

**一、清除是刪除資料列，不是再加一個旗標。** `fields_json` 與 `previous_fields_json` 一併消失；[ADR-0017](./0017-thumbnails-are-self-hosted-with-external-urls-kept.md) 的代管縮圖位元組一併從 R2 刪除。留著位元組正是責任的來源，再多一個旗標只是把 Mastodon #19774 重演一次。

**二、期限跟著資料列走，不是散在程式裡的常數。** 選擇與到期時間存成 `circle_overrides` 的欄位，每一列自己帶著自己的到期時間。這樣「沒填」與「已清除」可以區分，維運端也能直接查出哪些列在什麼時候會消失，而不必靠讀程式碼推論。90 天從**活動結束時間**起算，不是最後編輯時間——期限的理由是活動結束，不是社團有沒有回來改過東西。

**三、清除跑在獨立的排程 Worker 上**，不掛在任何使用者請求的路徑上，理由與成本見 [ADR-0022](./0022-expiry-runs-in-a-separate-cron-worker.md)。

### 稽核記錄不隨之刪除

`audit_log` 留下「這筆資料因為期限到期被刪除」這件事，但不得留下被刪除的內容。研究裡 pretix 是唯一處理過這個衝突的實作：`LogEntry` 永不刪除，只塗掉個資並標記。本站採同樣的方向——**刪除的是內容，不是刪除這件事發生過的證據**。

## 這個決策沒有解決什麼

- **它只涵蓋社團自述的補充資料。** 身分與稽核相關的表由 [ADR-0021](./0021-credentials-expire-and-are-purged-records-are-kept.md) 決定。
- **90 天沒有法律依據，是本站選的數字。** 研究裡沒有同業提供可比的基準；要改就改，但改的時候要一起改文件、欄位與測試。

## 後果

- **多一個社團要回答的問題。** 填表的成本增加，換到的是這筆資料的壽命由當事人決定，而不是由「我們沒想過」決定。
- **既有資料列沒有選擇值。** 現在資料庫裡的列都是在這個選項存在之前寫的，實作時它們一律視為「保留」，並在社團下次登入時請他們表態。
- **[ADR-0017](./0017-thumbnails-are-self-hosted-with-external-urls-kept.md) 的代管縮圖有期限了。** 該 ADR 只確定代管圖片必須被涵蓋，數值留給 #30；本 ADR 給的答案是：跟著它所屬的補充資料走，同一個選項、同一個 90 天。
- **清除機制要有測試。** 研究裡 Discourse 與 pretix 的清除機制都有測試，Indico 的查不到——本站要站在有測試的那一邊，這也是 #30 驗收條件白紙黑字要求的。
