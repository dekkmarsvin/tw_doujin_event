# ADR-0015：Access 閘控在 repo 不再含有第三方位元組時解除

- 狀態：已定案（2026-08-18）
- 部分取代：[ADR-0011：FF47 期間全站不公開](./0011-ff47-is-not-a-public-launch.md) 的「不在本 ADR 範圍」第一條（重新開放的條件）
- 延續：[ADR-0012](./0012-first-party-sources-only.md)、[ADR-0014](./0014-event-data-lives-outside-the-code-repo.md)
- 相關契約：[社團自助控制面契約](../contracts/circle-portal.md)、[資料傳輸與離線契約](../contracts/delivery-and-offline.md)
- 相關流程：[部署](../runbooks/deployment.md)

## 脈絡

[ADR-0011](./0011-ff47-is-not-a-public-launch.md) 決定 FF47 期間全站閘控，並把重新開放的條件留在範圍外：「那需要來源授權與正式條款兩者都完成。」

這句話的問題不是它錯，是它**不可判定**。「來源授權完成」沒有可以指的動作、沒有負責人、沒有完成的樣子——社群維護的試算表沒有一個可以聯絡並取得授權的窗口，所以這個條件在實務上永遠不會被宣告達成。閘控因此不是暫時措施，而是一個沒有出口的狀態。

[ADR-0014](./0014-event-data-lives-outside-the-code-repo.md) 之後，同一件事有了可判定的形狀。它把問題從「我們有沒有權利發布這些內容」換成「本 repo 有沒有在宣稱它擁有這些內容」——後者是關於 `LICENSE` 涵蓋範圍的事實問題，可以檢查、可以完成。但 ADR-0014 只搬走 HEAD 的檔案，並明白寫著：「歷史仍然留著那些位元組……在決定是否重寫歷史之前，**不得宣稱本 repo 不含第三方資料**。」

於是解除條件落在那句話上。

## 決策

**Access 全站閘控在本 repo 完全不含第三方試算表資料時解除——包含 git 歷史。**

達成條件是兩件事都完成：

1. **[#38](https://github.com/dekkmarsvin/tw_doujin_event/issues/38)**：per-event 資料（`data_source_test/*`、`public/data/events/ff47/*`、`app/ff47-circle-templates.*`，以及以程式碼形式存在的活動資料）移出到資料 repo，本 repo 以固定 commit SHA 與 SHA-256 引用。
2. **重寫 git 歷史**，移除既有的第三方位元組。ADR-0014 把這件事列為「另議」，本 ADR 就是那個議：它是解除條件的一部分，不是可選的後續整理。

兩者都完成後，`git ls-files` 與 `git log` 都不含第三方著作，「本 repo 不含第三方資料」才是可以宣稱的事實。屆時移除 Zero Trust application，站台對外開放。

### 這個決策沒有解決什麼

**它不是取得了發布那些內容的授權。** 公開的 `circles.json` 目前仍由社群維護的試算表衍生而來，把來源檔案搬走或從歷史抹掉**不會改變已發布內容的來源**。ADR-0014 自己就寫過同一句：「本 ADR 不解決授權本身。」

因此本 ADR 解除的是 [ADR-0011](./0011-ff47-is-not-a-public-launch.md) 兩個閘控前提中的**第一個的 repo 面**，不是它的內容面。內容面的出口仍然是 [ADR-0012](./0012-first-party-sources-only.md) 的主線工作（[#33](https://github.com/dekkmarsvin/tw_doujin_event/issues/33) 工作簿退場、[#34](https://github.com/dekkmarsvin/tw_doujin_event/issues/34) 縮圖圖床退場），而那條線在解除閘控時仍未完成。這是本決策明知並接受的落差，寫在這裡是為了日後沒有人以為授權問題已經處理掉了。

## 後果

### 立刻改變的

- **[#38](https://github.com/dekkmarsvin/tw_doujin_event/issues/38) 從結構性整理升格為解鎖整條產品線的前置。** 社團自填的覆蓋率、[#33](https://github.com/dekkmarsvin/tw_doujin_event/issues/33) 的內容退場、[#40](https://github.com/dekkmarsvin/tw_doujin_event/issues/40) 的縮圖代管實作，全部排在它後面。
- **重寫歷史會 force-push 一個公開 repo。** 既有 clone 與 fork 的 commit SHA 全部失效，PR 的 base 需要重建，任何以 SHA 引用本 repo 的地方會斷。這是一次性的破壞性操作，必須在沒有進行中 PR 的時間點做，並事先公告。
- **`README.md` 與 `PRODUCT.md` 目前把「站台不對外開放」寫成現行狀態。** 解除當下這幾處必須同一個 commit 更新，否則文件會在陳述一件已經不成立的事。

### 必須同時處理的

- **[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30) 在解除的那一刻從「未來的 blocker」變成擋在門口的那一個。** [ADR-0011](./0011-ff47-is-not-a-public-launch.md) 的閘控涵蓋社團端且不留 Bypass，所以閘控一旦移除，`/circle` 與 `/api/auth/*` 同時對外可達——任何人都能索取登入連結並送出 email，本站就開始收集真實個人資料。隱私告知與保存政策**不能晚於**解除。
- **若 [#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30) 屆時尚未完成，需要一個新決策**：只對社團端保留閘控。這等於部分回復 ADR-0011「不保留任何 Bypass 路徑」的姿態，方向相反（放行閱讀端而非放行社團端），**本 ADR 不預先授予它**——要做就另寫 ADR，說明為什麼這次的例外不會重蹈原本 Bypass 清單難以維護的問題。
- **CI 的 Access service token 依賴會改變。** 目前 smoke test 帶 `CF-Access-Client-Id`／`Secret` 通過閘控（見[部署 runbook](../runbooks/deployment.md#ci-用-service-token-通過-access)）。閘控移除後這組 header 變成無作用而非必要，`/` 應直接回 200；斷言與錯誤訊息要跟著改，否則 CI 會用一個不再存在的失敗模式解釋成功。
- **公開之後才會有真實流量，Pages Functions 的每日配額才開始是實際約束。** 閱讀端純靜態不計費，但 `/data/events/:eventId/overrides.json` 是 Function，免費方案每日 100,000 次；以其 `max-age=60, must-revalidate` 的 revalidation 頻率估算，約當每天一萬名活躍讀者。解除前應確認快取行為，不要在開放當天才發現。

### 沒有改變的

- **[ADR-0011](./0011-ff47-is-not-a-public-launch.md) 的其餘部分。** FF47 是驗證資料而非發表場合這個定位不變；閘控存在期間不邀請任何真實社團也不變。
- **[ADR-0008](./0008-static-public-reading-path.md) 的靜態閱讀路徑。** Access 在邊緣層，移除它不改變任何 payload 邊界或發布機制。

## 不在本 ADR 範圍

- 重寫歷史的具體作法（`filter-repo`、squash 或新 repo 重新開始）與執行時間點。
- 資料 repo 是公開或私有，以及它自己的授權宣告——[ADR-0014](./0014-event-data-lives-outside-the-code-repo.md) 已把這條列為另議，本 ADR 不改變它。
- 使用條款與隱私告知的內容（[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30)）。
- 解除之後是否為未來活動（FF48…）另行決定公開時程。
