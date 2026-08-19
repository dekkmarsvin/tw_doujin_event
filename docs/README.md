# 文件索引

文件依**職責**歸檔，不依主題。找東西時先問「我要的是哪一種答案」：

| 我想知道… | 去哪裡 |
|---|---|
| 產品要解決什麼、給誰用、邊界在哪 | [`PRODUCT.md`](../PRODUCT.md) |
| 介面長什麼樣、用哪些 token 與視覺規則 | [`DESIGN.md`](../DESIGN.md) |
| 這個詞在本專案是什麼意思 | [`CONTEXT.md`](../CONTEXT.md) |
| **某個模組現在的行為是什麼、怎麼驗收** | [`contracts/`](#契約) |
| **怎麼做某件事** | [`runbooks/`](#流程) |
| **為什麼當初這樣決定** | [`adr/`](#決策紀錄) |
| 外部產品實際長什麼樣 | [`research/`](#研究) |
| 代理人的 issue tracker 與標籤設定 | [`agents/`](./agents) |

## 契約

描述**現況**，可驗收。實作與契約不一致時，兩者之一是錯的——不是「文件比較舊」。

| 文件 | 涵蓋 |
|---|---|
| [社團目錄](./contracts/circle-catalog.md) | 社團身分、資料權威、領域模型、模板匹配、三種資訊密度、來源標示 |
| [活動地圖](./contracts/event-map.md) | layout 不變量、renderer 邊界、互動與縮放、使用者流程 |
| [收藏與走訪規劃](./contracts/planning.md) | 收藏／群組／行程模型、不變量、儲存與遷移、跨介面同步、匯出 |
| [搜尋、篩選與顯示設定](./contracts/search.md) | 三組條件的責任切分、詳細搜尋互動、已實作與未實作 |
| [URL 檢視狀態](./contracts/url-state.md) | 17 個查詢參數、恢復規則、不寫入 URL 的狀態 |
| [社團自助控制面](./contracts/circle-portal.md) | 身分、認領、可編輯範圍、預覽、活動後退出、管理者、媒體安全 |
| [資料傳輸與離線](./contracts/delivery-and-offline.md) | payload 邊界、載入行為、Service Worker、快取標頭 |
| [資料匯入](./contracts/data-import.md) | **P2，尚未實作**。身分比對、預覽、CSV v1、外部服務串接 |

## 流程

| 文件 | 何時用 |
|---|---|
| [本機開發與驗證](./runbooks/local-development.md) | 啟動、跑 gate、交付前檢查 |
| [社團資料更新](./runbooks/catalog-data-update.md) | 上游試算表有變動時 |
| [地圖 authoring](./runbooks/map-authoring.md) | 要更新地圖靜態快照時 |
| [部署](./runbooks/deployment.md) | 首次啟用、改密鑰、看 CI 行為、回滾 |

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
| [0010](./adr/0010-circle-identity-is-an-allocated-serial.md) | 社團身分改用配發的流水號（**已實作**，取代 0003） |
| [0011](./adr/0011-ff47-is-not-a-public-launch.md) | FF47 期間全站不公開，含社團端（**資料留在 repo 內一句已被 0014 取代；解除條件已被 0015 取代**） |
| [0012](./adr/0012-first-party-sources-only.md) | 資料來源只留主辦官網與社團本人 |
| [0013](./adr/0013-drop-the-legacy-circle-id-compatibility-path.md) | 移除舊 circle ID 的相容路徑（**部分取代 0010**） |
| [0014](./adr/0014-event-data-lives-outside-the-code-repo.md) | 活動資料移出程式碼 repo，以固定 commit 引用（**部分取代 0011**） |
| [0015](./adr/0015-access-lifts-when-no-third-party-bytes-remain.md) | Access 閘控在 repo 不再含有第三方位元組時解除（**部分取代 0011**） |
| [0016](./adr/0016-human-verification-guards-the-mailer.md) | 真人驗證擋在寄信入口，不擋全站 |
| [0017](./adr/0017-thumbnails-are-self-hosted-with-external-urls-kept.md) | 縮圖由本站代管，外部網址保留為第二條線 |

## 研究

外部產品的實地觀察紀錄，**唯讀**。它們記的是觀察當下的狀態，不是本專案的現況；結論已轉入上面的 ADR 與契約。

- [Comike WebCatalog：地圖功能](./research/comike-webcatalog-map.md)
- [Comike WebCatalog：資訊介面、收藏與資料串接](./research/comike-webcatalog-information-and-favorites.md)
- [Comike WebCatalog：社團自助編輯](./research/comike-webcatalog-circle-editing.md)
- [日本同人／コミケ周邊服務功能盤點](./research/doujin-service-landscape.md)（**二手檢索，未實地操作**——可信度低於上面三份）
- [性質相近的服務與開源專案如何公開自己的資料收集](./research/data-collection-policies-in-comparable-projects.md)（17 個對象，全部原文已讀；為 [#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30) 的基礎研究）

## 維護規則

- **一個契約只有一個家。** 同一條規則不得同時寫在兩份文件裡；需要交叉引用時放連結，不複製內容。
- **改行為就改契約，同一個 commit。** 契約落後於實作，下一個人就會拿它當真相。
- 契約裡的型別必須與 `app/` 的實際型別同步；欄位名稱不一致是 bug，不是措辭差異。
- **研究文件不改。** 觀察結果是歷史，要更新就重新觀察並註明日期。
- ADR 不改，只新增。推翻舊決策時寫新的 ADR 並在舊的標註被取代。
