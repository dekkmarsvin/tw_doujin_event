# Cloudflare 容量與耗用監控

這個只讀流程每日查詢 Cloudflare GraphQL Analytics API，同時保存 account-wide R2 彙整，以及 production／preview 的縮圖與私人地圖投稿 buckets。它不列出 object name、不接入網站 request path，也不影響縮圖或地圖投稿。

## 資料與報表

- `r2StorageAdaptiveGroups`：物件數、upload count、payload bytes、metadata bytes。
- `r2OperationsAdaptiveGroups`：依 action、action status、HTTP status 彙整 requests。
- `r2:account` 查詢不帶 `bucketName` filter，用來觀察所有 account buckets 共用的 R2 計費量；其餘四列以 bucket filter 保留專案／環境歸因。
- 查詢與計費語意以 Cloudflare 的 [R2 metrics and analytics](https://developers.cloudflare.com/r2/platform/metrics-analytics/) 與 [R2 pricing](https://developers.cloudflare.com/r2/pricing/) 為準；account-wide 列用來對照共用的月度 included usage，bucket 列只做歸因，不能各自重複套用免費額度。
- 所有可能計費的 action 都進 Class A／B 趨勢估算，失敗請求另以 `failed` 診斷量保留；只有 Cloudflare pricing 明確列為不收費的未授權 HTTP 401 排除。這是趨勢估算，不是帳單明細。
- `GetBucketNotificationConfiguration` 與 `GetBucketSippyConfiguration` 是實測出現、但官方 pricing 表未分類的唯讀 action；為避免低估，依維護者決策保守納入 Class B。
- 未知的成功 action 不會被猜測分類；報表列出名稱並讓排程失敗，提醒依 Cloudflare 最新 pricing 文件更新 `monitoring/cloudflare-usage.config.json`。
- storage 缺列、GraphQL error 或 response schema 改變都保存明確狀態並使 job 失敗。storage 已有當日列而 operations 沒有任何 group 時視為零次操作；兩個 dataset 都沒有資料才標示延遲。

歷史 schema 以真實 UTC 日期為鍵；同一天重跑會取代該日快照，不重複加總。不存在的日期與今天／未來日期都會被拒絕。`Saved days` 是 history 中的日期數，可能包含明確保存的 delayed／error 診斷日；是否可用必須看各資源的連續 `Healthy days` 與 `Complete baseline`，不能只看 `Saved days`。

報表只在完整窗口存在時顯示 7／30 日數字：

- Class A／B 的 7 日合計需要含報表日的 7 個連續健康 UTC 快照；30 日同理。
- storage 7 日增量需要相隔 7 個完整日的兩個端點，因此通常需要 8 個連續健康快照；30 日增量需要 31 個。
- 任一受監控資源缺日、delayed、error、schema drift 或 unknown action 時，該窗口顯示 `n/a`。
- 月底預測至少需要 7 個連續健康快照；此前顯示 `n/a`。

只有 `7-day decision window: complete` 才表示 account-wide 與所有四個專案 buckets 都具備可比較的完整 7 日窗口。

## GitHub Actions 設定

`.github/workflows/cloudflare-usage.yml` 每日 06:17 UTC 收集前一個 UTC 日，並把 `.cloudflare-usage/history.json` 保存在跨 run cache。失敗時仍保存查詢錯誤狀態，並在 workflow summary 顯示報表。

cache 沒有保存承諾，因此排程找不到 history 時必須失敗，不能靜默建立空基線。先確認是否能從先前 run 或備份恢復；確定無法恢復時，才以手動 workflow 勾選 `allow_history_reset` 並填寫 `history_reset_reason`。這會在 summary 留下 warning，之後的 7／30 日趨勢從新基線重新累積。

Repository secrets：

| Secret | 內容 |
|---|---|
| `CF_USAGE_API_TOKEN` | 只授予目標 account 的 `Account Analytics: Read` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_USAGE_LIMITS_JSON` | 可選；符合 `cloudflare-usage-limits/1`、且資源集合完整的單行 JSON |

GraphQL token 不需要 R2 object read/write 權限。Cloudflare 建議用 API token 呼叫 `https://api.cloudflare.com/client/v4/graphql`；不要使用 Global API Key。

手動補跑指定日期可從 Actions 的 `workflow_dispatch` 輸入 `YYYY-MM-DD`。同日補跑仍是 idempotent。

## 本機執行

PowerShell：

```powershell
$env:CLOUDFLARE_API_TOKEN = "<account-analytics-read token>"
$env:CLOUDFLARE_ACCOUNT_ID = "<account id>"
npm run usage:collect -- --date 2026-08-20
```

第一次建立本機基線，或明確放棄無法恢復的本機 history 時，額外加入 `--allow-empty-history`。平常漏掉 `.cloudflare-usage/history.json` 會直接失敗：

```powershell
npm run usage:collect -- --date 2026-08-20 --allow-empty-history
```

報表重算不呼叫 API：

```bash
npm run usage:report -- --date 2026-08-20
```

本機 history 在 `.cloudflare-usage/`，已忽略版控。token、account ID、價格、免費額度、預算與通知設定都不得提交。

## 外部設定

複製 `monitoring/cloudflare-usage-limits.example.json` 的資料形狀到 secret。schema、欄位、所有受監控資源 ID 與數值都會嚴格驗證，缺漏或多餘資源會使 collector fail closed。所有數值預設為 `null`；Cloudflare 計價與免費額度會變動，因此程式不內建金額或額度。

通知政策尚未實作前，`monthlyBudgetUsd` 與 `pricing` 必須維持 `null`；填入尚未被程式使用的預算或單價會明確失敗，不能看似設定成功卻沒有作用。容量與 Class A／B request limits 可先由外部設定提供。

所有受監控資源的完整 7 日 decision window 累積完成後，再由維護者決定：

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
