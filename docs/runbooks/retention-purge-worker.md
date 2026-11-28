# 排程清除 Worker

`workers/retention-purge/` 是獨立部署的 Worker，不隨 Pages 一起上線。部署方式見[獨立 Worker](./deployment.md#獨立-worker)。保存期限的權威定義在[資料 inventory](../contracts/data-inventory.md)。


保存期限要有東西去執行，而 **Pages 沒有 Cron Trigger**——那是 Workers 的功能。因此 `workers/retention-purge/` 是一個**獨立的部署單位**，與 Pages project 分開，綁同一個 D1、該環境的縮圖 R2 bucket 與私人地圖來源 bucket（[ADR-0022](../adr/0022-expiry-runs-in-a-separate-cron-worker.md)）。

它每天 UTC 03:17 執行一次清除，依下表刪除或匿名化到期資料，並寫一筆 `audit_log` 摘要：

| 目標 | 期限 |
|---|---|
| `login_tokens` | 建立後 24 小時 |
| `sessions` | 到期或撤銷後 7 天 |
| `preview_mail_sink` | 7 天 |
| `circle_overrides` | 只刪 [ADR-0054](../adr/0054-the-retention-choice-is-withdrawn-publish-or-delete.md) 之前選了 `retention_choice = 'purge'` 且 `retention_expires_at` 已過的既有列；新資料列不設期限 |
| `map_drafts`／`map_draft_revisions` | `draft`／`changes_requested` 180 天無活動後刪除內容；後者保留去識別化 review |
| 私人地圖來源 R2 bytes | `approved`／`rejected`／`exported`／`withdrawn` 決定 30 天後刪除；`submitted` 不自動清除 |
| `audit_log.ip_hash` | 寫入滿 90 天後清為 `NULL`，audit 列不刪除 |

各期限的值與起算點以[資料 inventory 的保存期常數](../contracts/data-inventory.md#保存期現行常數)為準，上表只是執行範圍的摘要。刪除 D1 metadata 前先刪除對應 R2 bytes；私人 bucket 未綁定且有到期原始檔時會中止，不把 metadata 當成已清除。社團自述清除後 `overrides_doc` 同步失去該筆並遞增 revision，且每筆寫一列 `override.purged` 稽核，內容不留。

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

## 每小時服務檢查

同一個 Worker 另有一條 `47 * * * *` 排程（#580），`scheduled()` 依 `controller.cron` 分流：每日 03:17 清除，每小時第 47 分檢查服務。檢查只讀，不寄通知、不碰清除。程式在 `db/scheduled-service-check.ts`，cron 字串要與 `SERVICE_CHECK_CRON` 一致。

| 項目 | 方式 | 不可用 |
|---|---|---|
| 寄信服務 | 讀 Mailgun 網域狀態（與手動「檢查服務」相同） | 金鑰錯誤、網域不存在、停用或未驗證 |
| 讀取服務 | 讀公開網站的 `/data/events/index.json` | 非 2xx、不是有效 JSON、連線失敗；8 秒逾時記為「無法確認」 |
| 通知寄送 | 查 `account_notification_items` | 有待寄通知到期超過 1 小時，或永久失敗筆數比上次多 |

結果寫回 `/admin` 顯示的 `site_service_check`。項目在正常與不可用之間改變時，以 Email Routing 的 `send_email` 綁定（`ALERT_EMAIL`）從 `alerts@kotoban.top` 寄一封信；持續不可用不重寄，「無法確認」不觸發也不解除告警。寄送失敗會留下 `service_check.alert_failed` log（只記錯誤名稱），下一次檢查重寄。手動「檢查服務」等待結果時，每小時檢查不會代替它回答。

### 設定

| 名稱 | 種類 | production | preview |
|---|---|---|---|
| `MAILGUN_DOMAIN` | `wrangler.jsonc` 變數 | `verify.kotoban.top` | `verify.kotoban.top` |
| `SITE_ORIGIN` | `wrangler.jsonc` 變數 | `https://map.kotoban.top` | 不設：preview 沒有固定網址，讀取服務記為「無法確認」 |
| `ENVIRONMENT_NAME` | `wrangler.jsonc` 變數 | `正式站` | `預覽站`，放在告警主旨開頭 |
| `MAILGUN_API_KEY` | Worker secret | 必填 | 必填 |
| `ALERT_RECIPIENT` | Worker secret | 維護者信箱 | 不設就只記錄、不寄信 |

`ALERT_RECIPIENT` 必須列在 `kotoban.top` Email Routing 的 Destination addresses 並已驗證；綁定不限制收件人，但 Email Routing 只會寄到已驗證的地址。repo 是公開的，收件人只放 secret：

```bash
npx wrangler secret put ALERT_RECIPIENT --config workers/retention-purge/wrangler.jsonc
npx wrangler secret put ALERT_RECIPIENT --config workers/retention-purge/wrangler.jsonc --env preview
```

`vars` 每次部署都會取代 Dashboard 上的變數，所以 `MAILGUN_DOMAIN` 寫在 `wrangler.jsonc`，不要只在 Dashboard 設定。

### 驗證

- `/admin` 服務檢查的時間每小時更新，四個項目都有結果；每日清除的 `retention.purged` audit 照常出現。
- Workers Logs 每小時有一筆 `service_check.scheduled`，含各項狀態與 `alert`（`none`／`sent`／`not_configured`／`failed`）。
- 要驗告警，暫時把 `MAILGUN_API_KEY` 改成錯的值：下一次檢查記為不可用並寄出一封告警，之後不重寄；改回後寄出一封恢復信。

### 兩件容易踩到的事

- **CI 不會部署它。** 改了 `db/retention-purge.ts`、`db/scheduled-service-check.ts` 等 Worker 輸入後，合併到 main 再手動部署。
- **bindings 不會被 named environment 繼承。** `env.preview` 必須自己宣告 `d1_databases`、`THUMBNAILS` 與 `MAP_CONTRIBUTIONS`，理由與 Pages 的 `wrangler.jsonc` 完全相同；漏掉的話 preview 那份會直接少資源。
