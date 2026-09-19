# ADR-0065：成本推算以 Workers Paid 的月度計費量為準

- 狀態：已定案（2026-09-19）
- 取代：[ADR-0017](./0017-thumbnails-are-self-hosted-with-external-urls-kept.md)、[ADR-0022](./0022-expiry-runs-in-a-separate-cron-worker.md)、[ADR-0031](./0031-quota-exhaustion-is-not-a-release-gate.md) 三份中以 Workers Free 每日額度為前提的成本敘述。三者的決策本身不變。
- 相關契約：[資料傳輸與離線契約](../contracts/delivery-and-offline.md)、[地圖投稿契約](../contracts/map-contributions.md)
- 相關流程：[專案工作流程 §7](../runbooks/project-workflow.md)
- 相關 issue：[#48](https://github.com/dekkmarsvin/tw_doujin_event/issues/48)

## 問題

Repository 多處成本論證建立在 Workers Free 的額度上：每日 100,000 次請求、每次呼叫 10 ms CPU、每次呼叫 50 個子請求、每個帳號 5 個 cron 觸發器。

2026-09-19 查核帳號 `b5623999b74ce6acca28e8b923f07172` 的訂閱頁，實際狀態是 **Workers Paid 與 R2 Paid 皆為使用中**（續訂 Sep 22, 2026）。兩者是分開的兩筆訂閱。

Free 與 Paid 的差距不是邊際修正：

| 限制 | Workers Free | Workers Paid |
|---|---|---|
| 每次呼叫的子請求 | 50 | 10,000 |
| CPU 時間 | 10 ms／次呼叫 | 5 分鐘／次呼叫 |
| 帳號 cron 觸發器 | 5 | 250 |
| 請求 | 每日 100,000 次上限 | 每月內含 10M，超出 US$0.30／百萬，**無每日上限** |

以錯誤層級寫下的成本論證會導出兩種相反但同樣有害的錯誤：把不存在的限制當成待修風險（例如把發布流程的 55 次 GitHub 呼叫視為逼近 50 的上限），以及為了迴避不存在的每日天花板而做不必要的快取或排程最佳化。

判錯的直接原因也值得記下：Dashboard 的 `/workers/plans` 是方案比較頁，其按鈕狀態曾被誤讀為目前訂閱。

## 決策

1. **成本推算一律以 Workers Paid 與 R2 Paid 的月度內含額度與超額單價為基準**，不再引用 Free 的每日上限。超出內含額度的後果是計費，不是服務中斷。
2. **方案層級的唯一權威來源是 Dashboard 的 `/billing/subscriptions`。** `/workers/plans` 不作判定依據。帳號可同時持有多筆獨立付費訂閱，盤點須逐項確認，不以其中一筆推定其餘。
3. **計費事實集中記錄在[專案工作流程 §7](../runbooks/project-workflow.md)**：訂閱狀態、內含額度、實測用量、既有預算警示，均保留查核日期。官方價格文件才是費率來源；該節的數字是查核日快照，不是持續有效的費率承諾。
4. **既有 ADR 的決策不因本 ADR 變更**，只在各自狀態列標註成本前提被取代。ADR 內文不改。
5. **方案升級不構成放寬既有保守預算的理由。** 自訂的工作量上界（例如清除批次每次呼叫 50 次 D1 呼叫）維持有效，要放寬須依 §7.6 擴充門檻另行說明。

## 後果

- **ADR-0017**：「一頁 30 張 × 3,000 名訪客就是 90,000 次／天，光是圖片就吃掉免費方案每日 100,000 次配額」的論證前提失效。**「代管圖片絕不經 Pages Function 服務、走 R2 custom domain」的決策不變**，理由改為公開讀取路徑不應與 overlay 分食同一份帳號請求額度並計入同一份月度計費量。同 ADR「Function 的免費 CPU 額度是 10 ms／次」也不再適用；不在 Worker 內做影像處理的決策不變，理由是攻擊面與可預期的驗證成本。
- **ADR-0022**：成本表的 Free 欄不再是本帳號的適用值。**「清除跑在獨立排程 Worker」的決策不變。**「吃掉帳號 5 個 cron 額度中的一個」應讀作 250 個中的一個；cron 槽不再是稀缺資源，但新增排程角色仍受 §7.4 複雜度預算約束。
- **ADR-0031**：問題陳述「Workers Free 每日請求額度耗盡時會觸發 Error 1027」不適用於本帳號。**該 ADR 的兩項決策不受影響**：不以耗盡實驗作發布 gate，且 production／preview 的 deployment config 必須是 `fail_open: true`。fail-open 是與方案層級無關、可重複驗收的配置契約，維持有效。
- 先前把發布流程 55 次 GitHub 呼叫視為逼近子請求上限的疑慮不成立。[CH20 地圖更正驗收紀錄](../design/ch20-map-correction-acceptance.md)對該歸因的 DECLINE 維持有效——現有證據仍不足以確診那兩次 GitHub 請求失敗。
- **新的計費維度需要追蹤**：Workers Traces 目前為 beta 免費，自 2026-10-01 起每個 span 計為一個 observability event，與 Workers Logs 共用每月 2,000 萬則的內含額度（超出 US$0.60／百萬，保留 7 天）。兩個排程 Worker 目前均為全量取樣；依 PR #285 後每 tick 約 3 spans 估算約 175k events／月，約內含額度的 0.9%，暫不調整。tick 頻率或 span 數上升時重算。
- 以 Free 額度換算的「每天 100,000 個活躍讀者分鐘」不再有效，相關敘述已在資料傳輸與離線契約標為不成立。該換算另有一個獨立於方案的錯誤前提（假設 client 每分鐘輪詢，實際是每活動單次載入）；overlay 可見性要求如何維持，留待維護者決策，本 ADR 不變更該要求。

## 非目標

- 不因方案為 Paid 而放寬任何既有的保守預算或安全邊界。
- 不新增 Cloudflare 產品、排程角色或監控系統。
- 不改寫 ADR-0017、0022、0031 的內文，也不撤銷它們的決策。
