# 主辦單位工作區契約

主辦單位在獨立入口 `/organizer` 建立候選活動、匯入攤位資料、畫地圖、驗證、預覽並送審。它產生的是**候選內容**，不是公開資料：公開場刊仍只來自 data repository 的 reviewed snapshot 與 pin。

**實作**：[`app/organizer/`](../../app/organizer)、[`app/organizer-client.ts`](../../app/organizer-client.ts)、[`app/organizer-event.ts`](../../app/organizer-event.ts)、[`app/event-aliases.ts`](../../app/event-aliases.ts)、[`app/organizer-workspace.ts`](../../app/organizer-workspace.ts)、[`app/organizer-import.ts`](../../app/organizer-import.ts)、[`app/organizer-workbook.ts`](../../app/organizer-workbook.ts)、[`app/organizer-publication.ts`](../../app/organizer-publication.ts)、[`app/organizer-publication-presentation.ts`](../../app/organizer-publication-presentation.ts)、[`app/event-authoring-scope.ts`](../../app/event-authoring-scope.ts)、[`app/publication-bundle-assembler.ts`](../../app/publication-bundle-assembler.ts)、[`app/github-app-token.ts`](../../app/github-app-token.ts)、[`app/github-installation-probe.ts`](../../app/github-installation-probe.ts)、[`app/github-publication.ts`](../../app/github-publication.ts)、[`app/github-remote-auditor.ts`](../../app/github-remote-auditor.ts)、[`app/circle-portal-handlers.ts`](../../app/circle-portal-handlers.ts)、[`db/identity-repository.ts`](../../db/identity-repository.ts)、[`functions/api/organizer/`](../../functions/api/organizer)、[`functions/api/admin/organizer/`](../../functions/api/admin/organizer)、[`functions/api/admin/integrations/github/probe.ts`](../../functions/api/admin/integrations/github/probe.ts)、[`app/organizer-amendment.mjs`](../../app/organizer-amendment.mjs)、[`app/organizer-amendment-baseline.ts`](../../app/organizer-amendment-baseline.ts)、[`app/organizer-amendment-settings.ts`](../../app/organizer-amendment-settings.ts)、[`app/publication-artifacts.ts`](../../app/publication-artifacts.ts)、[`app/publication-rollout.ts`](../../app/publication-rollout.ts)、[`app/publication-dispatch.ts`](../../app/publication-dispatch.ts)、[`app/publication-scheduler.ts`](../../app/publication-scheduler.ts)、[`app/publication-runtime.ts`](../../app/publication-runtime.ts)、[`app/publication-origin.ts`](../../app/publication-origin.ts)、[`app/github-publication-driver.ts`](../../app/github-publication-driver.ts)、[`app/github-publication-deployment.ts`](../../app/github-publication-deployment.ts)、[`db/organizer-amendment-repository.ts`](../../db/organizer-amendment-repository.ts)、[`db/organizer-application-repository.ts`](../../db/organizer-application-repository.ts)、[`workers/publication-dispatch/`](../../workers/publication-dispatch/)
**測試**：`tests/organizer-workspace.test.mjs`、`tests/organizer-handlers.test.mjs`、`tests/organizer-repository.test.mjs`、`tests/organizer-reopen.test.mjs`、`tests/github-remote-auditor.test.mjs`、`tests/organizer-entry.test.mjs`、`tests/modal-focus.test.mjs`、`tests/organizer-import.test.mjs`、`tests/event-authoring-scope.test.mjs`、`tests/publication-bundle.test.mjs`、`tests/github-publication.test.mjs`、`tests/github-app-token.test.mjs`、`tests/github-installation-probe.test.mjs`、`tests/multi-space-event-map.test.mjs`、`tests/organizer-amendment.test.mjs`、`tests/organizer-amendment-baseline.test.mjs`、`tests/organizer-amendment-handlers.test.mjs`、`tests/organizer-amendment-repository.test.mjs`、`tests/organizer-applications.test.mjs`、`tests/organizer-publication-presentation.test.mjs`、`tests/publication-artifacts.test.mjs`、`tests/publication-amendment-artifacts.test.mjs`、`tests/publication-deployment.test.mjs`、`tests/publication-workerd.test.mjs`、`tests/github-publication-driver.test.mjs`、`tests/organizer-event-aliases.test.mjs`、`tests/organizer-amendment-settings.test.mjs`
**決策**：[ADR-0047](../adr/0047-organizer-onboarding-opens-into-a-resumable-workspace.md)、[ADR-0046](../adr/0046-approved-organizer-publications-may-merge-app-owned-pull-requests.md)、[ADR-0058](../adr/0058-publication-is-enforced-by-the-app-not-the-ruleset.md)、[ADR-0038](../adr/0038-authoring-moves-to-the-control-surface-local-stays-as-backup.md)、[ADR-0039](../adr/0039-one-data-repo-for-events-and-references.md)、[ADR-0044](../adr/0044-an-accepted-circle-list-is-not-yet-catalogable.md)、[ADR-0068](../adr/0068-published-event-settings-are-declared-amendments.md)

首次發布與發布後更正均已接上 Web UI 與自動發布。真實執行證據見 [CH20 首次發布／恢復](https://github.com/dekkmarsvin/tw_doujin_event/issues/212)及[地圖更正](https://github.com/dekkmarsvin/tw_doujin_event/issues/190)，其中記錄的人工補救不因功能已上線而抹除。部署模式與缺少 dispatcher 時的處置見[發布邊界](#發布邊界)。

## 入口與登入

- 入口是 `/organizer`，`noindex, nofollow`，不出現在公開導覽，也**不與 `/circle` 或閱讀端共用 bundle**。
- 登入沿用[社團自助控制面](./circle-portal.md)的 email 一次性連結與統一 7 天 session cookie；`POST /api/auth/request-link` 以 `audience: "organizer"` 決定信件與登入連結指向 `/organizer`。Turnstile、速率上限與 session 規則只寫在該契約，本文不重複。
- **帳號本身沒有 Organizer 權限。** 能看到工作區的條件是持有任一候選活動的 grant，或是全域管理者。
- 申請人可在同一 `/organizer` 登入查看自己的申請；送件或待審核不授予候選活動 grant。申請表與結果可在手機使用，活動資料與地圖編輯仍限桌機。
- 工作區是桌機介面。視窗過窄時顯示「請改用桌機」，不提供縮小版的地圖編輯。
- 左側活動列表可以收合，收合後把寬度讓給工作區。收合狀態不保存，重新登入回到展開。

## 活動申請

主辦、獲授權人員及提供官方來源的資料整理者沿用 Organizer magic-link 登入。`POST /api/organizer/applications` 收活動名稱、官方 HTTPS 網址、預計開始／結束日期、選填地點、與活動關係及說明；資料整理者須填整理理由。不收另一份聯絡資料，不接受既有 eventId／candidateId 或角色授權欄位。

`GET /api/organizer/applications` 只回傳自己的申請；全域管理者在原工作區「活動申請」查看全部申請、登入帳號及官方來源。私人內容不進 Reader 或匿名 API。拒絕必須填理由，申請人可回此頁更新狀態。送件使用 client UUID，重試同一內容只留一筆，不能以相同 UUID 覆寫或讀取別人的申請。

管理者以 `POST /api/admin/organizer/applications/:id` 核准／拒絕。核准在同一 D1 batch 轉換 pending 狀態、建立新 CREATE 候選、初始 revision／workspace、已接受的邀請及 Owner grant；以唯一 review token 保護所有相依寫入，交易內重查申請者、管理者及 session。重複／併行同決策回原結果，相反決策回 409，不會重新授予已撤銷的 grant。拒絕不建候選。既有活動請由管理者拒絕重複申請並按原協作者流程處理，不因名稱或來源相同而授權原活動。

新候選沿用申請名稱與官方來源，預計日期／地點留在申請供確認；真正活動日與使用空間由既有引導填寫。核准申請僅准許建置，不建立「官方認證」標示；內容送審、核准 snapshot、publication job、恢復與 production smoke 全沿用既有路徑。

公開活動選擇頁的 CTA 由 build-time `VITE_ORGANIZER_APPLICATIONS_OPEN=true` 控制，送件另由 Pages `ORGANIZER_APPLICATIONS_OPEN=true` 控制，均預設關閉；Reader 不為此呼叫 Function。隔離／受控驗收可只把明確帳號加入伺服器的 `ORGANIZER_APPLICATION_ALLOWED_EMAILS`（逗號分隔），不顯示公開 CTA，其他帳號送件仍回 403。既有邀請與已送件結果不受關閉開關影響。啟用條件與步驟見[部署 runbook](../runbooks/deployment.md#organizer-發布)。

申請與決策不設新的 TTL／排程；帳號刪除時刪除 pending 申請，已審核申請保留去識別的決策與候選連結，清空申請自由內容與理由。帳號／審核者去識別化沿用既有刪除交易；正式活動內容及 sole-owner 刪除保護不變。

## 引導式任務站與活動建置冊

開啟活動時才恢復該協作者上次的項目與引導步驟；儲存後重讀活動只更新資料與狀態。較晚到達的儲存回應不得將已切換的項目跳回原處，也不關閉使用者正在查看的全部項目。

- 新候選活動先進入三項真實資料任務：活動識別與官方來源、活動日期、場館與使用空間。任務進度直接篩選 `validateOrganizerEventDraft()` 的 issue，不另有一套 Wizard 驗證。
- **引導期只有一套進度，而且只算已儲存的。**「已完成 N/3」讀已保存草稿，不讀畫面上的輸入：打字打對不是一個完成的步驟，而步驟列上那一行已經寫著「尚未儲存」。引導期不顯示六區的準備進度——它講的是還沒走到的工作，N/6 與眼前的 N/3 是兩套互相矛盾的說法。
- **完成 onboarding 後只有一份主要導覽。** 準備進度側欄承擔六區的切換、各區狀態、下一步與待修正清單；面板上方不再另有一條編號步驟列，那份複本只能靠手工維持同步。側欄的區段清單以 `活動項目` 具名。
- **任務第一次打開時是中性的。** 整份任務問題清單是儲存的回答，等按下去再出現；唯一例外是它同時也是儲存鍵被停用的理由——停用不能沒有理由。「儲存並繼續」檢查它所站的那一個任務，未完成就保留輸入、說出缺什麼、不前進；「儲存並離開」與離開對話框不帶這個檢查，半成品草稿是可以存下來回頭再做的東西。
- 動作回饋遵循 [Action Feedback](../design/components.md#action-feedback)：切換引導任務不沿用前一任務的驗證或儲存訊息；建置冊儲存活動、場館或匯入後，重新取得已存版本仍保留當次成功回饋，再編輯或發動下一動作才清除。已存草稿的正規化值同步回未修改的表單；有未儲存輸入時，不因重新整理而更新它的 `expectedVersion`。首次載入先核對記住的活動是否仍在可見清單；切換活動的讀取 effect 卸載後不再套用其回應。
- 活動、場館與匯入表單在儲存及其重新讀取期間停用編輯，避免成功回饋對不上提交內容；重新讀取失敗不降低已成功儲存的版本，仍可再儲存。
- **匯入範例不會因為選了檔案而消失。** 選檔前展開、選檔後收合；下載分成空白 CSV（拿去填）與填寫範例（拿去讀）兩種，兩者都由 `buildOrganizerImportSample()` 依這場活動的活動日、使用空間與是否需要展區產生。預覽本身就是確認步驟，所以取代語意寫在「確認並儲存」旁，不另外開對話框。
- 三項基礎設定通過後，`POST /api/organizer/events/:candidateId/workspace/complete-onboarding` 以 `expectedVersion` 再次檢查已保存草稿，成功後永久進入活動建置冊。成功回應遺失後可用任何舊版本重送，仍會冪等回傳既有 binder 狀態；後續資料錯誤只顯示為需要處理，不會退回引導。
- 「查看全部項目」不完成 onboarding；它只暫時打開六個區段。每位協作者的上次引導任務與建置冊區段由 `PATCH …/workspace` 分別保存，跨登入恢復且不互相覆蓋。
- workspace 偏好與 onboarding 狀態不屬於候選內容：更新它們不增加 `current_version`，也不建立活動 revision。ADR-0047 上線前已存在、沒有 workspace state 的候選一律從建置冊開啟。
- 表單有未儲存變更時，切換活動、引導任務或建置冊區段會提供「儲存並切換／放棄／取消」；離開瀏覽器頁面則使用瀏覽器既有的未儲存變更確認。對話框沿用全站 shared modal focus lifecycle。Revision 一旦儲存成功，畫面會先同步新版本再執行引導或離開動作；後續動作失敗不會讓下一次儲存沿用舊版本。「儲存並離開」後保持未選取活動，不會因清單刷新自動重開第一筆。
- 建置冊直接開放活動、場館與使用空間、攤位匯入、地圖、驗證與預覽、送審與發布六區。Readiness 顯示完成區段數、具名阻擋項與建議下一步，不顯示百分比；`blocked` 只代表缺少技術前置資料，區段本身仍可開啟查看。活動或場館表單有未儲存變更時，Readiness 以目前表單內容即時顯示「尚未儲存」，不沿用上一版結果。
- 六區共用 [`app/organizer-workspace.ts`](../../app/organizer-workspace.ts) 的 prerequisite evaluator。活動與場館來自草稿 validation；匯入要求至少一列且沒有 import error；地圖要求匯入已完成、完整 day × venue-space coverage，且每份已保存地圖必須通過與正式 validation 相同的攤位覆蓋、未知攤位、重疊與幾何規則（未知攤位在候選活動是 warning，不擋住地圖區；理由見下方[地圖](#地圖)）；驗證只在沒有 error 且 `last_validated_version` 等於目前 candidate version 時完成；只有 published 才把送審與發布區段標為完成。

## 邀請制，不能自助開活動

- 候選活動只能由**全域管理者**以 `POST /api/admin/organizer/events` 建立，必須提供暫定名稱與 Owner email，並要求有效 session。
- 建立成功即寄出主辦工作區邀請信；受邀者以該連結登入後自動接受待處理邀請並取得 grant。信件由 `app/mail-letter.ts` 產生，同時寄出 HTML 與純文字；連結過期時，信中指示受邀者到 `/organizer` 用同一信箱重新索取登入連結，任何 `organizer` 登入都會接受該信箱的待處理邀請。
- 首次邀請與重寄的 HTML／純文字均列出寄送當下的活動暫定名稱，以及此次邀請操作的角色：建立活動或管理負責人邀請為「網站管理者」，邀請協作者為「活動負責人」（即使同時是網站管理者）。邀請者 Email 不寫入信件內容，名稱與角色由伺服器取得。
- **管理者把自己填成負責人時，owner grant 在建立活動的同一個 transaction 內直接成立**，該筆邀請同時標記為建立時即接受，不必先收信。管理者本來就是唯一能增減 Owner 的角色，繞一圈收信不增加任何保證，卻讓建立者停在 `admin` 事件角色、看不到 Owner 專屬的送審控制項。稽核寫的是 `organizer_event.owner_granted_on_create`，與接受邀請分開。信照常寄出（那是一條可用的登入連結），寄信預算與寄送失敗的處理都不變；負責人填別人時行為完全不變，仍由對方收信登入後取得 grant。送審與核准的 有效 session 要求不因此放寬。
- Owner 可邀請或撤銷 Editor；**只有全域管理者可以增減 Owner**。撤銷對尚未登入者同樣有效——撤掉 grant 或撤掉尚未接受的邀請，任一成立即算成功。
- 寄信失敗保留已建立的活動與邀請；回傳 `invitationSent: false` 及 `invitationDelivery`（`failed` 為明確拒絕，`unknown` 為逾時或無法確認），清除本次寄信建立的登入權杖並寫入 `organizer_event.invitation_failed`。邀請建立的稽核先於寄信，不會因寄信失敗遺失。成功受理回 `sent`，不代表已送達。
- 協作者／負責人表單可用「重寄邀請信」對既有 Email 重寄，包含重新開啟工作區後；`POST …/collaborators` 的 `resend` 只接受同一候選、信箱與角色下尚未接受且未撤銷的邀請，沿用邀請的權限。重寄不新增邀請、grant 或候選版本，成功另留 `organizer_event.editor_resend`／`owner_resend` 稽核。已具該角色不再新增邀請，另一角色的待接受邀請不會被重寄或覆寫。
- 邀請會鑄造真正的登入連結，因此受三道獨立預算限制：每小時每收件匣 3 封**他人寄來的**邀請、每小時每邀請人 10 封，另沿用每 IP 每小時 20 封登入連結的上限。收件匣預算刻意不與本人自助索取的登入連結共用計數器，否則邀請人可以花光對方的額度把人鎖在帳號外。
- 首次寄送與重寄均以登入權杖計數，邀請人依 `minted_by` 及建立時間計算，不能重用舊邀請繞過額度。preview 不允許的收件地址在新增邀請或寄信前拒絕，既有邀請不受影響。

## 候選活動的狀態

```text
draft → submitted → approved → publishing → published
          ↓                       ↓
   changes_requested            failed
```

- `draft` 與 `changes_requested` 可編輯；其餘狀態一律不可寫入。
- 每一次寫入都要帶 `expectedVersion`，成功後 `current_version` 遞增並留下一筆 immutable revision。版本落後回 409 並指出目前版本，不靜默覆寫。
- `eventId` 在 CREATE 的**首次送審時鎖定**，之後不得改成別的值；未送審前可以修改。它在 CREATE 候選之間唯一（partial unique index）；明確 AMEND 候選沿用來源 eventId 並在建立時鎖定，同事件最多一份尚未 published 的 AMEND。首次發布的核准 handler 與 executor 仍以 `event_id_collision` 拒絕同名 published event，不 silent overwrite 或自動轉換。兩條地圖管線仍靠 `candidate_id` 分離。

## 草稿內容

`organizer-event-draft/1`，欄位與驗證規則以 [`app/organizer-event.ts`](../../app/organizer-event.ts) 為準：

| 區塊 | 內容 | 規則 |
|---|---|---|
| `event` | `id`、`name`、選填 `aliases[]`、`days[]` | `id` 只允許小寫英數與連字號；每個活動日需要 id、名稱與 `YYYY-MM-DD` 日期，id 不得重複。活動別稱最多 5 個、每個不超過 40 字，不得與活動名稱或彼此重複（NFKC 後不分大小寫）；空白列在儲存時略去，沒有別稱時不保存這個欄位（[ADR-0068](../adr/0068-published-event-settings-are-declared-amendments.md)） |
| `venue.assignments` | `venueId`、`venueSpaceId`、`areaMode`、`areaIds[]`、`mapTemplate` | 至少一個場館空間；`venueSpaceId` 不得重複且必須屬於所選場館；`areaMode` 為 `imported` 或 `none`；`none` 必須且只能保存 `areaIds: ["ALL"]` |
| `officialSource` | `label`、`url` | 來源說明與 HTTPS 網址均必填 |

新增活動日時，第一日的日期留空；之後以最後一個有效日期加一天，若已有列但皆無有效日期才回退為作者當地的今天。新活動日的 id 取最小尚未使用的序號。這是可覆寫的預設值，不是驗證規則。

`venueId` 與 `venueSpaceId` 是系統保存的 stable ID，介面不要求主辦輸入。主辦先從共用場館目錄選擇場館，再從該場館的使用空間下拉選擇；找不到時可以立即建立新場館與第一個使用空間，或在既有場館立即新增使用空間。每筆目錄資料都要求官方 HTTPS 來源，但使用空間的來源網址可以留空——留空時沿用它所屬場館的網址，因為「全館」這類空間通常沒有自己的官方頁面，而主辦通常只有一條官方網址。格式錯誤的網址仍然退回；沿用是補齊，不是豁免。建立與 audit 在同一個 D1 transaction；新資料只是候選控制面的來源記錄，不會因此自動成為已發布 reference pin。

`areaIds` **不在場館表單手填**。`areaMode` 是每場活動自己的選擇，場館目錄的 `defaultAreaMode` 只提供新增 assignment 時的預設。`imported` 的展區是攤位名單事實，由匯入推導；`none` 代表這場活動在該使用空間沒有分區，匯入不用對應展區欄，系統固定保存 `ALL`。有匯入資料後，prerequisite 以 `missing_space_import` 指出未被檔案涵蓋的使用空間。

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

planner 產出既有 `circle-identity-groups/2`，只套用本次 transitions；baseline 的舊 transitions 已生效，不再重播。保留既有群組與 linkage；部分換手／移動造成群組跨列時，由明確宣告及其來源（未另填時用活動官方來源）產生 linkage。連續修正的退役證據與 Reader 投影依 [circle catalog 契約](./circle-catalog.md)。

### 活動設定更正宣告

修正候選除了 `changes[]`，另可保存選填的 `settings`：`{ name?, aliases?, days?: [{ id, date }] }`（[ADR-0068](../adr/0068-published-event-settings-are-declared-amendments.md)）。`app/organizer-amendment-settings.ts` 的純函式負責正規化、套用與影響，兩種宣告分開保存、分開比對。

- **允許清單**：活動名稱、活動別稱、既有活動日的日期。其他鍵、新增或刪除活動日、重複的活動日代號，以及活動日除 `id`、`date` 以外的欄位，一律 422。
- 從固定 baseline 草稿正規化：名稱與別稱去頭尾空白，空白別稱略去；與 baseline 相同的值不保存，全部相同時不保存任何設定（`settings_json` 為 NULL）。`aliases: []` 表示移除全部別稱。套上宣告後的草稿必須通過建立活動時的同一套驗證。
- **整份覆寫**：每次 `PUT` 的 `settings` 取代上一份，省略即沒有設定更正。
- 修正候選的草稿維持等於 baseline 草稿，設定只存在宣告裡；Reader 預覽顯示套上宣告後的活動名稱與日期。

### 修正候選與基準 API

- `POST /api/organizer/events/:sourceCandidateId/amendments` 只接受 `expectedVersion`。來源 Owner 或 Admin 可以建立；Editor 不行。來源候選、該版本 snapshot 與 publication job 必須一致且已 published。伺服器以既有 GitHub App 的唯讀 token 核對目前 main pin、原 job 的 main pin、固定 data commit 每檔 SHA-256、核准 bytes，以及 Pages 正在提供的 data commit／Reader catalog；錯版、未公開、缺檔、讀取失敗均不建立，客戶端不能指定基準內容。
- 建立新的候選、鎖定 eventId、immutable baseline、首版空宣告、版本紀錄、匯入列、獨立地圖草稿及 audit 在同一 D1 batch。交易內重新檢查來源版本、published job／snapshot 與 Owner grant 或目前 Admin 名冊；宣告保存同樣重檢 grant／Admin，避免預讀後撤權仍寫入。候選複製當下有效的 Owner／Editor grants；之後沿用每候選的協作者管理。Admin 不因建立動作取得 Owner。
- `GET /api/organizer/events/:candidateId/amendment` 由候選 Owner／Editor／Admin 讀目前宣告、影響、設定宣告及其前後值（`settings`、`settingsImpact`）與可選來源名單；以同一 SQL 讀取 candidate 版本與最新宣告，地圖單獨修改後仍回目前候選版本，不能將舊宣告配上並行保存後的新版本。不回傳 global allocations／evidence 或核准 snapshot。`PUT` 只接受 `expectedVersion`、完整 `changes[]` 與選填 `settings`，從固定 baseline 重新規劃，不從前一次結果累加或推論。未知來源、錯誤宣告或允許清單外的設定為 422，版本／狀態或交易內撤權衝突為 409。
- 宣告保存以唯一 revision token 串起版本、不可變宣告紀錄、衍生匯入列與 audit；同時保存只成功一份，失敗請求不能把勝出者的匯入列退役。baseline 不隨保存改變。沿用 20,000 列、代碼 80 字、名稱 200 字及 8 MiB 名單限制；宣告本身也限制 8 MiB。匯入列只供既有地圖及驗證接線，身分仍由 baseline／宣告決定，不編造主辦 stable key。
- AMEND 的一般活動設定儲存與匯入覆蓋一律回 409 `amendment_declaration_required`，名單變動與活動設定更正都只能經修正宣告；地圖沿用原候選版本及權限檢查。送審與核准沿用 CREATE 的 publication engine，不能用 CREATE 繞過修正宣告。送審的 snapshot 帶上已保存的設定宣告（沒有時不出現這個鍵）；核准時 snapshot 的 `changes`、`settings` 必須與已保存內容一致，否則回 409 `snapshot_mismatch`。
- Runtime schema 新增 `publication_operation`（舊候選預設 CREATE）、`organizer_amendments` 與 `organizer_amendment_changes`；設定宣告存在 `organizer_amendment_changes.settings_json`，由 runtime 欄位遷移補上。舊 eventId index 以同名在一個交易中替換，避免舊部署的 `CREATE INDEX IF NOT EXISTS` 重建舊規則；CREATE 唯一及 AMEND 活躍唯一各自保留，不需要人工 SQL 遷移。

### 修正操作介面

- 已發布候選的 Owner／Admin 可按「開始修正已發布活動」，核對成功後開啟獨立修正候選。活動列表及工作區標示「發布後修正」；Editor 可編輯既有修正候選，沒有建立入口。
- **名單修正只能表達四種變動，純分類變更不在其中。** 退出、換手、移動／重編號、新增——只有「移動」帶得動目的地的活動日、展區與代碼。所以「把展區重新歸類、攤位本身沒動」這種修正，在系統裡只能寫成逐攤的移動宣告，而讀者會因此在每一個攤位看到「已移動攤位」。發布時 `publication-artifacts` 還會比對 snapshot 的攤位清單與「baseline + 宣告」推出的結果，不一致就以 `snapshot_mismatch` 退件——因此直接改候選的匯入列也走不通。修正的 baseline 取自目前對外服務的目錄而非 D1，改舊候選同樣不影響未來的修正。遇到管線表達不了的資料更正時，預設是不動已發布資料、改為修正上游避免再發生；若確實必須更動已發布位元組，那是繞過「已發布內容來自已核准 snapshot」的治理例外，要明確記錄後才執行。
- AMEND 的「名單修正」取代一般攤位匯入。表單明選變動類型、搜尋／勾選來源攤位，填接手或新增社團名稱，以及逐攤目的活動日、展區、代碼；選填 HTTPS 更正依據。來源每頁最多 50 個，跨頁／搜尋仍保留選取。
- 修正面板的「活動設定」預填目前生效的活動名稱、別稱與各活動日日期，可直接更正，與名單宣告一起儲存；「已儲存的活動設定更正」逐欄列出原本與修正後的值。
- 宣告可加入清單、修改或取消，再按「儲存修正並檢視影響」。影響區只顯示伺服器已保存版本；未保存時明確標示，切換活動／項目或離開頁面有未儲存提示。「開始修正」的基準核對回應較晚到達時，也檢查目前面板的未儲存輸入，不能直接切走其他候選。取消宣告只撤掉那筆修正，不推論名單缺列。409 保留輸入與舊影響，需明確捨棄後讀取新版本，不能直接重送覆蓋。
- 活動設定只能經上述「活動設定」更正，場館設定為唯讀；地圖、檢查與 Reader 預覽沿用既有介面。自動發布未啟用時 detail 回 `publicationAvailable: false`：AMEND 的送審與所有核准按鈕停用，後端核准回 503 `publication_unavailable`，送審內容保留。

## 主辦與分類目錄

活動設定的 `references` 保存 `organizerAssignments[]`（organizerId／lead、co-organizer、partner）與 `categoryCatalog`（id／organizerId／revision）。必須恰好一位 lead，單位不可重複；分類目錄屬於已選單位且至少含一個有效分類。建立及選取共用 Reader 分類驗證，分類名稱不可使用其保留名稱「全部類別」。未選可以儲存未完成草稿，但 validate／submit 會阻擋；明確選入的錯誤 reference 在 save 即拒絕。

`POST /api/organizer/events/:candidateId/references` 接受 expectedVersion、kind、名稱、HTTPS 官方來源；分類目錄另含所屬主辦與分類 label／選填 description。Owner／Editor／Admin 可在 draft／changes_requested 建立，舊版本或已鎖定狀態拒絕；建立與 audit 原子完成，候選內容不因目錄建立而前進版本。使用者選取後以原本的草稿 save 套用。沒有原地修改既有 reference 的 API；不提供猜測分類或 stable ID 輸入欄。

`organizer_reference_records` 保存 canonical public_reference_json 與 source_captured_at。場館／空間正常建立在同交易固定 canonical 記錄；seed adoption 依 [ADR-0061](../adr/0061-organizer-snapshot-pins-complete-reference-records.md) 的已核對來源與時間，只補缺少記錄，既有 metadata 不一致時不強行採用。控制面名稱「全館」與公開名稱「爭艷館展區」分開保存。

既有非 seed 場館／空間缺少 canonical 記錄時，「場館與使用空間」列出待補來源。使用者核對並輸入公開名稱與官方 HTTPS 網址後，以同一 references endpoint 的 `venue`／`venue-space` kind 補齊。僅能處理已儲存在該候選的 assignment；同交易檢查角色、可編輯狀態、expectedVersion、場館關係與 path 未存在，建立／audit 原子完成。保存固定本次核對時間，不改目錄友善名稱、candidate revision 或任何既有 snapshot；既有 canonical 記錄不能由此覆寫。之後仍須重新檢查、預覽與送審。

validate／preview／submit 共用 selected-reference resolver。`organizer-reader-preview/1.references` 是所選 canonical 公開記錄，介面呈現主辦、分類與正式場館名稱；選單仍使用原本 venueCatalog 的友善名稱。公開 schema／檔案選取 parser 與 CLI 共用 `app/reference-selection.mjs`。

## 攤位匯入

- **原始檔只在瀏覽器裡解析與雜湊。** `readOrganizerWorkbook()` 讀 CSV 或 XLSX、列出工作表、保留實體列號；沒有任何 API 接受這個 File。
- `PUT /api/organizer/events/:candidateId/imports` 只收主辦確認過的**正規化攤位群組**與來源 metadata（檔名、工作表、原始檔 SHA-256、來源說明、欄位 mapping）。
- 每個群組的 `dayId`、`venueSpaceId` 與 `areaId` 必須落在草稿已宣告的集合內；`areaMode: none` 的列會被正規化為 `ALL`，不讀來源檔的展區值；同一活動日 × 場館空間 × 攤位代碼不得重複（大小寫不敏感）。
- 每個群組保存 `codes[]`、社團名稱與來源參考列；正整數表示原檔列號，`sourceRow: 0` 表示手動新增或從不同來源列合併的群組，不虛構檔案列號。一團多攤不需要填主辦內部編號。重複驗證逐個代碼進行，同群組內重複也整批拒絕；API 要求非空的字串陣列，各碼不超過 80 字元，現有 20,000 群組與 8 MiB 上限不變。舊有正整數來源列維持相容，不需資料遷移。
- 欄位 mapping 保存 `boothCodeMode`：預設 `single` 不拆碼；`delimited` 以空白、逗號（含全形）、頓號、分號（含全形）或斜線拆分；`fixed-width` 使用主辦明確確認的 `boothCodeWidth`（1–80 字元）。寬度只提出候選值、不自動套用；不可整除或包含分隔符號時，指出來源列並擋住儲存。`single` 遇可能連寫的代碼，於 mapping／預覽即提示。
- 預覽顯示群組列數、展開代碼總數與各列的全部代碼；已儲存清單提供社團／代碼／內部編號搜尋、活動日與使用空間篩選、依第一個攤位代碼自然排序及每頁 100 列的分頁。候選鎖定時仍可唯讀檢視；與地圖的對照見[地圖](#地圖)。
- 已匯入清單在 draft／changes_requested 可修改、手動新增、刪除、拆分與合併群組。拆分勾選要移至另一組的代碼，兩組保留原名稱與明確的 stableKey／identityGroup，名稱相同不另外產生識別連結。合併只允許同活動日、同使用空間、同展區且內部編號一致；名稱不同時須明確選擇保留名稱，不能默默覆寫社團識別。同來源列的拆分／合併仍可回查原列，不同來源列合併標成手動群組。
- 清單編輯草稿獨立於尚未儲存的匯入預覽；搜尋、篩選、排序與換頁不清除修改，僅渲染目前 100 列。離開區段與重新整理沿用未儲存提醒；有清單草稿時，先儲存或放棄才能以新檔案取代。此入口需要已有匯入出處，不提供從零建單。
- 編輯時即時指出同日 × 同空間重複代碼、缺值與活動設定不符；可疑連寫只提供建議，須確認才拆碼。活動日與使用空間只能從活動設定選擇，無分區沿用 ALL；分區變動在儲存前沿用展區宣告，再以取得的新 expectedVersion 儲存整份清單。409 保留本機草稿並停止重試覆寫，須放棄及重新讀取新版本。
- 儲存沿用原 PUT 與 20,000 群組／8 MiB 上限，檔名、工作表與 SHA-256 保留為原始匯入出處，不聲稱等於編輯後內容。AMEND 不使用此編輯器，仍走明確修正宣告；API 的 AMEND 拒絕邊界不變。
- 匯入預覽與已儲存清單中，無分區空間顯示「無分區」，不顯示內部值 `ALL`；有分區空間若實際使用 `ALL` 作為展區代碼，仍保留原名稱。
- D1 以新增的 nullable `codes_json` 保存群組，舊 `booth_code` 欄保留為相容投影（新寫入為群組第一碼）。舊資料未有 `codes_json` 時讀成 `[booth_code]`，**不猜拆舊合併代碼**，不改寫任何既有 approval snapshot。新送審使用 `organizer-submission-snapshot/3` 並保存 `codes[]`；舊 `/1` snapshot 原 bytes 與 hash 不變。舊版匯入寫入格式會被 API 拒絕，重新載入 UI 後使用新版群組格式。
- authoring scope 與地圖覆蓋驗證攤平 `codes[]`；Reader preview 的 placement 仍一碼一筆，同群組每碼帶相同社團名稱。正式已發布活動的讀取／身分投影不變。metadata mapping 與新 snapshot 均可追溯主辦確認的拆碼選擇。
- **預覽可以逐列修正。** 缺值或攤位重複的列會列在「待修正」，直接在預覽裡補上活動日、使用空間、展區、攤位代碼、社團名稱或主辦內部編號；也可以移除個別列，或一次略過全部待修正的列。活動日與使用空間只能從活動已宣告的清單選，展區與攤位代碼是來源檔的事實，維持自由輸入。補上主辦內部編號會一併重算該列的 `identityGroup`。
- 匯入預覽中移除的列**既不匯入也不再回報問題**，而且不佔用攤位位置：同一攤位的重複因此可能由移除另一列解除。預覽修正與移除以來源列號為鍵，換檔案、換工作表或改標題列時清空的僅為這份未儲存預覽——不清空已存清單的編輯草稿。
- 還有待修正的列時不能儲存；要嘛補完，要嘛移除。這只擋住這一步，未宣告的活動日、使用空間或展區在 API 端仍然照樣拒絕。
- **展區由這次匯入決定。** 預覽會列出這次要匯入的每個場館空間出現的展區與列數（含手動補正，不含已移除的列）；主辦按下確認時，介面先把這些展區寫進草稿（一次正常的 `expectedVersion` 儲存），再以新版本送出匯入。API 端「未宣告的展區一律拒絕」的規則不變——被宣告的來源換成同一份檔案。
- 展區的推導與匯入一樣是**取代**語意：草稿裡有、但這次匯入沒有提到的分區空間會被清空展區——包含整批被移除的那些列所屬的空間；無分區空間仍固定為 `ALL`。prerequisite 的 `missing_space_import` 會指出沒有任何匯入列的使用空間。預覽會先以場館與使用空間名稱提醒哪些空間沒出現在檔案裡。
- 保存匯入後若再移除活動日、移除使用空間、切換展區方式或改變已宣告展區，validate、preview 與 submit 都會逐列反查既有資料並要求修正清單或重新匯入；舊列不會以 orphan space 或過期展區進入送審 snapshot。相同原因的列會聚合成一個帶影響列數與代表來源列的 issue，回應最多列出 100 組再加一筆省略摘要，避免 20,000 列名單放大成 20,000 個 blocker。手動群組不顯示虛構的來源第 0 列。
- 檔案裡出現草稿沒有的場館空間，或展區代碼不是英數字、底線與連字號（它會進公開網址）時，預覽直接擋下儲存並指出要修的是來源檔還是場館設定。
- 主辦內部編號只供主辦自用核對，UI 不承諾跨活動識別。`identityGroup` 只能是 `stable:<stableKey>` 或 `null`。**名稱相同不構成同一社團**，與[社團目錄契約](./circle-catalog.md)的 linkage 規則一致。
- 匯入是**取代**語意：一次請求就是這個候選活動的完整攤位表。新來源寫入時，前一份標記 `replaced_at`，其資料列不再是有效匯入。
- 兩道上限，回不同的狀態碼：**超過 20,000 列**在最初的參數檢查就回 `400`；**正規化後超過 8 MiB** 回 `413`。兩者各有自己的錯誤訊息，都在寫入之前拒絕，不會留下半套匯入。
- **分批不是這兩道上限的解法**——取代語意表示後一批會丟棄前一批。實際可行的是縮短欄位內容，或先確認匯入範圍是否真的屬於同一場活動。
- 稽核只留版本、列數與原始檔 SHA-256。**私人 workbook 的檔名與工作表名不寫進 `audit_log`**——來源可追溯靠 hash，檔名會比它描述的匯入列活得更久。
- **hash 證明的是來源檔，不是每一列。** 預覽裡的手動補正與移除不改變 hash，也不逐列留下紀錄；可追溯的是「這份檔案，加上主辦在這一版所做的修正」。最終資料列本身由送審 snapshot 固定（見[驗證、預覽與送審](#驗證預覽與送審)），要核對某一版實際匯入了什麼，看的是那份 snapshot 而不是 hash。

## 地圖

清單的「已儲存地圖」逐群組顯示待畫、部分已畫或已畫，以該活動日 × 使用空間最新已存地圖的代碼核對，讀取失敗不當作待畫。已有座標可定位到同一範圍的編輯器；清單尚有未保存變更時先儲存再定位。此狀態來自既有 maps 列表的選填 `coverage=1` 投影，不另外保存完成旗標。

編輯器的清單對照則依目前地圖草稿即時更新，清楚標示儲存後才更新清單狀態；畫入、改碼、刪除及復原都參與計算。可搜尋代碼與社團名稱，待畫代碼沒有無效定位，選取已有攤位可核對同範圍的群組。共用行為見[地圖編輯器契約](./map-editor.md)。

- 每一個「活動日 × venue-space」各一份地圖草稿，沿用既有的 `MapLayoutEditor` 與 template 辨識器。
- 共用的[私人輔助線與吸附](./map-editor.md#私人輔助線與吸附)隨地圖 revision 保存。API 以 layout 同層的可選 `authoring` 讀寫，公開預覽／publication 只採地圖 layout；畫布個人顯示開關不觸發候選保存。
- 共用的[描摹顯示與精準操作](./map-editor.md#描摹顯示與精準操作)與[排段整體調整](./map-editor.md#排段整體調整)在本工作區與地圖貢獻控制面行為一致。配置圖顯示、透明度、描摹模式與微移步進只留在瀏覽器，不進草稿也不進 revision。
- **「儲存地圖變更」只儲存，不關閉編輯器。** 一張地圖要畫很多輪，關閉是另一個決定，由「關閉編輯器」負責。儲存後編輯器沿用同一份 layout 繼續編輯，並改為更新剛才存下的那份地圖：第一次儲存之後的每一次儲存都是更新，不會再建立第二份。有未儲存變更時關閉才會出現「儲存並關閉／放棄／取消」。已保存的地圖沒有新變更時儲存鍵停用，旁邊沿用草稿表單同一組「尚有未儲存變更／目前沒有未儲存的變更」；畫布上沒有任何攤位或設施時，不論這張地圖是否已經建立，儲存鍵同樣停用並說明缺什麼。停用不只是版面整潔：每次儲存都讓 candidate 前進一個版本並寫入一份 revision，沒有變更的儲存會在歷史留下一步空紀錄，而空白地圖的第一次儲存是同一件事的另一個入口——它還會讓「N 張地圖」這個計數記上一張沒有內容的地圖。
- **配置圖跟著地圖存下來。** 一份地圖草稿有一張目前的配置圖，經 `PUT /api/organizer/events/:candidateId/maps/:draftId/background` 存進私人 bucket `MAP_CONTRIBUTIONS`，由 `GET` 同一個位址讀回，兩者都限協作者且回應 `private, no-store`。物件位址由草稿自己的 id 決定（`organizer-map-backgrounds/<candidateId>/<draftId>`），因此**沒有任何 D1 資料列指向它**：再上傳一次就是覆蓋同一個位址，草稿被保存期限清除時也照同一組 id 刪除，不需要先讀 metadata。只接受 JPEG／PNG／WebP，上限 10 MB，容器檢查與貢獻來源檔共用同一份 [`prepareMapImageFile()`](../../app/map-contribution-files.ts)。
- 上傳按鈕依狀態顯示三種字：編輯器沒開時是「上傳配置圖並編輯」，會用圖片建立新的 layout（有辨識器就辨識，沒有就依圖片尺寸開一張空白底圖）；編輯器開著而還沒有配置圖時是「上傳配置圖」，**只把圖片放到現有攤位底下，不動地圖內容**；已經有配置圖時是「更換配置圖」。同一個檔案可以連續選第二次。地圖還沒建立時選的配置圖會在第一次儲存時一起存上去。
- **已發布修正沿用來源底圖。** 修正地圖尚未上傳自己的配置圖時，登入且具修正候選權限的協作者可讀取固定 baseline 中同活動日／場館空間的已發布來源底圖，連續修正也沿用這條來源關係；不接受客戶端提供來源 id 或 bucket key。更換配置圖只寫修正地圖自己的物件，不影響原版。GET 不寫入、不推進版本，來源底圖維持原保存期限；來源已清除時維持找不到配置圖，不複製資料以延長保存。
- **上傳配置圖不推進版本。** 配置圖是描圖用的底圖，不是送審內容，所以它不增加 candidate version、不寫 map revision，只留一筆 `organizer_event.map_background_updated` 稽核。儲存鍵的停用條件因此不受影響。
- **會清掉畫面內容的動作都先問。** 空白畫布（畫面上有內容時）、切換地圖分頁、從同場館空間複製、切換使用空間（有未儲存變更時），以及已經有配置圖時再次上傳，都要先確認再執行。
- 候選地圖的 scope 由 [`resolveCandidateAuthoringScope()`](../../app/event-authoring-scope.ts) 從草稿與匯入列推導：`allowedBoothCodes` 與 `requiredBoothCodes` 都是該 scope 實際匯入的攤位代碼。
- **候選活動的地圖可以含沒有社團的攤位格。** 配置圖畫的是整個場地，包含沒賣掉的攤位，而那些格子沒有任何匯入列可以指認。已發布活動有 reviewed snapshot 透過 `existingBoothCodes` 認領這些格子，所以在那裡出現的陌生代碼是打錯字，仍然是 error；候選活動的第一份地圖沒有 snapshot 可依靠，因此 `unknown_booth` 降為 warning，代碼照樣列出來給人看。這是 `allowsUnallocatedBooths` 這個 scope 欄位唯一的用途。`missing_booth`、`overlap` 與幾何錯誤不受影響。
- **候選地圖沒有公開檔案位址**（`targetPath: null`）。已發布活動的 authoring scope 才有 `targetPath`，只有一組「活動日 × 場館空間」時是 `map.json`，多組時是 `maps/<periodKey>/<venueSpaceId>.json`。

## 驗證、預覽與送審

AMEND 沿用驗證、Reader 預覽、Owner 送審及 Admin 核准。送審固定 `organizer-submission-snapshot/4`、明確 operation，以及伺服器保存的 baseline JSON／SHA-256／目前修正宣告；衍生名單與地圖須通過相同產檔驗證。核准再次比對 immutable snapshot 與此版本宣告，沿用唯一 publication job 和自動 dispatcher；不新增人工 Publish。snapshot 儲存與送審在 SQL 寫入時檢查有效 Owner，review 交易重新檢查有效 Admin、候選版本與 snapshot，所有核准寫入以唯一 review token 綁定。

- 地圖檢查保留完整 `boothCodes`，檢查與預覽以活動日與場館空間標示每項問題；攤位差異顯示比對的匯入檔名、工作表與該範圍列數，可展開全部代碼，缺少的攤位另顯示社團名稱與來源列號。提示分別引導檢查地圖與匯入欄位，未知攤位維持 warning，缺少攤位維持 error。

- `POST …/validate` 回傳 `issues[]`，每筆帶 `severity`、`step`（`event`／`venue`／`import`／`map`／`preview`）、`code`，必要時帶 `row` 或 `target`。缺任何一份「活動日 × venue-space」地圖是 error，不是 warning。成功時只把 workspace 的 `last_validated_version` 記為目前版本；不增加 candidate version，也不建立內容 revision。任何後續內容寫入使版本前進後，這個完成狀態自然失效；若版本在 validation 與 marker 寫入之間前進，API 回 409 並要求重新驗證，不會對舊版回報成功。
- `POST …/preview` 回傳 `organizer-reader-preview/1`：草稿、匯入的配置與每份地圖 layout，供 Reader 樣式預覽。它不寫入任何資料。
- 預覽攤位以可讀底色呈現；滑鼠或鍵盤選取時反白該格，顯示該活動日與場館空間內的攤位代碼及社團名稱。切換預覽地圖清除選取，不沿用另一張地圖的社團資訊。
- `POST …/submit` 只有 Owner 可以呼叫，且要求有效 session。CREATE 新送審固定 `organizer-submission-snapshot/3`：草稿、完整 reference selection、各 reference 的 path／原始 JSON bytes／SHA-256、匯入來源 metadata、`codes[]` 攤位群組與地圖內容；`contentUpdatedAt` 取該 candidate version 的 immutable revision.created_at。既有 `/1`、`/2` snapshot bytes/hash 保持不變。產檔只能使用 snapshot，不可回讀 live catalog 或推測舊 snapshot 缺少的公開資料。
- **validate、preview 與 submit 讀同一份 bytes**：候選、匯入與每份地圖各只讀一次，所以送審固定的內容與剛才驗證過的內容不可能不同。
- `POST /api/admin/organizer/events/:candidateId/review` 由全域管理者以有效 session 核准或要求修改。核准前重跑驗證；找不到該 revision 的 immutable snapshot 就拒絕。
- **管理者可以核准自己送出的 revision**，但稽核會記下 `selfApproval`、actor、snapshot hash、版本與時間。

## 發布邊界

核心實作：[`organizer-publication.ts`](../../app/organizer-publication.ts)、[`organizer-publication-presentation.ts`](../../app/organizer-publication-presentation.ts)、[`publication-rollout.ts`](../../app/publication-rollout.ts)、[`github-remote-auditor.ts`](../../app/github-remote-auditor.ts)。測試：`tests/organizer-repository.test.mjs`、`tests/organizer-handlers.test.mjs`、`tests/organizer-reopen.test.mjs`、`tests/github-remote-auditor.test.mjs`、`tests/organizer-publication-presentation.test.mjs`。決策：[ADR-0057](../adr/0057-approval-starts-create-publication.md)、[ADR-0058](../adr/0058-publication-is-enforced-by-the-app-not-the-ruleset.md)、[ADR-0059](../adr/0059-failed-publication-requires-explicit-reopen.md)。

依 ADR-0057，UI 動作為「核准並發布」。已啟用且有 durable dispatch adapter 時，同一 D1 transaction 記錄核准、建立唯一 `queued/preparing_data` job、把 candidate 改為 publishing，再交給 dispatcher；不需要第二次人工發布。dispatch 失敗記錄 `dispatch_failed`，內容保持核准與鎖定，可由 Owner 或 Admin 重試。

`app/organizer-publication.ts` 每次 delivery 至多執行一個 transition，持有有時限的全域 lease。snapshot id、版本、hash 與 snapshot bytes 必須相符。driver 以 job/step/hash 作為 reconciliation key，副作用前必須再次確認 lease；pending 保留步驟。已保存的 PR、head SHA、merge SHA 與 workflow id 不能被新的 checkpoint 改寫。

步驟為 preparing_data → waiting_data_checks → merging_data → preparing_main → waiting_main_checks → merging_main → waiting_deployment → verifying_production → completed。失敗保留原 step、failure_code、error、retryable 與 metadata。Main 需要 data merge SHA，deployment 需要 main merge SHA；productionVerified 必須明確為 true 才能完成。此 boolean 是 **driver 的 blocking Pages smoke 結果**，由下方 deployment adapter 核對實際公開來源；測試 driver 的結果不能當成真實 smoke。

driver 第一次 remote mutation 前必須先以目前 job、candidate version、approval 與 lease CAS 寫入 sticky `remote_write_intent_at`，再在每個 mutation 前 assert lease；錯誤、timeout、空 remote audit 與 retry 都不清除它。這個欄位只表示遠端結果可能未知，不代替已確認的 PR／SHA／workflow checkpoint，因此有 intent 的 failed candidate 不能被 reopen。

同版本核准重送沿用相同 snapshot/hash 的既有 job，不重寫核准、不重複 dispatch；不一致回報 `approval_mismatch`。相同 snapshot/hash 的既有 queued job 可在 submitted 核准時沿用。nullish metadata 表示未提供更新，保留已保存的 checkpoint。

lease 過期後，只允許仍持有原 token 與原 step 的 executor 寫入 failed/retryable；不能推進步驟，也不能覆寫新 lease 持有者。失敗記錄遭 fence 拒絕時向 dispatcher 拋出失敗，不把該 delivery 當成成功。

`POST /api/organizer/publications/:jobId/retry` 先驗證登入再查詢 job，與既有 admin route 共用 Owner／Admin 有效 session 檢查，Editor 無權重試。只恢復同一 failed/retryable job 與 snapshot，不建立另一筆 job；不可重試的 collision/hash failure 顯示具體下一步，不表示內容退件。

只有明確的 Owner／Admin 動作可以把「目前版本、已核准、狀態為 `failed`」的候選退回 `changes_requested`：`POST /api/organizer/events/:candidateId/reopen` 需要 有效 session、`expectedVersion` 與必填退回理由。它不受 publication mode disabled 影響，但會先取得既有 global lease，查核固定 data/main repository 中 `organizer/{jobId}/data` 與 `/main` 的分支，以及包含 closed／merged 的完整 PR 分頁；任何 branch、PR、403、網路錯誤、格式錯誤或不完整分頁都拒絕。七個 remote checkpoint 與 `remote_write_intent_at` 都必須為 NULL，且 audit 與提交交易間 lease token 仍有效。

成功退回會遞增 candidate version、保留 `eventId` 鎖定與舊 snapshot／review／job，新增 immutable revision 與含理由的 `changes_requested` review，並令舊 job `retryable = 0`。舊 job 仍會在頁面顯示為上一版本的歷史發布紀錄，不能再 retry；新的版本回到一般編輯、驗證與送審流程。Owner／Admin 以外的 Editor 沒有此動作。

**`queued` 停留超過 15 分鐘就是失敗。** 依 ADR-0062，獨立 publication Worker 每分鐘掃描，把超時 job 改為 `failed` + `queued_timeout` + retryable，step 原封不動，candidate 一併轉為 `failed`；活動列表與候選 GET 不執行掃描或寫入。更新交易再次檢查 live lease，避免掃描與 dispatch 同時開始時錯誤判定逾時。恢復沿用同一筆 job、同一份 snapshot，不新增手動啟動 queued job 的入口。等待 CI 是 `publishing`，不受 queued timeout 影響。

**持續推進不依賴使用者開啟頁面。** Pages 核准／retry 僅提交到期的持久化 job；cron 每輪最多處理十筆目前核准版本且到期的 queued／publishing job，各推進一步。pending 的 next attempt 與 checkpoint 在同一 lease 下寫入 D1，退避依序 1、2、4、5 分鐘，上限五分鐘，短於 queued timeout。前進後下一輪可續推；failed 不自動 retry，舊版本不派送。Webhook 只重設到期時間，漏送或早於 checkpoint 到達仍由 cron 接手。服務停機時不保證一分鐘執行，恢復後超時 queued 仍按既有失敗／retry 路徑處理。

**逾時的 job 不一定從未開始，所以失敗訊息看 checkpoint 而不是 step。** retry 會把 job 放回 `queued` 並保留原 step，因此同一個逾時有兩種來源：從未被 dispatch 的 job，以及重試後 dispatch 又沒發生、先前 checkpoint 都還在的 job。判準是這份工作有沒有留下任何 checkpoint。`preparing_data` 是新工作唯一能通過的第一步，而 `missing_checkpoint` 不允許它在缺 `data_pr_number` 與 `data_head_sha` 的情況下前進；其後每一步在它完成前都到不了，`preparing_main` 起另有 `missing_data_commit` 把關。因此七個 checkpoint 欄位全空就代表這份工作什麼都還沒碰到。（並非每個步驟都宣告 required checkpoint——`waiting_data_checks`、`waiting_main_checks` 與 `verifying_production` 沒有——但新建的工作過不到那裡。）pending 的 delivery 會寫下 metadata 卻不推進 step，所以這個判準量的是「有沒有東西跑過」，不是「有沒有階段完成」；區分從未被 dispatch 的工作與遠端產物已經釘住的工作，要的正是前者。**step 不能拿來判斷**：核准流程建立的 job 落在 `preparing_data`，舊的建立路徑落在 `assemble`，而 retry 保留上次失敗的那一步，同一個名字同時涵蓋兩種情形。只有從未完成任何階段的才說發布沒有開始；其餘沿用既有 retryable 措辭，因為 UI 四階段對它已經顯示出已完成的階段，說「沒有開始」會與同一畫面互相矛盾。

UI 四階段保留已完成進度，raw error 與 step 放在「技術詳細資訊」。每五秒重新讀取進行中的工作與活動列表狀態，不重疊請求；讀取失敗立即標示目前為上次讀取的進度，401 停止輪詢並提供重新登入入口，其他錯誤連續三次後停止，提供手動重新讀取。送審與發布只有 published 才算完成，不能在 approved/queued 顯示 6/6。同源、同瀏覽器帳號的上次 candidate 保存於 localStorage，讀寫被封鎖時仍可在記憶體中操作；登入後仍以伺服器授權清單確認可達性，各協作者的區段仍由 D1 保存。

目前 production gate：

1. 未設定 `ORGANIZER_PUBLICATION_MODE` 仍預設 disabled；該模式不注入 dispatcher，核准／retry 保留 503。production 的 Pages 與獨立 Worker 明確設定 github；Pages 核准／retry 僅提交到期的持久化 job，獨立 Worker 每次只推進一個 bounded transition。Preview Worker 仍 disabled。fake 只在 `PREVIEW_MAIL_SINK=d1` 的隔離測試環境注入，Pages 單次 dispatch 完成八個模擬步驟，不能當作公開結果證據。部署設定見[部署 runbook](../runbooks/deployment.md)。
2. 僅 `POST /api/integrations/github/webhook` 豁免 Origin 檢查，JSON 與 HMAC 保留；其他 mutating route 不變。非 github 或缺 secret 回 503；已配置時無簽章回 401。合法 delivery 僅喚醒固定兩 repo 中符合已釘住 SHA 的 active job，在同一 D1 transaction 完成 delivery 紀錄；delivery ID 重用但 bytes 或 event 不同回 409，已完成重送回 202 且不再喚醒。未知事件、repo 或 SHA 不推進任何工作，HTTP request 不執行遠端寫入。
3. `POST /api/admin/integrations/github/probe` 只接受同源 JSON `{}` 且要求有效的管理者 session；伺服器以固定 metadata:read scope 呼叫 GitHub App mint，必須得到精確 `201`，再以 installation token 讀取同一 repository metadata，GET 必須是精確 `200` 且 JSON `full_name` 完全相符才回 `{"ok":true}`。失敗只回固定 503 code；正式啟用仍須在已部署 runtime 實測。

GitHub App token provider 使用 WebCrypto RS256 簽署 App JWT（`iat = now - 60s`、`exp = iat + 600s`），接受 PKCS#8 與 PKCS#1 RSA private key。每個 provider／job 只有一份記憶體 cache；token 剩餘 60 秒內更新，進行中的 mint 共用同一個 pending promise。請求遭遇 `401` 時，每個 request 最多 invalidate 並重試一次，而且只有被拒絕的 token 仍是目前 cache 才能 invalidate；`403` 不刷新 token。缺少 App ID、installation ID 或 private key，以及 import/sign/fetch/JSON 例外，都轉成固定 `PublicationFailure`，不保存或回傳 raw exception、request body、Authorization、key、JWT 或 token。

`app/publication-rollout.ts` 的 ruleset 評估器**不是 gate**：它是無 runtime caller 的維運報告，不阻擋 publication 或模式啟用。報告檢查 main 適用規則、PR、指定 checks、check 的 App 綁定及 App／human bypass；不能把報告通過當作 App 受到權限約束，原因與已完成的治理評估見 [ADR-0066](../adr/0066-the-ruleset-cannot-bound-an-app-that-writes-checks.md)。

### 核准 snapshot 產檔

`app/publication-artifacts.ts` 消費 CREATE snapshot/3，或明確 `operation: AMEND` 的 snapshot/4，以及其核准 hash。資料產生不讀即時 catalog、時鐘或網路：內容時間取 contentUpdatedAt；活動結束取最後日期台灣時間 23:59:59；草稿有活動別稱時 `event.json` 才帶 `aliases`（緊接在 `name` 後），沒有時不出現這個鍵，已核准 snapshot 因此重建出相同位元組；活動與逐日攤位表網址皆取已核准 officialSource.url，統一經 URL canonicalization（合法的大寫 HTTPS scheme 轉小寫），snapshot bytes/hash 不改写。地圖保留每個 day × venue-space 的內容，單一範圍產生 map.json，多範圍產生完整 manifest。現行公開格式要求同活動模板一致、展區由使用空間唯一持有；不相容 snapshot 明確拒絕，不取第一個空間猜值。

`buildPublicationDataStage` 要求固定 data base commit、活動目錄不存在的觀測，以及每個 selected reference 的既有 bytes 或明確 null。缺失觀測不可當不存在；語意相同的 JSON 保留既有 bytes 並不加入寫入清單，不同或損壞拒絕。`buildPublicationMainStage` 要求實際 data merge commit／檔案 bytes 與固定 main base 資料；事件內容必須與 snapshot 產物完全相同，reference 可只有 JSON 格式差異，pin 的 hash 一律取實際 bytes。

main 清單保留原 events 順序追加；已存在活動或 pin 拒絕 CREATE。沿用同一份 event-local identity 配號器追加 allocations／evidence，不因同名猜 linkage，不動既有活動 pin；身分群組使用 codes[]，只有 snapshot 的 stableKey 能合併多個官方群組。完整產物再經 publication allowlist。這些純函式不建立或合併 PR；GitHub driver 將其結果寫入固定工作分支。

AMEND snapshot/4 額外保存不可變 `amendment.baselineJson`／`baselineSha256`、明確 `changes[]`，以及選填的正規化 `settings`。產檔以 baseline 草稿重新正規化 `settings`，結果必須與保存內容完全相同，否則以 `snapshot_mismatch` 退件；生效草稿是 baseline 草稿套上 `settings`。`event.json` 必須等於 baseline 活動資料套上宣告值（名稱、別稱、逐日 `dateLabel`，以及依新日期重算的 `dateRangeLabel`／`eventEndsAt`），除 `dataUpdatedAt` 外任何差異都退件。產檔核對 baseline、活動設定及 reference，重算宣告後必須與衍生匯入列一致；身分由已核准 grouping／宣告決定，不能以匯入列重新配舊 Circle ID。地圖仍逐範圍驗證，內容時間取此修正版的 immutable revision。

AMEND data 產檔要求固定 base 的完整 event-directory leaves，逐檔核對原 pin hash，含 NOTICE 的存在／內容與檔案集合；缺失、額外或漂移拒絕。Main 產檔要求原 published event／pin 完全一致，保留 published-events 原 bytes／順序，僅更新該活動 pin。使用此 main base 的最新 global ledger 配新 ID，容許其他活動在編輯期間取得配號；原活動的身份與退出歷史不能變更。兩階段仍驗實際合併 bytes 與 allowlist，不影響其他活動 pin。

依 ADR-0045 的發布產物補充，snapshot 宣告透過既有 planner 生成 transitions，main 只套用一次，退出歷史保存在 evidence；公開 groups/2 存放結果群組及空 transitions，供既有 `identity:generate --check` 驗證已套用的 registry，避免每次 build 再執行歷史退出。已公開 AMEND 可重新載入為下一次 baseline，source 只保留 job／snapshot 識別，不能遞迴嵌入前次 snapshot；下一次 baseline 的草稿是套上前次設定宣告的生效草稿。

AMEND 送審／核准與原 executor／driver 共用以下固定觀測與恢復路徑，沿用既有 publication mode 與 dispatcher 啟用條件。

### GitHub data／main driver

`github-publication-driver.ts` 只使用伺服器固定的兩個 repository 與 `organizer/{jobId}/{stage}` 分支，接收未重新序列化的核准 snapshot bytes。首次 data 發布前先查本部署的 published event resolver，再查 GitHub 固定 main commit 的 published collection；讀取失敗不是活動不存在的證據。

每次 preparing 先找所有狀態的同分支 PR／branch；已有 commit 時先確認其唯一 parent 是固定 current main 的歷史祖先，再以該 parent 重建預期產物，比對完整 leaf tree（包含保留的舊檔與所有新檔的 Git blob hash），不只比對 PR 本文。不接受分支自行提出、未進入 main 的基準。分支、PR、核准 check 寫入成功但回應遺失時沿用遠端產物；已關閉未合併、換 head、額外檔案或 snapshot 不符時停止，不自動覆寫。每一次 GitHub mutation（含 tree／commit、branch、PR、check、merge）都在發送前持久化 write intent 並重驗 lease。

必要 check 使用同 head SHA、最新 check run、completed + success；skipped 不通過。核准 check 另比對 job 與 approval hash。合併仍帶 expected SHA；若回應遺失，重試讀取同 PR 的已合併 SHA，不再次 merge。Main 產檔再次讀取固定 data merge commit 的 bytes。`Browser acceptance` 列在唯一的 `PUBLICATION_REQUIRED_CHECKS.main` 定義中。

AMEND 沿用同一 executor 的八個步驟，候選 operation、eventId 與 snapshot/4 明確 AMEND 必須一致；CREATE 仍做首次發布碰撞檢查。Driver 每次 preparing 讀固定原目錄／pin，AMEND 不能靠相同 eventId 取得覆寫權。合併前重建原 PR parent 的核准產物、比對完整分支 tree，再查目前 main 的原 pin、活動資料與身份歷史；PR 準備後待寫入檔案有變更時，回不可重試 `amendment_base_conflict`，停止合併以保留介入的發布，交由管理者核對，不能靠反覆按重試覆寫。無關程式／文件前進不阻擋。

AMEND 的分支、PR、核准 check 或 merge 回應遺失，仍以原工作識別與完整 tree 恢復；已合併 PR 不再要求目前 pin 等於舊基準（自己的 merge 已更新它），而是核對原 parent、固定 data merge 與該 PR 的合併 SHA／產物 bytes。原 checkpoint、expected head SHA、lease、sticky write intent 與同 head 必要 checks 全部保留，沒有改用另一个 job 或另一套部署流程。Pages production origin 驗證仍是完成 published 的必要條件。

Deployment seam 缺少實作時仍回 `publication_deployment_unavailable`，不能完成 published；Pages 與 cron 共用的 runtime 使用 [`github-publication-deployment.ts`](../../app/github-publication-deployment.ts) 的 adapter。只接受 main repository、`deploy-pages.yml`（workflow ID 331570396）、push/main、本 job `main_merge_sha` 的唯一 run。先保存 run ID／attempt，再讀該 attempt 的 jobs；`Deploy to Cloudflare Pages` 成功才進入 verifying，該 attempt 的 `Verify and deploy` 與 `Smoke test production deployment` 均 completed + success 才檢查公開來源。Skipped 不通過，custom domain 結果不影響 blocking gate。

CI 在 pinned production build 後產生 `deployment-manifest.json`，記錄部署 commit、所有 published event 的 data pin commit 與實際輸出 JSON SHA-256；production smoke 同時核對部署 commit。Runtime 僅查固定 `https://tw-catalog.pages.dev`、不帶認證且不接受 redirect，核對本次 main SHA／data SHA、固定 main commit 的完整公開活動清單、全部列出的活動 JSON bytes（含既有活動、地圖）、Reader HTML 與匿名 session 401，最後重讀 manifest 確認驗證途中未換版。通過後保存 manifest SHA-256 才可 published。這不取代 CH20 真實 Reader UI 驗收。

部署或 workflow smoke 失敗記錄 retryable `publication_deployment_failed`；既有 Owner／Admin retry 交易僅授權原 run 的下一個 attempt，保留 snapshot、data／main SHA、PR 與原 stage。Adapter 重跑原 run，接受 GitHub 空 body 201，回應遺失後先 reconcile 已出現的下一 attempt；未經 retry 的 attempt 改變 fail closed。重跑前在既有 lease／remote intent 下重查 main，若已前進就拒絕部署舊 checkout。只有 origin 檢查失敗則重驗 origin，不重新建立 PR 或主動重部署。模擬 GitHub／本機 D1 證據不能代替真正的發布失敗恢復。

既有純函式邊界保留：

- [`publicationPathAllowed()`](../../app/publication-bundle-assembler.ts) 的路徑 allowlist——data repository 只接受 `events/<eventId>/` 底下的 `event`／`official-booths`／`circle-identity-groups`／`map`／`map-manifest`／`reference-selection`、`maps/<day>/<space>.json` 與 `NOTICE`，加上 `references/**.json`；main repository 只接受 `data/published-events.json`、兩份 identity 檔與該活動的 pin。`.github/**` 與任何跳脫路徑一律拒絕。
- webhook 的 HMAC 驗證與以 delivery id 去重。

data／main 的 PR、核准 check、allowlist 與 expected SHA merge 由 driver 執行，持久化排程依 [ADR-0062](../adr/0062-publication-wakes-through-webhooks-and-a-dedicated-cron.md)，deployment／origin 由上述 adapter 核對。合併前 PR 作者必須是建立核准 check 的同一個 App（[ADR-0066](../adr/0066-the-ruleset-cannot-bound-an-app-that-writes-checks.md)）。disabled 不自動發布；啟用後僅目前核准版本的 active job 可派送，超時 queued 先轉 failed，failed 舊 job 不自行恢復。失敗候選的內容有誤時，須明確經 UI reopen、重新匯入、validate／submit／approve，不重試錯誤 snapshot。

## 與地圖貢獻流程的邊界

`map_drafts` 由 organizer 與公開[地圖貢獻控制面](./map-contributions.md)共用，而候選活動的 `event_id` 可能正是某個已發布活動的 id。**唯一能分開兩條管線的是 `candidate_id`**：

- organizer 的地圖草稿 `candidate_id` 非 NULL，且只能經 `/api/organizer/**` 讀寫。
- 公開地圖貢獻流程的每一句 SQL 都要求 `candidate_id IS NULL`。

少了這個條件，同時具備 organizer 與 `map_contributor` 身分的人可以把候選地圖送進公開審閱並匯出成正式地圖。這是程式邊界，不是慣例；回歸測試涵蓋這個身分組合。

## 驗收條件

- 未登入或無 grant 的帳號拿不到任何候選活動；不存在的候選與無權限的候選都回 404，不區分。
- 任何寫入帶錯 `expectedVersion` 一律 409，且回應指出目前版本。
- 送審與核准是兩次獨立動作，各自要求有效 session；核准自己送出的 revision 會在稽核留下 `selfApproval`。
- 匯入 API 拒絕未宣告的活動日、場館空間或展區，並在錯誤訊息指出來源列號。
- 預覽裡移除的列不會被匯入，也不會產生待修正項目；被它解除的攤位重複不再回報。
- 手動補正過的列仍要通過與其他列相同的檢查：未宣告的活動日、場館空間或展區照樣被匯入 API 拒絕，介面上的修正不是繞過那道檢查的路。
- `ORGANIZER_PUBLICATION_MODE` 未設定或缺少 dispatcher 時，核准 API 回 503，候選保留 `submitted`，不建立發布工作；非 github 模式的 webhook 回 503。
- 只有 Owner／Admin 以有效 session、目前版本與非空理由可退回 `failed` 候選；系統先以 global lease 查核固定遠端分支與完整 PR 分頁，任何遠端紀錄或不確定性都拒絕，成功後保留 eventId／歷史並令舊 job 不可重試。
- 退回期間若 lease 過期或版本 CAS 失敗，不新增 revision、review 或 audit；sticky `remote_write_intent_at` 與任一 confirmed checkpoint 也會阻止退回。
- 停在 `queued` 超過 15 分鐘的發布工作，在活動列表與活動頁都顯示為失敗且可重試，重試的是原本那一筆 job；沒有任何介面可以手動啟動一筆 `queued` job。
- 逾時失敗的訊息只有在該 job 一個 checkpoint 都沒有時才說發布沒有開始；已經留下 checkpoint 的工作沿用既有 retryable 措辭，不與四階段清單上的進度互相矛盾。這條對核准流程建立的 job（`preparing_data`）與舊建立路徑（`assemble`）都成立。
- 公開 bundle 不含 organizer 介面與寫入 route，由 `tests/public-artifact.test.mjs` 把關。
- 新候選活動預設進入引導；跨登入可恢復每位協作者自己的位置；完成 onboarding、切換區段或執行驗證都不會產生候選內容 revision。
- workspace preference 與完成 onboarding 的最終 SQL 寫入會再次檢查 active grant；權限在請求途中被撤銷時不會留下流程狀態變更，對外仍回 404。
