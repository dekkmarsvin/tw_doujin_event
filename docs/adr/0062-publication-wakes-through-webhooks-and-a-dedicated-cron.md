# ADR-0062：Webhook 喚醒，由獨立 cron 持續推進 publication

- 狀態：Accepted（2026-09-14）
- 依據：#246，整合 #241、#235、#236；延續 ADR-0057、0058。

核准建立的 job 是持久化工作。Pages 的 production 核准／retry 僅提交 due job，由獨立 `workers/publication-dispatch` Worker 綁同環境 identity D1，每分鐘執行一次。它與 retention Worker 分開，沒有 HTTP 入口，不新增定時發布的產品功能。

2026-09-15 CH20 實測補正（#212）：Pages 與 Worker 共用 verifier 的 runtime 缺陷，曾使舊 Pages 在 UI retry 內同步執行並再次 failed，修正獨立 Worker 也無法接手。移除 Pages 的第一次同步 transition，讓 retry 的持久化意圖交由可獨立修復的執行者處理；不改核准、授權、lease、失敗重試或版本驗證邊界。

Webhook 僅接受固定路徑的 JSON POST，豁免該請求的 Origin 檢查，仍驗證 exact bytes HMAC。合法 delivery 以固定 repository 和已釘住的 head／merge SHA 找 job，在同一交易重設 due time 並完成 delivery 紀錄；重送不再重設排程。Webhook 不在 HTTP request 內執行 GitHub 發布。

Cron 每輪挑最多十筆到期且仍屬目前核准版本的 job，各執行一步。外部 pending 以 1、2、4、5 分鐘退避，之後上限五分鐘；成功前進的下一步於下次 cron 可執行。due time 與 checkpoint 在既有 lease 下同次寫入，重啟不丟排程。Webhook 漏送、早於 checkpoint 到達或與正在執行的 delivery 相撞，最遲仍由到期輪詢接手；五分鐘是排程退避上限，不是外部服務可用性保證。

保留 15 分鐘 queued timeout，由 cron 掃描並在交易時重新檢查 live lease；工作區 GET 不再掃描或更改 publication。CI 等待為 publishing，沒有 queued timeout。失敗仍要求既有 Owner／Admin retry，同一 job、snapshot 與 checkpoint；cron 不自行恢復 failed 或舊版本。

Worker 與 Pages 的 production mode 預設 disabled。獨立 Worker 部署、D1 綁定、App secrets、webhook 設定及兩邊 mode 啟用是一次性基礎建置；需另做正式環境驗收。日常新增活動不需要另建 Worker、secret 或手動叫醒。Deployment／Pages origin smoke adapter 仍由 #212 Phase 4 承接；此決策的模擬驗證不代表 CH20 已發布。
