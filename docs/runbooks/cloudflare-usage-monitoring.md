# Cloudflare 容量與耗用監控

這個只讀流程每日查詢 Cloudflare GraphQL Analytics API，分開保存 production 與 preview R2 bucket 的 bucket 級彙整。它不列出 object name、不接入網站 request path，也不影響縮圖上傳。

## 資料與報表

- `r2StorageAdaptiveGroups`：物件數、upload count、payload bytes、metadata bytes。
- `r2OperationsAdaptiveGroups`：依 action、action status、HTTP status 彙整 requests。
- 所有可能計費的 action 都進 Class A／B 趨勢估算，失敗請求另以 `failed` 診斷量保留；只有 Cloudflare pricing 明確列為不收費的未授權 HTTP 401 排除。這是趨勢估算，不是帳單明細。
- `GetBucketNotificationConfiguration` 與 `GetBucketSippyConfiguration` 是實測出現、但官方 pricing 表未分類的唯讀 action；為避免低估，依維護者決策保守納入 Class B。
- 未知的成功 action 不會被猜測分類；報表列出名稱並讓排程失敗，提醒依 Cloudflare 最新 pricing 文件更新 `monitoring/cloudflare-usage.config.json`。
- storage 缺列、GraphQL error 或 response schema 改變都保存明確狀態並使 job 失敗。storage 已有當日列而 operations 沒有任何 group 時視為零次操作；兩個 dataset 都沒有資料才標示延遲。

歷史 schema 以日期為鍵；同一天重跑會取代該日快照，不重複加總。報表顯示 7／30 日 storage 增量、Class A／B 操作量與依目前月內平均推估的月底值。資料未滿 7／30 天時顯示 `n/a`。

## GitHub Actions 設定

`.github/workflows/cloudflare-usage.yml` 每日 06:17 UTC 收集前一個 UTC 日，並把 `.cloudflare-usage/history.json` 保存在跨 run cache。失敗時仍保存查詢錯誤狀態，並在 workflow summary 顯示報表。

Repository secrets：

| Secret | 內容 |
|---|---|
| `CF_USAGE_API_TOKEN` | 只授予目標 account 的 `Account Analytics: Read` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_USAGE_LIMITS_JSON` | 可選；符合 `cloudflare-usage-limits/1` 的單行 JSON |

GraphQL token 不需要 R2 object read/write 權限。Cloudflare 建議用 API token 呼叫 `https://api.cloudflare.com/client/v4/graphql`；不要使用 Global API Key。

手動補跑指定日期可從 Actions 的 `workflow_dispatch` 輸入 `YYYY-MM-DD`。同日補跑仍是 idempotent。

## 本機執行

PowerShell：

```powershell
$env:CLOUDFLARE_API_TOKEN = "<account-analytics-read token>"
$env:CLOUDFLARE_ACCOUNT_ID = "<account id>"
npm run usage:collect -- --date 2026-08-20
```

報表重算不呼叫 API：

```bash
npm run usage:report -- --date 2026-08-20
```

本機 history 在 `.cloudflare-usage/`，已忽略版控。token、account ID、價格、免費額度、預算與通知設定都不得提交。

## 外部設定

複製 `monitoring/cloudflare-usage-limits.example.json` 的資料形狀到 secret。所有數值預設為 `null`；Cloudflare 計價與免費額度會變動，因此程式不內建金額或額度。

至少累積 7 天後，再由維護者決定：

- production／preview 或 account-wide 的月預算；
- 50%／80%／100% 門檻是否啟用；
- 通知管道與接收人。

目前只產生報表，不送通知。

## 納入其他按需付費資源

沿用 `resource id → unit → current → 7/30 day trend → forecast → external limit/budget` 形狀：

- D1：database storage、rows read／written或官方 analytics 可提供的對應單位。
- Workers／Pages Functions：requests、CPU time、subrequests。
- 其他資源：先確認官方 dataset 與計價單位，再新增 collector adapter；不得把某產品的單位塞進 R2 欄位。

每個 adapter 都必須維持唯讀、資源級彙整、同日重跑可覆寫、缺值可觀測與未知 schema fail closed。
