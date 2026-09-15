# CH20 首次正式發布驗收

**首次發布完成。** 2026-09-15T03:16:39.104Z（臺灣 11:16:39），原 publication job 由獨立 cron 完成 `published / completed`；Organizer 顯示 **6/6、已發布**。本次包含真實失敗及工程修復，不宣稱整段觀測旅程零人工補救。#104 仍保留發布後更正，#190 是下一里程碑。

公開結果：[CH20 Reader](https://map.kotoban.top/?event=ch-20)、[Pages production origin](https://tw-catalog.pages.dev/?event=ch-20)、[既有 FF47 Reader](https://map.kotoban.top/?event=ff47)。本紀錄的發布與恢復證據截止 main `22daf8f`；後續純證據提交不改活動資料或 runtime，最新部署核對另記 #212。

## 核准內容與 UI 旅程

| 項目 | 已驗收結果 |
| --- | --- |
| 活動 | Comic Horizon 20；2026-10-09；GJ工作室；三重綜合體育館／1F 開放式場地 |
| Candidate | `1da921dd-9e1e-4ca3-b117-a31b526f1556`，v15，event `ch-20` |
| Snapshot | `a78be78e-7c22-41c6-b568-b8d1cf494cf7` |
| 核准 SHA-256 | `4a0a45366caae1d555fbfb4c4f622a8d19de9e6054bbfb651a8c8515386da1e3` |
| 匯入 | 原 CSV 經 UI 明確選固定 3 字元拆碼，170 列 → 202 個唯一代碼，0 待修正；v13 存檔後可讀完整清單 |
| 地圖 | UI 處理32組雙攤框→64格，138原單格與非 rows layout不變；revision7，8排、202格、0 overlaps |
| 檢查／預覽 | 正式 validation 0 errors／warnings；A01 滑鼠、A02 鍵盤與 G30 詳情正確 |
| 送審／核准 | 01:40:08.992Z 送審；02:12:20.706Z UI「核准並發布」，audit `selfApproval=true` |
| 最終 Reader | 全部202個地圖按鈕的代碼／名稱符合公開 placements；170 circle IDs、同團多攤身份保留；地圖 layout 與 snapshot 完全一致 |
| FF47 | 四份公開 JSON SHA-256 與發布前基準完全相同；Reader 日期、花博公園爭艷館及 A01 OriginZero 詳情正確 |

「艾 B15、B16」及原始 B15B6 差異註記沿用使用者決定；不宣稱官方原檔已改，也未再主動查證。CSV SHA-256：`dda265180c5e66592ffe421210083aabe050bfd83625f24c9c483a7e62adc9dc`。

送審前 authoring 皆经 Organizer UI，未以 SQL／API 寫入替代。底圖沿用原上傳。原核准前操作包在 [PR #259](https://github.com/dekkmarsvin/tw_doujin_event/pull/259) 留存；其預定 workflow cancellation 後來由本次自然發生的 checks failure 承接，沒有執行取消或 workflow rerun。

## 系統發布與 origin proof

- Job：`94812f08-3a56-4d1c-9474-7e52f0ea7414`。
- System 建立並合併 [data PR #2](https://github.com/dekkmarsvin/tw_doujin_event-data/pull/2)，data merge `65ae92f707381881d0817a577b5e87109e9bfc84`。
- System 建立並合併 [main PR #264](https://github.com/dekkmarsvin/tw_doujin_event/pull/264)，main merge `8d9eac3b1d62689e1409ba30d5eae0e23929bbfd`；兩張 publication PR 均非人工 merge。
- 固定 production [run 34922029842](https://github.com/dekkmarsvin/tw_doujin_event/actions/runs/34922029842)，attempt1，push/main；Verify and deploy、必要 Pages origin smoke 均成功。
- 原 immutable Pages deployment：`9fc184c5-2339-4cca-b00f-c2d7880a0e92`。
- 系統保存 manifest SHA-256：`f00f09320c9b3c850f17802a687a4e2ac92fe31ea6505967453eb149f608b750`。獨立唯讀核對同一 main/data SHA、全部8份 JSON bytes、Reader200、匿名 session401與前後manifest一致；公開後才取得完成證據。
- Worker `9a22e2e4-61fc-42ff-8def-45deca6153ff` 的真實 scheduled invocation 記錄原 job `advanced`，outcome=ok，無 exception。該輪未開 Organizer、未直接呼叫 executor。

## 真實失敗與同 job 恢復

1. **必要 checks 真實失敗**：#264 首次 CI `34920517765` 的 driver 測試寫死只有 FF47，加入 CH20 後失敗。Job 留在 `waiting_main_checks / publication_check_failed`。由 [#265](https://github.com/dekkmarsvin/tw_doujin_event/pull/265) 修正測試；未降低 required checks。原 App PR head/body/作者不變。
2. 人工 close/reopen 兩組觸發原 PR CI。第一次 `34921360072` 實際 checkout仍是舊merge ref，不算修正驗證；第二次 [34921601863](https://github.com/dekkmarsvin/tw_doujin_event/actions/runs/34921601863) 實際checkout `ec6627e`，同 head latest required checks 全成功。02:38:55.445Z **UI retry** 原 job，System 隨後合併並部署，未重做 data／PR。
3. **Origin runtime 真實失敗**：原 job 在 `verifying_production / production_smoke_failed` 停止。02:46:29.544Z 一次 UI retry 仍失败；停止重試後以真實 workerd 定位 `redirect:error` 不被支援。Node smoke 成功不等於 Worker verifier 成功。
4. [#266](https://github.com/dekkmarsvin/tw_doujin_event/pull/266) 改用 `manual`＋原精確狀態檢查，Pages github 核准／retry 僅 durable enqueue。主要 Review Done；最終head `1155040` 的 [required CI 34923605612](https://github.com/dekkmarsvin/tw_doujin_event/actions/runs/34923605612) 全通過。合併為 `22daf8fb949091dc66d2f77a36fffd3c2eef1aa5`，其[正式部署34923967485](https://github.com/dekkmarsvin/tw_doujin_event/actions/runs/34923967485)與smoke通過。
5. 為保留原固定SHA，按已審查操作包短暫部署既有mode=disabled的Worker `57d0f9f1-0ef0-4bee-9cf9-3b912ca18712`；確認真實cron已由該版本接管、無在途工作／live lease，保留原trigger與其他設定。
6. 03:15:08.427Z **UI retry**，原 job留queued，14個核准／PR／SHA／workflow欄位逐一比對未變。Pages切回原`9fc184c5` deployment，重新驗證原manifest與全部bytes；恢復修正Worker的github mode，cron於03:16:39.104Z完成。queued僅91.275秒，沒有延長15分鐘timeout、手改D1或更換checkpoint。
7. Published後，Pages切回已成功的修正版`dbe965d6-964a-400b-8c74-42989822a892`（main22daf8f），manifest hash=`5910ec1d62dd6da496205caf0193ce6e98f288f0b8fdece9d2a6b5df06cf1752`。所有event pins／8份bytes與原發布一致。Worker最終github、每分鐘cron、原production D1、URL disabled與logs設定保留。

本次有三次真實 UI retry（checks一次、origin兩次）；沒有第二份邏輯 publication、未重試舊v10 job、沒有假driver的production完成紀錄。此證據符合#212「至少一次真實可恢復publication failure」；不宣稱真實deployment rerun或外部同一webhook重送已驗。

## 人工操作與完成邊界

一次性基建：沿用既有GitHub App／installation／secrets；啟用Pages與獨立Worker、正確DB與每分鐘cron，#259／#263保留設定。正常每場活動不需要新增repository、PAT、secret或Worker。

核准v15到published的事故補救如實記錄：

| 操作 | 數量／原因 |
| --- | --- |
| Production runtime code修正 | 1張PR（#266，4個程式檔）；另1張測試修正PR #265 |
| 人工業務JSON／YAML或D1修改 | 0；資料與地圖均由UI及System產檔 |
| Organizer Git操作 | 0；authoring均經UI |
| Maintainer人工merge | 2張工程PR（#265、#266）；publication data/main PR人工merge為0 |
| CLI發布／恢復寫入 | 6次：原PR close/reopen各2次、Worker部署2次；工程Git／PR操作及唯讀驗證另有非零次數，不把它們算成0 |
| AI agent工程介入 | 有，本任務處理上述2張工程PR與恢復；不宣稱無需工程介入的完整觀測旅程 |
| 額外人工deployment操作 | Worker暫停／恢復2次＋Pages immutable版本切換2次；工程main push另自動觸發2次部署 |
| UI retry | 3次，非第二個Publish動作 |
| 新活動repository／PAT／secret | 均0 |

交付後正常新增路徑是UI核准→durable job→Worker→GitHub→Pages→origin verifier，沒有新增日常手動部署步驟。但本場的零人工補救統計未通過，所以#212的非零維運指標保持未勾選；不能只憑PR合併把它們改為0。

**本次首次發布與可恢復失敗驗收通過；不代表#104或#212所有指標結案。** #104保持開啟，發布後更正／amendment保留#190，未自動展開。#246真實cron與webhook接收已觀測，同一外部delivery真實重送未完成，保留既有票；不因它開啟而擴大首次發布goal。

Reader非阻擋觀察留#104：[placement被標為社團、全部類別重複計數](https://github.com/dekkmarsvin/tw_doujin_event/issues/104#issuecomment-5674076486)、[平移後工具列命中區](https://github.com/dekkmarsvin/tw_doujin_event/issues/104#issuecomment-5674202564)。後者可用「查看全場」再點選或鍵盤操作；資料／地圖完整性未受影響。本輪不處理全部backlog。

## 證據索引

- UI前置：[檢查／預覽](assets/ch20-first-publication-2026-09-15/check-preview.png)、[地圖下段](assets/ch20-first-publication-2026-09-15/preview-map-bottom.png)、[送審](assets/ch20-first-publication-2026-09-15/submitted.png)、[匯入／地圖比對](assets/ch20-first-publication-2026-09-15/map-import-check.json)、[snapshot比對](assets/ch20-first-publication-2026-09-15/submitted-snapshot-check.json)。
- 完成：[Organizer已發布](assets/ch20-first-publication-2026-09-15/published.png)、[原job／retry audit／cron證據](assets/ch20-first-publication-2026-09-15/publication-recovery.json)、[固定origin proof](assets/ch20-first-publication-2026-09-15/published-origin-proof.json)、[全量公開內容比對](assets/ch20-first-publication-2026-09-15/published-content-proof.json)、[恢復修正版後proof](assets/ch20-first-publication-2026-09-15/runtime-restored-proof.json)。
- Reader：[A01](assets/ch20-first-publication-2026-09-15/reader-a01.png)、[A02](assets/ch20-first-publication-2026-09-15/reader-a02.png)、[G30](assets/ch20-first-publication-2026-09-15/reader-g30.png)、[202個map labels全量比對](assets/ch20-first-publication-2026-09-15/reader-label-proof.json)。
- FF47：[發布前四檔基準](assets/ch20-first-publication-2026-09-15/ff47-before.json)、[最終Reader](assets/ch20-first-publication-2026-09-15/ff47-after.png)；四檔不變的逐一hash在固定origin proof內。
