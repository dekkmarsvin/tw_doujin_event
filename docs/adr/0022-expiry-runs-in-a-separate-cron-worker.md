# ADR-0022：清除跑在獨立的排程 Worker，不掛在使用者請求上

- 狀態：已定案（2026-08-20）
- 相關 ADR：[ADR-0008](./0008-static-public-reading-path.md)、[ADR-0009](./0009-single-pages-project-direct-upload.md)、[ADR-0018](./0018-retention-is-the-circles-choice.md)、[ADR-0021](./0021-credentials-expire-and-are-purged-records-are-kept.md)
- 相關 issue：[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30)、[#48](https://github.com/dekkmarsvin/tw_doujin_event/issues/48)

## 脈絡

[ADR-0018](./0018-retention-is-the-circles-choice.md) 與 [ADR-0021](./0021-credentials-expire-and-are-purged-records-are-kept.md) 給了期限，但本站沒有任何地方能定時執行程式。**Cron Trigger 是 Workers 的功能，Pages 沒有**（Cloudflare 的 Pages→Workers 對照表把 Cron Triggers 列在「Workers 有、Pages 沒有」那一欄），而 [ADR-0009](./0009-single-pages-project-direct-upload.md) 決定的部署形狀是單一 Pages project。

三條路：

**A. 獨立 Worker 加 Cron Trigger**，綁同一個 D1。多一個部署單位。

**B. 機會性清除**，掛在某個既有請求路徑上順手刪。不必新增任何東西。

**C. 把整個站從 Pages 遷到 Workers**，讓 cron 與 Functions 待在同一個單位裡。

## 決策

**採 A：獨立的排程 Worker，每天執行一次。**

B 的問題不是效能，是**保存期限會變成流量的函數**。沒有人登入的那個月，過期的登入權杖與 session 就留著——而它們恰好是最該被清掉的東西。一個「只有在有人來的時候才會兌現」的期限，寫進隱私告知就是一句做不到的話。它另外還會把 D1 寫入接到使用者請求的關鍵路徑上；若接到公開的 overlay 端點更糟，[#48](https://github.com/dekkmarsvin/tw_doujin_event/issues/48) 已實測那條路徑的**每一次 revalidation 都是一次 Function 呼叫，包含回 304 的那些**。

C 是長期方向而不是現在的動作。[ADR-0008](./0008-static-public-reading-path.md) 的純靜態閱讀路徑與 [ADR-0009](./0009-single-pages-project-direct-upload.md) 的 Direct Upload 都建立在 Pages 上，為了一個每天跑一次的刪除作業去搬整個站，代價與收益不成比例。

### 成本：免費方案就夠，而且差得很遠

| | Workers Free | Workers Paid |
|---|---|---|
| 請求 | 100,000／天 | $5 USD／月起，含 10M／月，超出 $0.30／百萬 |
| CPU | 每次呼叫 10 ms | 含 30M CPU-ms／月，cron 單次上限 15 分鐘 |
| Cron Trigger | 每帳號 5 個 | 每帳號 250 個 |

| | D1 Free | D1 Paid |
|---|---|---|
| 列讀取 | 5,000,000／天 | 首 25B／月，超出 $0.001／百萬 |
| 列寫入 | 100,000／天 | 首 50M／月，超出 $1.00／百萬 |
| 儲存 | 5 GB | 首 5 GB，超出 $0.75／GB-月 |

每天一次的排程，一個月約 30 次呼叫；本站的資料量以千列計。**這件事本身不會讓帳單從 0 變成不是 0。**

要注意的是 Pages Functions 與 Workers 共用同一份帳號額度（Cloudflare 明說 Pages Functions 依 Workers 計費），所以真正該擔心的仍然是 overlay 端點那 100,000 次／天，不是這個排程——這也正是不把清除掛上去的理由。

### 五個實作時不能選錯的約束

**一、刪除用 SQL 的條件式刪除，不在 JS 裡逐列迴圈。** 免費方案的 10 ms CPU 是**每次呼叫**的上限；等待 D1 不計入 CPU，但把幾千列拉進 JS 再逐一處理會計入。索引欄位被寫到時會多算一列寫入，估算寫入量時要記得。

**二、這個 Worker 不建立 schema。** 建表由 Pages 端的 repository 在首次使用時完成（[ADR-0009](./0009-single-pages-project-direct-upload.md) 沒有 migration 步驟的後果）。排程 Worker 只刪；表不存在就結束，不要在兩個地方各有一份會建表的程式。

**三、preview 與 production 各綁自己的 D1。** 理由與 `wrangler.jsonc` 裡 `d1_databases` 不繼承那段完全相同，binding 名稱維持 `DB`。**preview 的排程要開**——`preview_mail_sink` 是全站唯一存有信件內文的地方，正是最需要被清的東西。

**四、清除邏輯放在能被 `node --test` 驅動的模組，Worker 的 `scheduled()` 只是薄殼。** 現在時間由參數傳入，不在模組內讀時鐘，否則測試只能等。#30 的驗收條件要的就是這個：機制有測試，不是文件裡的一句話。

**五、每次執行寫一筆 `audit_log` 摘要**（各表刪了幾列）。沒有這筆紀錄，「清除到底有沒有在跑」就只能靠翻資料庫猜；而這正是研究裡 Mastodon #19774 那個失敗模式最後現形的地方。

## 這個決策沒有解決什麼

- **它不決定 Worker 的名稱、cron 表達式與部署流程**，那些屬於實作與[部署 runbook](../runbooks/deployment.md)。
- **R2 刪除已由 [#65](https://github.com/dekkmarsvin/tw_doujin_event/issues/65) 接入。** Worker 綁定與 D1 同環境的 `THUMBNAILS`；到期列有 `hosted_thumbnail_key` 時，先做可重試的 R2 delete，再刪 D1 列與更新公開文件。

## 後果

- **多一個部署單位。** 第二份 wrangler 設定、CI 多一步、`wrangler.jsonc` 的 binding 要在兩邊維持一致。這是 [ADR-0009](./0009-single-pages-project-direct-upload.md)「單一 Pages project」第一次被打破，理由是 Pages 在功能上做不到，不是為了方便。
- **它吃掉帳號 5 個 cron 額度中的一個**（preview 若獨立部署就是兩個）。免費方案給 5 個，還很寬裕，但不是無限。
- **排程失敗要看得見。** 一個沒人看的排程等於沒有排程；至少要能從 `audit_log` 看出上次成功執行是什麼時候。
