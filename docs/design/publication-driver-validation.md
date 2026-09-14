# Publication driver 接線驗收（2026-09-14）

此紀錄屬 #245 工程驗收。資料為合成活動；fake 不連 GitHub、不部署、不驗公開 origin，不能當作 CH20 發布或 #212 真實失敗／恢復完成的證據。

## 本機 UI 任務

Source：`9636d6d921549e478b32e54366c7971721b1eefd`。Edge 153、本機 Pages／workerd `http://127.0.0.1:8789`，獨立 `.wrangler/245-local-fake` D1／R2。只使用保留的 `.test` 帳號、官方 Turnstile 測試 key 與 preview D1 mail sink；無正式憑證或資料寫入。

以正常登入及已授權 API 建立合成候選、主辦／分類、攤位匯入、地圖、檢查、預覽與送審。瀏覽器在活動列表選取候選並按一次「核准並發布」；未攔截 API 回應。Pages 注入的 fake dispatcher 自動完成工作，UI 顯示「已發布」、四階段完成與建置狀態 6/6。重新載入仍是同一 job，無 page error。

- Candidate：`07b8f98a-a038-457a-9221-f705956754f4`
- Job：`753c45c5-b8a6-4950-a2ed-5e3bec77d962`
- D1／API 結果：candidate `published`，job `published`，step `completed`
- [機器可讀證據](assets/publication-driver-2026-09-14/evidence.json)
- [完成畫面](assets/publication-driver-2026-09-14/published.png)

只保留確認過活動內容與最終結果相符的完成截圖。準備 fixture 所用的 API 不計為 Organizer 全流程 UI 驗收；本次直接受影響的 UI 動作為核准與狀態更新。

## 程式與恢復驗證

真實 D1＋Pages handler 測試覆蓋 mode 與重試接線，單次 fake dispatch 將 queued 工作推到 completed。GitHub driver 以記錄不可變 commit／tree 與實際 blob hash 的模擬邊界，驗證 data → main、固定 data merge SHA、保留 FF47 pin，以及 branch／PR／approval check／merge 寫入成功但回應遺失後的重入。

主要 review 首次受審 `9636d6d` 找到一項 MUST FIX NOW（目前 PR／正式啟用）：恢復分支時不可讓分支自行選擇未受信任的 parent。修正先證明 parent 屬於固定 main 歷史，再做完整產物比對。聚焦測試同時確認 data／main 的不可信 parent 被拒絕且無寫入，以及 main 合法前進後仍可恢復。

真正持續推進由 #246、deployment／Pages origin evidence 由 #212 Phase 4 接線；正式模式仍 disabled。
