# ADR 索引

要動某個區域之前，只讀那個區域指到的 ADR，不需要掃完 47 份。

狀態三種：

- **生效** — 完整有效。
- **部分被取代** — 仍然載重，但有部分內容被後來的 ADR 推翻。讀的時候要一併讀取代它的那份。
- **已取代** — 只剩歷史脈絡，不要據此實作。

ADR 的內文不改也不搬動；推翻舊決策時寫新的 ADR，並在舊的那份標註被取代（見 [`../README.md`](../README.md) 的維護規則）。這張表是那些標註的彙整，不是另一個權威——衝突時以 ADR 本身為準。

## 依區域

| 區域 | 要讀的 ADR |
|---|---|
| 閱讀端（搜尋、篩選、地圖檢視、多活動入口） | 0001、0006、0008、0042 |
| 收藏與行程規劃 | 0002、0004、0005 |
| 社團身分與目錄 | 0010、0013、0030、0044、0045 |
| 社團控制面 | 0007、0016、0017、0020、0043 |
| 主辦工作區與發布 | 0035、0037、0038、0046、0047 |
| 地圖貢獻 | 0033 |
| 活動資料與 reference | 0012、0014、0026、0028、0032、0039 |
| 保存期限與個資 | 0018、0021、0022、0027 |
| 部署、Access 與配額 | 0009、0015、0029、0031、0034 |
| 對外文案與來源標示 | 0024、0036 |
| 產品範圍 | 0025、0041 |
| 對外政策 | 0019、0023 |
| 代理人流程 | 0040 |

## 全部

| ADR | 決策 | 狀態 |
|---|---|---|
| [0001](./0001-adopt-webcatalog-patterns-selectively.md) | 選擇性採納 Comike WebCatalog 的模式 | 生效 |
| [0002](./0002-planning-data-stays-on-device.md) | 規劃資料只留在使用者裝置 | 生效 |
| [0003](./0003-circle-identity-from-workbook-row.md) | 社團身分以試算表主資料列為準 | **已取代** — 全部由 0010 取代 |
| [0004](./0004-plan-and-next-stop-are-separate-actions.md) | 加入行程與設為下一站是兩個獨立動作 | 生效 |
| [0005](./0005-import-stays-p2-export-only.md) | 匯入維持 P2，一般介面只保留安全匯出 | 生效 |
| [0006](./0006-split-search-planning-filter-and-display.md) | 把搜尋、規劃篩選與顯示設定拆成三組 | 生效 |
| [0007](./0007-circle-name-is-not-circle-editable.md) | 社團名稱不可由社團自行編輯 | 生效 |
| [0008](./0008-static-public-reading-path.md) | 公開閱讀路徑純靜態，不經 Worker | 生效 |
| [0009](./0009-single-pages-project-direct-upload.md) | 單一 Pages project + Direct Upload | 生效 |
| [0010](./0010-circle-identity-is-an-allocated-serial.md) | 社團身分改用配發的流水號 | **部分被取代** — 三項遷移後果由 0013 取代；規則一（跨活動 ID 沿用）由 0039 暫緩 |
| [0011](./0011-ff47-is-not-a-public-launch.md) | FF47 期間全站不公開 | **已取代** — 由 0029 取代；資料位置見 0014，解除條件見 0015 |
| [0012](./0012-first-party-sources-only.md) | 資料來源只留主辦官網與社團本人 | **部分被取代** — 主辦 transport 限制由 0044 放寬；非主辦第三方來源仍禁止 |
| [0013](./0013-drop-the-legacy-circle-id-compatibility-path.md) | 移除舊 circle ID 的相容路徑 | 生效 |
| [0014](./0014-event-data-lives-outside-the-code-repo.md) | 活動資料移出程式碼 repo，以固定 commit 引用 | **部分被取代** — 決策 3「一活動一 repo」由 0039 取代 |
| [0015](./0015-access-lifts-when-no-third-party-bytes-remain.md) | Access 閘控在 repo 不再含第三方位元組時解除 | **部分被取代** — 最終邊界改由 0029 定義 |
| [0016](./0016-human-verification-guards-the-mailer.md) | 真人驗證擋在寄信入口，不擋全站 | **部分被取代** — 「全站入口維持 Access」由 0029 取代；Turnstile 決策不變 |
| [0017](./0017-thumbnails-are-self-hosted-with-external-urls-kept.md) | 縮圖由本站代管，外部網址保留為第二條線 | **部分被取代** — Error 1027 的後果敘述由 0031 取代 |
| [0018](./0018-retention-is-the-circles-choice.md) | 保存期限由社團自己選，選了清除就真的刪除 | 生效 |
| [0019](./0019-personal-data-requests-go-to-the-mailbox-not-the-issue-tracker.md) | 個資請求走維運信箱，功能問題走公開 issue | 生效 |
| [0020](./0020-self-service-deletion-reuses-the-existing-ownership-chain.md) | 自助刪除沿用既有的擁有權鏈 | 生效 |
| [0021](./0021-credentials-expire-and-are-purged-records-are-kept.md) | 憑證到期就清掉，紀錄類保留不設期限 | 生效 |
| [0022](./0022-expiry-runs-in-a-separate-cron-worker.md) | 清除跑在獨立的排程 Worker | 生效 |
| [0023](./0023-the-privacy-notice-ships-without-professional-review.md) | 隱私告知自行撰寫，不送專業審閱 | **部分被取代** — 揭露方式由 0024 部分取代 |
| [0024](./0024-user-facing-copy-uses-minimum-necessary-disclosure.md) | 對外文案採最少必要揭露 | 生效 |
| [0025](./0025-open-with-an-official-only-thin-catalog.md) | 重新公開前先切成主辦資料的薄場刊 | 生效 |
| [0026](./0026-public-sanitized-event-data-and-history-rewrite.md) | 活動資料 repo 公開且只收可再發布資料 | 生效 |
| [0027](./0027-personal-data-lifecycle-and-account-deletion.md) | 帳號刪除釋放擁有權，稽核個資塗銷，IP 雜湊保留 90 天 | 生效 |
| [0028](./0028-versioned-json-event-definitions.md) | 活動定義使用版本化 JSON | 生效 |
| [0029](./0029-public-production-gated-preview.md) | production 公開、preview 持續受 Access 保護 | **部分被取代** — Error 1027 實測 gate 由 0031 取代；CI gate 由 0034 調整 |
| [0030](./0030-organizer-category-catalog-circle-selected-value.md) | 主辦分類目錄是活動資料，逐社團類別是社團填寫 | **部分被取代** — 第 5 點的畫面措辭由 0036 取代；provenance 不合併的實質決定不變 |
| [0031](./0031-quota-exhaustion-is-not-a-release-gate.md) | 配額耗盡不作發布 gate，Pages Functions 設為 fail-open | 生效 |
| [0032](./0032-shared-reference-data-is-public-and-pinned.md) | 共享 reference-data 公開且由活動固定版本 | **部分被取代** — 決策 1／5（獨立 repo 與更新順序）由 0039 取代 |
| [0033](./0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md) | 地圖貢獻採管理者授權與私人版本化草稿 | 生效 |
| [0034](./0034-production-origin-gates-deployment.md) | production origin 阻擋壞部署，自訂網域提供非阻塞訊號 | 生效 |
| [0035](./0035-new-event-onboarding-is-data-driven.md) | 新活動 onboarding 以資料驅動 | **部分被取代** — 決策 4 由 0038 推翻；選項 D 已否決 |
| [0036](./0036-provenance-labels-name-the-source-not-its-trust-level.md) | 來源標示只寫來源，不寫信任等級 | 生效 |
| [0037](./0037-the-control-plane-opens-pull-requests-with-a-scoped-token.md) | 控制面以受限 GitHub 憑證開 PR | **部分被取代且暫緩** — 「不得合併」由 0046 取代；PAT 路線由 0039 決策 5 暫緩。文中的 repo 表已封存，照字面執行會保護錯的對象。憑證範圍與外洩分析仍有效 |
| [0038](./0038-authoring-moves-to-the-control-surface-local-stays-as-backup.md) | authoring 介面搬到控制面，本機環境降為備援 | 生效 |
| [0039](./0039-one-data-repo-for-events-and-references.md) | 活動與 reference 資料收斂為單一資料 repo | 生效 |
| [0040](./0040-review-findings-are-bounded-by-the-ticket.md) | review 發現以 ticket 範圍為界 | 生效 |
| [0041](./0041-scope-is-bounded-by-shippable-features.md) | 交付範圍以可實現功能為界 | 生效 |
| [0042](./0042-the-public-entry-is-an-event-chooser.md) | 公開入口支援多活動選擇，既有 deep link 保持有效 | 生效 |
| [0043](./0043-the-circle-portal-is-event-agnostic.md) | Circle portal 是通用入口，claim 逐活動隔離 | 生效 |
| [0044](./0044-an-accepted-circle-list-is-not-yet-catalogable.md) | 錄取名單不等於可編目，身分等主辦攤位證據 | 生效 |
| [0045](./0045-list-changes-are-declared-not-inferred.md) | 名單變動要宣告，不從差異推論 | 生效 |
| [0046](./0046-approved-organizer-publications-may-merge-app-owned-pull-requests.md) | 已核准的 Organizer publication 可合併 App 自己建立的 PR | 生效 |
| [0047](./0047-organizer-onboarding-opens-into-a-resumable-workspace.md) | Organizer onboarding 先引導，完成後開放為可續作工作區 | 生效 |
| [0048](./0048-a-map-covers-one-day-in-one-hall.md) | 一份地圖涵蓋一個活動日的一個場館空間 | 生效 |
