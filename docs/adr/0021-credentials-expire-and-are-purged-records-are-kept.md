# ADR-0021：憑證到期就清掉，紀錄類保留不設期限

- 狀態：已定案（2026-08-20）
- 相關契約：[社團自助控制面契約](../contracts/circle-portal.md)
- 相關 ADR：[ADR-0018](./0018-retention-is-the-circles-choice.md)、[ADR-0022](./0022-expiry-runs-in-a-separate-cron-worker.md)
- 相關 issue：[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30)

## 脈絡

[ADR-0018](./0018-retention-is-the-circles-choice.md) 只處理社團自述的補充資料。社團端實際持有的資料還有七類，[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30) 要求每一類都有目的、保存期限、到期處置與負責人。

[基礎研究](../research/data-collection-policies-in-comparable-projects.md)給了兩個可抄的形狀：Wikimedia 把保存期限獨立成一張表，而且 `Indefinitely` 是表裡一個正當的值；pretix 的 `LogEntry` 永不刪除，遇到刪除請求時塗掉個資而不刪列。

分類的標準不是「敏感不敏感」，是**這筆資料過了今天還有沒有用**：

- **憑證**（登入權杖、session）的價值在它有效的那段時間，過期之後留著只是風險。
- **紀錄**（帳號、認領、稽核）的價值恰好在事後——誰在什麼時候取得了哪個社團的擁有權，是日後發生爭議時唯一能回答問題的東西。

## 決策

| 資料 | 目的 | 保存期限 | 到期處置 |
|---|---|---|---|
| `login_tokens` | 寄出一次性登入連結，並支撐每小時的速率限制 | 建立後 24 小時 | 刪除資料列 |
| `sessions` | 維持登入狀態 | 到期或撤銷後 7 天 | 刪除資料列 |
| `preview_mail_sink` | preview 環境的收信槽，供 E2E 與人工測試 | 7 天 | 刪除資料列 |
| `accounts` | 帳號身分（email） | 不設期限 | 依當事人請求刪除 |
| `circle_claims` | 擁有權及其證據 | 不設期限 | 依當事人請求刪除 |
| `audit_log` | 認領、撤下、刪除等決策的紀錄 | 不設期限，永不刪除 | 依請求塗銷其中的個資，保留該列 |
| `admins` | 管理者名單 | 不設期限 | 移除即刪除資料列（已實作） |
| `circle_overrides` | 社團自述的補充內容 | 見 [ADR-0018](./0018-retention-is-the-circles-choice.md) | 同左 |
| `overrides_doc` | 公開文件的快取 | 衍生資料，每次重建覆寫 | 不適用 |

負責人只有一位：**專案維運者**。這不是分工表，是「出事時找誰」的答案；[ADR-0019](./0019-personal-data-requests-go-to-the-mailbox-not-the-issue-tracker.md) 的維運信箱是同一個人。

### `login_tokens` 不能「用完即刪」

速率限制數的就是這張表：`SELECT COUNT(*) FROM login_tokens WHERE <email 或 request_ip_hash> = ?1 AND created_at >= ?2`，視窗一小時，額度是每信箱 5 次、每 IP 20 次。**用完就刪會把這兩道限制打穿**，因為計數的依據跟著被刪掉了。清除門檻因此必須大於速率限制的視窗；取 24 小時，留一天的餘裕，也讓「有人一直對我的信箱要登入連結」在當天還查得到。

### 刪掉憑證不會失去證據

`auth.link_requested` 已經把 IP 雜湊與 email 的 SHA-256 寫進 `audit_log`（`app/circle-portal-handlers.ts`）。所以 `login_tokens` 那一列消失之後，**該次索取仍然留有紀錄**——消失的是能拿來登入的東西，留下的是這件事發生過。`sessions` 連 IP 欄位都沒有，`accounts.last_login_at` 已經記著最後登入時間，過期的 session 列沒有任何事後價值。

這就是憑證與紀錄分開處理的整個理由：**兩者不是同一份資料的不同天數，是不同的東西。**

### `preview_mail_sink` 的期限最短

它是全站唯一存有信件內文的地方——登入信全文，包含連結——而 preview 的沙盒收件人是真實的個人信箱。它服務的是測試，測試不需要昨天的信。

### IP 雜湊：保留，但不假裝它是匿名的

IP 以固定 pepper 雜湊後存放（`peppered(config.hashPepper, address)`）。**固定鹽加上 IPv4 只有 2^32 個可能值，代表這個雜湊可以用窮舉還原。** 它是化名，不是匿名。

決策是**保留**：它只出現在 `audit_log` 與生命期 24 小時的 `login_tokens` 裡，而 `audit_log` 的用途正是事後調查濫用。代價明確——保留它就是保留一項可還原的個人資料，因此隱私告知必須照實寫，不得用「已加密」「已匿名化」帶過。

要收斂的話有兩條路，都不在本決策內：定期輪替 pepper（讓舊雜湊彼此無法連結，Plausible 的作法），或在一定天數後把 `audit_log.ip_hash` 清成 `NULL` 而保留該列其餘內容。

## 這個決策沒有解決什麼

- **它不決定帳號刪除之後認領與稽核怎麼辦。** 刪掉 `accounts` 那一列，`circle_claims` 與 `audit_log` 裡的 `account_id` 就成了指不到人的識別碼。處理方式（連帶刪除、塗銷、或保留孤兒鍵）留給實作，但 `circle_claims_one_owner_idx` 的不變量不能因此被繞過。
- **它不涵蓋 Cloudflare 與 Mailgun 各自保存了什麼。** 本站控制得了自己的資料庫，控制不了服務商的日誌；隱私告知只能揭露有委外處理這件事。

## 後果

- **清除要有跑得起來的機制**，見 [ADR-0022](./0022-expiry-runs-in-a-separate-cron-worker.md)。這張表在機制上線之前，每一格都只是文件。
- **`sessions` 與 `login_tokens` 的清除必須以「已過期」為條件，不是以「已使用」為條件。** 兩者的差別就是速率限制還在不在。
- **隱私告知要放得下這張表。** 使用者看得懂的版本可以簡化，但不得出現與這裡不一致的天數。
