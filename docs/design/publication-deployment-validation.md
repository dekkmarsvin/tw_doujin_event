# #212 Phase 4：部署與公開結果驗證

本切片將 Pages／cron 共用的 runtime 接上 deployment adapter。首次發布、核准 snapshot、lease 與重试行為依 [Organizer contract](../contracts/organizer-workspace.md)；不啟用 production mode、不替代 CH20 的 UI／公開 Reader／真實故障驗收。

## 可核對的工程證據

- GitHub 真實唯讀 API 對 main `010966d` 的 run `34858703330` 確認：workflow ID `331570396`、push/main、attempt 1；attempt-specific jobs 帶相同 head SHA／run ID／attempt，`Verify and deploy` 中的 deployment 與 production smoke step 均 success。這是既有工程部署證據，沒有觸發 rerun。
- 模擬 HTTP 測試驗證固定 run 身分、attempt-specific jobs、skipped 拒絕、custom domain advisory、retry 空 body 201、回應遺失後只採用下一 attempt，以及 main 前進／lease 失效時沒有 rerun 寫入。
- 真實 D1 驗證首次 run checkpoint 先保存、failure 後既有 retry 交易只授權下一 attempt，同 job／approval hash／data SHA／main SHA 恢復；未授權 attempt 變更被 executor 拒絕。舊資料庫三個新增欄位的 migration 通過。
- Origin 模擬以兩場活動檢查 manifest、data pin、每個 artifact SHA-256、Reader HTML、匿名 session 401 與 manifest 前後一致；舊版本、漏活動／地圖、既有活動內容改變、redirect 均不能 published。
- 本機實際 `build:production` 使用 FF47 pin `8c645303fa6838383549fbe8433ece081c514e1e` 成功生成全部公開 JSON 的 manifest；沒有更改 pin 或正式活動內容。Wrangler 4.120.1 dry-run：340.75 KiB，production mode disabled。
- 新增 11 項聚焦檢查通過；相關 regression 82/82 通過，typecheck／完整 lint 通過。Required CI 結果另在 PR 留存。

## 上線与恢復邊界

合併後 CI 會產生 `/deployment-manifest.json` 並以此次 commit 驗 production smoke；runtime 另對固定 Pages origin 重驗實際檔案。只有三項證據一致（核准 publication 的 main merge、同 run/attempt 的 deployment + smoke、實際公開 bytes），才標 published。Manifest 不包含帳號、snapshot 私有內容或 credentials。

GitHub installation token 的 Actions scope 由 read 使用為 write，供既有 UI retry 重跑失敗部署；仍僅固定兩個 repo，不取得 Workflows。Worker 尚須一次性部署／secrets／cron 設定與正式啟用核准。

一次真實的可恢復 failure/retry 仍未執行，預計在首次 CH20 CREATE 前固定操作包：只對該 job 已釘住、尚未進入部署步驟的 production workflow run 做受控取消，再由 UI retry 恢復同一 run 的下一 attempt。此處只記錄待核准方案，不授權或宣稱已完成故障操作。
