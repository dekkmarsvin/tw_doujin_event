# ADR-0067 草案：稽核依用途保存，先移除兩項重複寫入

- 狀態：**提案，尚未生效（2026-09-22）**。合併這份草案不核准清除資料，也不改變現有保存期限。
- 對應：[#189](https://github.com/dekkmarsvin/tw_doujin_event/issues/189)。本票交付研究與方案；後續實作由維護者選入。
- 盤點基準：`main@528de91d0f3c61c366ac2addd211c39a4f64b994`。未讀取或清除 production D1 資料；以下是程式與契約盤點，沒有資料量或節費推估。
- 若採納將部分取代：[0021](./0021-credentials-expire-and-are-purged-records-are-kept.md)、[0027](./0027-personal-data-lifecycle-and-account-deletion.md)、[0033](./0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md) 中「audit 永不刪列」的概括規則。**目前仍以這三份生效決策為準。**

## 問題與已查證的現況

`audit_log` 把登入診斷、普通修改、權限決策及清除摘要全部永久保存；IP 90 天後清空，帳號刪除會塗銷 actor、主體連結、自由內容與 IP。它沒有一般使用者或管理介面的查詢功能，目前的讀取者是維護者透過 D1 排錯。不能因沒有 audit browser 就認定紀錄沒有用途，也不為本票建立查詢平台。

實際寫入分散於 [handlers](../../app/circle-portal-handlers.ts)、[repository](../../db/identity-repository.ts)、[修正 repository](../../db/organizer-amendment-repository.ts) 與 [retention purge](../../db/retention-purge.ts)。多個 handler 先完成業務寫入，再 `await writeAudit`；後者失敗時可能回傳失敗，但業務已經成功。場館建立、reference 建立、直接 owner grant、退回修改及 AMEND 等部分路徑已將 audit 放在受條件控制的 batch，不能一概改成忽略 audit 失敗。

核准／要求修改有 `organizer_event_reviews` 與 snapshot，另寫 `organizer_event.approved`／`changes_requested` audit；後者帶 snapshot hash、selfApproval。發布結果實際在 `organizer_publication_jobs`，**沒有 `organizer_publication.published`／`failed` audit action**。重試會清掉 job 上的 error／failure_code，因此現況不是每次結果都永久可追溯。這是後續必要紀錄的缺口，不是本草案已經補齊的能力。

## 建議分類與期限（均待決策）

共同原則：期限從紀錄時間計算；「90 天」指整列到期清除，與現行只清 IP 不同。必要決策紀錄不設期限，但只留主體識別、action、角色、版本／hash、決策時間等最小欄位；帳號刪除仍去識別化，不留下被刪內容。自由文字、URL、原始來源檔名、留言本文、完整請求或錯誤堆疊都不是永久 audit 的必要內容。

| 實際 action／資料 | 處理情境與查看者 | 既有業務證據及差異 | 建議 |
| --- | --- | --- | --- |
| `auth.link_requested`、`auth.session_created`、`auth.signed_out` | 維護者處理收不到信、異常登入、登出爭議 | token／session 有短期限，無完整歷史；速率限制不以 audit 計數 | 診斷 90 天；保留既有 email HMAC，禁止 token／cookie／明文 email |
| `claim.challenge_failed`、`claim.verify_conflict` | 維護者判斷驗證錯誤或佔用衝突 | claim 的累計次數／目前狀態不能重建每次失敗 | 診斷 90 天；URL 不永久保留 |
| `claim.created`、`claim.auto_verified`、`claim.withdrawn`、`claim.admin_approve`／`admin_reject`／`admin_revoke` | 管理者處理認領／撤銷爭議 | claim 保存目前處理結果，但曾經的轉換仍有價值 | 最小決策紀錄不設期限 |
| `admin.added`／`removed`、`account.disabled`／`deleted`、`map_contributor.grant`／`revoke`／`suspend` | 管理者回答誰取得／失去權限、誰執行停用／刪除 | 名冊和 grant 會改變或隨帳號刪除，不能替代歷史決策 | 最小決策紀錄不設期限；`account.deleted` 維持已塗銷記錄 |
| `override.retention`、`override.post_event_visibility`、`override.takendown`、`override.deleted`、`override.purged` | 管理者／維護者核對公開選擇、撤下或清除是否完成 | override 可被覆寫／刪除；歷史保存選擇仍解釋既有到期處理 | 最小決策紀錄不設期限；舊 retention action 不因新 UI 已退場而刪掉 |
| `override.updated` | 維護者釐清何時成功保存社團資料 | override 只保存目前內容，公開 doc revision 也非逐次完整歷史 | 90 天，承認其修改時間／actor 的排錯用途；不複製欄位內容 |
| `map_draft.created` | 維護者排查草稿建立 | draft 與初始 revision 已有建立者／時間 | 90 天；本批不改草稿保存期 |
| `map_draft.submitted`、`changes_requested`／`reject`／`approve`、`exported`、`purged`／`content_purged`／`raw_purged` | 管理者審閱、維護者確認核准版本及清除 | reviews／exports 有版本與決策；清除後仍須知道發生什麼 | 最小決策紀錄不設期限；已有 business record 的路徑不再新增第二份內容副本 |
| `map_draft.commented` | 貢獻者與管理者閱讀討論；維護者排查提交 | comment 已保存 revision、author role／account、target、時間及本文；audit 只再記 revision、target kind 與 IP | **停止新 audit**；代價是留言不再另留 IP。舊 audit 90 天；comment 本身仍依 ADR-0033 隨草稿／匿名化規則保存 |
| `organizer_event.created`、`organizer_venue.created`、`organizer_venue_space.created`、`organizer_reference.created`、`organizer.amendment.create` | 維護者核對來源、候選及修正基準 | candidate、reference、revision、amendment 已有建立者或基準，但有些建立／授權同時發生 | 保留最小來源／建立決策，不設期限；不拆現有 atomic audit |
| `organizer_event.owner_granted_on_create`、`owner_invite`／`owner_revoke`／`editor_invite`／`editor_revoke` | 管理者／主辦核對協作權限 | grant／invitation 是業務狀態，帳號刪除會改寫識別資料 | 最小決策紀錄不設期限 |
| `organizer_event.updated`、`import_replaced`、`map_created`／`map_updated`／`map_background_updated`、`organizer.amendment.save` | 主辦查目前版本；維護者處理遺失修改與版本衝突 | revision、import source／rows、map revision、amendment changes 有版本和來源；audit 並非還原內容來源 | audit 90 天；版本／業務資料期限不在本方案變更；不把原始檔 hash 說成編輯後內容 hash |
| `organizer_event.onboarding_completed` | 主辦回到建置冊，維護者釐清流程模式 | workspace state 有不可逆的完成者／完成時間；audit 額外留當時版本、角色和 IP，無現有流程依賴這三項 | **停止新 audit**；接受不再另存該版本／角色／IP。舊 audit 90 天，workspace state 不變 |
| `organizer_event.invitation_failed` | 維護者區分候選建立成功與邀請寄送失敗 | invitation／mail 狀態不一定涵蓋完整例外原因 | 診斷 90 天；只允許已定義的失敗類別 |
| `organizer_event.submitted`、`approved`／`changes_requested`、`reopened`、`organizer_publication.retried` | 管理者核對授權決策及某版如何進入／退出發布 | reviews、snapshot、job、reopen revision 是核心狀態；selfApproval 目前另在 audit detail | 最小決策紀錄不設期限。核准／要求修改須能取得 actor、candidate version、snapshot hash、時間及 selfApproval；不能用匿名後相等的 actor 值推導 selfApproval |
| job 的 `published`／`failed` 結果（不是現有 audit action） | 主辦查看結果；管理者／維護者核對核准內容及失敗類別 | job 保存 snapshot／approval hash、狀態與 metadata；重試會覆蓋失敗原因 | 每次結果只保留 job／candidate version、核准 snapshot hash、狀態、時間、failure category 的最小歷史；不設期限。需後續局部實作，不能將目前 job 當成已完成歷史 |
| job step／error、PR／SHA、workflow／重試／remote-write metadata | 維護者恢復發布，主辦查看可重試狀態 | 同一 job 的恢復與防止重複遠端副作用正依賴這些欄位 | **本輪不清除 job 欄位**。建議未來僅對已 published 或明確退回且不可再重試的 job，結束 90 天後評估移除純 error 診斷；仍被 AMEND 基準／恢復使用的 SHA、snapshot、remote-write 證據不屬可刪診斷。failed／retryable／有 lease 或遠端狀態不明者不按日齡刪除 |
| `retention.purged` | 維護者確認排程仍執行、清除及匿名化筆數、缺表情況 | Worker console 有同份 summary，但其保存可用性未在本研究證實 | 每次執行（包括零筆）仍記摘要，改建議 90 天。逐筆 `override.purged` 等必要證據另留；不新增 heartbeat 或排程角色 |

這是用途分類，不能用 `organizer_*`／`map_draft.*` 等前綴直接做 TTL 刪除。未知 action 預設保留，分類新增須有具體用途。90 天是便於維護者查近期操作、且與現有 IP 窗口一致的產品建議，**不是法律要求或成本量測結論**。可替代方案為 30 天（排錯窗口縮短）或維持現行永久保存；採用任何期限前需明確核准。

## 一致性與失敗處理

| 情境 | 必須保證的行為 | 本次觀察及後續方式 |
| --- | --- | --- |
| 認領、權限、撤下／刪除、公開選擇、送審／審閱等必要決策 | 成功轉換與其必要證據一起成立；拒絕或 CAS 失敗不留下成功紀錄 | 優先使用已存在的 business review／revision 與同一 D1 batch。一般 handler 的事後 audit 不具有這項保證；不得用全域 catch 忽略所有 audit。後續選定哪條路徑才局部修正，不在方案 PR 重構 repository |
| 發布核准、結果、重試 | 固定 snapshot／版本，結果不可被後次重試抹掉；同一轉換重送不造假結果 | 既有核准 review/job batch 保留；後續補最小結果證據須和狀態轉換的 CAS 一起寫入。遠端 GitHub 寫入不宣稱與 D1 原子；保留現有 lease、remote-write 與復原界線 |
| 普通診斷 | 業務成功不因普通 log 失敗讓使用者重做；業務失敗不能假報成功 | 若保留 diagnostic write，捕捉僅該寫入的錯誤，留下 action／失敗類別的非敏感運作訊號。不得吞掉業務寫入、授權、版本或必要決策錯誤 |
| 留言／onboarding 的重複 audit | 業務資料成功保存即回成功，既有權限與版本錯誤照常拒絕 | 第一批移除兩個事後 audit 呼叫，沒有新 queue／重試層，也不需要捕捉整個 handler |
| 帳號刪除與到期排程 | 不重新附回 actor／IP／自由文字，不復活刪除內容；重跑不重複決策 | 沿用現有塗銷與晚到 audit 保護。未來永久 selfApproval 等非識別欄位如需跨塗銷保留，必須有明確欄位與測試，不能保留整包 detail_json |

## 建議的最小第一批（需另行選入）

只停止 `map_draft.commented` 與 `organizer_event.onboarding_completed` 的新 audit 寫入。它們的業務證據已存在，且可直接消除「操作成功、事後 audit 失敗卻顯示失敗」的路徑。明確接受上表列出的額外 audit 欄位不再蒐集。

第一批不刪歷史列、不改 TTL、不改 comment／revision／snapshot／job 保存期、不動其他 atomic audit、不重構所有決策交易。同步受影響的 inventory、ADR 與 privacy notice；後續若採 90 天清除，沿用既有 retention Worker，精確列出 action allowlist、可重跑的有界刪除與刪除筆數。這是另一個需核准的實作範圍，不能由草案合併自動啟用。

| 第一批驗收 | 必要證據 |
| --- | --- |
| 貢獻者及管理者可留言，revision／target／角色／時間保持正確 | handler + repository 測試；業務列存在、沒有新增 `map_draft.commented`；拒絕陌生人、失效 grant、錯誤 target 的測試繼續通過 |
| 完成 onboarding 進入建置冊，重送維持原完成時間 | 既有流程與衝突測試；沒有新增 `onboarding_completed` audit；workspace state 仍保存完成者／時間 |
| 普通 audit 寫入失敗不會使上述已成功操作回錯 | 在這兩個 handler 注入會失敗的 `writeAudit`，確認不再呼叫且回正確成功；業務寫入失敗仍失敗 |
| 必要決策不受影響 | 保留認領、grant、審閱、清除、account deletion 的既有測試；核對 patch 只移除兩項寫入 |
| 歷史與刪除權不變 | 無 migration／DELETE，既有 account shred、comments retention 測試繼續通過 |

若日後選入 TTL 與最小發布結果，另驗：90 天邊界與精確 allowlist、未知／必要 action 不刪、重跑與中途失敗、IP／shred 不回填、活躍／retryable job 不清、審閱與結果 CAS 失敗無成功 audit、重試不覆蓋前次失敗。這些是相應實作的驗收，**不是目前其他功能的前置 gate**。

## 文件與政策影響

- ADR-0021／0027 的「audit 永不刪列」須在 TTL 真正獲准並實作時明確部分取代；帳號刪除與 IP 90 天規則保留。
- ADR-0033 的草稿 180 天、已審原始檔 30 天、reviews／comments 匿名化規則不變；只刪除重複 audit 不等於刪留言或審閱證據。
- ADR-0041 不授權任意拆除現有安全／清除邏輯。本方案只回應 #189 的具體用途及操作失敗路徑，不建立 audit browser、通用事件平台或新 log 基礎設施。
- [data inventory](../contracts/data-inventory.md) 只隨實際行為更新，不把上面的 90 天提前寫成現況。本草案 PR 只補漏列的現有 action 與發布結果所在位置。
- [privacy notice](../policy/privacy-notice.md) 現況說明保留至目的消失；採用新期限／不再蒐集某項操作 IP 時再同步清楚描述。草案階段不承諾尚未執行的到期刪除。
- [retention runbook](../runbooks/retention-purge-worker.md) 與 `RETENTION_WINDOWS` 等到 TTL 實作才更新；沿用既有 Worker，不新增 Cloudflare 產品或排程角色。未量測 D1 資料量，不主張節省多少費用。

## 待維護者決策

1. 是否採上表的必要決策永久最小紀錄、一般診斷 90 天分類？若採用，這是政策方向，尚未授權直接操作 production 刪除。
2. 是否將「只停止留言與 onboarding 的新重複 audit」選為第一批實作？可獨立接受這一批，同時延後期限、job 診斷清理與發布歷史補強。

本草案合併只完成 #189 的方案交付。排程與決策結果留在 GitHub；沒有新增追蹤文件或實作階層。

