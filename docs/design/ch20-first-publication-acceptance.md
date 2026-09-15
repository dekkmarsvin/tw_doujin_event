# CH20 首次發布：送審證據與啟用操作包

2026-09-15。本文件記錄 #212／#104 本輪首次發布驗收；**尚未核准、啟用或公開**。#259 保持 Draft，最終待核對的 PR head／CI 記在 PR 說明與 #212。

## 已送審內容

- Candidate `1da921dd-9e1e-4ca3-b117-a31b526f1556`，**v15**，event `ch-20`。
- Comic Horizon 20，2026-10-09，GJ工作室，三重綜合體育館／1F 開放式場地。
- Snapshot `a78be78e-7c22-41c6-b568-b8d1cf494cf7`，2026-09-15T01:40:08.992Z 透過 UI 送審。
- SHA-256：`4a0a45366caae1d555fbfb4c4f622a8d19de9e6054bbfb651a8c8515386da1e3`；以儲存 bytes 重算相符。
- 170 列、202 個唯一攤位碼，8 排，map revision **7**；snapshot 地圖與已驗證內容完全相同，代碼覆蓋完整。
- 「艾 B15、B16」及原始 B15B6 差異註記沿用使用者決定，不再主動查證。

真實 authoring 皆經 Organizer UI：退回 v10、活動／主辦／分類與場館來源整理、CSV 固定 3 字元拆碼、32 個雙攤框拆分、浮點邊界修正、validate、preview、submit。唯讀 D1 查核未寫資料。138 個原單格與所有非 rows layout 保持相同；0 overlaps。底圖沿用既有上傳，沒有重新製造地圖來源。

PR #262 修正預覽黑底與選取缺漏，主要 review Done；最終 head `259c25d` 必要 CI [34917476088](https://github.com/dekkmarsvin/tw_doujin_event/actions/runs/34917476088) 全部成功。main `0818db5` 的正式部署 [34917870595](https://github.com/dekkmarsvin/tw_doujin_event/actions/runs/34917870595) 與 Pages origin smoke 成功。真實 CH20 重驗 0 errors／warnings，滑鼠 A01、ArrowDown＋Enter A02 與 G30 選取顯示正確社團。

證據：[檢查與地圖上段](assets/ch20-first-publication-2026-09-15/check-preview.png)、[地圖下段](assets/ch20-first-publication-2026-09-15/preview-map-bottom.png)、[UI 送審成功](assets/ch20-first-publication-2026-09-15/submitted.png)、[匯入與地圖比對](assets/ch20-first-publication-2026-09-15/map-import-check.json)、[snapshot 核對](assets/ch20-first-publication-2026-09-15/submitted-snapshot-check.json)、[FF47 發布前四份公開 JSON 基準](assets/ch20-first-publication-2026-09-15/ff47-before.json)。

## 待維護者确认的執行範圍

1. 確認上述新 snapshot 及 #259 最終 head 的必要 CI。合併 #259、等待 Pages 正式部署，再部署同 commit 的 `tw-catalog-publication-dispatch` Worker；核對兩端 production mode=github、正確 D1、既有 App credentials、每分鐘 cron。這些是一次性 rollout。
2. 只在 UI 核准此 snapshot。系統建立唯一 job，完成 data PR／checks／merge、main PR／checks／merge；正常發布不由人代做。
3. **受控故障只限該 job 固定的 production run／attempt**：執行前核對 job 的 main merge SHA、workflow `331570396`、repository `dekkmarsvin/tw_doujin_event`、`push`／`main` 與唯一 `Verify and deploy` job。僅在 **Deploy to Cloudflare Pages 尚未開始** 時取消整個對應 run。若部署已開始就停止故障操作，不取消其他 run、不修改正式資料或 required checks。
4. 保存取消前 step 狀態、原 job／snapshot、data/main PR與 merge SHA、run／attempt、取消結果及 UI retryable failure。Candidate 應保留已核准內容，不能回草稿；已完成 checkpoints 不能重建。
5. 透過 UI「重試發布」一次，由系統恢復同 job／snapshot／checkpoints，重跑原 run 的下一 attempt。此期間不合併其他 main 變更。非預期 failure 先保留證據並依具體原因處理，不建立第二個 CREATE、不重試舊 v10 job。
6. 只有系統 production verifier 成功且標 published，才進入完成核對：Pages manifest main/data SHA、CH20 全部公開 JSON／地圖、真實 Reader 日期／場館／攤位互動，以及 FF47 bytes 與 Reader 未被覆寫。

第一次取消属于受控故障驗收、一次 UI retry 屬恢復操作，與正常流程分開計數。工程修正／一次性建置／唯讀驗證亦另列；尚未把「沒有人工補完正常發布步驟」勾為完成。

## 尚未完成及停止範圍

管理者核准、publication 自動推進、受控失敗／恢復、CH20 Pages origin 與公開 Reader 驗證均尚待執行。完成後結果回填 #212，#246 依正式 cron／webhook 證據更新；#104 保留發布後更正範圍，#190 留下一里程碑，不因其他非阻擋票開啟而擴張本 goal。
