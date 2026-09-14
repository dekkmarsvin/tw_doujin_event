# #246 持久化 publication 推進驗證

2026-09-14，本切片承接 #246、#241、#235、#236。架構與一次性建置邊界見 [ADR-0062](../adr/0062-publication-wakes-through-webhooks-and-a-dedicated-cron.md)；產品行為唯一契約為 [Organizer workspace](../contracts/organizer-workspace.md)。

## 工程驗證

- 真實 D1 的 scheduler 測試依序走完八個 stage；三個 waiting stage 各 pending 五次，退避不超過五分鐘，重建 repository／dispatcher 後仍從既有 checkpoint 前進；準備與合併各只執行一次。
- 簽章 webhook 經實際 middleware 與 Pages handler：無 Origin、無簽章到達 401；非 JSON 415；其他路徑／mutating method 403；disabled 503。並行重送只喚醒一次，之後 replay 不重設 due time；不同 event 或 bytes 重用 delivery ID 拒絕。
- Cron、重送與並行 tick 共用真實 D1 global lease，只有一個 driver 執行；舊版本與 failed 不派送。queued timeout 在沒有 UI request 時成立，掃描後才取得 lease 的競爭也不會誤判失敗。
- 工作區讀取測試保留原 job，明確確認 GET／list 不再造成 timeout 寫入；獨立排程處理後，原 UI failure／retry 文案與 checkpoint 維持。
- 既有資料庫測試新增缺少兩個排程欄位的舊表，驗證 additive migrations 先於 index 建立。
- 聚焦測試 75/75、typecheck、相關 lint 通過。Wrangler 4.120.1 實際 dry-run bundle 328.15 KiB，production vars 仍 disabled。
- 實際 workerd 的 `scheduled` handler 以 Miniflare API 觸發八輪，D1 中同一 job／approval hash 依序到 completed，所有 scheduled outcome 為 ok；[逐輪證據](./assets/publication-scheduler-2026-09-14/evidence.json)。這是本機 fake adapter，不是已部署 cron 或公開發布證據。

## 實際環境界線

本機測試使用 synthetic approved snapshot、模擬 GitHub 結果及本機 D1，不代表已核准或發布 CH20。新 Worker 尚未部署／配置 App secrets 或正式 cron，production mode 仍 disabled。真實 GitHub delivery、無人操作的正式 publication 與失敗恢復，仍須與 #212 Phase 4／6 一起驗收。

完整本機測試首次執行遭 Windows loopback ephemeral port 耗盡（`EADDRINUSE`，觀察到 15,684 個 TIME_WAIT），結果不能記成通過；required CI 仍須在 PR 同一 head 通過，沒有降低 gate。
