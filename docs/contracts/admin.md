# 管理入口契約

網站管理入口 `/admin` 的行為契約：認領與內容審核、帳號、網站營運設定與共用資料。登入沿用[社團入口](./circle-portal.md#入口分離)的 session，只有管理者名單上的帳號能使用。

**實作**：`app/admin/admin-panels.tsx`
**實作**：`app/admin/use-admin-review-queue.ts`
**實作**：`app/admin/admin-app.tsx`、`app/admin/admin-navigation.ts`、`app/admin/admin-overview.tsx`
**實作**：`app/admin/admin-circle-panel.tsx`、`app/admin-circle-detail.ts`
**實作**：`app/admin/admin-account-panel.tsx`、`app/admin-account-detail.ts`

## 待審通知

每筆新的活動申請、活動內容送審或人工待審認領，寄一封信給每位網站管理者（#546）；自動通過的認領不寄。信件只有類型、活動代碼與審核入口，不附申請內容、證據或登入憑證。沒有個人頻率或開關，全站開關在[網站營運設定](#網站營運設定)。寄送方式見[部署 runbook 的通知](../runbooks/deployment.md#通知)。

## 審核與帳號操作

- `/admin` 依 `section` 分為管理總覽、活動管理、社團管理、帳號管理、資料管理與網站設定；只有目前分區的面板掛載。活動管理預設完整活動總表，另有審核與發布頁籤；社團管理預設認領審核，另一頁籤保留名稱查詢與撤下。帳號管理預設 Email 查詢，網站管理者名單另有唯一頁籤，停用位於已確認目標的帳號明細；資料管理保留場館／主辦／分類。候選活動的內容、成員與核准並發布仍在 `/organizer`，不重建 Admin 編輯器。
- **`/admin` 預設跨活動管理總覽，不先選活動。** 待審摘要採既有 COUNT 及完整認領分組計數；待審內容的計數與列表都包含 submitted 及發布未完成而停在 approved 的候選（#581），單列連指定 candidate 的 review。認領活動摘要進該活動清單；過去活動的待辦保留。近期活動只列已知公開活動，標明「已公開活動」，連往完整活動總表；總表以 eventId 合併公開定義及候選版次，無 eventId 者分開，公開日期與工作日期分列。發布摘要列目前 queued／publishing 及未解決 failed 作業、edition、階段與更新時間，連指定候選 review；不可重試及暫停不代表問題已解決。`/circle` 的管理連結不帶活動。
- 新路由以 `section`／`view`／`event` 及必要 `claim` 精確識別；社團查詢保留 `q`，資料管理保留 `view`。舊 `section=references` 映射資料管理，`#overview`／`#admin`／`#takedown`／`#accounts`／`#review-notifications` 保留目的地。無分區及錨點的 `/admin?event=X` 永久開該活動認領審核；精確新分區不被 legacy event 規則覆蓋。無效的指定活動或頁籤顯示無法開啟，不改開第一場。
- 社團查詢先選一場已公開、此部署服務的活動，沿用名稱搜尋與上限；`event`／`q`／`circle` 可還原指定明細，返回列表保留搜尋。`GET /api/admin/circles/:circleId?event=...` 只供管理者讀取指定活動的官方基本資料、認領帳號／結果、目前保存的補充內容及可歸屬該活動／社團的必要處理紀錄；不放寬社團擁有者查詢，也不向公開 Reader 回傳私人認領資料。沒有可用公開頁或可信主辦工作區時不產生連結。
- 明細的資料狀態與公開狀態分開。公開中沿用 `getPublicOverride` 的 `live`、同活動 `verified` 認領與活動結束後 `post_event_hidden` 判斷；內容仍存在但因無有效認領或活動後隱藏而不公開，不稱已刪除或管理者撤下。圖片處理另列無清除工作、已清除、待清除或無法確認，查核錯誤不冒充已清除；整筆查無、無補充內容與讀取失敗分開。
- 從明細撤下直接使用已選定的活動／社團，原因與確認顯示對象及既有後果；沿用同一 `POST /api/admin/overrides`、條件寫入、稽核、通知與圖片清除。成功或原有部分圖片失敗後重讀明細及搜尋結果，已撤下但仍待清除可接續原撤下重試。活動／社團切換不沿用原因或非同步結果；Organizer 的 scoped 撤下面板維持原行為。
- 明細的已通過認領列提供撤銷，確認顯示活動、帳號與後果（該帳號不能再編輯、補充資料立即停止公開、內容保留）；沿用 `POST /api/admin/claims` 的 `revoke`、稽核、通知與公開文件重建，完成後重讀明細與搜尋結果。
- 帳號查詢使用 `GET /api/admin/accounts?email=...`，僅管理者可讀，Email 沿用既有正規化與驗證；查無回傳空帳號，不建立帳號、寄信或授權。帳號明細與讀取失敗分開，列出可使用／已停用／刪除中、網站管理者名單、目標帳號自己的有效候選成員 grants 與社團認領。候選以 ID 區分，不按同名合併，版次沿用既有 edition；不把管理者自己的全站查阅資格當作被查者的 role。可用的認領明細／審核連結帶精確活動與對象，未服務活動保留紀錄而不產生壞連結，私人關聯不進 Reader。
- 同一查詢欄可解析為 Email 時讀取該帳號，否則以社團名稱查帳號（正式社團名稱含「@」，例如 `Millet@半米紀行`，不能以「@」判斷）：`GET /api/admin/accounts?circle=...` 僅管理者可讀，將輸入以 `normalizeCircleName` 正規化後，對認領保存的社團名稱鍵做部分比對（`%`、`_` 照字面），跨活動、不分認領狀態，依申請時間新到舊列出最多 20 筆的社團名稱、活動、認領狀態與申請帳號 Email；不回傳佐證，不建立帳號或寄信。結果連到該 Email 的帳號明細，`q` 還原這次搜尋。
- 帳號分區以 `view=search`／`view=admins` 切換；`email` 還原查詢目標，舊 `#accounts` 仍開管理者名單。帳號讀取與停用不受其他分區的活動篩選影響。帳號限制依既有 handler，成功後重讀，失敗保留目標與結果。
- 帳號明細底部停用顯示已確認 Email、既有影響與確認，不重填目標。仍在網站管理者名單內時先提示移出名單及提供該入口，伺服器判斷仍保留；管理者新增／移除集中於同一名單，不能移除自己或最後管理者等限制不變。不新增恢復、合併或任意帳號編輯。
- 需要單一活動的區塊各自帶活動選單：撤下表單的請求指名表單上選的活動。只有一場已發布活動時不顯示選單。管理者名單及帳號停用仍是帳號層操作。
- **批次核准與婉拒先確認。** 確認視窗依活動分組列出社團；已有通過認領的社團、以及同一活動同一社團勾選了兩筆以上時，這些認領列為「略過」並留在清單，由管理者逐筆決定。送出時逐筆請求、逐筆回報：清單上方一行總結，未完成的原因標在該列；登入失效或失去管理者資格時停止送出其餘各筆。單筆核准與婉拒不經確認。
- **核准與婉拒只作用於仍在待審的認領。** 清單可能落後其他管理者或其他分頁數秒；對已處理的認領送出核准或婉拒回 `409`「這筆認領已不在待審中。」，不改寫既有結果，也不重建公開文件。撤下擁有者只能用撤銷；撤銷只作用於仍為通過的認領，其他狀態回 `409`「這筆認領已不是通過狀態。」，不改寫待審、婉拒或已撤回的結果。
- `/admin` 在登入到期或 API 回 401 時移除管理內容並提供 `/circle` 重新登入連結。未登入與重新登入入口以 `admin=1` 及 `adminSection`／`adminView`／`adminEvent`／`adminClaim`／`adminCircle`／`adminSearch`／`adminEmail`／`adminHash`／`adminNotifications` 白名單保留原目的地；與社團的 `event`／`circle` 選擇分開。沿用 circle audience、既有登入表單與 token 消耗，登入後只轉回同源固定 `/admin`，不接受任意 return URL。連結不授權，非管理者仍顯示「需要管理者權限」；逐 endpoint 的管理者、CSRF、活動與 revision 檢查不因入口搬移改變。
- 待審總覽與認領清單在頁面可見時每 30 秒更新，切回頁面時立即更新，也可手動重新整理。更新失敗顯示錯誤，保留上次成功取得的清單；核准或婉拒送出期間不以背景更新替換清單。
- **只有首次載入與手動按下才改變「重新整理」按鈕的狀態**；背景更新照常換清單、照常回報失敗，但不把按鈕切成「更新中…」。讀者沒有按過的控制項每 30 秒閃一次，只是動作，不是資訊。
- 讀取待審認領、核准、婉拒與撤銷都要求同一個有效 session 與當下的管理者資格。到期時整個控制面回到登入畫面，不保留「已登入但管理功能因登入時間被鎖定」的第二種狀態。
- **管理者名單存在資料庫（`admins` 表）而非設定值**，可在控制面即時增減、不需重新部署。
- **不得移除自己，也不得移除最後一位管理者**——兩者都是把自己鎖在門外的最短路徑。
- 名單為空時由 `ADMIN_EMAILS` 設定值重新灌入，作為救援路徑。上面兩道限制讓它不會正常地走到那一步。
- 管理者位址比對前先做與儲存時相同的正規化。
- 管理者可撤下任何社團補充資料，D1 公開文件立即移除；已開啟讀者頁面的可見性限制見[資料傳輸契約](./reader.md#更新可見性)，不能把伺服器撤下等同用戶端立即更新。

## 網站營運設定

**實作**：`app/site-settings.ts`、`app/site-service-check.ts`、`app/admin/admin-site-settings-panel.tsx`、`app/workspace-nav.tsx`、`db/site-settings-repository.ts`、`server/admin.ts`、`functions/_after-write.ts`
**測試**：`tests/site-settings.test.mjs`、`tests/api-organizer.test.mjs`、`tests/notification-delivery.test.mjs`、`tests/organizer-repository.test.mjs`、`tests/browser/portal-admin-entry.mjs`
**實作**：`app/admin/use-admin-site-status.ts`、`app/admin/admin-service-status.tsx`

`/admin?section=settings` 沿用網站管理入口、登入與管理者授權，管理活動申請、聯絡方式、通知、發布四項營運設定。首頁沿用既有登入入口，不新增另一個申請按鈕，也不為開關加入 Reader API。公開申請由維護者在 Admin 手動啟用；這是 #477 的已接受決策，取代 #163 原以零人工補救旅程作為公開申請開關的前置；該旅程仍是 Organizer 里程碑驗收。

### 唯一設定來源與儲存

設定存在 D1 `site_settings` 單筆 `id='global'`，schema 由 `migrations/` 建立。Pages 控制面以 `INSERT OR IGNORE` 保留已儲存的設定；新資料庫初始為暫停申請、空名單、通知與發布關閉，之後由 Admin 啟用。舊營運環境旗標已移除，不作初始化或 runtime fallback。


`GET /api/admin/site-settings` 只供有效網站管理者讀取完整設定、唯讀發布能力、進行中與未解決發布活動及最近一次診斷。`PUT` 接受完整 `settings` 與 `expectedUpdatedAt`，驗證 enum、boolean、email 陣列並正規化、去空白及去重；聯絡連結只接受空字串或 https（500 字內），認領審核中說明為 200 字內的自由文字，兩者去除前後空白。時間／epoch／actor 由伺服器建立；交易內重查有效帳號、session、admin 及舊更新版本，同 batch 寫入 audit。過期表單回 409，不覆寫其他管理者的修改。Audit 保留切換值、名單數量與聯絡設定，不複製 email 名單。

Repository／isolate 只快取初始化，不快取可變設定。申請及通知 producer 讀最新 D1；寫入後的背景工作每次執行時讀設定。管理者儲存後顯示「已生效」、更新時間與操作者。

### 四項行為

- 申請 `closed`：所有帳號停止新送件，保留既有申請查詢、邀請、workspace 與 grant。`invite_only`：僅名單中已登入帳號送件。`public`：所有已登入帳號可送件，仍逐件審核。Session、申請清單資格及 POST 使用同一 D1 設定。
- 聯絡方式：聯絡連結非空時，社團資料與主辦工作區登入後的頁首顯示「聯絡管理者」，在新分頁開啟。認領審核中說明非空時，社團有人工審核中的認領才顯示，後接聯絡連結；驗證碼認領由社團自行完成驗證，不顯示。兩者經登入 session 回應（`contactUrl`、`claimReviewNotice`）傳給工作區，未登入頁面與公開閱讀端不讀取。新資料庫與既有資料庫升級後皆為空字串，需由管理者設定。
- 帳號通知：停用時停止新入列與寄送；false → true 由伺服器建立新的起點，原 pending 早於起點的項目取消，不補寄停用期間事件。登入及邀請信沿用原路徑，不受這兩個通知開關控制。
- 待審通知：全站開關控制是否寄出待審通知信；暫停期間不刪除待審工作。
- 發布：`ORGANIZER_PUBLICATION_MODE` 保留環境能力邊界，D1 `publication_enabled` 控制正常執行。暫停仍可編輯與送審；核准並發布回 503，送審內容與已公開版本保留，恢復後再核准即可。

### 活動狀態與唯讀健康檢查

管理總覽唯讀顯示已保存的申請模式、發布開關、帳號通知與待審通知；設定表單仍是唯一修改入口，未保存輸入與個人偏好不改總覽。發布在核准請求內完成，沒有排隊或進行中的作業可列；發布未完成而停在已核准的版本與待審內容列在一起，連到工作區再核准。環境發布能力與已保存開關、最近服務結果分開。讀取失敗顯示未知，保留舊值時標示更新時間及更新失敗。進入或一般刷新只讀取 D1，不發起診斷。

發布模式 disabled 時停用發布控制；連線或診斷失敗仍可暫停處理。

「檢查服務」在原 D1 `site_service_check` 保存一筆可覆寫的請求／結果，由下一次寫入請求之後的背景工作以 Pages 的實際憑證檢查。沒有排程、診斷歷史或郵件寄送。Admin 僅在這一次請求等待結果，最多 90 秒；逾時顯示尚未收到結果，不宣稱服務故障。較早結果不能覆寫較新請求。

寄信只讀 Mailgun 網域資料：檢查設定、連線、金鑰與 active 網域。發送專用金鑰沒有網域讀取權時顯示「無法確認」，不推定無法寄信；此檢查不證明收件匣投遞，也不寄測試信。發布只檢查此環境是否啟用核准即寫入活動資料（`ORGANIZER_PUBLICATION_MODE=r2`），不寫入任何資料。回傳僅包含明確分類、來源與原因，不含金鑰或 provider 回應內文。未檢查／暫時連線失敗與已確認不可用分開呈現。

首次部署／清除舊環境旗標與回滾順序見[部署 runbook](../runbooks/deployment.md#網站營運設定遷移477)。

## 共用資料管理

網站管理的「共用資料」入口為 `/admin?section=references`。管理者可在沒有候選活動時讀取完整場館／場地、主辦與分類目錄，新增場館連同第一個場地、在既有場館新增場地、新增主辦與分類目錄，以及補齊既有場館／場地缺少的 canonical 來源或場館地址。分類目錄須屬於既有主辦；場館與場地保留既有識別碼，地址只保存在 canonical reference JSON。

`GET /api/admin/references` 僅回傳操作所需的公開欄位、版本及編輯／刪除限制；版本是 canonical bytes 的 SHA-256，場地另含展區預設。`POST` 依 `kind` 執行建立／補齊，或以 `action: edit | delete` 加上 GET 的 `path`／`version` 修改／刪除。兩者都要求管理者；每次寫入在同一 D1 transaction 內重新確認帳號仍為有效管理者、資料未變、依賴條件仍成立，寫入並留下 audit。地址補齊仍要求資料缺地址，既有來源補齊仍不可覆寫。

分類編輯保留目錄 ID、所屬主辦與舊版，另存遞增版本；版號採數值排序，目錄流水號獨立保存已配置的最大版號，不因刪除或 audit 隱私清除而重用。分類按輸入行序保存，重排保留同名分類 ID 及說明；新名稱取得新 ID。共用資料清單依目錄分組，新版在前、舊版預設摺疊，各版可獨立展開；雙欄內容由左到右逐列排列。公開篩選另有「全部類別」，不屬於可編輯分類。

主辦／場館／場地只有尚未被活動歷史或快照引用的記錄可原地編輯，場館／場地同步更新選單 metadata。已固定的系統 seed 不可一般編輯或刪除。刪除同樣要求未被引用，主辦另須沒有所屬分類，場館另須沒有場地；場地也檢查匯入列與地圖。引用判斷涵蓋已保存的候選 revision 及 submission snapshot，保留歷史可解析性。活動儲存也在 SQL 寫入時核對所選主辦、分類版本與場館／場地仍存在，避免讀取後遭刪除的競態。過期、引用或撤權衝突回傳 409，不留下部分資料或 audit。

編輯採置中 modal，提供儲存與取消，離開未儲存內容時確認放棄；刪除先列出目標及不可復原後果，受引用限制時只顯示原因與取消。寫入成功後清單重新讀取若失敗，顯示已儲存／刪除狀態、鎖住寫入，只允許重試 GET；不得重送已成功 POST。既有候選活動的角色與版本檢查不變，已送審 snapshot 和已發布版本不變；新分類版本須由活動明確選取，不會自動套用至既有活動，本次不擴張發布後修正可修改的 reference 範圍。

**實作**：[`app/admin-reference-handlers.ts`](../../app/admin-reference-handlers.ts)、[`app/shared-reference-catalog.ts`](../../app/shared-reference-catalog.ts)、[`app/admin/admin-reference-panel.tsx`](../../app/admin/admin-reference-panel.tsx)、[`db/admin-reference-repository.ts`](../../db/admin-reference-repository.ts)、[`server/admin.ts`](../../server/admin.ts)。
**驗證**：[`tests/api-admin.test.mjs`](../../tests/api-admin.test.mjs)。
