# ADR-0027：帳號刪除會釋放擁有權，稽核個資塗銷，IP 雜湊保留 90 天

- 狀態：已定案（2026-08-21）
- 具體化：[ADR-0021](./0021-credentials-expire-and-are-purged-records-are-kept.md)
- 相關 issue：[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30)、[#63](https://github.com/dekkmarsvin/tw_doujin_event/issues/63)

## 決策

1. 登入中的非管理者可用完整 email 二次確認刪除帳號。刪除會清掉帳號、登入權杖、sessions、該帳號的所有 claims，以及仍由其 verified claim 擁有的 overlays，並同步更新公開文件；主辦資料不受影響。管理者必須先由另一位管理者移出名單。
2. 刪除 claims 會釋放 partial unique index 的擁有者名額。已轉移給他人的社團不因前任刪帳號而刪除現任內容。
3. `audit_log` 永不刪列。與帳號或其 email digest 可連結的欄位設為 `NULL`／固定 `[shredded]`，自由內容清空，並寫入 `shredded_at`；action 與時間保留。
4. `auth.link_requested.subject_id` 改為以 `HASH_PEPPER` 做金鑰、帶 `audit-email-v1` domain separation 的 HMAC，不再用無金鑰 SHA-256。
5. `audit_log.ip_hash` 在 90 天後由排程清為 `NULL`；audit action 本身保留。`login_tokens.request_ip_hash` 仍隨 token 列在 24 小時內刪除。
6. `accounts.disabled_at` 保留並提供管理者寫入路徑；停用立即撤銷 sessions 並阻止再次登入。

## 後果

- 帳號刪除是不可復原動作；日後重新登入會得到新帳號，認領需重做。
- audit 塗銷後仍能回答「何時發生哪個動作」，但不能再用於辨認當事人。
- `HASH_PEPPER` 輪替會改變新舊 email digest，刪除流程只需處理當事人目前金鑰生成的 digest；actor/account 關聯仍是主要塗銷索引。

