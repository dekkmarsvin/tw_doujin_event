# 文件索引

文件依**職責**歸檔，不依主題。找東西時先問「我要的是哪一種答案」：

| 我想知道… | 去哪裡 |
|---|---|
| 產品要解決什麼、給誰用、邊界在哪 | [`PRODUCT.md`](../PRODUCT.md) |
| 三種使用者是誰、做到了長什麼樣 | [使用者](./product/users.md) |
| 某個功能在 P0 還是 P2、算不算做完 | [交付範圍與完成定義](./product/scope.md) |
| 色彩、字體、層級、圓角 | [`DESIGN.md`](../DESIGN.md) |
| **介面上該寫什麼字、不該寫什麼字** | [對外文案](./design/copy.md) |
| 某個介面表面的元件長什麼樣 | [元件與介面規格](./design/components.md) |
| 這個詞在本專案是什麼意思 | [`CONTEXT.md`](../CONTEXT.md) |
| **我要改這個檔案，是哪份契約在管它** | [契約索引](./contracts/INDEX.md) |
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
| [主辦單位工作區](./contracts/organizer-workspace.md) | 邀請制入口、候選活動 revision、攤位匯入、逐 scope 地圖、驗證、送審與核准、發布 fail-closed 邊界 |
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
| [部署](./runbooks/deployment.md) | 改密鑰、看 CI 行為、發布前 gate、回滾 |
| [首次啟用](./runbooks/first-time-setup.md) | 從零建 Cloudflare 資源；一個專案只做一次 |
| [排程清除 Worker](./runbooks/retention-purge-worker.md) | 部署或驗證保存期限清除 |
| [Cloudflare 容量與耗用監控](./runbooks/cloudflare-usage-monitoring.md) | R2 每日容量、操作量與月底趨勢 |

## 決策紀錄

已定案且**推翻需要代價**的取捨。每份寫明脈絡、決策與後果。

**[ADR 索引](./adr/INDEX.md)** 依區域列出要讀哪幾份，並標明每一份是生效、部分被取代還是已取代。要動某個區域時只讀那一列指到的 ADR，不需要掃完 47 份。


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
