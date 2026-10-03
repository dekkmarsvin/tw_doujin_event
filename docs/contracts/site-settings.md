# 網站營運設定

**實作**：`app/site-settings.ts`、`app/site-service-check.ts`、`app/admin/admin-site-settings-panel.tsx`、`app/workspace-nav.tsx`、`db/site-settings-repository.ts`、`db/identity-runtime-schema.ts`、`functions/api/admin/site-settings.ts`、`functions/api/admin/service-check.ts`、`workers/publication-dispatch/index.ts`
**測試**：`tests/site-settings.test.mjs`、`tests/organizer-applications.test.mjs`、`tests/account-notifications.test.mjs`、`tests/review-notifications.test.mjs`、`tests/organizer-repository.test.mjs`、`tests/browser/portal-admin-entry.mjs`、`tests/browser/portal-organizer-amendment-publication.mjs`

`/admin?section=settings` 沿用網站管理入口、登入與管理者授權，管理活動申請、聯絡方式、通知、發布四項營運設定。首頁沿用既有登入入口，不新增另一個申請按鈕，也不為開關加入 Reader API。公開申請由維護者在 Admin 手動啟用；這是 #477 的已接受決策，取代 #163 原以零人工補救旅程作為公開申請開關的前置；該旅程仍是 Organizer 里程碑驗收。

## 唯一設定來源與儲存

同環境 Pages 與排程 Worker 共用 D1 `site_settings` 單筆 `id='global'`。Pages 控制面以 `INSERT OR IGNORE` 保留已儲存的設定；新資料庫初始為暫停申請、空名單、通知與發布關閉，之後由 Admin 啟用。舊營運環境旗標已移除，不作初始化或 runtime fallback。Worker 不初始化這筆資料；若先到則跳過工作並記錄未初始化，待 Pages 完成後下一 tick 讀取。Runtime schema 繼續沿用單一 initializer/version。


`GET /api/admin/site-settings` 只供有效網站管理者讀取完整設定、唯讀發布能力、進行中活動及最近一次診斷。`PUT` 接受完整 `settings` 與 `expectedUpdatedAt`，驗證 enum、boolean、email 陣列並正規化、去空白及去重；聯絡連結只接受空字串或 https（500 字內），認領審核中說明為 200 字內的自由文字，兩者去除前後空白。時間／epoch／actor 由伺服器建立；交易內重查有效帳號、session、admin 及舊更新版本，同 batch 寫入 audit。過期表單回 409，不覆寫其他管理者的修改。Audit 保留切換值、名單數量與聯絡設定，不複製 email 名單。

Repository／isolate 只快取初始化，不快取可變設定。申請及通知 producer 讀最新 D1；scheduler 在每 tick／新工作邊界讀設定。管理者儲存後顯示「已生效」、更新時間與操作者。

## 四項行為

- 申請 `closed`：所有帳號停止新送件，保留既有申請查詢、邀請、workspace 與 grant。`invite_only`：僅名單中已登入帳號送件。`public`：所有已登入帳號可送件，仍逐件審核。Session、申請清單資格及 POST 使用同一 D1 設定。
- 聯絡方式：聯絡連結非空時，社團資料與主辦工作區登入後的頁首顯示「聯絡管理者」，在新分頁開啟。認領審核中說明非空時，社團有人工審核中的認領才顯示，後接聯絡連結；驗證碼認領由社團自行完成驗證，不顯示。兩者經登入 session 回應（`contactUrl`、`claimReviewNotice`）傳給工作區，未登入頁面與公開閱讀端不讀取。新資料庫與既有資料庫升級後皆為空字串，需由管理者設定。
- 帳號通知：停用時停止新入列與寄送；false → true 由伺服器建立新的起點，原 pending 早於起點的項目取消，不補寄停用期間事件。個人頻率／偏好保留。登入及邀請信沿用原路徑，不受這兩個通知開關控制。
- 待審通知：全站寄信開關只控制 scheduler；各管理者的啟用時間與頻率沿用原偏好。暫停期間不改寫偏好或刪除待審工作。
- 發布：`ORGANIZER_PUBLICATION_MODE` 保留環境能力邊界，D1 `publication_enabled` 控制正常執行。暫停仍可編輯與送審；拒絕新核准發布／重試，scheduler 不執行新步驟及逾時清理，保留 job／snapshot／checkpoint／已公開版本。恢復同一 job；queued 工作的原 15 分鐘等待窗從恢復時重算。已發出的 GitHub 呼叫、合併及部署不會因開關而撤銷。

## 活動狀態與唯讀健康檢查

Admin 顯示目前 queued／publishing 活動名稱、狀態、階段及工作區連結；runtime 已暫停時顯示已暫停。發布模式 disabled 時停用發布控制；連線或診斷失敗仍可暫停處理。

「檢查服務」在原 D1 `site_service_check` 保存一筆可覆寫的請求／結果，由既有每分鐘 Worker 使用自己的實際憑證檢查。沒有新 Worker／排程角色、診斷歷史或郵件寄送。Admin 僅在這一次請求等待結果，最多 90 秒；逾時顯示尚未收到結果，不宣稱服務故障。較早結果不能覆寫較新請求。

寄信只讀 Mailgun 網域資料：檢查設定、連線、金鑰與 active 網域。發送專用金鑰沒有網域讀取權時顯示「無法確認」，不推定無法寄信；此檢查不證明收件匣投遞，也不寄測試信。發布向 GitHub 取得固定兩個 repository、與 driver 相同 permission scope 的 installation token，不建立 branch／PR／merge。回傳僅包含明確分類、來源與原因，不含 token、私鑰或 provider 回應內文。未檢查／暫時連線失敗與已確認不可用分開呈現。

首次部署／清除舊環境旗標與回滾順序見[部署 runbook](../runbooks/deployment.md#網站營運設定遷移477)。
