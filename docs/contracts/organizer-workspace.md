# 主辦單位工作區契約

## 工作區頂欄

頂欄使用與社團資料、網站管理相同的工作區切換及頭像面板。活動選單來自此帳號的工作區；切換保留原本的未儲存提醒。所選版本決定面板的主辦待辦；尚未公開的活動也可回到自己的編輯頁。草稿、名單、地圖、匯入及公告的編輯狀態同步顯示於頂欄。


> **角色（#546 階段 5b）**：Owner／Editor 已合併為單一「活動成員」，資料庫仍以 `owner` 保存。每位成員都能編輯、送審、管理成員、撤銷認領與開始修正；網站管理者負責核准並發布。

**實作**：`app/organizer-status-summary.ts`、`app/organizer/organizer-workspace-header.tsx`、`app/organizer/use-organizer-pending-claims.ts`、`app/organizer/organizer-takedown-panel.tsx`

主辦單位在獨立入口 `/organizer` 建立候選活動、匯入攤位資料、畫地圖、驗證、預覽並送審。它產生的是**候選內容**，不是公開資料：公開資料只來自核准後寫入活動資料 bucket 的版本。

**實作**：[`app/organizer-event-groups.ts`](../../app/organizer-event-groups.ts)、[`app/admin-reference-edit.ts`](../../app/admin-reference-edit.ts)、[`app/organizer/`](../../app/organizer)、[`app/organizer-client.ts`](../../app/organizer-client.ts)、[`app/organizer-event.ts`](../../app/organizer-event.ts)、[`app/event-aliases.ts`](../../app/event-aliases.ts)、[`app/event-image.ts`](../../app/event-image.ts)、[`app/organizer-workspace.ts`](../../app/organizer-workspace.ts)、[`app/organizer-import.ts`](../../app/organizer-import.ts)、[`app/organizer-circle-groups.mjs`](../../app/organizer-circle-groups.mjs)、[`app/organizer-workbook.ts`](../../app/organizer-workbook.ts)、[`app/organizer-publication.ts`](../../app/organizer-publication.ts)、[`app/event-authoring-scope.ts`](../../app/event-authoring-scope.ts)、[`app/publication-bundle-assembler.ts`](../../app/publication-bundle-assembler.ts)、[`db/identity-repository.ts`](../../db/identity-repository.ts)、[`server/organizer.ts`](../../server/organizer.ts)、[`server/organizer-content.ts`](../../server/organizer-content.ts)、[`server/organizer-publication.ts`](../../server/organizer-publication.ts)、[`app/organizer-amendment.mjs`](../../app/organizer-amendment.mjs)、[`app/organizer-amendment-baseline.ts`](../../app/organizer-amendment-baseline.ts)、[`app/organizer-baseline-adoption.ts`](../../app/organizer-baseline-adoption.ts)、[`app/organizer-amendment-settings.ts`](../../app/organizer-amendment-settings.ts)、[`app/publication-artifacts.ts`](../../app/publication-artifacts.ts)、[`db/organizer-amendment-repository.ts`](../../db/organizer-amendment-repository.ts)、[`db/organizer-application-repository.ts`](../../db/organizer-application-repository.ts)
**測試**：`tests/organizer-event-groups.test.mjs`、`tests/api-organizer.test.mjs`、`tests/organizer-workspace.test.mjs`、`tests/event-image.test.mjs`、`tests/organizer-repository.test.mjs`、`tests/organizer-entry.test.mjs`、`tests/browser/catalog-browse.mjs`、`tests/organizer-import.test.mjs`、`tests/organizer-circle-groups.test.mjs`、`tests/event-authoring-scope.test.mjs`、`tests/publication-bundle.test.mjs`、`tests/multi-space-event-map.test.mjs`、`tests/organizer-amendment.test.mjs`、`tests/organizer-amendment-repository.test.mjs`、`tests/publication-artifacts.test.mjs`、`tests/publication-amendment-artifacts.test.mjs`、`tests/organizer-event-aliases.test.mjs`、`tests/organizer-amendment-settings.test.mjs`
**決策**：[ADR-0047](../adr/0047-organizer-onboarding-opens-into-a-resumable-workspace.md)、[ADR-0046](../adr/0046-approved-organizer-publications-may-merge-app-owned-pull-requests.md)、[ADR-0058](../adr/0058-publication-is-enforced-by-the-app-not-the-ruleset.md)、[ADR-0038](../adr/0038-authoring-moves-to-the-control-surface-local-stays-as-backup.md)、[ADR-0039](../adr/0039-one-data-repo-for-events-and-references.md)、[ADR-0044](../adr/0044-an-accepted-circle-list-is-not-yet-catalogable.md)、[ADR-0068](../adr/0068-published-event-settings-are-declared-amendments.md)、[ADR-0070](../adr/0070-event-images-are-published-by-approval-under-their-hash.md)

首次發布與發布後更正均已接上 Web UI 與自動發布。真實執行證據見 [CH20 首次發布／恢復](https://github.com/dekkmarsvin/tw_doujin_event/issues/212)及[地圖更正](https://github.com/dekkmarsvin/tw_doujin_event/issues/190)，其中記錄的人工補救不因功能已上線而抹除。部署模式與缺少 dispatcher 時的處置見[發布邊界](#發布邊界)。

## 入口與登入

- 入口是 `/organizer`，`noindex, nofollow`，**不與 `/circle` 或閱讀端共用 bundle**。閱讀頁「我的」依權限連到本工作區。未登入的公開頁首「登入」帶到 `/circle`，工作區頂欄依 session 顯示可用入口（見[社團契約的入口分離](./circle-portal.md#入口分離)）。這個入口不受新活動申請開關影響。
- 登入沿用[社團自助控制面](./circle-portal.md)的 email 一次性連結與統一 7 天 session cookie；`POST /api/auth/request-link` 以 `audience: "organizer"` 決定信件與登入連結指向 `/organizer`。Turnstile、速率上限與 session 規則只寫在該契約，本文不重複。
- **帳號本身沒有 Organizer 權限。** 能看到工作區的條件是持有任一候選活動的 grant，或是全域管理者。
- 申請人可在同一 `/organizer` 登入查看自己的申請；送件或待審核不授予候選活動 grant。申請表與結果可在手機使用，管理者即使沒有本人申請或申請資格也可進入申請審核；活動資料與地圖編輯仍限桌機。
- **已登入但無事可做不是登出。** session 有效，但帳號不是管理者、沒有 grant、不能申請也沒有申請紀錄時，保留 session，說明此帳號沒有主辦工作區權限及目前未開放新活動申請，並提供「返回社團資料」與「返回活動列表」，不回到登入表單。主辦邀請只在以主辦登入連結登入時接受，因此同一畫面可應要求寄送主辦登入連結：收件者固定為目前帳號、`audience: "organizer"`，真人驗證在按下後才載入。只有 session 失效（401）才回到登入表單。
- 工作區是桌機介面。視窗過窄時顯示「請改用桌機」，不提供縮小版的地圖編輯。
- 左側活動列表可以收合，收合後把寬度讓給工作區。收合狀態不保存，重新登入回到展開。
- 活動列表依 `eventId` 分組並可逐活動摺疊；尚未指定活動代碼的候選各自一組，不按名稱合併。同一活動的初次建置與每次發布後修正候選，以建立時間及候選 ID 的固定順序編為「第 X 版」，不使用逐次儲存的 `current_version`。編號以資料庫中該活動的候選計算，授權清單只回傳本人可達的候選，因此只獲授權新版者的編號不會重新從 1 開始。
- 一般進入及恢復上次活動時預設選該活動本人可達的最新版；明確 `candidate` 連結仍開指定候選。左側活動展開區的版本選單可切換初版與修正版，版本切換沿用未儲存變更保護及各候選原有的編輯／發布鎖定。保存舊候選的新修改不會把它變成最新版。
- 上次開啟的候選依同源、同瀏覽器、同帳號保存於 localStorage；讀寫被封鎖時仍可在記憶體中操作，登入後仍以伺服器授權清單確認可達性，各成員的區段仍由 D1 保存。
- `candidate=<候選>&section=members` 直接開指定候選的既有成員面板，優先於上次的內容頁偏好。未登入或 session 到期時以既有 Organizer 登入流程保留這組固定目的地；沒有候選或無權限時不改開別場。窄螢幕保留目的地並沿用桌機限制；成員操作仍由原有元件與候選授權負責。
- 活動功能導覽只出現在左側展開區，不在右側重複顯示。右側頂部集中活動名稱、身分、審核與發布狀態；審核已通過不等於發布已完成，發布失敗仍顯示已核准與發布失敗兩個結果。「成員與權限」開啟目前版本的協作者與負責人管理；審核與發布狀態開啟「檢查與發布」，社團認領狀態開啟「社團管理」，切換都沿用未儲存變更保護。成員管理不是準備區段，不計入準備進度。
- 網站管理者在頁首顯示「管理」連結，進入 `/admin`；非管理者不顯示。

## 活動內社團認領審核

活動資料與「社團管理」是獨立工作面板；社團管理依序放社團認領審核、撤銷已通過的認領（Owner）與撤下補充資料，開頭一行說明社團名單和攤位的增刪改屬於活動資料，在「活動資料」匯入，活動已發布後由負責人建立修正版。社團管理不算入五區活動建置進度。只有活動已在目前部署的公開清單中，工作區才顯示社團處置與活動公告入口。它們處理的是該活動目前的認領與補充資料，不是所選候選的歷史快照。

右側頂部顯示此活動的社團認領待審筆數；初版及修正版共用目前待審清單，不統計社團數或歷史裁決。總數在清單 500 筆上限之前計算，超出上限不會少算。核准、婉拒及清單重新整理後同步更新；其他面板在可見時每 30 秒與返回視窗時更新。未能讀取不顯示為零，切換活動不沿用另一活動的筆數。

`GET／POST /api/organizer/events/:candidateId/claims` 要求有效 session 與該候選的有效成員 grant，或網站管理者身分。候選須有已發布版次記錄，或為伺服器從同一活動已發布來源建立的修正版；一般 CREATE 草稿即使填入已公開活動 ID，也不取得審核權限。活動由伺服器讀取這項可信關聯的 `event_id` 決定；不接受由 body 或 query 改寫活動範圍。沒有候選授權、可信關聯、活動未公開或認領屬於另一活動時回 404。列表只回此活動的待審認領與佐證，不回跨活動管理總覽或其他帳號 email。

面板共用 `/admin` 的單筆／批次核准及婉拒、佐證、重複申請提示與重新整理。成員可核准或婉拒 `pending` 認領，也可撤銷已通過的認領。成員在同一面板以社團名稱搜尋此活動的公開社團，已通過認領的社團附撤銷，確認後沿用唯一擁有者約束與公開文件重建；搜尋結果只多帶已通過認領的 ID，不回帳號個資。任何組合都不取得其他全域管理權限。每筆裁決沿用唯一擁有者約束、狀態 CAS 及帳號通知，SQL 寫入時再次核對 actor 有效、候選可信關聯與認領活動相同，以及 grant／管理者身分仍有效；撤權競態不改寫認領。主辦裁決的 method 為 `organizer`，audit action 為 `claim.organizer_approve／reject／revoke`，保留 actorRole、candidateId、eventId 與結果。

### 活動內撤下社團補充資料

`GET／POST /api/organizer/events/:candidateId/overrides` 沿用相同有效 session、成員 grant／管理者、可信候選關聯及已公開活動條件，範圍由候選 `event_id` 決定。GET 依社團名稱搜尋此活動的公開社團清單，回傳社團名稱、ID 與補充資料狀態，不回內容或帳號個資。POST 要求社團 ID 與撤下原因，並核對社團屬於此活動。

主辦與 `/admin` 共用搜尋、選取、原因及確認面板。確認時說明補充資料停止公開、已上傳圖片刪除，活動攤位與認領保留。D1 更新在寫入時再次核對有效授權與活動，並比較所讀取的內容及更新時間；衝突或撤權不修改資料、不刪 R2。更新成功後依該活動日期重建公開投影，清除所屬活動／社團的 R2 圖片；不重新公開活動後隱藏的其他社團。

R2 清除暫時失敗時，資料維持撤下，搜尋顯示圖片待清除並允許再次處置；重試再次核對授權，不覆寫原撤下原因與 actor，不重複通知社團。已完成清理的重複撤下回 404。主辦稽核 action 為 `override.organizer_takendown`，保留 actorRole、candidateId、eventId、原因及 applied／retryCleanup；管理者沿用 `override.takendown`。

### 活動公告

「活動公告」與社團管理並列，出現條件相同（活動已在目前部署的公開清單中），不算入活動建置進度。每個活動同一時間只有一則公告：類型「一般」或「重要」、說明（純文字，200 字以內）與選填的 https 連結。儲存就是發布，不經網站管理者審核、不另設確認；清除後讀者端不再顯示。不保留歷史版本。主辦表單沿用工作區的桌機寬度限制，沒有手機發布入口。

`GET／PUT／DELETE /api/organizer/events/:candidateId/notice` 沿用上方 `/overrides` 的有效 session、成員 grant／管理者、可信候選關聯及已公開活動條件，活動範圍由候選 `event_id` 決定，不接受 body 或 query 改寫。PUT 驗證失敗回 400 並說明是哪個欄位。寫入或清除後重建該活動的公開 overlay，`notice` 隨 `/data/events/:eventId/overrides.json` 送出；所有重建入口（社團更新、撤下、認領裁決與活動階段切換）都讀取目前公告。重建的 revision 以原子遞增寫入，不同公開內容不共用同一 revision 與 strong ETag，較舊的重建不覆蓋已完成的公告更新／清除。稽核 action 為 `event_notice.published`／`event_notice.cleared`，保留 actorRole、candidateId 與 eventId。

讀者端在地圖、逛品書頂端及社團介紹頁名稱上方顯示公告：重要公告使用警示色，只顯示主辦的說明與連結，不加站方提醒或免責文字。更新時機見[交付與離線](./reader.md#更新可見性)。活動選擇頁不載入 overlay，不顯示公告。

## 活動申請

主辦、獲授權人員及提供官方來源的資料整理者沿用 Organizer magic-link 登入。`POST /api/organizer/applications` 收活動名稱、官方 HTTPS 網址、預計開始／結束日期、選填地點、與活動關係及說明；資料整理者須填整理理由。不收另一份聯絡資料，不接受既有 eventId／candidateId 或角色授權欄位。

`GET /api/organizer/applications` 只回傳自己的申請；全域管理者在原工作區「活動申請」查看全部申請、登入帳號及官方來源。私人內容不進 Reader 或匿名 API。拒絕必須填理由，申請人可回此頁更新狀態。送件使用 client UUID，重試同一內容只留一筆，不能以相同 UUID 覆寫或讀取別人的申請。

管理者以 `POST /api/admin/organizer/applications/:id` 核准／拒絕。核准在同一 D1 batch 轉換 pending 狀態、建立新 CREATE 候選、初始 revision／workspace、已接受的邀請及 Owner grant；以唯一 review token 保護所有相依寫入，交易內重查申請者、管理者及 session。重複／併行同決策回原結果，相反決策回 409，不會重新授予已撤銷的 grant。拒絕不建候選。既有活動請由管理者拒絕重複申請並按原協作者流程處理，不因名稱或來源相同而授權原活動。

新候選沿用申請名稱與官方來源，預計日期／地點留在申請供確認；真正活動日與場地由既有引導填寫。核准申請僅准許建置，不建立「官方認證」標示；內容送審、核准 snapshot、publication job、恢復與 production smoke 全沿用既有路徑。

申請資格由共用 D1 的 `organizer_application_mode` 控制：`closed`、`invite_only`、`public`；Session、申請清單與送件均讀取當次設定。首頁沿用既有登入入口，不新增申請按鈕，也不為開關呼叫 Reader Function。維護者於 `/admin?section=settings` 手動開放；既有邀請、grant 與申請查詢不受關閉開關影響。詳見[網站營運設定](./admin.md#網站營運設定)及[部署 runbook](../runbooks/deployment.md#網站營運設定遷移477)。

申請與決策不設新的 TTL／排程；帳號刪除時刪除 pending 申請，已審核申請保留去識別的決策與候選連結，清空申請自由內容與理由。帳號／審核者去識別化沿用既有刪除交易；正式活動內容及 sole-owner 刪除保護不變。

## 引導式任務站與活動建置冊

開啟活動時才恢復該協作者上次的項目與引導步驟；儲存後重讀活動只更新資料與狀態。較晚到達的儲存回應不得將已切換的項目跳回原處，也不關閉使用者正在查看的全部項目。

- 新候選活動先進入三項真實資料任務：活動識別與官方來源、活動日期、場館與場地。任務進度直接篩選 `validateOrganizerEventDraft()` 的 issue，不另有一套 Wizard 驗證。
- **引導期只有一套進度，而且只算已儲存的。**「已完成 N/3」讀已保存草稿，不讀畫面上的輸入：打字打對不是一個完成的步驟，而步驟列上那一行已經寫著「尚未儲存」。引導期不顯示五區的準備進度——它講的是還沒走到的工作，N/5 與眼前的 N/3 是兩套互相矛盾的說法。
- **完成 onboarding 後只有一份主要導覽。** 準備進度側欄承擔五區的切換、各區狀態、下一步與待修正清單；面板上方不再另有一條編號步驟列，那份複本只能靠手工維持同步。側欄的區段清單以 `活動項目` 具名，目前開啟的區段以 `aria-current` 與左側標記標出；目前區段就是建議下一步時不顯示「下一步」按鈕，那顆按鈕只會把讀者送到旁邊已經開著的面板。
- **填寫前可辨認要求。** 活動名稱、活動代碼、官方公告網址、活動日期（含展開後的名稱與代碼）、場館及場地標明「必填」；主辦單位與含至少一個分類的分類目錄標「送審前必填」，不新增 onboarding 門檻。別稱、來源名稱與活動圖片維持選填。建立主辦、分類目錄或場館／場地時也在欄位旁標示必要資料，場地網址仍可留空沿用場館網址。
- **待修正項目能回到欄位。** 活動及場館欄位問題在待修正清單、表單問題清單與檢查卡可點選定位；到達後展開所需的活動日詳細設定、捲動、聚焦並高亮。首次進入不顯示整份紅字，欄位離焦、嘗試儲存或點選問題後顯示適用的欄位錯誤；引導任務的「儲存並繼續」只標出該任務檢查的欄位，送審前必填欄位不因此變紅。修正後即時更新。同頁定位保留未儲存輸入，跨頁定位沿用儲存／放棄／取消。填寫中的準備進度也檢查目前選取的主辦及分類目錄，包含剛建立的目錄。
- **任務第一次打開時是中性的。** 整份任務問題清單是儲存的回答，等按下去再出現；唯一例外是它同時也是儲存鍵被停用的理由——停用不能沒有理由。「儲存並繼續」檢查它所站的那一個任務，未完成就保留輸入、說出缺什麼、不前進；「儲存並離開」與離開對話框不帶這個檢查，半成品草稿是可以存下來回頭再做的東西。
- 動作回饋遵循 [Action Feedback](../design/components.md#action-feedback)：切換引導任務不沿用前一任務的驗證或儲存訊息；建置冊儲存活動、場館或匯入後，重新取得已存版本仍保留當次成功回饋，再編輯或發動下一動作才清除。已存草稿的正規化值同步回未修改的表單；有未儲存輸入時，不因重新整理而更新它的 `expectedVersion`。首次載入先核對記住的活動是否仍在可見清單；切換活動的讀取 effect 卸載後不再套用其回應。
- 活動、場館與匯入表單在儲存及其重新讀取期間停用編輯，避免成功回饋對不上提交內容；重新讀取失敗不降低已成功儲存的版本，仍可再儲存。
- **匯入範例不會因為選了檔案而消失。** 選檔前展開、選檔後收合；下載分成空白 CSV（拿去填）與填寫範例（拿去讀）兩種，兩者都由 `buildOrganizerImportSample()` 依這場活動的活動日、場地與是否需要展區產生。範例含同一社團同一天的兩個攤位寫在同一格：同名同日但沒有主辦內部編號的兩列會成為兩個社團。預覽本身就是確認步驟，所以取代語意寫在「確認並儲存」旁，不另外開對話框。
- 三項基礎設定通過後，`POST /api/organizer/events/:candidateId/workspace/complete-onboarding` 以 `expectedVersion` 再次檢查已保存草稿，成功後永久進入活動建置冊。成功回應遺失後可用任何舊版本重送，仍會冪等回傳既有 binder 狀態；後續資料錯誤只顯示為需要處理，不會退回引導。
- **完成基本設定後開在下一步，不開在剛填完的表單。** 完成鍵隨引導站卸載，它的結果沒有地方可放，所以建置冊直接開在重新讀取後的建議下一步（新活動一定是攤位匯入），並把它存成上次的建置冊區段，下次登入也從這裡開始。那個區段的面板上方出現一次「基本設定完成」，說明接下來做什麼、其餘項目改由右側準備進度進入，焦點也移到這一行；讀者切換區段或在面板裡發動任何操作後即消失，不放在整個工作區頂端。完成失敗時沿用表單在儲存鍵旁的「已儲存，但後續動作未完成」。
- 「查看全部項目」不完成 onboarding；它只暫時打開五個區段。每位協作者的上次引導任務與建置冊區段由 `PATCH …/workspace` 分別保存，跨登入恢復且不互相覆蓋。
- workspace 偏好與 onboarding 狀態不屬於候選內容：更新它們不增加 `current_version`，也不建立活動 revision。ADR-0047 上線前已存在、沒有 workspace state 的候選一律從建置冊開啟。
- 表單或地圖有未儲存變更時，切換活動、引導任務或建置冊區段（含準備進度項目與「下一步」、「查看全部項目」／「回到基本設定」）會提供「儲存並切換／放棄／取消」；取消保留目前內容，沒有未儲存變更時直接切換。重新整理或關閉瀏覽器頁面則使用瀏覽器既有的未儲存變更確認。對話框沿用全站 shared modal focus lifecycle。Revision 一旦儲存成功，畫面會先同步新版本再執行引導或離開動作；後續動作失敗不會讓下一次儲存沿用舊版本。「儲存並離開」後保持未選取活動，不會因清單刷新自動重開第一筆。
- 建置冊直接開放活動、場館與場地、攤位匯入、地圖、檢查與發布五區。檢查與發布在同一面板依序提供檢查、預覽、送審、審閱與發布結果；草稿或要求修改狀態下，每次進入該區會自動執行一次檢查，不需先按「執行檢查」。先前保存為 `validate` 的區段偏好以 `review` 恢復。Readiness 顯示完成區段數、具名阻擋項與建議下一步，不顯示百分比；檢查與發布只在 published 完成，其列依階段顯示「檢查通過」（目前版本已通過檢查；能否送審仍由角色與發布啟用決定，由面板說明）、「審閱中」或「等待發布」，讓通過檢查在側欄可見；`blocked` 只代表缺少技術前置資料，區段本身仍可開啟查看。活動或場館表單有未儲存變更時，Readiness 以目前表單內容即時顯示「尚未儲存」，不沿用上一版結果。
- 五區共用 [`app/organizer-workspace.ts`](../../app/organizer-workspace.ts) 的 prerequisite evaluator。活動與場館來自草稿 validation；匯入要求至少一列且沒有 import error；地圖要求匯入已完成、完整 day × venue-space coverage，且每份已保存地圖必須通過與正式 validation 相同的攤位覆蓋、未知攤位、重疊與幾何規則（未知攤位在候選活動是 warning，不擋住地圖區；理由見下方[地圖](#地圖)）；驗證只在沒有 error 且 `last_validated_version` 等於目前 candidate version 時完成，未完成時以 `validation_required` 阻擋項列在檢查與發布；只有 published 才把檢查與發布區段標為完成。

## 管理者建立與邀請

- **全域管理者**可直接以 `POST /api/admin/organizer/events` 建立候選活動，必須提供暫定名稱與 Owner email，並要求有效 session。另一條建立路徑是核准[活動申請](#活動申請)；申請人不能自行建立候選或授予 grant。
- 建立成功即寄出主辦工作區邀請信；受邀者以該連結登入後自動接受待處理邀請並取得 grant。信件由 `app/mail-letter.ts` 產生，同時寄出 HTML 與純文字；連結過期時，信中指示受邀者到 `/organizer` 用同一信箱重新索取登入連結，任何 `organizer` 登入都會接受該信箱的待處理邀請。
- 首次邀請與重寄的 HTML／純文字均列出寄送當下的活動暫定名稱，以及此次邀請操作的角色：建立活動、管理者邀請負責人，或沒有該活動 Owner grant 的管理者邀請協作者為「網站管理者」；一般 Owner 邀請負責人、任何 Owner 邀請協作者為「活動負責人」。邀請者 Email 不寫入信件內容，名稱與角色由伺服器取得。
- **管理者把自己填成負責人時，owner grant 在建立活動的同一個 transaction 內直接成立**，該筆邀請同時標記為建立時即接受，不必先收信。管理者具有指派 Owner 的權限，繞一圈收信不增加任何保證。稽核寫的是 `organizer_event.owner_granted_on_create`，與接受邀請分開。信照常寄出（那是一條可用的登入連結），寄信預算與寄送失敗的處理都不變；負責人填別人時行為完全不變，仍由對方收信登入後取得 grant。送審與核准的 有效 session 要求不因此放寬。
- 該候選的成員與全域管理者（不需持有該活動的 grant，見 [ADR-0080](../adr/0080-site-admins-submit-and-manage-collaborators-without-an-owner-grant.md)）可邀請、重寄或撤銷同一候選活動的成員；其他候選活動的成員無此權限。成員管理在資料庫寫入時重查有效帳號及該候選的成員 grant／目前管理者名冊，撤權後不能沿用先前讀取的授權。撤銷對尚未登入者同樣有效——撤掉 grant 或撤掉尚未接受的邀請，任一成立即算成功。撤銷已接受的成員時必須仍有另一位有效成員，待接受邀請不算；此條件由同一 SQL 寫入保護，並行移除也不能清空成員。另有成員時可移除自己，工作區重新載入可存取的活動清單。
- 寄信失敗保留已建立的活動與邀請；回傳 `invitationSent: false` 及 `invitationDelivery`（`failed` 為明確拒絕，`unknown` 為逾時或無法確認），清除本次寄信建立的登入權杖並寫入 `organizer_event.invitation_failed`。邀請建立的稽核先於寄信，不會因寄信失敗遺失。成功受理回 `sent`，不代表已送達。
- 協作者／負責人表單可用「重寄邀請信」對既有 Email 重寄，包含重新開啟工作區後；`POST …/collaborators` 的 `resend` 只接受同一候選、信箱與角色下尚未接受且未撤銷的邀請，沿用邀請的權限。重寄不新增邀請、grant 或候選版本，成功另留 `organizer_event.editor_resend`／`owner_resend` 稽核。已具該角色不再新增邀請，另一角色的待接受邀請不會被重寄或覆寫。
- 舊的 Editor 待接受邀請視為成員邀請，可重寄或撤回；接受任何邀請都成為成員。已撤銷的成員可再次接受新的邀請。
- 邀請會鑄造真正的登入連結，因此受三道獨立預算限制：每小時每收件匣 3 封**他人寄來的**邀請、每小時每邀請人 10 封，另沿用每 IP 每小時 20 封登入連結的上限。收件匣預算刻意不與本人自助索取的登入連結共用計數器，否則邀請人可以花光對方的額度把人鎖在帳號外。
- 首次寄送與重寄均以登入權杖計數，邀請人依 `minted_by` 及建立時間計算，不能重用舊邀請繞過額度。preview 不允許的收件地址在新增邀請或寄信前拒絕，既有邀請不受影響。

## 候選活動的狀態

```text
draft → submitted → approved → published
          ↓
   changes_requested
```

核准並發布在同一個請求內完成：先把送審版本標為 `approved`，寫入活動資料後再改為 published。`approved` 期間不能要求修改，發布暫時失敗或請求中斷時停在這裡，再次核准即重試。`publishing`、`failed` 只出現在舊流程留下的紀錄。修正候選另有 `abandoned`（已終止，公開內容不變）。

- `draft` 與 `changes_requested` 可編輯；其餘狀態一律不可寫入。
- 每一次寫入都要帶 `expectedVersion`，成功後 `current_version` 遞增並留下一筆 immutable revision。版本落後回 409 並指出目前版本，不靜默覆寫。
- `eventId` 在 CREATE 的**首次送審時鎖定**，之後不得改成別的值；未送審前可以修改。它在 CREATE 候選之間唯一（partial unique index）；明確 AMEND 候選沿用來源 eventId 並在建立時鎖定，同事件最多一份尚未 published 的 AMEND。首次發布仍以 `event_id_collision` 拒絕同名 published event，不 silent overwrite 或自動轉換。兩條地圖管線仍靠 `candidate_id` 分離。

## 草稿內容

`organizer-event-draft/1`，欄位與驗證規則以 [`app/organizer-event.ts`](../../app/organizer-event.ts) 為準：

| 區塊 | 內容 | 規則 |
|---|---|---|
| `event` | `id`、`name`、選填 `aliases[]`、選填 `image`、`days[]` | `id` 只允許小寫英數與連字號；每個活動日需要 id、名稱與 `YYYY-MM-DD` 日期，id 不得重複。活動別稱最多 5 個、每個不超過 40 字，不得與活動名稱或彼此重複（NFKC 後不分大小寫）；空白列在儲存時略去，沒有別稱時不保存這個欄位（[ADR-0068](../adr/0068-published-event-settings-are-declared-amendments.md)）。`image` 見下方「活動圖片」，沒有時不保存這個欄位 |
| `venue.assignments` | `venueId`、`venueSpaceId`、`areaMode`、`areaIds[]`、`mapTemplate` | 至少一個場地；`venueSpaceId` 不得重複且必須屬於所選場館；`areaMode` 為 `imported` 或 `none`；`none` 必須且只能保存 `areaIds: ["ALL"]` |
| `officialSource` | `label`、`url` | HTTPS 網址必填；`label` 選填，留空時以「活動官方來源」發布（`NOTICE` 與匯入的來源說明），與核准申請時預填的名稱相同 |

### 活動圖片

選填（[ADR-0070](../adr/0070-event-images-are-published-by-approval-under-their-hash.md)）。`event.image` 為 `{ url, sha256, contentType, width, height }`，`url` 必須等於公開 bucket 的 `event-images/<sha256>.<ext>`，由 `app/event-image.ts` 檢查。

- `PUT /api/organizer/events/:candidateId/image`（multipart：`file`）由可編輯候選的成員／Admin 上傳；只在 `draft`、`changes_requested` 接受。JPEG、PNG 或 WebP，5 MiB 以內，寬度至少 1200 px，不限比例，結構檢查沿用配置圖。上傳不要求另行勾選權利聲明。上傳只寫入非公開 bucket 的 `organizer-event-images/<candidateId>/<sha256>.<ext>` 並回傳 `image`，**不修改草稿**；主辦儲存草稿（或修正宣告）後才生效。未綁定 bucket 時 503。
- 圖片與其他欄位共用表單的儲存狀態，不另顯示「已上傳／已移除，尚未儲存」。儲存成功而後續讀取失敗時，仍以已儲存呈現；上傳進度、格式限制與可處理的錯誤保留在圖片欄位。
- 修正影響以原圖與修正後圖片供主辦核對，不以尺寸代替圖片。原圖讀已發布網址；修正後圖片先讀此候選的非公開預覽，已有公開圖片時可回退至公開網址。新增或移除的一側顯示「無」。
- `GET /api/organizer/events/:candidateId/image?sha256=&contentType=` 供候選的成員／Admin 預覽暫存圖片，回應 `private, no-store`、`nosniff` 與 sandbox CSP；已公開的圖片直接讀公開網址。
- 儲存草稿或修正宣告時，若圖片與上次儲存不同，伺服器重新讀取暫存位元組並重新檢查，雜湊、類型與尺寸都必須相符，否則 422；相同時不讀 bucket。
- 送審成功後刪除此候選送審內容沒有使用的暫存。只在送審後清理：草稿可編輯時，協作者的儲存隨時可能指向任何一張暫存。清理失敗不影響送審。
- 核准時、寫入活動資料之前，把核准內容的圖片複製到公開 bucket 的 `event-images/<sha256>.<ext>`；已存在則略過。只有對「目前待審版本」的核准才複製；已退回修改或版本不符的過時核准不會公開圖片。暫存位元組缺少或不符時回 503 `event_image_unavailable`，候選狀態不變，可再次核准。

新增活動日時，第一日的日期留空；之後以最後一個有效日期加一天，若已有列但皆無有效日期才回退為作者當地的今天。新活動日的 id 取最小尚未使用的序號。這是可覆寫的預設值，不是驗證規則。

`venueId` 與 `venueSpaceId` 是系統保存的 stable ID，介面不要求主辦輸入。主辦先從共用場館目錄選擇場館，再從該場館的場地下拉選擇；找不到時可以立即建立新場館與第一個場地，或在既有場館立即新增場地。每筆目錄資料都要求官方 HTTPS 來源，但場地的來源網址可以留空——留空時沿用它所屬場館的網址，因為「全館」這類場地通常沒有自己的官方頁面，而主辦通常只有一條官方網址。格式錯誤的網址仍然退回；沿用是補齊，不是豁免。建立場館另要求地址：主辦貼上場館官方網頁上的完整地址，NFKC 正規化並合併空白後須為 1–200 字，空白或只有空格時退回「請填寫場館地址。」地址只寫入場館的公開 `venue/1` 記錄（`address`，出處指向同一官方來源），不另存於 `organizer_venues`；場地沒有地址。建立與 audit 在同一個 D1 transaction；新資料只是候選控制面的來源記錄，不會因此自動成為已發布的 reference 記錄。

場館表單直接列出已設定的活動日期（唯讀），場館與場地共用於所有活動日。尚無選擇時直接顯示第一組空白選擇器，不因此產生未儲存變更；選好後可「再選一個場地」。「建立新場館」只保留一個入口，建立後優先填入空白選擇列，沒有空白列才加入一列。

`areaIds` **不在場館表單手填**。`areaMode` 是每場活動自己的選擇，場館目錄的 `defaultAreaMode` 只提供新增 assignment 時的預設。`imported` 的展區是攤位名單事實，由匯入推導；`none` 代表這場活動在該場地沒有分區，匯入不用對應展區欄，系統固定保存 `ALL`。有匯入資料後，prerequisite 以 `missing_space_import` 指出未被檔案涵蓋的場地。

`mapTemplate` 的值域是 `listMapTemplateOptions()`，介面以下拉選單呈現並預覽這個選擇的後果（能否自動辨識配置圖、存檔時依什麼檢查）。草稿裡不在清單內的既有值會原樣保留為額外選項，不被靜默改寫。

## 已發布名單的明確修正宣告

`app/organizer-amendment.mjs` 的共用 planner 接受已發布的 event、official booths、grouping、allocations／evidence，以及 `changes[]`；不接受替換整份名單來推論退出。共用核心本身不讀寫候選或公開資料；候選與 API 的 baseline 邊界如下。修正表單、送審與核准已接上候選 API 及原 publication engine；CREATE 的碰撞保護不變。

每筆宣告必須明說 `kind`：

| kind | 宣告內容 | 身分及預覽結果 |
| --- | --- | --- |
| `withdrawn` | 同一社團的既有 `sources[]` | 只退出所選攤位，保留原 Circle ID。 |
| `released` | 同一社團的既有 `sources[]`、新 `circleName` | 所選攤位交給一個新社團，配置新 Circle ID；原社團及未選攤位保留。 |
| `moved` | 同一社團的 `moves[]`，每筆為 `source` 與 `to` | 明確移往另一攤位，包含跨日、展區及重編號，保留原 Circle ID。 |
| `added` | 新 `circleName` 與 `placements[]` | 明確新增一個社團，可含多日多攤；不因同名連結既有社團。 |

來源是 `<day>:<code>`；目的地及新增攤位是 `{dayId, code, areaId}`，活動日與展區必須已宣告。`reference` 為選填 HTTPS 來源。每次輸出 `impact[]`，逐筆列出種類、前後社團 ID／名稱、活動日／攤位／展區；UI 呈現社團與攤位的變動，不要求使用者讀寫 evidence。新 ID 是此 baseline 的規劃結果，正式配置仍須受 publication 的版本與資料檢查保護。

未知或重複來源、跨社團混選、換手仍為同一名稱、大小寫折疊後重複或原已佔用的目的地，以及未公開配號或缺列的 baseline 均拒絕。目的地不因同批另一筆退出而變可用；同攤換手必須用 `released`。沿用官方資料每個活動日至少一攤的限制。未選資料與其他活動 evidence 保留；空宣告清單為無變動預覽。

planner 產出既有 `circle-identity-groups/2`，只套用本次 transitions；baseline 的舊 transitions 已生效，不再重播。保留既有群組與 linkage；部分換手／移動造成群組跨列時，由明確宣告及其來源（未另填時用活動官方來源）產生 linkage。連續修正的退役證據與 Reader 投影依 [circle catalog 契約](./reader.md#社團目錄)。

### 活動設定更正宣告

修正候選除了 `changes[]`，另可保存選填的 `settings`：`{ name?, aliases?, days?: [{ id, date }], image? }`（[ADR-0068](../adr/0068-published-event-settings-are-declared-amendments.md)、[ADR-0070](../adr/0070-event-images-are-published-by-approval-under-their-hash.md)）。`app/organizer-amendment-settings.ts` 的純函式負責正規化、套用與影響，兩種宣告分開保存、分開比對。

- **允許清單**：活動名稱、活動別稱、既有活動日的日期、活動圖片。`image` 為新圖片即更換，`null` 即移除；新圖片沿用上方「活動圖片」的暫存與核准規則。其他鍵、新增或刪除活動日、重複的活動日代號，以及活動日除 `id`、`date` 以外的欄位，一律 422。
- 從固定 baseline 草稿正規化：名稱與別稱去頭尾空白，空白別稱略去；與 baseline 相同的值不保存，全部相同時不保存任何設定（`settings_json` 為 NULL）。`aliases: []` 表示移除全部別稱。套上宣告後的草稿必須通過建立活動時的同一套驗證，包括草稿儲存的 1 MiB 上限；超過上限回 413，其餘不合規則回 422。
- **整份覆寫**：每次 `PUT` 的 `settings` 取代上一份，省略即沒有設定更正。
- 修正候選的草稿維持等於 baseline 草稿，設定只存在宣告裡；Reader 預覽顯示套上宣告後的活動名稱與日期。

### 修正候選與基準 API

- `POST /api/organizer/events/:sourceCandidateId/amendments` 只接受 `expectedVersion`。來源候選的成員或 Admin 可以建立。來源候選、該版本 snapshot 與 publication job 必須一致且已 published。伺服器以 D1 中來源候選的核准 snapshot 重算公開檔，與活動資料 bucket 目前提供的版本逐檔比對；分組取自該版本的來源檔，沒有時沿用核准 snapshot。錯版、未公開、缺檔、讀取失敗均不建立，客戶端不能指定基準內容。
- [ADR-0073](../adr/0073-reviewed-grouping-corrections-have-explicit-amendment-baselines.md) 的跨日身分整合承接紀錄只存在於 #546 之前核准的 `/2` 基準；這些基準仍可讀取。新修正一律從活動資料 bucket 取得基準。
- 讀不到活動資料 index 回 503 `amendment_baseline_unavailable`；index 可讀但基準與發布紀錄不符、或版本內的檔案讀不到時回 409 `amendment_baseline_changed`。不將未知錯誤內容直接傳給使用者，也不對無法靠重新載入解決的差異要求重新載入。
- 建立新的候選、鎖定 eventId、immutable baseline、首版空宣告、版本紀錄、匯入列、獨立地圖草稿及 audit 在同一 D1 batch。交易內重新檢查來源版本、published job／snapshot 與成員 grant 或目前 Admin 名冊；宣告保存同樣重檢 grant／Admin，避免預讀後撤權仍寫入。候選複製當下有效的成員 grants；之後沿用每候選的成員管理。Admin 不因建立動作成為成員。
- `GET /api/organizer/events/:candidateId/amendment` 由候選成員／Admin 讀目前宣告、影響、設定宣告及其前後值（`settings`、`settingsImpact`）與可選來源名單；以同一 SQL 讀取 candidate 版本與最新宣告，地圖單獨修改後仍回目前候選版本，不能將舊宣告配上並行保存後的新版本。不回傳 global allocations／evidence 或核准 snapshot。`PUT` 只接受 `expectedVersion`、完整 `changes[]` 與選填 `settings`，從固定 baseline 重新規劃，不從前一次結果累加或推論。未知來源、錯誤宣告或允許清單外的設定為 422，版本／狀態或交易內撤權衝突為 409。
- 宣告保存以唯一 revision token 串起版本、不可變宣告紀錄、衍生匯入列與 audit；同時保存只成功一份，失敗請求不能把勝出者的匯入列退役。baseline 不隨保存改變。沿用 20,000 列、代碼 80 字、名稱 200 字及 8 MiB 名單限制；宣告本身也限制 8 MiB。匯入列只供既有地圖及驗證接線，身分仍由 baseline／宣告決定，不編造主辦 stable key。
- AMEND 的一般活動設定儲存與匯入覆蓋一律回 409 `amendment_declaration_required`，名單變動與活動設定更正都只能經修正宣告；地圖沿用原候選版本及權限檢查。送審與核准沿用 CREATE 的 publication engine，不能用 CREATE 繞過修正宣告。送審的 snapshot 帶上已保存的設定宣告（沒有時不出現這個鍵）；核准時 snapshot 的 `changes`、`settings` 必須與已保存內容一致，否則回 409 `snapshot_mismatch`。
- `publication_operation`（舊候選為 CREATE）、`organizer_amendments` 與 `organizer_amendment_changes`（設定宣告在 `settings_json`）由 `migrations/` 建立；CREATE 唯一及 AMEND 活躍唯一兩條 eventId index 各自保留。

### 修正操作介面

- 已發布候選的成員或 Admin 可按「開始修正已發布活動」，核對成功後開啟獨立修正候選。活動列表及工作區標示「發布後修正」。
- **名單修正只能表達四種變動，純分類變更不在其中。** 退出、換手、移動／重編號、新增——只有「移動」帶得動目的地的活動日、展區與代碼。所以「把展區重新歸類、攤位本身沒動」這種修正，在系統裡只能寫成逐攤的移動宣告，而讀者會因此在每一個攤位看到「已移動攤位」。發布時 `publication-artifacts` 還會比對 snapshot 的攤位清單與「baseline + 宣告」推出的結果，不一致就以 `snapshot_mismatch` 退件——因此直接改候選的匯入列也走不通。修正的 baseline 取自目前對外服務的目錄而非 D1，改舊候選同樣不影響未來的修正。遇到管線表達不了的資料更正時，預設是不動已發布資料、改為修正上游避免再發生；若確實必須更動已發布位元組，那是繞過「已發布內容來自已核准 snapshot」的治理例外，要明確記錄後才執行。
- AMEND 的「名單修正」取代一般攤位匯入。表單明選變動類型、搜尋／勾選來源攤位，填接手或新增社團名稱，以及逐攤目的活動日、展區、代碼；選填 HTTPS 更正依據。來源每頁最多 50 個，跨頁／搜尋仍保留選取。
- 修正面板的「活動設定」預填目前生效的活動名稱、別稱與各活動日日期，可直接更正，與名單宣告一起儲存；「已儲存的活動設定更正」逐欄列出原本與修正後的值。
- 宣告可加入清單、修改或取消，再按「儲存修正並檢視影響」。影響區只顯示伺服器已保存版本；未保存時明確標示，切換活動／項目或離開頁面有未儲存提示。「開始修正」的基準核對回應較晚到達時，也檢查目前面板的未儲存輸入，不能直接切走其他候選。取消宣告只撤掉那筆修正，不推論名單缺列。409 保留輸入與舊影響，需明確捨棄後讀取新版本，不能直接重送覆蓋。
- 活動設定只能經上述「活動設定」更正，場館設定為唯讀；地圖、檢查與 Reader 預覽沿用既有介面。自動發布未啟用時 detail 回 `publicationAvailable: false`：AMEND 的送審與所有核准按鈕停用，後端核准回 503 `publication_unavailable`，送審內容保留。

## 主辦與分類目錄

活動設定的 `references` 保存 `organizerAssignments[]`（organizerId／lead、co-organizer、partner）與 `categoryCatalog`（id／organizerId／revision）。必須恰好一位 lead，單位不可重複；分類目錄屬於已選單位且至少含一個有效分類。建立及選取共用 Reader 分類驗證，分類名稱不可使用其保留名稱「全部類別」。未選可以儲存未完成草稿，但 validate／submit 會阻擋；明確選入的錯誤 reference 在 save 即拒絕。

`POST /api/organizer/events/:candidateId/references` 接受 expectedVersion、kind、名稱、HTTPS 官方來源；分類目錄另含所屬主辦與分類 label／選填 description。成員／Admin 可在 draft／changes_requested 建立，舊版本或已鎖定狀態拒絕；建立與 audit 原子完成，候選內容不因目錄建立而前進版本。使用者選取後以原本的草稿 save 套用。除了下方的場館補上地址，沒有原地修改既有 reference 的 API；不提供猜測分類或 stable ID 輸入欄。

建立分類目錄時，「分類官方來源網址」預填活動設定的官方公告網址（分類通常公布在活動公告裡），可以修改；活動尚未填網址時留空。

`organizer_reference_records` 保存 canonical public_reference_json 與 source_captured_at。場館／場地正常建立在同交易固定 canonical 記錄；seed adoption 依 [ADR-0061](../adr/0061-organizer-snapshot-pins-complete-reference-records.md) 的已核對來源與時間，只補缺少記錄，既有 metadata 不一致時不強行採用。控制面名稱「全館」與公開名稱「爭艷館展區」分開保存。四個 seed 場館的地址取自各自官方來源頁，以 `address-source`（核對時間 2026-09-24T15:50:00Z）另列出處；FF47 固定 bytes 的名稱與網址出處不變。已存在的 seed 記錄不在初始化時補地址，走下方的補上地址。

既有非 seed 場館／場地缺少 canonical 記錄時，「場館與場地」列出待補來源。使用者核對並輸入公開名稱與官方 HTTPS 網址（場館另含地址）後，以同一 references endpoint 的 `venue`／`venue-space` kind 補齊。僅能處理已儲存在該候選的 assignment；同交易檢查角色、可編輯狀態、expectedVersion、場館關係與 path 未存在，建立／audit 原子完成。保存固定本次核對時間，不改目錄友善名稱、candidate revision 或任何既有 snapshot；既有 canonical 記錄不能由此覆寫。之後仍須重新檢查、預覽與送審。

**補上地址**（#395）：候選已選的場館有 canonical 記錄但沒有 `address` 時，detail 的 `missingVenueAddresses` 列出它，resolver 以 `missing_venue_address`（venue 步驟 error）阻擋檢查、預覽與送審。「場館與場地」為每個這樣的場館顯示地址欄；以同一 references endpoint 的 `venue-address` kind（`referenceId`、`address`、expectedVersion）送出。這是 canonical 記錄唯一的原地修改：記錄加上 `address`、一個出處為場館 `officialUrl`、核對時間為本次的 `address-source`，以及 `/address` provenance，其餘位元組語意不變。同一 D1 batch 檢查角色、draft／changes_requested（發布後修正亦同，因為地址屬於共用場館記錄而非本活動設定）、expectedVersion、場館在候選 assignment 中、記錄仍是讀取時的 bytes 且尚無地址，並寫入 `organizer_reference.address_completed` audit。已有地址時回 409，不能由此改地址。候選版本、revision、目錄友善名稱與既有 snapshot 都不變。

validate／preview／submit 共用 selected-reference resolver。`organizer-reader-preview/1.references` 是所選 canonical 公開記錄，介面呈現主辦、分類與正式場館名稱；選單仍使用原本 venueCatalog 的友善名稱。公開 schema／檔案選取 parser 與 CLI 共用 `app/reference-selection.mjs`。

## 攤位匯入

- 工作區入口為「攤位名單」，預設檢視已儲存資料；「匯入檔案」另開選檔、欄位對照、預覽確認三步流程。返回前一步保留設定與修正；返回名單或離開活動時保護未儲存內容，匯入必須在最後一步明確確認。

- **原始檔只在瀏覽器裡解析與雜湊。** `readOrganizerWorkbook()` 讀 CSV 或 XLSX、列出工作表、保留實體列號；沒有任何 API 接受這個 File。
- `PUT /api/organizer/events/:candidateId/imports` 只收主辦確認過的**正規化攤位群組**與來源 metadata（檔名、工作表、原始檔 SHA-256、來源說明、欄位 mapping）。
- 每個群組的 `dayId`、`venueSpaceId` 與 `areaId` 必須落在草稿已宣告的集合內；`areaMode: none` 的列會被正規化為 `ALL`，不讀來源檔的展區值；同一活動日 × 場地 × 攤位代碼不得重複（大小寫不敏感）。
- 每個群組保存 `codes[]`、社團名稱與來源參考列；正整數表示原檔列號，`sourceRow: 0` 表示手動新增或從不同來源列合併的群組，不虛構檔案列號。一團多攤不需要填主辦內部編號。重複驗證逐個代碼進行，同群組內重複也整批拒絕；API 要求非空的字串陣列，各碼不超過 80 字元，現有 20,000 群組與 8 MiB 上限不變。舊有正整數來源列維持相容，不需資料遷移。
- 欄位 mapping 保存 `boothCodeMode`：預設 `single` 不拆碼；`delimited` 以空白、逗號（含全形）、頓號、分號（含全形）或斜線拆分；`fixed-width` 使用主辦明確確認的 `boothCodeWidth`（1–80 字元）。寬度只提出候選值、不自動套用；不可整除或包含分隔符號時，指出來源列並擋住儲存。`single` 遇可能連寫的代碼，於 mapping／預覽即提示；遇同一格以分隔符號列出多個代碼（每段都含數字），於格式選單下說明列數與一例，並提供一鍵改用 `delimited`，仍不自動套用。選定攤位代碼欄後，步驟二同時顯示拆碼後的總列數、總攤數與代表列（含當日攤數），讓主辦當場確認分隔或字元數是否生效（固定字元數留白或無效時先顯示提示而不誤標壞列）；無法拆分的列以警告列標示。
- 步驟二的「活動日」與「場地」選定來源欄後，「值對應」列出該欄每個來源值與受影響列數：尚未對應的排在前面；與活動設定完全匹配的也列出，預先選好並標示「自動」。場地值若恰好是唯一一個已加入場地名稱的開頭（忽略全半形、大小寫與空白，且開頭之後不接英數字，例如「P3」對「P3倉庫」、不對「P30倉庫」），預先選好並標示「建議」，摘要提示確認；有兩個以上候選時不建議。主辦可改選，改回同一目標即恢復自動或建議的對應。讓主辦直接指定目標選項或前往「場館與場地」補建或移除場地；所選對應寫入欄位 mapping 的 `values`。已加入活動、卻沒有任何來源值對應到的場地，在同一區塊列名提醒匯入後沒有攤位、也無法送審。序列化後的欄位 mapping 超過伺服器 100 KB 上限時，在儲存任何草稿或送出前阻擋並提示縮短別名。
- 步驟二的「展區」為選填，預設為「沒有分區」：未對應展區欄、固定值留空，或有對應展區欄但某個場地的所有匯入列都未填展區值時，該場地自動正規化為無分區（`ALL`），確認匯入時一併將草稿該場地更新為 `areaMode: "none"`；已填有展區的場地若仍有個別列漏填，仍於「待修正」提示補正。若切換檔案或工作表後原選的展區欄超出新標題範圍，須重新選擇展區欄或改選「沒有分區」才可預覽與匯入。
- 預覽顯示群組列數、展開代碼總數與各列的全部代碼及攤數；已儲存清單提供社團／代碼／內部編號搜尋、活動日、場地、場地內展區與已儲存地圖狀態篩選、依第一個攤位代碼自然排序及分頁：每頁 25／50／100 列（預設 100）或全部；「全部」僅在符合條件不超過 500 列時可選，超過時以每頁 100 列顯示。切換每頁列數時停在原本顯示的位置，選擇只記在該瀏覽器。候選鎖定時仍可唯讀檢視；與地圖的對照見[地圖](#地圖)。
- 已匯入清單在 draft／changes_requested 可修改、手動新增、刪除、拆分與合併群組。拆分勾選要移至另一組的代碼，兩組保留原名稱與明確的 stableKey／identityGroup，名稱相同不另外產生識別連結。合併只允許同活動日、同場地、同展區且內部編號一致；名稱不同時須明確選擇保留名稱，不能默默覆寫社團識別。同來源列的拆分／合併仍可回查原列，不同來源列合併標成手動群組。
- 儲存格直接編輯代碼、名稱、日期、場地、展區及選填內部編號。Enter 確認、Tab 移至下一格、Escape 還原本格，組字中的 Enter 不提交。列位置不因輸入重新排序或消失；主動篩選／排序或儲存後重算。錯誤指出對應欄位並可跳往修正。
- 清單編輯草稿獨立於尚未儲存的匯入預覽；搜尋、篩選、排序與換頁不清除修改，僅渲染目前這一頁。離開區段與重新整理沿用未儲存提醒；有清單草稿時，先儲存或放棄才能以新檔案取代。此入口需要已有匯入出處，不提供從零建單。
- 編輯時即時指出同日 × 同場地重複代碼、缺值與活動設定不符；可疑連寫只提供建議，須確認才拆碼。活動日與場地只能從活動設定選擇，無分區沿用 ALL；分區變動在儲存前沿用展區宣告，再以取得的新 expectedVersion 儲存整份清單。409 保留本機草稿並停止重試覆寫，須放棄及重新讀取新版本。
- 儲存沿用原 PUT 與 20,000 群組／8 MiB 上限，檔名、工作表與 SHA-256 保留為原始匯入出處，不聲稱等於編輯後內容。AMEND 不使用此編輯器，仍走明確修正宣告；API 的 AMEND 拒絕邊界不變。
- 匯入預覽與已儲存清單中，無分區場地顯示「無分區」，不顯示內部值 `ALL`；有分區場地若實際使用 `ALL` 作為展區代碼，仍保留原名稱。
- D1 以新增的 nullable `codes_json` 保存群組，舊 `booth_code` 欄保留為相容投影（新寫入為群組第一碼）。舊資料未有 `codes_json` 時讀成 `[booth_code]`，**不猜拆舊合併代碼**，不改寫任何既有 approval snapshot。新送審使用 `organizer-submission-snapshot/5` 並保存 `codes[]`；舊 `/1` snapshot 原 bytes 與 hash 不變。舊版匯入寫入格式會被 API 拒絕，重新載入 UI 後使用新版群組格式。
- authoring scope 與地圖覆蓋驗證攤平 `codes[]`；Reader preview 的 placement 仍一碼一筆，同群組每碼帶相同社團名稱。正式已發布活動的讀取／身分投影不變。metadata mapping 與新 snapshot 均可追溯主辦確認的拆碼選擇。
- **預覽可以逐列修正。** 缺值或攤位重複的列會列在「待修正」，直接在預覽裡補上活動日、場地、展區、攤位代碼、社團名稱或主辦內部編號；也可以移除個別列，或一次略過全部待修正的列。活動日與場地只能從活動已宣告的清單選，展區與攤位代碼是來源檔的事實，維持自由輸入。補上主辦內部編號會一併重算該列的 `identityGroup`。
- 匯入預覽中移除的列**既不匯入也不再回報問題**，而且不佔用攤位位置：同一攤位的重複因此可能由移除另一列解除。預覽修正與移除以來源列號為鍵，換檔案、換工作表或改標題列時清空的僅為這份未儲存預覽——不清空已存清單的編輯草稿。
- 還有待修正的列時不能儲存；要嘛補完，要嘛移除。這只擋住這一步，未宣告的活動日、場地或展區在 API 端仍然照樣拒絕。
- **展區由這次匯入決定。** 預覽會列出這次要匯入的場地與展區（含手動補正，不含已排除的列）；主辦按下確認時，`PUT /api/organizer/events/:candidateId/imports` 攜帶 `deriveAreas`，於同一版本與交易內先驗證全部列再原子更新草稿的展區設定（`areaMode`／`areaIds`／`areaLabels`）與匯入名單；任一列驗證失敗時，原有草稿展區設定與舊名單皆保持不變。API 端仍檢查非無分區場地的展區代碼符合網址格式、無分區場地為 `ALL`。
- CSV／XLSX 的展區欄及固定值是展區名稱，可含中文、空格與標點，經 NFKC、去除頭尾空白與合併連續空白後，須為 1–60 字。同一場地內名稱精確相同的列跨日歸為同一展區，不做模糊比對。缺漏或過長名稱列入待修正，可補正、排除與恢復；無分區 `ALL` 不讀來源展區值。
- 新展區的 `areaId` 由系統自動編配為 `area-<匯入起始候選版本>-<序號>`，序號在本次活動匯入中不重複，避開所有既有代碼；候選版本避免後續匯入重用已移除展區的地圖身分。排除列保留本次編號位置，僅有效列的展區寫入草稿。重新匯入按既有名稱（舊資料無名稱時按原碼）沿用未跨場地重複的代碼，不因列順序改變而重編；名稱保存於 assignment 的 `areaLabels[areaId]`，公開 `areas[].label` 沿用名稱，配置與地圖仍用內部 `areaId`。不遷移既有名單、地圖或核准 snapshot。
- 預覽、已存名單、場館設定與地圖選單呈現展區名稱。已存名單的展區儲存格亦以名稱編輯，同名沿用既有群組、新名自動編號，與名單共同儲存；名單工具列的「展區名稱」可單獨更名，名稱不可清空，沿用活動草稿 PATCH 與 expectedVersion，不重新寫入攤位名單。名單草稿必須先儲存或放棄；名稱草稿有離開提示，409 不覆寫新版本。AMEND 仍走既有修正宣告。
- 預覽的可匯入、待修正、已排除資料各自每頁 100 筆，能修正與恢復第 100 筆以後的資料。最後確認顯示新舊筆數與未涵蓋場地；匯入成功返回名單。若匯入已成功但重新讀取失敗，提供重新讀取入口，不重送匯入。
- 展區的推導與匯入一樣是**取代**語意：草稿裡有、但這次匯入沒有提到的分區場地會被清空展區——包含整批被移除的那些列所屬的場地；無分區場地仍固定為 `ALL`。prerequisite 的 `missing_space_import` 會指出沒有任何匯入列的場地。預覽會先以場館與場地名稱提醒哪些場地沒出現在檔案裡。
- 保存匯入後若再移除活動日、移除場地、切換展區方式或改變已宣告展區，validate、preview 與 submit 都會逐列反查既有資料並要求修正清單或重新匯入；舊列不會以 orphan space 或過期展區進入送審 snapshot。相同原因的列會聚合成一個帶影響列數與代表來源列的 issue，回應最多列出 100 組再加一筆省略摘要，避免 20,000 列名單放大成 20,000 個 blocker。手動群組不顯示虛構的來源第 0 列。
- 檔案裡出現草稿沒有的場地時，預覽擋下儲存並指出要修的是來源檔還是場館設定。API／草稿仍要求內部展區代碼符合網址格式；此限制不再施加於來源檔的展區名稱。
- 主辦內部編號只供主辦自用核對，UI 不承諾跨活動識別。`identityGroup` 只能是 `stable:<stableKey>` 或 `null`。此欄只保存明確編號，跨日同名關聯另由完整名單投影。依 [ADR-0071](../adr/0071-organizer-review-confirms-cross-day-circle-grouping.md)，沒有內部編號的同名列跨兩日以上時自動分組，匯入預覽與已存名單列出所有日期／場地／攤位供主辦確認；名稱正規化後精確比對，不做模糊比對。同名列有任何內部編號時，只合併編號相同者，空白編號保持分開；單日同名不自動合併。
- 匯入是**取代**語意：一次請求就是這個候選活動的完整攤位表。新來源寫入時，前一份標記 `replaced_at`，其資料列不再是有效匯入。
- 兩道上限，回不同的狀態碼：**超過 20,000 列**在最初的參數檢查就回 `400`；**正規化後超過 8 MiB** 回 `413`。兩者各有自己的錯誤訊息，都在寫入之前拒絕，不會留下半套匯入。
- **分批不是這兩道上限的解法**——取代語意表示後一批會丟棄前一批。實際可行的是縮短欄位內容，或先確認匯入範圍是否真的屬於同一場活動。
- 稽核只留版本、列數與原始檔 SHA-256。**私人 workbook 的檔名與工作表名不寫進 `audit_log`**——來源可追溯靠 hash，檔名會比它描述的匯入列活得更久。
- **hash 證明的是來源檔，不是每一列。** 預覽裡的手動補正與移除不改變 hash，也不逐列留下紀錄；可追溯的是「這份檔案，加上主辦在這一版所做的修正」。最終資料列本身由送審 snapshot 固定（見[驗證、預覽與送審](#驗證預覽與送審)），要核對某一版實際匯入了什麼，看的是那份 snapshot 而不是 hash。

## 地圖

清單的「已儲存地圖」逐群組顯示待畫、部分已畫或已畫，以該活動日 × 場地最新已存地圖的代碼核對，讀取失敗不當作待畫。已有座標可定位到同一範圍的編輯器；清單尚有未保存變更時先儲存再定位。此狀態來自既有 maps 列表的選填 `coverage=1` 投影，不另外保存完成旗標。

編輯器的清單對照則依目前地圖草稿即時更新，清楚標示儲存後才更新清單狀態；畫入、改碼、刪除及復原都參與計算。可搜尋代碼與社團名稱，待畫代碼沒有無效定位，選取已有攤位可核對同範圍的群組。共用行為見[地圖編輯器](#地圖編輯器)。

- 每一個「活動日 × venue-space」各一份地圖草稿，沿用既有的 `MapLayoutEditor` 與 template 辨識器。
- 編輯器可在已匯入的展區代碼中選擇一個，逐點畫不規則範圍並選淡色；同碼可畫多塊且共用顏色。可重開選取範圍、編輯頂點／展區／顏色或刪除，並使用既有復原與儲存。scope 不接受其他場地的展區代碼；Reader 預覽顯示範圍與顯示名稱，發布時保留 `areaRegions`。
- 共用的[私人輔助線與吸附](./organizer-workspace.md#私人輔助線與吸附)隨地圖 revision 保存。API 以 layout 同層的可選 `authoring` 讀寫，公開預覽／publication 只採地圖 layout；畫布個人顯示開關不觸發候選保存。
- 共用的[描摹顯示與精準操作](./organizer-workspace.md#描摹顯示與精準操作)與[排段整體調整](./organizer-workspace.md#排段整體調整)在地圖編輯器中的行為見下方。配置圖顯示、透明度、描摹模式與微移步進只留在瀏覽器，不進草稿也不進 revision。
- **「儲存地圖變更」只儲存，不關閉編輯器。** 一張地圖要畫很多輪，關閉是另一個決定，由「關閉編輯器」負責。儲存後編輯器沿用同一份 layout 繼續編輯，並改為更新剛才存下的那份地圖：第一次儲存之後的每一次儲存都是更新，不會再建立第二份。有未儲存變更時關閉才會出現「儲存並關閉／放棄／取消」。已保存的地圖沒有新變更時儲存鍵停用，旁邊沿用草稿表單同一組「尚有未儲存變更／目前沒有未儲存的變更」；畫布上沒有任何攤位或設施時，不論這張地圖是否已經建立，儲存鍵同樣停用並說明缺什麼。停用不只是版面整潔：每次儲存都讓 candidate 前進一個版本並寫入一份 revision，沒有變更的儲存會在歷史留下一步空紀錄，而空白地圖的第一次儲存是同一件事的另一個入口——它還會讓「N 張地圖」這個計數記上一張沒有內容的地圖。
- **地圖儲存帶的是面板看到的最新活動版本。** 在其他項目儲存後隨即切到地圖時，儲存後的重讀可能在地圖面板開啟之後才到；下一次儲存的 `expectedVersion` 取這份活動資料與面板自己上一次儲存回應中較新的一個，有未儲存的地圖變更時也一樣，不因此回 409。地圖內容本身由 `expectedMapRevision` 保護，它只來自讀取地圖與面板自己的儲存：另一個分頁或裝置已經存過同一份地圖時，下一次儲存仍回 409，畫面上的變更保留。
- **配置圖跟著地圖存下來。** 一份地圖草稿有一張目前的配置圖，經 `PUT /api/organizer/events/:candidateId/maps/:draftId/background` 存進私人 bucket `MAP_CONTRIBUTIONS`，由 `GET` 同一個位址讀回，兩者都限協作者且回應 `private, no-store`。物件位址由草稿自己的 id 決定（`organizer-map-backgrounds/<candidateId>/<draftId>`），因此**沒有任何 D1 資料列指向它**：再上傳一次就是覆蓋同一個位址，草稿被保存期限清除時也照同一組 id 刪除，不需要先讀 metadata。只接受 JPEG／PNG／WebP，上限 10 MB，容器檢查與貢獻來源檔共用同一份 [`prepareMapImageFile()`](../../app/map-contribution-files.ts)。
- 上傳按鈕依狀態顯示三種字：編輯器沒開時是「上傳配置圖並編輯」，會先框選目前場地或使用整張圖，再依保留圖片的尺寸建立畫布；完整原圖可沿用模板辨識，裁片從空白地圖開始；編輯器開著而還沒有配置圖時是「上傳配置圖」，已有內容時只換底圖；新圖或空白地圖可框選裁切，先以裁片尺寸重設畫布；已經有配置圖時是「更換配置圖」。同一個檔案可以連續選第二次。上傳進行中（包含儲存地圖時一起上傳的配置圖）按鈕暫停，同一張地圖一次只有一個上傳，避免較舊的圖晚到而蓋掉新的；重設畫布後才完成的上傳不再改動畫面。地圖還沒建立時選的配置圖會在第一次儲存時一起存上去。處理結果寫在工具列下方的獨立一行，不佔用上傳按鈕本身，所以上傳後按鈕仍在原位、可以隨時再選一張；空白畫布、關閉編輯器、切換活動日／場地／地圖分頁或從同場地複製時，這行結果一起清掉。
- **新圖裁切。** 框選以原始像素計算，也可用數字欄位操作；取消或晚到結果不改目前草稿。已放攤位、設施、區域、輔助線，或已修改場館外框的地圖不能重裁。裁片在瀏覽器輸出，沿用私人底圖上傳與 10 MB 上限，辨識、保存重開及 Reader 使用裁片的新座標，不保存原圖 offset。同一來源可為其他活動日／場地重新選取。實作見 [配置圖裁切](../../app/organizer/map-plan-crop.tsx)。
- **已發布修正沿用來源底圖。** 修正地圖尚未上傳自己的配置圖時，登入且具修正候選權限的協作者可讀取固定 baseline 中同活動日／場地的已發布來源底圖，連續修正也沿用這條來源關係；不接受客戶端提供來源 id 或 bucket key。更換配置圖只寫修正地圖自己的物件，不影響原版。GET 不寫入、不推進版本，來源底圖維持原保存期限；來源已清除時維持找不到配置圖，不複製資料以延長保存。
- **上傳配置圖不推進版本。** 配置圖是描圖用的底圖，不是送審內容，所以它不增加 candidate version、不寫 map revision，只留一筆 `organizer_event.map_background_updated` 稽核。儲存鍵的停用條件因此不受影響。
- **會清掉畫面內容的動作都先問。** 空白畫布（畫面上有內容時）、切換地圖分頁、從同場地複製、切換場地（有未儲存變更時），以及已經有配置圖時再次上傳，都要先確認再執行。
- 地圖的未儲存狀態與儲存動作接入工作區導覽；「儲存並切換」沿用地圖儲存規則，空白地圖不能儲存，儲存失敗保留內容與原因且不切換。新地圖尚未儲存、既有地圖編輯後，以及待儲存的配置圖都受到保護；已儲存後未再編輯不重複詢問。這不改變地圖面板內的切換／關閉確認，也不新增自動儲存。
- 候選地圖的 scope 由 [`resolveCandidateAuthoringScope()`](../../app/event-authoring-scope.ts) 從草稿與匯入列推導：`allowedBoothCodes` 與 `requiredBoothCodes` 都是該 scope 實際匯入的攤位代碼。
- **候選活動的地圖可以含沒有社團的攤位格。** 配置圖畫的是整個場地，包含沒賣掉的攤位，而那些格子沒有任何匯入列可以指認。已發布活動有 reviewed snapshot 透過 `existingBoothCodes` 認領這些格子，所以在那裡出現的陌生代碼是打錯字，仍然是 error；候選活動的第一份地圖沒有 snapshot 可依靠，因此 `unknown_booth` 降為 warning，代碼照樣列出來給人看。這是 `allowsUnallocatedBooths` 這個 scope 欄位唯一的用途。`missing_booth`、`overlap` 與幾何錯誤不受影響。
- **候選地圖沒有公開檔案位址**（`targetPath: null`）。已發布活動的 authoring scope 才有 `targetPath`，只有一組「活動日 × 場地」時是 `map.json`，多組時是 `maps/<periodKey>/<venueSpaceId>.json`。

## 驗證、預覽與送審

AMEND 沿用驗證、Reader 預覽、Owner／Admin 送審及 Admin 核准。送審固定 `organizer-submission-snapshot/4`、明確 operation，以及伺服器保存的 baseline JSON／SHA-256／目前修正宣告；衍生名單與地圖須通過相同產檔驗證。核准再次比對 immutable snapshot 與此版本宣告，沿用唯一 publication job 和自動 dispatcher；不新增人工 Publish。snapshot 儲存與送審在 SQL 寫入時檢查有效 Owner，review 交易重新檢查有效 Admin、候選版本與 snapshot，所有核准寫入以唯一 review token 綁定。

- 地圖檢查保留完整 `boothCodes`，檢查與發布的檢查結果以活動日與場地標示每項問題；攤位差異顯示比對的匯入檔名、工作表與該範圍列數，可展開全部代碼，缺少的攤位另顯示社團名稱與來源列號。提示分別引導檢查地圖與匯入欄位，未知攤位維持 warning，缺少攤位維持 error。

- `POST …/validate` 回傳 `issues[]`，每筆帶 `severity`、`step`（`event`／`venue`／`import`／`map`／`preview`）、`code`，必要時帶 `row` 或 `target`。缺任何一份「活動日 × venue-space」地圖是 error，不是 warning。成功時只把 workspace 的 `last_validated_version` 記為目前版本；不增加 candidate version，也不建立內容 revision。任何後續內容寫入使版本前進後，這個完成狀態自然失效；若版本在 validation 與 marker 寫入之間前進，API 回 409 並要求重新驗證，不會對舊版回報成功。
- `POST …/preview` 回傳 `organizer-reader-preview/1`：草稿、匯入的配置與每份地圖 layout，供 Reader 樣式預覽。它不寫入任何資料。
- 預覽攤位以可讀底色呈現；滑鼠或鍵盤選取時反白該格，顯示該活動日與場地內的攤位代碼及社團名稱。切換預覽地圖清除選取，不沿用另一張地圖的社團資訊。
- `POST …/submit` 只有該候選的 Owner 或全域管理者可以呼叫（ADR-0080），且要求有效 session；寫入時重查 Owner grant／管理者名冊。管理者以自己的帳號送審時記為 `submitted_by`，稽核角色為 `admin`，之後核准自己送出的版本照常記錄 `selfApproval`。CREATE 新送審固定 `organizer-submission-snapshot/5`：草稿、完整 reference selection、各 reference 的 path／原始 JSON bytes／SHA-256、匯入來源 metadata、`codes[]` 攤位群組與地圖內容；`contentUpdatedAt` 取該 candidate version 的 immutable revision.created_at。既有 `/1`、`/2`、`/3` snapshot bytes/hash 保持不變，`/3` 產物沿用只依明確編號分組的規則。產檔只能使用 snapshot，不可回讀 live catalog 或推測舊 snapshot 缺少的公開資料。
- **validate、preview 與 submit 讀同一份 bytes**：候選、匯入與每份地圖各只讀一次，所以送審固定的內容與剛才驗證過的內容不可能不同。
- `POST /api/admin/organizer/events/:candidateId/review` 由全域管理者以有效 session 核准或要求修改。核准前重跑驗證；找不到該 revision 的 immutable snapshot 就拒絕。
- 送審頁的「網站管理者審閱」表單僅對全域管理者顯示；一般成員保留送審狀態與發布進度，不顯示停用的管理者審閱表單。成員管理與送出審閱對成員與全域管理者都可操作；新增成員不授予全域建活動或核准權限。
- **管理者可以核准自己送出的 revision**，但稽核會記下 `selfApproval`、actor、snapshot hash、版本與時間。

## 發布邊界

核心實作：[`server/organizer-publication.ts`](../../server/organizer-publication.ts)、[`app/event-data-publisher.ts`](../../app/event-data-publisher.ts)、[`app/publication-artifacts.ts`](../../app/publication-artifacts.ts)。部署設定與回滾見[部署 runbook](../runbooks/deployment.md#核准即發布)。

- 依 ADR-0057，UI 動作為「核准並發布」。發布啟用（`ORGANIZER_PUBLICATION_MODE=r2` 且[網站營運設定](./admin.md#網站營運設定)的發布開關開啟）時，核准請求先確認管理者仍有效、送審版本未變，把候選標為 `approved`；再寫入活動資料：產生公開檔、更新社團配號表、公開活動圖片、寫入新版本，最後以 ETag 條件改寫 `index.json`；成功後同一 D1 交易記錄核准、將候選改為 published 並寄出結果通知。未啟用或發布開關暫停時核准回 503，候選保留送審狀態。
- **寫入失敗不切換 `index.json`**，讀者看到的內容不變。可重試的失敗（儲存暫時無法寫入、另一筆發布剛完成造成的 ETag 衝突）回 503，候選停在 `approved`，再按一次核准即重試；內容本身無法發布（例如首次發布的活動代號已公開、修正基準已變更、送審的活動圖片已遺失）回 409，候選回到 submitted，活動圖片不公開，由管理者退回修改。
- 送審 snapshot 必須是這個候選這一版的內容：雜湊、候選 ID、版本、活動代號與 CREATE／AMEND 任一不符都拒絕核准。
- 同一版本再次核准不重複發布：`index.json` 已指向這次核准時直接完成 D1 紀錄，候選已 published 時直接回成功。這也涵蓋寫入成功但 D1 交易失敗、或回應遺失的情況。
- 沒有發布工作、背景接手或輪詢；核准回應就是發布結果。

### 核准 snapshot 產檔

`app/publication-artifacts.ts` 消費 CREATE snapshot/3，或明確 `operation: AMEND` 的 snapshot/4，以及其核准 hash。資料產生不讀即時 catalog、時鐘或網路：內容時間取 contentUpdatedAt；活動結束取最後日期台灣時間 23:59:59；草稿有活動別稱時 `event.json` 才帶 `aliases`（緊接在 `name` 後），有活動圖片時才在最後帶 `image: { url, width, height }`，沒有時都不出現這些鍵，已核准 snapshot 因此重建出相同位元組；活動與逐日攤位表網址皆取已核准 officialSource.url，統一經 URL canonicalization（合法的大寫 HTTPS scheme 轉小寫），snapshot bytes/hash 不改写。地圖保留每個 day × venue-space 的內容，單一範圍產生 map.json，多範圍產生完整 manifest。現行公開格式要求同活動模板一致、展區由場地唯一持有；不相容 snapshot 明確拒絕，不取第一個場地猜值。

AMEND snapshot/4 額外保存不可變 `amendment.baselineJson`／`baselineSha256`、明確 `changes[]`，以及選填的正規化 `settings`。產檔以 baseline 草稿重新正規化 `settings`，結果必須與保存內容完全相同，否則以 `snapshot_mismatch` 退件；生效草稿是 baseline 草稿套上 `settings`。`event.json` 必須等於 baseline 活動資料套上宣告值（名稱、別稱、逐日 `dateLabel`，以及依新日期重算的 `dateRangeLabel`／`eventEndsAt`），除 `dataUpdatedAt` 外任何差異都退件。產檔核對 baseline、活動設定及 reference，reference 除場館補上地址外必須與 baseline 相同，重算宣告後必須與衍生匯入列一致；身分由已核准 grouping／宣告決定，不能以匯入列重新配舊 Circle ID。地圖仍逐範圍驗證，內容時間取此修正版的 immutable revision。

## 驗收條件

- 未登入或無 grant 的帳號拿不到任何候選活動；不存在的候選與無權限的候選都回 404，不區分。
- 任何寫入帶錯 `expectedVersion` 一律 409，且回應指出目前版本。
- 送審與核准是兩次獨立動作，各自要求有效 session；核准自己送出的 revision 會在稽核留下 `selfApproval`。
- 匯入 API 拒絕未宣告的活動日、場地或展區，並在錯誤訊息指出來源列號。
- 預覽裡移除的列不會被匯入，也不會產生待修正項目；被它解除的攤位重複不再回報。
- 手動補正過的列仍要通過與其他列相同的檢查：未宣告的活動日、場地或展區照樣被匯入 API 拒絕，介面上的修正不是繞過那道檢查的路。
- `ORGANIZER_PUBLICATION_MODE` 未設定時，核准 API 回 503，候選保留 `submitted`。
- 發布寫入失敗時 `index.json` 不變；可重試的失敗停在 `approved` 且不能要求修改，內容被拒時回到 `submitted`。再次核准成功後才記錄核准與 published，只留一筆核准紀錄。
- 核准途中被要求修改或管理者資格被移除時，核准在寫入活動資料前就停止；只有自己這次的核准會因內容被拒而撤回。核准者帳號在寫入期間刪除時，不寫回其帳號與說明，候選停在 `approved` 由其他管理者再核准。
- 公開 bundle 不含 organizer 介面與寫入 route，由 `tests/public-artifact.test.mjs` 把關。
- 新候選活動預設進入引導；跨登入可恢復每位協作者自己的位置；完成 onboarding、切換區段或執行驗證都不會產生候選內容 revision。
- workspace preference 與完成 onboarding 的最終 SQL 寫入會再次檢查 active grant；權限在請求途中被撤銷時不會留下流程狀態變更，對外仍回 404。

## 工作區通知信

帳號通知模組沿用現有權限：邀請沿用即時登入信；實際接受而成立／變更 grant 才通知當事人及同 candidate 其他有效 Owner，同帳號去重。取消未接受邀請不產生撤權事件。被撤權本人收到歷史異動事實，不能由信件取得工作區資料；其餘失去資格者取消待寄，新增成員不補舊件。

活動建置申請依本人關係通知核准／拒絕；核准與首次 Owner grant 合併一封。內容（含更正）審核通過／退修、失敗重開，以及 publication failed／published 通知當時有效 Owner，協作者只接自身權限異動。完成既有 production verified gate 才通知已公開；舊核准進度／失敗信可在同版本已公開或版本更替時取消。業務轉換與通知在同一 D1 batch，寄送失敗不撤銷業務結果。

`/organizer?candidate=…&section=review` 優先於上次活動；`application=…` 打開指定申請，`?application` 未指定申請時打開申請面板，空值仍保留到登入信；`notifications=1` 開啟跨工作區共用設定。未登入時參數經白名單帶入登入信，無權限／不存在不默開其他活動。手機可讀指定活動目前狀態、活動申請與通知設定，編輯仍須桌機，同一信件保留目的地。信件指向公開活動時使用 `/events/{eventId}/`。

## 地圖編輯器

**實作**：`app/map-shape-geometry.ts`、`app/map-shape-drawing.tsx`
**測試**：`tests/map-shape-geometry.test.mjs`
**實作**：[`app/map-annotations.ts`](../../app/map-annotations.ts)、[`app/map-annotation-drawing.tsx`](../../app/map-annotation-drawing.tsx)
**測試**：`tests/map-annotations.test.mjs`

主辦單位工作區使用 `MapLayoutEditor`。本契約管畫布編輯行為；草稿的保存、權限、版本與審閱見[主辦單位工作區契約](./organizer-workspace.md#地圖)，操作順序見[地圖 authoring](../runbooks/map-authoring.md)。

**實作**：[`app/map-layout-editor.tsx`](../../app/map-layout-editor.tsx)、[`app/map-layout-editor-geometry.ts`](../../app/map-layout-editor-geometry.ts)、[`app/map-layout-editor-selection.ts`](../../app/map-layout-editor-selection.ts)、[`app/map-segment-edit.ts`](../../app/map-segment-edit.ts)、[`app/map-placement-tool.ts`](../../app/map-placement-tool.ts)、[`app/map-editor-history.ts`](../../app/map-editor-history.ts)、[`app/map-editor-preferences.ts`](../../app/map-editor-preferences.ts)、[`app/map-authoring-state.ts`](../../app/map-authoring-state.ts)、[`app/map-booth-list.tsx`](../../app/map-booth-list.tsx)、[`app/map-booth-coverage.ts`](../../app/map-booth-coverage.ts)、[`app/map-recognition.ts`](../../app/map-recognition.ts)、[`app/map-template-registry.ts`](../../app/map-template-registry.ts)
**測試**：`tests/map-authoring-state.test.mjs`、`tests/map-editor-preferences.test.mjs`、`tests/map-placement-tool.test.mjs`、`tests/map-segment-edit.test.mjs`、`tests/map-import.test.mjs`、`tests/map-template-shape.test.mjs`
**實作**：[`app/map-recognition-panel.tsx`](../../app/map-recognition-panel.tsx)、[`app/map-recognition-draft.ts`](../../app/map-recognition-draft.ts)、[`app/map-recognition-review.ts`](../../app/map-recognition-review.ts)、[`app/map-auto-recognition/build-layout.ts`](../../app/map-auto-recognition/build-layout.ts)
**測試**：`tests/map-recognition-draft.test.mjs`、`tests/map-recognizer-prototype.test.mjs`

### 檢視

- **編輯畫布的 100% 是整張地圖看得完**，不是把地圖拉滿畫布寬度；倍率由畫布實際可用空間與地圖比例算出。地圖以無外框、無捲軸的內嵌畫布呈現，放大後以平移查看，保留倍率重設與聚焦選取；放大上限與平移見[描摹顯示與精準操作](#描摹顯示與精準操作)。畫布高度來自編輯器版面而非固定值，右側屬性欄自行捲動，不把地圖擠成需要捲動才看得完。

### 攤位清單對照

共用編輯器可選填活動日 × 場地的攤位 scope。主辦工作區提供該範圍的清單，依目前 layout 即時計算已畫／待畫數量、可搜尋的待畫代碼與社團群組；只有已有座標的代碼提供定位，選取攤位也顯示對應群組。切換範圍清除清單篩選與選取。清單外代碼沿用 API 判定：候選活動為提醒，已發布活動為錯誤；畫面提示不取代送審驗證。未提供 scope 的嵌入仍保留基本編輯能力。

### 實驗性辨識校對

主辦在既有配置圖上辨識後，預覽與校對進度留在編輯器內，不寫入 `EventMapLayout`。每批只加入明確勾選的項目；以目前地圖重新檢查攤位代碼、攤位幾何、同類設施衝突與整份 layout 有效性，整批拒絕或整批成功，既有人工內容及輔助線保留。每批成功採用各算一步復原。

辨識面板自己的成功採用是唯一的基準更新例外：剩餘結果接到本次產生的同一份 layout，原 proposal 項目鍵不改變，已採用項目保留顯示但不能再次加入。剩餘項目重新計算衝突。手動編輯（含輔助線）、復原／重做、替換 layout、換圖、換活動日／場地／攤位清單、修改辨識範圍或重新辨識，仍使舊結果失效；晚到的 Worker 訊息不能恢復結果。儲存及配置圖讀取期間不能採用。有效結果可跨工具切換及全視窗展開／返回保留，成功通知不跨工具留存。

預覽與清單共用待核對、已勾選、已採用與衝突狀態；未配對另作可並存的屬性。點預覽的排以清單內捲動與焦點定位對應項目，不自動勾選；Enter／Space 有相同行為，清單既有勾選與查看操作保留。

缺漏提醒依內部結構化診斷的攤位代碼，排除目前 layout 實際已有的格。整排已畫不再要求新增；部分已畫只列剩餘代碼，不以排名相同或任一格已存在代替完整覆蓋。排內少格採相同判定。清單格式錯誤、未配對區塊與待命名區域等其他有效提醒保留；未採用的預覽不能代替保存及送審的攤位覆蓋驗證。

### 放置工具

新增工具只切換模式，尚未放置不改草稿；工具顯示按下狀態、畫布游標及操作提示。切換工具或 Escape 取消尚未放置的預覽，`pointercancel` 不建立元素，也不留下復原紀錄。

- 排／排段與單一攤位拖出外框，放開才建立；沿用既有連續描摹與編號。
- 「攤位」工具組的「新增保留／取消格」先選保留空桌（預設）或取消攤位，再拖框建立；單擊、Escape 及 `pointercancel` 不建立。新格沿用單一矩形的選取、拖移、四角縮放、座標欄位、多選、刪除與復原／重做，可在屬性欄改類型，隨地圖保存重開及複製。標記不改動攤位名單、代碼或覆蓋提醒，原圖 X 的類型由主辦決定，辨識器不自行猜測。
- 企業攤、舞台與其他區域只能拖出外框建立：每個場館的區域大小不同，沒有值得猜的預設大小，所以單擊不建立任何東西，游標移動時也不跟著預設大小的預覽框。柱子可拖出外框，或單擊以預設大小置中放置。靠近畫布邊緣時限制在畫布內。點擊與拖曳以螢幕 3 px 區分，單方向細線不建立矩形。
- 出入口是同一個工具：工具啟用時狀態列出現「類型」選單（入口／出口／出入兩用，預設入口），選過的類型保留到下次放置；以單擊位置建立，預設朝北，類型與方向都可在屬性欄更改。三種類型在編輯器、讀者地圖與設施清單畫同一個圖示：入口圓形、出口方形、出入兩用菱形內兩支反向並排的箭頭。
- 服務設施也以單擊位置建立：工具啟用時狀態列出現「類型」選單，先選九類之一再點畫布，包含售票處與更衣室；選過的類型保留到下次放置。屬性欄可改類型、填選填的名稱（40 字以內，留空就不存名稱），以及 X／Y。
- 每次設施放置只記一個復原步驟，選取新元素並回到選取模式。

### 排與排段

- **「新增排／排段」在原圖上框出一段攤位**：先填排標籤、代碼前綴、**起始編號與結束編號**（配置圖上印的就是這兩個數字，例如某欄是 01–26 就填 1 與 26，格數由兩者相減得到）、補零位數、方向與**編號起點**（直排：上→下／下→上；橫排：左→右／右→左），然後直接在底圖拖曳框住一段連續攤位。**放開滑鼠就建立**，沒有另外的確認按鈕——框選本身已經說完攤位需要的一切，要檢查的東西不論如何都在畫布上。**座標與每格寬高由框選結果算出**，一般流程不必輸入。
  - 框選矩形就是這一段的**總外框**：直排 N 格時每格高為框高的 N 分之一、寬即框寬，橫排反之。每格由相鄰切線構成，因此**連續攤位無縫相接**，不會因為中心間距與格子尺寸兩套數值不匹配而出現縫隙或重疊；切線一律由框的起點加上總長的 i/N 算出，長排也不會累積浮點誤差。
  - 沒填排標籤時不會開始框選，因為放開滑鼠就已經建立，沒有第二次機會補。
  - 方向取框的長軸；換軸時編號起點回到該軸的第一端。排標籤與代碼前綴是任意字串，因此地支（`子`、`丑`…）或 `商` 這類區段不需特殊處理；前綴留空則沿用排標籤。
  - **建立後這一段仍被框著，四角把手可以整段重新分割**，並對其他已放好的攤位吸附（按住 Alt 暫停）。這是修正整排大小的方式：不必逐格調整，也不必整排刪掉重放。**點任何一格攤位就改抓它所在的那一段**，因此先前放好的排段隨時可以再調整；一段是指彼此貼齊的連續攤位，走道兩側算兩段。整段外框欄位與改編號見[排段整體調整](#排段整體調整)。
  - 建立後仍可改**方向**（同一個框沿另一軸重新分割，代碼不變）與**編號起點**（代碼整段反過來，矩形不動），不必復原重畫。
  - 建立後面板不關閉：排標籤、前綴、補零位數、方向與編號起點都留著，**起始編號與結束編號各自加上剛才的格數**，可以直接框下一段。K51 的 A 排因此是：填 1 與 12 後框第一段；面板自動跳到 13–24，把結束編號改成 32 再框第二段；面板跳到 33–52，把結束編號改成 44 再框第三段。
- **一個排標籤可以有多個排段**：填入既有排標籤時，這一段會**併入該排**，面板顯示「將加入既有 B 排（目前 N 格）」；填新標籤才建立新排。CWT*K51 的 B 區左右兩欄、被通道切成三段的 A 區、以及一排背對背的兩面攤位，都是同一個排標籤下的數個排段。**排的方向取第一段的方向**，所以同一排的各段方向不一致時，排標籤會落在錯的一軸。同一場館的不同活動日攤位範圍不同（K51 第一天雙欄是 01–26／27–52，第二天是 01–24／25–48），每一天各自框選即可，工具不綁定任何固定格數。
- **背對背的兩面用相反的編號起點**：同一排上下（或左右）兩面編號方向相反時，兩段用同一個排標籤、不同的起始編號與相反的編號起點即可，不需要另一套規則。編號起點只影響代碼發放的順序，不改變矩形，也不寫進 `EventMapLayout`。
- 拖曳過程中會即時把框切成 N 格畫在畫布上，放開才寫進 layout；跨排重複的攤位代碼與結束編號小於起始編號都會擋下並說明原因。重複的排標籤不再是錯誤，而是併段。
- **編輯畫布會畫出排標籤**（A、B、C…W），選取同排的一格或多格後，可在「排標籤位置」指定上／下／左／右側；預設為直排上方、橫排下方。編輯器、複製預覽與 Reader 共用 `rowLabelPlacement()` 及螢幕字級／邊界投影，標籤跟著整排外框走，不是每段一個，U 形與中斷排不猜編號起點。修改位置不改攤位代碼或矩形，可復原並隨草稿保存。文字只沿所選側滑回畫布，不跨到攤位或另一側；此側容不下完整文字或與既有名稱衝突時不畫，屬性欄提示調整位置或放大檢視。
- **錨點推算（進階設定）**：這是**傾斜校正工具**，只適用**同一條等距直線排段**——原圖有輕微旋轉、掃描歪斜，或很難精確框到頭尾時使用；**不得跨走道或跨平行欄**，那些情況請分開框選。展開「進階設定」後按「開始標記錨點」，於畫布空白處點選三格以上的中心，並在清單填入該格在這一排的編號（可不相鄰、不依序，例如第 1、5、12 格）。工具以最小平方法對兩軸擬合直線，外推出最低到最高編號之間的每一格，並顯示格數、起始編號與**最大偏差**——偏差大代表某個錨點點在別格上，或錨點根本不在同一條線上（例如分屬兩欄），應先修正再推算。三個是最少能互相矛盾的數量，兩個只能決定一條線而無法平均掉點選誤差。推算只給中心與格數，外框仍用進階設定的每格寬高，所以它不保證無縫。
  - 進階設定同時保留**用起點與終點的中心座標建立**的舊流程，供斜排或刻意留間距的排段使用。
  - **推算結果一律是草稿**：草稿以虛線畫在畫布上，逐格列出並各自有確認勾選框，**預設全部未確認**。未確認的格以灰色虛線畫出、已確認的以綠色實線畫出，兩者都在畫面上，才能對著原圖判斷該留哪幾格——外推會產生錨點之間本來不存在的格子（例如中間其實是通道），預設勾選會讓確認步驟形同虛設。只有勾選確認的格會寫進 layout，一格都沒確認時「加入確認的 N / M 格」不可按。草稿不存在於 `EventMapLayout` 裡，因此未確認的格子在結構上就不可能進入送審內容——這是位置關係，不是額外的旗標。
  - 改動排標籤、代碼前綴、每格寬高、補零位數等任一欄位，或新增、移除、改動任一錨點編號，都會**丟棄既有草稿**；改變畫布尺寸時錨點與其他元素一起依比例縮放，草稿同樣丟棄，必須重新推算，避免畫面顯示新值卻寫入舊值。關閉「新增排／排段」面板會一併結束錨點標記，畫布隨即恢復多選與拖曳。
  - 推算只決定端點與格數，實際產生 slot 仍由 `generateRowSlots` 負責，代碼與唯一性檢查與手動建立完全相同。推算邏輯在 `app/map-layout-editor-geometry.ts`，不依賴任何版型辨識器，可用於沒有辨識器的新版型。
- inspector 的排清單可改名、改方向或移除整排。
- **「手動畫攤位」逐格描繪**：輸入排標籤與起始代碼後在畫布拖曳出攤位外框，一次一格，代碼自動遞增，適合間距不規則、等距產生會對不上的段落。標籤欄有既有排標籤的下拉建議；填既有標籤即併入該排。

### 選取、移動與批次操作

- **註記工具**：「新增文字註記」拖曳矩形，點一下不猜尺寸，釋放後以「文字註記」起始文字建立並選取；屬性欄可改純文字（最多 120 字、3 行）、位置與寬高。「新增動線箭頭」依序點選起點、拐點、終點，至少 2 點後完成；待放置折線有方向預覽，取消、工具切換、Escape 不寫入 layout。箭頭可選取、拖曳、微移、縮放、拖動或輸入頂點、插入／移除頂點、Delete 及復原／重做；直線的零寬或零高保持原軸，改另一軸可用頂點編輯。所有座標使用同一畫布，縮放整張畫布同步縮放註記矩形與折線點。
- 編輯器顯示文字矩形與攤位、折線與箭頭頭部穿過攤位的修正提示。這些碰撞可先保存草稿再修正，送審與發布必須移開，Reader 不靠省略註記避碰。時段只是該地圖的靜態文字，保存重開不解析、不跨日改寫；同場地複製保留文字，主辦核對新日並改複本，來源不變。僅有註記或箭頭的地圖也能保存，不能再視為可裁切重建的空畫布。
- 復原／重做清掉依元素索引持有的待重繪多邊形及待放置箭頭，避免刪除／還原元素後完成預覽而改到另一個元素。

- 可拖曳或輸入座標調整一般攤位、柱子、出入口與服務設施。**場館外框從外框線拖曳**，避免填滿整張圖時吃掉空白處的點擊。
- 可新增、命名、分類、縮放或移除企業攤、舞台及其他非一般攤位區。
- 選取一般攤位、柱子、非一般攤位區或場館外框後，物件四角顯示直接縮放把手。
- **多選**：Shift 點選加選或取消單一元素；在空白處拖曳框選範圍內的所有元素，按住 Shift 拖曳則併入既有選取。選超過一個元素時，四角把手改為框住整組，縮放會把整組從原本的外接矩形映射到新的外接矩形，內部間距按比例保留。**整組縮放維持長寬比**：長寬各自依自己的邊長換算時，兩排攤位那種細長選取會讓同一個手勢在兩軸產生差好幾倍的倍率，格子忽高忽扁，而且兩軸還會各自先撞到畫布邊界或最小值；改成兩軸共用一個倍率（把位移投影到選取範圍自己的對角線），格子就維持原本的形狀，放大縮小也是線性的。要單獨改一個元素的寬或高，選取單一元素或改用 inspector 的寬／高欄位。
- **批次操作**：多選後可一起拖曳、以方向鍵微調，或用 inspector 的「自動對齊」與靠左／靠右／靠上／靠下對齊。整組共用同一位移，因此碰到畫布邊界時整組一起停下，不會壓扁彼此間距。一次批次操作是一個復原步驟。
  - **對齊是往該側靠攏，不是疊在同一條線上**：每個元素往指定的那一邊滑，滑到整組外接矩形的那一側邊界、或撞到已經定位的元素為止。另一軸完全不動，所以直排仍是直排、橫排仍是橫排；改變的是間距收攏，而且**兩個攤位不會疊在一起**。**同不同一條線，以半格為界**：兩個元素在另一軸的重疊超過較小那個的一半才算同一條線，會依序緊貼排好；重疊不到一半的就是並排，彼此擋不住，因此一排攤位按靠上就是單純的靠上對齊。手繪描出來的兩直排常常互咬幾個單位，以前只要咬到一點就被當成同一直排，整塊會被接成一條上下錯開、兩倍長的鏈。原本互相重疊的一組攤位被推開後會比原本的外接矩形長，末端可以超出該矩形，只有畫布邊界會擋下它。
  - **自動對齊**：一鍵把手繪描出來的一塊整理成格狀——先把每格改成組內最多元素採用的大小（兩種大小一樣多時取較大的，每格以自身中心縮放），再依「畫的時候本來在哪一直排」排成格線：從整組左上角起算，每一直排由上而下一格接一格，直排與直排緊貼排開。分排同樣以半格為界，且是跟左右相鄰那格比而不是跟排頭比，所以描歪的一直排仍算同一排。兩排直排一起選取後按一次就會變成緊密貼合、不重疊的格狀；出入口沒有大小、在格狀裡沒有位置，維持不動，也不會把整塊拉到它那邊（格線的起點只看有大小的元素）。
- **複製多排**：選取同一排的一格或多格攤位，指定複製份數（1–100）、方向、邊緣間距與排名序列。序列提供 A–Z、十二地支或自訂名單；完整列出將新增的排名與攤數。預設序列不足時直接說明從起始排名起最多可建幾排，不要求填寫排名。保留原排的 U 形、分段、編號尾碼及方向，只平移幾何並替換代碼的原排名前綴。前綴不符時先引導調整排段代碼，不猜測中文遞增或加假後綴。預覽不寫入草稿；排名／代碼重複、攤位重疊或超出畫布時整批拒絕。確認後新增的攤位維持選取，整批是一個復原步驟。取消、Escape、選取或 layout 變動會捨棄預覽。
- inspector 上方的「畫布寬」「畫布高」改變座標空間，既有排、柱子、非一般攤位區、出入口與服務設施依比例保留。恰在畫布右緣或下緣的出入口與服務設施縮放後仍在邊緣上，不因浮點誤差落到畫布外而無法儲存；原本就在畫布外的點不會被拉回。
- 服務設施和出入口一樣是點：框選、多選、整組移動、方向鍵微移與 Delete 都包含它，沒有大小所以不參與自動對齊的格線，也不顯示縮放把手。
- 畫布有焦點時按 `Delete`（或 `Backspace`）移除選取的元素，等同 inspector 的移除按鈕：場館外框不會被移除，排上最後一格被移除時整排一併消失。

### 私人輔助線與吸附

草稿 envelope 可選填 `authoring: { guides: [{ id, axis, position, locked }] }`；`axis` 為 `x`（垂直）或 `y`（水平），位置採地圖座標。舊稿未帶 authoring 時，介面視為零條輔助線，不改寫舊的 snapshot bytes。每稿最多 256 條，ID 唯一且最多 80 字，位置為有限數字且不得超出畫布；未知欄位與 malformed metadata 拒絕保存。

- 水平／垂直工具以畫布單擊新增；輔助線可選取、拖曳、數字微調、鎖定／解鎖、刪除。鎖定禁止移動，仍可作吸附目標。線條為細虛線，命中區大於可見線寬。
- 新增、移動、鎖定與刪除可復原／重做，和地圖共用同一份歷史。畫布尺寸改動同時縮放輔助線，復原也一併還原。
- 矩形外緣與出入口、服務設施中心吸附手動線及既有向量元素，8 螢幕 px 內取最小位移，同距離優先手動線。多選移動用整組外框，保留成員相對位置；排段縮放只改所拖角的邊，內部再等分並保持無縫。
- 顯示輔助線與啟用吸附是分開的控制，Alt 暫停目前手勢的吸附。吸附時顯示命中線及其 X／Y 座標；不從圖片偵測邊線，也不為每個攤位自動建立輔助線。

Organizer 把 authoring 跟隨 map revision 保存、重開，沿用原有角色／狀態與 expected version／revision 檢查；不新增資料表或另一條保存路徑。核准 snapshot 保留私人草稿內容，但 publication／候選匯出僅取 `content.layout`，公開地圖與 Reader 不含輔助線。顯示／吸附開關不推進候選版本。

### 描摹顯示與精準操作

配置圖顯示與否、透明度、描摹模式與微移步進都是個人 UI 偏好：只存在這個瀏覽器（`localStorage` 鍵 `map-editor-display/1`），不進草稿 envelope、不進歷史、不推進候選版本，也不隨草稿送審。讀不到或格式不符的偏好逐欄退回預設（顯示配置圖、透明度 30%、關閉描摹、步進 1），不讓控制項停在沒有對應選項的狀態；瀏覽器不給寫入時只是下次回到預設。

- 配置圖可顯示／隱藏、透明度 0–100% 連續調整並可一鍵重設為 30%。隱藏是改 `visibility` 而非移除，配置圖始終不接受滑鼠事件。沒有配置圖時，這三個控制項為 disabled。
- 描摹模式把攤位、非一般攤位區、柱子、出入口與服務設施收成外框（去填色），並隱藏格內代碼與排標籤；幾何與命中區不變。
- 選取以獨立的 selection overlay 呈現，視覺線寬不超過 1.5px；原元件邊線維持原寬，不再改成 4px，也不加陰影。resize 把手的可見方塊縮小，命中區維持較大的透明範圍。
- 微移步進提供 0.1／0.5／1／5／10，方向鍵移動一個步進，Shift + 方向鍵為 10 倍，步進位於「底圖與畫布」設定中。
- 編輯倍率最高 800%；畫布上的滑鼠滾輪向前放大、向後縮小，沿用倍率按鈕的步進及視野中心；面板內的滾輪保留原生捲動，拖曳編輯或平移期間不改倍率。放大後 Space + 拖曳或滑鼠中鍵拖曳平移畫布，平移只捲動視野，不修改 layout，也不產生復原步驟。

### 排段整體調整

選取單一攤位後可抓取它所在的排段（彼此貼齊的連續攤位），並以整段外框的 X／Y／寬／高欄位調整；每次修改重新無縫等分該段內部攤位，欄位值限制在畫布內且寬高不得收合為零。修改編號與方向是分開的第二步：讀入現有代碼後才可改代碼前綴、起始／結束編號、補零位數、方向與編號起點，套用時只重寫該段。同一排的其他排段保留自己的代碼、幾何與編號方向；只有整排都在選取範圍內時才改寫該排的 `orientation`。代碼與該段以外的既有代碼衝突時拒絕套用並指出衝突代碼，段內原本的代碼可自由重用。

外框一律是該段攤位目前所佔的範圍：以拖曳、方向鍵微移或任何其他方式移動這些攤位之後，四角把手與四個欄位都對著移動後的位置，再次調整不會把該段退回先前的座標。選取不再剛好是該段的成員時（點選別的元素、加減選、框選或從元素選單切換），排段調整結束，面板與把手一併收起，不留下指向另一段的編輯目標。

### 多排同步上下邊界

選取兩排以上的直排攤位後，按「同步上下邊界」預覽共同的上界、下界與內部分隔線。上下界預設取整個選取的外緣，可直接修改上界 Y／下界 Y。綠色外框只呈現預覽，不寫入 layout、歷史或保存內容；按「套用上下邊界」才提交。取消、Escape、改變選取或編輯／替換 layout 都會捨棄待套用值。預覽不攔截畫布操作，套用後維持原選取。

每一排以共同邊界無縫等分重切，因此各排的分隔線落在同一條線上，不會因為各自四捨五入格高而漂開。**每一格保留原本的 X 與寬度**，排與排之間的走道不變；未選取的元件完全不動。

畫布範圍、最小格高 1 與「下界必須大於上界」在共同邊界層級檢查一次，不逐格各自夾限；空值與非有限數值不能套用。不適用時動作停用並就地說明：混入設施、不足兩排、各排格數不同（列出實際格數）、選取中含橫排攤位、無法辨識直排，或共同高度放不下該格數。依 X／寬度辨識直排，每排至少選兩格；同一 row 的多欄仍各自分組。代碼、row 歸屬、順序與編號方向不受影響，這個動作只改幾何。一次套用是一個歷史步驟，一次復原即可還原整批。

與外部元件碰撞沿用既有的重疊提示與驗證，不另做全圖避碰或自動搬移。

### 逐步復原

工具列的「復原」與「重做」（`Ctrl`／`Cmd` + `Z`，加 `Shift` 或 `Ctrl` + `Y` 重做）可回到任一中間狀態，不必整份還原。快捷鍵在 inspector 有焦點時同樣有效，但文字欄位內保留瀏覽器原生的復原。

- **一次手勢算一步**：一次拖曳或縮放、一段連續同方向的方向鍵微調、同一欄位的連續輸入各自合併成單一步驟；改變方向、換欄位、放開方向鍵或結束拖曳都會結束該步驟，下一次操作另起一步。
- 復原後再編輯會捨棄可重做的分支。
- 歷史只保存最近 `LAYOUT_HISTORY_LIMIT`（50）份 layout，**不保存原始圖位元組**。超出上限的最舊步驟會被丟棄。
- 重新辨識圖片、改用空白地圖或按「還原本次編輯」是整份替換 layout，不是編輯步驟，歷史會從新的 layout 重新開始。

### 編輯工作區

上方依攤位、設施、區域、輔助線、底圖與畫布、辨識分組；攤位清單可收合，屬性隨選取或工具展開。攤位清單與屬性面板浮在地圖左右兩側，各自捲動，不預留側欄空間；開關面板及選取時不改變畫布的尺寸與縮放。底部保留吸附與視域控制，選取模式另列多選、框選與平移的操作提示。鍵盤順序與畫面相同：工具列、攤位清單、畫布，再到畫布下方的控制列。編輯器寬度不足 900px 時，展開按鈕旁提示改用全視窗；全視窗內不顯示。

切換工具分組會取消尚未放置的元素及待套用預覽，不改變已完成的地圖與復原歷史。點選「辨識」直接顯示底圖與辨識操作，不需再展開第二層面板，預覽隨可用高度延伸；離開再返回時保留辨識輸入及尚未失效的結果。

從主辦地圖步驟可展開編輯器至全視窗。展開／返回不重建 layout、選取或復原歷史；返回只收合，真正離開及切換範圍仍須處理未儲存變更。全視窗隔離外層控制項、保留儲存動作與結果，儲存失敗不關閉或丟棄草稿。Escape 優先取消待套用預覽及放置工具，其次收起工具分組，最後返回地圖步驟。返回恢復展開按鈕的焦點。

### 多邊形

設施工具可選場館外框、企業攤、舞台或其他區域，逐點描繪多邊形；完成前只有預覽，取消不建立元素。曲線不靠手點：「最後 3 點連成弧線」把最近點下的起點、弧上一點與終點換成通過三點的圓弧（約每 7.5° 一點，不超過頂點上限）；剛好 3 點時「3 點畫成圓形」換成 48 點的圓。三點共線、弧線／圓形會超出畫布，或圓形小到無法成形時，顯示原因並保留原點。產生的頂點仍是一般頂點，取到 0.1 單位，取整後重疊的相鄰點合併，之後照常編輯；動線箭頭也有同一個弧線按鈕。場館外框替換該張地圖外框，其餘種類建立獨立命名區域。選取後可重新描繪、改回外接矩形、拖動或用座標移動／縮放，並在頂點面板增刪及修改座標，或拖曳畫布頂點。無效頂點編輯會顯示原因且保留原有效形狀。所有已完成操作使用同一復原／重做與保存機制；一般攤位格不提供多邊形工具。

## 共享 reference 選擇

送審 snapshot 保存活動的 reference selection，記錄它使用的主辦、分類目錄、場館與場地；核准發布時依此產生公開的 `reference-records.json`。

### `reference-selection/1`

selection 保存語意，不保存定位：

- `eventId`；
- organizer 集合；
- category catalog 的 `id`、`organizerId`、`revision` 與 path；
- venue、選填的單場館總覽 `overview`（`id === venue.id`、`path === references/venue-overviews/<venueId>.json`），與其 venue-space 集合的 stable ID 與 path。

所有 path 以 `references/` 開頭。selection 不含版本或 hash——那些由活動資料 bucket 的版本承擔。

當單場館多場地活動送審時，若 `organizer_reference_records` 已存在對應且涵蓋該活動全部已指派 `venueSpaceId` 的 `venue-overview/1` 記錄，`resolveOrganizerReferences()` 自動將其帶入 `venues[0].overview` 並納入 `reference-records.json` 與 R2 公開檔案；已發布活動的修正候選（`AMEND`）補上或沿用有效 `venue-overview/1` 不視為基準變更。單筆 `venue-overview/1` 驗證同時在共用驗證器強制 `buildings[].id` 與非空 `buildings[].venueSpaceId` 唯一、座標位於 `viewBox` 內且不含任意 SVG／HTML／外部網址。Phase 1 不提供 `/admin` 或 `/organizer` 園區總覽圖形編輯介面，`/api/admin/references` 明確拒絕針對 `venue-overview` 的 `edit`／`delete` 請求。

分類目錄 selection 同時保存 `id`、`organizerId`、`revision` 與 path，避免不同版本被誤認為同一份資料；organizers 與 venues 使用陣列，因此可完整表示 lead／co-organizer／partner 與多場館 assignment。
