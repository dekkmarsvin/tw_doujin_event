# Issue #202 複核

2026-09-12，對照未提交工作樹。依使用者指示，先完成本次本機實作驗收，再讀取 [issue #202](https://github.com/dekkmarsvin/tw_doujin_event/issues/202) 的本文、標籤與留言（無留言）。本次是驗證，不代表 issue 已解決或可合併；未修改 GitHub issue 狀態。

## 逐項結果

| # | 稽核項目 | 本次結果與證據 |
|---|---|---|
| 1 | 缺 design-qa.md | **已補齊**。根目錄報告存在，ADR-0056 改用相對連結。 |
| 2 | 文件仍稱未實作 | **已修正**。docs/README 與計劃開頭同步為已實作，計劃第 8 節記錄實際驗收與限制。 |
| 3 | 三份文件仍稱四頁籤 | **已修正現況指引**。活的 local-development runbook 改為兩入口與摘要；兩份桌機歷史文件明示手機規則由 ADR-0056 取代，保留當時的驗收數字而不冒稱現況。 |
| 4 | 把手不足 44px | **成立，待修**。CSS 為 14px；短螢幕摘要 8px。替代收起按鈕存在，但不能據此宣稱符合 44px 設計目標。 |
| 5 | 缺純轉移測試 | **成立但需限縮說法**。沒有手機純轉移測試，導航／失效摘要／斷點等仍缺完整自動回歸；已有通用 URL、視域與瀏覽器 shared-day-and-history 測試，不能概括成完全沒有 URL 測試。計劃第 8 節已說明重用既有狀態而非新增 reducer，但這不免除行為測試需求。 |
| 6 | 行程成功回饋 | **成立，待修**。摘要按鈕只從加入行程翻為移出行程，沒有針對成功操作的文字通知／status。 |
| 7 | 矩陣不可重現／公式不同 | **部分成立**。matrix.json 是本次 CUA 量測，產生程序未存為可直接重跑腳本；現行量測使用 dock.top − tools.bottom − 32，與瀏覽器腳本 240px 判準一致，但兩次畫面及時間不同，不能拿 issue 的 423px 與目前約 392px 混為同一次測量。需要統一可重跑輸出。 |
| 8 | 多攤位導航目標換碼 | **成立，待修**。本次已實測 OriginZero A01 加入後導航選 A02；與 ticket 的 B11→B12 為同一機制。event-workspace-projection.ts 的 dayRecordsByCircleId 對同社團的 active record 持續覆寫，toggleNavigationMode 再以該 record 更新選取及 URL。未重跑 B11 個別案例，不把它冒稱本次實測。 |
| 9 | fit 預留右欄造成縮小 | **成立，屬過度預留**。use-map-viewport.ts 的 forFit 無條件扣除右邊 64px 控制欄與間距。可見性安全但未依地板是否真的重疊控制器選擇較大 fit。390px 可用寬 282px，未扣右欄為 358px，倍率差約 21.2%；issue 的「約 22%」合理。760px 實測控制器與地板在垂直方向會重疊，不能直接全面刪掉右欄預留，應以矩形碰撞處理。 |
| 10 | 工具選單無 Escape／點外部關閉 | **成立，待修**。裸 details 只有原生 summary 切換，未提供這兩個事件處理；點工具本身仍可收起，並非完全無法關閉。 |
| 11 | centerMapOffset 無 production 呼叫 | **成立，清理項**。rg 結果僅宣告與 tests/map-viewport.test.mjs。 |
| 12 | 分散 media 與覆寫 | **成立，清理項**。CSS 有 11 個手機條件區塊（含短高度條件），controls 寬度、brand grid-row 等仍存在後覆寫前的寫法。 |
| 13 | 死規則與重複樣式 | **成立，清理項**。desktop 條件才渲染 event，但手機仍有 event 規則；mobileTabs span、重複 inherit 與 main/dock 重複 style 都仍在。 |
| 14 | 收合列 magic number | **成立，清理項**。snap points 與 fit 各自寫 44；CSS 也以 108px 表示 64+44，應共用命名值或量測。 |
| 15 | 空欄位文件及異動文案 | **部分已修正**。components 已區分完整資訊省略缺欄、摘要明示未提供；異動摘要的「請查看完整資訊確認位置」仍與下方按鈕重複，文字清理待做。 |

後續修復順序及驗收條件見 [修復計劃](./issue-202-fix-plan.md)。

## 驗收結論

核心方案 B 畫面與主要流程已實作，623 項完整測試通過；收尾後 ESLint、TypeScript、5 項幾何測試、FF47 正式建置及 12 contracts 檢查再次通過。結果清單切換篩選後 scrollTop 844 → 844，Chrome error log 為空。

**#202 不能判定為全部解決。** 項目 1–3 已補齊，15 的文件衝突已消除；把手尺寸、操作回饋、多攤位導航、工具選單、fit 效率、測試與證據重現性，以及清理項仍須後續處理。本機視覺 QA 通過僅代表該次已測畫面，不能取代這份複核的未解決事項。真機 iOS Safari／Android Chrome 仍未驗證。
