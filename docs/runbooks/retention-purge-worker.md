# 排程清除 Worker

`workers/retention-purge/` 是獨立部署的 Worker，不隨 Pages 一起上線。保存期限的權威定義在[資料 inventory](../contracts/data-inventory.md)。


保存期限要有東西去執行，而 **Pages 沒有 Cron Trigger**——那是 Workers 的功能。因此 `workers/retention-purge/` 是一個**獨立的部署單位**，與 Pages project 分開，綁同一個 D1、該環境的縮圖 R2 bucket 與私人地圖來源 bucket（[ADR-0022](../adr/0022-expiry-runs-in-a-separate-cron-worker.md)）。

它每天 UTC 03:17 執行一次，依下表刪除或匿名化到期資料，並寫一筆 `audit_log` 摘要：

| 目標 | 期限 |
|---|---|
| `login_tokens` | 建立後 24 小時 |
| `sessions` | 到期或撤銷後 7 天 |
| `preview_mail_sink` | 7 天 |
| `circle_overrides` | **由社團自選**：只刪 `retention_choice = 'purge'` 且 `retention_expires_at` 已過的列（[ADR-0018](../adr/0018-retention-is-the-circles-choice.md)） |
| `map_drafts`／`map_draft_revisions` | `draft`／`changes_requested` 180 天無活動後刪除內容；後者保留去識別化 review |
| 私人地圖來源 R2 bytes | `approved`／`rejected`／`exported`／`withdrawn` 決定 30 天後刪除；`submitted` 不自動清除 |
| `audit_log.ip_hash` | 寫入滿 90 天後清為 `NULL`，audit 列不刪除 |

憑證、地圖草稿／原始檔與 audit IP 的期限是這個 Worker 的常數；社團補充資料的期限寫在每一列自己身上。刪除 D1 metadata 前先刪除對應 R2 bytes；私人 bucket 未綁定且有到期原始檔時會中止，不把 metadata 當成已清除。社團自述清除後 `overrides_doc` 同步失去該筆並遞增 revision，且每筆寫一列 `override.purged` 稽核，內容不留。

**它只刪，不建表**——schema 仍由 Pages 端的 repository 首次使用時建立；找不到的表會列進摘要的 `skipped` 並跳過。

```bash
npm run purge:deploy
```

preview 是另一個部署，指向 preview 的 D1：

```bash
npm run purge:deploy:preview
```

**preview 這一份不是可選的。** `preview_mail_sink` 是全站唯一存有信件內文的地方，而 preview 的沙盒收件人是真實個人信箱。

### 驗證它有在跑

```bash
npx wrangler d1 execute tw-catalog-identity --remote --command "SELECT at, detail_json FROM audit_log WHERE action = 'retention.purged' ORDER BY at DESC LIMIT 5"
```

沒有任何一列，就是它沒跑過——不是「沒有東西要刪」。什麼都沒刪的執行同樣會留下一列。

本機要手動觸發一次：

```bash
npm run purge:dev
```

再對 `http://localhost:8787/cdn-cgi/handler/scheduled` 發一個請求即可。

### 兩件容易踩到的事

- **它不在 GitHub Actions 的部署流程裡。** Pages 的 CI 不會連帶更新這個 Worker；改了 `db/retention-purge.ts` 之後要自己重跑 `npm run purge:deploy`。
- **bindings 不會被 named environment 繼承。** `env.preview` 必須自己宣告 `d1_databases`、`THUMBNAILS` 與 `MAP_CONTRIBUTIONS`，理由與 Pages 的 `wrangler.jsonc` 完全相同；漏掉的話 preview 那份會直接少資源。
