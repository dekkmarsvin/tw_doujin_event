# 文件索引

文件依**職責**歸檔，不依主題。找東西時先問「我要的是哪一種答案」：

| 我想知道… | 去哪裡 |
|---|---|
| 產品要解決什麼、給誰用、邊界在哪 | [`PRODUCT.md`](../PRODUCT.md) |
| 介面長什麼樣、用哪些 token、視覺規則與對外文案規則 | [`DESIGN.md`](../DESIGN.md) |
| 這個詞在本專案是什麼意思 | [`CONTEXT.md`](../CONTEXT.md) |
| **某個模組現在的行為是什麼、怎麼驗收** | [`contracts/`](#契約) |
| **怎麼做某件事** | [`runbooks/`](#流程) |
| **為什麼當初這樣決定** | [`adr/`](#決策紀錄) |
| 外部產品實際長什麼樣 | [`research/`](#研究) |
| **對外承諾了什麼** | [`policy/`](#對外文件) |
| 代理人的 issue tracker、標籤設定與 review-fix 迴圈守則 | [`agents/`](./agents) |

## 契約

描述**現況**，可驗收。實作與契約不一致時，兩者之一是錯的——不是「文件比較舊」。

| 文件 | 涵蓋 |
|---|---|
| [社團目錄](./contracts/circle-catalog.md) | 社團身分、資料權威、領域模型、模板匹配、三種資訊密度、來源標示 |
| [活動地圖](./contracts/event-map.md) | layout 不變量、renderer 邊界、互動與縮放、使用者流程 |
| [收藏與走訪規劃](./contracts/planning.md) | 收藏／群組／行程模型、不變量、儲存與遷移、跨介面同步、匯出 |
| [搜尋、篩選與顯示設定](./contracts/search.md) | 三組條件的責任切分、詳細搜尋互動、多主題與排除、命中原因 |
| [URL 檢視狀態](./contracts/url-state.md) | 20 個查詢參數、恢復規則、不寫入 URL 的狀態 |
| [社團自助控制面](./contracts/circle-portal.md) | 身分、認領、可編輯範圍、預覽、活動後退出、管理者、媒體安全 |
| [地圖貢獻控制面](./contracts/map-contributions.md) | contributor 授權、私人 revision、官方來源檔、審閱狀態機、留言與局部修改請求、候選匯出與保存期限 |
| [資料傳輸與離線](./contracts/delivery-and-offline.md) | payload 邊界、載入行為、Service Worker、快取標頭 |
| [資料匯入](./contracts/data-import.md) | **P2，尚未對外開放**。規劃檔案交換已有底層能力；一般介面與外部服務串接尚未實作 |
| [資料 inventory](./contracts/data-inventory.md) | 實際持有的資料、欄位、有效期與第三方；保存期限、到期處置與清除機制 |
| [共享 reference 選擇](./contracts/reference-selection.md) | 主辦／分類／場館資料的 stable ID selection 與 fail-closed 驗證邊界 |

## 流程

| 文件 | 何時用 |
|---|---|
| [本機開發與驗證](./runbooks/local-development.md) | 啟動、跑 gate、交付前檢查 |
| [社團資料更新](./runbooks/catalog-data-update.md) | 主辦活動資料或 data pin 有變動時 |
| [地圖 authoring](./runbooks/map-authoring.md) | 要更新地圖靜態快照時 |
| [部署](./runbooks/deployment.md) | 首次啟用、改密鑰、看 CI 行為、回滾 |
| [Cloudflare 容量與耗用監控](./runbooks/cloudflare-usage-monitoring.md) | R2 每日容量、操作量與月底趨勢 |

## 決策紀錄

已定案且**推翻需要代價**的取捨。每份寫明脈絡、決策與後果。

| ADR | 決策 |
|---|---|
| [0001](./adr/0001-adopt-webcatalog-patterns-selectively.md) | 選擇性採納 Comike WebCatalog 的模式 |
| [0002](./adr/0002-planning-data-stays-on-device.md) | 規劃資料只留在使用者裝置 |
| [0003](./adr/0003-circle-identity-from-workbook-row.md) | 社團身分以試算表主資料列為準（**已被 0010 取代**） |
| [0004](./adr/0004-plan-and-next-stop-are-separate-actions.md) | 加入行程與設為下一站是兩個獨立動作 |
| [0005](./adr/0005-import-stays-p2-export-only.md) | 匯入維持 P2，一般介面只保留安全匯出 |
| [0006](./adr/0006-split-search-planning-filter-and-display.md) | 把搜尋、規劃篩選與顯示設定拆成三組 |
| [0007](./adr/0007-circle-name-is-not-circle-editable.md) | 社團名稱不可由社團自行編輯 |
| [0008](./adr/0008-static-public-reading-path.md) | 公開閱讀路徑純靜態，不經 Worker |
| [0009](./adr/0009-single-pages-project-direct-upload.md) | 單一 Pages project + Direct Upload |
| [0010](./adr/0010-circle-identity-is-an-allocated-serial.md) | 社團身分改用配發的流水號（**已實作**，取代 0003；0039 保留全域唯一 namespace，但暫緩跨活動沿用） |
| [0011](./adr/0011-ff47-is-not-a-public-launch.md) | FF47 期間全站不公開，含社團端（**資料留在 repo 內一句已被 0014 取代；解除條件已被 0015 取代**） |
| [0012](./adr/0012-first-party-sources-only.md) | 資料來源只留第一方主辦與社團本人；主辦 transport 由 0044 部分取代，可含 authenticated Organizer import |
| [0013](./adr/0013-drop-the-legacy-circle-id-compatibility-path.md) | 移除舊 circle ID 的相容路徑（**部分取代 0010**） |
| [0014](./adr/0014-event-data-lives-outside-the-code-repo.md) | 活動資料移出程式碼 repo，以固定 commit 引用（**部分取代 0011；一活動一 repo 已被 0039 取代**） |
| [0015](./adr/0015-access-lifts-when-no-third-party-bytes-remain.md) | Access 閘控在 repo 不再含有第三方位元組時解除（**部分取代 0011**） |
| [0016](./adr/0016-human-verification-guards-the-mailer.md) | 真人驗證擋在寄信入口，不擋全站 |
| [0017](./adr/0017-thumbnails-are-self-hosted-with-external-urls-kept.md) | 縮圖由本站代管，外部網址保留為第二條線 |
| [0018](./adr/0018-retention-is-the-circles-choice.md) | 保存期限由社團自己選，選了清除就真的刪除 |
| [0019](./adr/0019-personal-data-requests-go-to-the-mailbox-not-the-issue-tracker.md) | 個資請求走維運信箱，功能問題走公開 issue |
| [0020](./adr/0020-self-service-deletion-reuses-the-existing-ownership-chain.md) | 自助刪除沿用既有的擁有權鏈，不另發編輯連結 |
| [0021](./adr/0021-credentials-expire-and-are-purged-records-are-kept.md) | 憑證到期就清掉，紀錄類保留不設期限 |
| [0022](./adr/0022-expiry-runs-in-a-separate-cron-worker.md) | 清除跑在獨立的排程 Worker，不掛在使用者請求上 |
| [0023](./adr/0023-the-privacy-notice-ships-without-professional-review.md) | 隱私告知自行撰寫、隨 repo 版控，不送專業審閱（**揭露方式已被 0024 部分取代**） |
| [0024](./adr/0024-user-facing-copy-uses-minimum-necessary-disclosure.md) | 對外文案採最少必要揭露 |
| [0025](./adr/0025-open-with-an-official-only-thin-catalog.md) | 重新公開前先切成主辦資料的薄場刊 |
| [0026](./adr/0026-public-sanitized-event-data-and-history-rewrite.md) | 活動資料 repo 公開且只收可再發布資料，程式碼 repo 重寫歷史 |
| [0027](./adr/0027-personal-data-lifecycle-and-account-deletion.md) | 帳號刪除、audit 塗銷與 IP 雜湊 90 天期限 |
| [0028](./adr/0028-versioned-json-event-definitions.md) | 活動定義使用版本化 JSON |
| [0029](./adr/0029-public-production-gated-preview.md) | production 公開、preview 持續受 Access 保護 |
| [0030](./adr/0030-organizer-category-catalog-circle-selected-value.md) | 主辦分類目錄是活動資料，逐社團類別是社團自述 |
| [0031](./adr/0031-quota-exhaustion-is-not-a-release-gate.md) | 不以不可安全重現的配額耗盡作發布 gate，Pages Functions 設為 fail-open |
| [0032](./adr/0032-shared-reference-data-is-public-and-pinned.md) | 共享 reference-data 公開、經 review 發布，活動只使用 pinned revision（**獨立 repo 與更新順序已被 0039 取代**） |
| [0033](./adr/0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md) | 地圖貢獻採管理者授權、私人平行草稿與明確保存期限 |
| [0034](./adr/0034-production-origin-gates-deployment.md) | Pages production origin 阻擋壞部署，自訂網域 smoke 提供非阻塞訊號 |
| [0035](./adr/0035-new-event-onboarding-is-data-driven.md) | 新活動 onboarding 資料驅動；機械工序自動化與編輯器排原語已實作。選項 B 的定案見 0038 |
| [0036](./adr/0036-provenance-labels-name-the-source-not-its-trust-level.md) | 來源標示只寫來源，不寫信任等級 |
| [0037](./adr/0037-the-control-plane-opens-pull-requests-with-a-scoped-token.md) | 控制面以受限 GitHub 憑證開 PR，不得合併（**實施暫緩，見 0039 決策第 5 點**） |
| [0038](./adr/0038-authoring-moves-to-the-control-surface-local-stays-as-backup.md) | authoring 介面搬到控制面，本機環境降為備援（取代 0035 決策第 4 點）|
| [0039](./adr/0039-one-data-repo-for-events-and-references.md) | 活動與 reference 資料收斂為單一資料 repo，跨活動 identity linkage 延後（取代 0014 決策第 3 點、0032 決策第 1／5 點，限縮 0010 規則一）|
| [0040](./adr/0040-review-findings-are-bounded-by-the-ticket.md) | review 發現以 ticket 範圍與已記錄的威脅模型為界；資料維運指令假設單一維護者、單一序列執行 |
| [0041](./adr/0041-scope-is-bounded-by-shippable-features.md) | 交付範圍以可實現功能為界，邊緣契約降級為紀錄（把 0040 的判準擴大到 backlog 與契約文件）|
| [0042](./adr/0042-the-public-entry-is-an-event-chooser.md) | 公開入口支援多活動選擇，已發布活動 deep link 保持有效；生命週期分組延後至 P1 #134 |
| [0043](./adr/0043-the-circle-portal-is-event-agnostic.md) | Circle portal 是通用入口；帳號跨活動、claim 與 ownership 逐活動隔離 |
| [0044](./adr/0044-an-accepted-circle-list-is-not-yet-catalogable.md) | 錄取名單不等於可編目；身分只由可追溯的主辦攤位配置配發。不可回頭的分界線是首次公開發布；authenticated Organizer import 納入第一方來源 |
| [0045](./adr/0045-list-changes-are-declared-not-inferred.md) | 已發布名單的退出、換手、移動與重編號由人工宣告後套用，不由差異推論；已發布 ID 永不跟著攤位換手（補上 0044 決策 6 的缺口）|

## 對外文件

使用者看得到的承諾。**描述的必須是實際行為**，行為改了就在同一個 commit 更新。

| 文件 | 涵蓋 |
|---|---|
| [隱私權與資料使用告知](./policy/privacy-notice.md) | 蒐集哪些資料、目的、保留期限、查詢與刪除、聯絡窗口（**已上線**） |

## 研究

外部產品的實地觀察紀錄，**唯讀**。它們記的是觀察當下的狀態，不是本專案的現況；結論已轉入上面的 ADR 與契約。

- [Comike WebCatalog：地圖功能](./research/comike-webcatalog-map.md)
- [Comike WebCatalog：資訊介面、收藏與資料串接](./research/comike-webcatalog-information-and-favorites.md)
- [Comike WebCatalog：社團自助編輯](./research/comike-webcatalog-circle-editing.md)
- [日本同人／コミケ周邊服務功能盤點](./research/doujin-service-landscape.md)（**二手檢索，未實地操作**——可信度低於上面三份）
- [性質相近的服務與開源專案如何公開自己的資料收集](./research/data-collection-policies-in-comparable-projects.md)（17 個對象，全部原文已讀；為 [#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30) 的基礎研究）
- [台灣同人展主辦官方攤位頁面盤點](./research/taiwan-organizer-booth-pages.md)（新活動 onboarding 與地圖 authoring 的輸入研究）

## 維護規則

- **一個契約只有一個家。** 同一條規則不得同時寫在兩份文件裡；需要交叉引用時放連結，不複製內容。
- **改行為就改契約，同一個 commit。** 契約落後於實作，下一個人就會拿它當真相。
- 契約裡的型別必須與 `app/` 的實際型別同步；欄位名稱不一致是 bug，不是措辭差異。
- **研究文件不改。** 觀察結果是歷史，要更新就重新觀察並註明日期。
- **對外文件不得落後於行為。** `policy/` 裡的每一句都是對使用者的承諾；改行為卻沒改它，是做了做不到的承諾，不是文件過期。
- ADR 不改，只新增。推翻舊決策時寫新的 ADR 並在舊的標註被取代。
