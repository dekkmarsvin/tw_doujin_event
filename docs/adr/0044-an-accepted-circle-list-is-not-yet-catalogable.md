# ADR-0044：錄取名單不等於可編目，身分等主辦攤位證據

- 狀態：已定案（2026-08-30）
- 相關 issue：[#137](https://github.com/dekkmarsvin/tw_doujin_event/issues/137)、[#139](https://github.com/dekkmarsvin/tw_doujin_event/issues/139)、[#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104)
- **部分取代**：[ADR-0012](./0012-first-party-sources-only.md)「活動事實只由主辦官網 transport」的限制。非主辦第三方來源仍禁止；依最新 PRODUCT，通過驗證的 Organizer 直接匯入可在 #104 完成身分、provenance、validation、草稿與發布契約後成為第一方輸入。
- 延續：[ADR-0010](./0010-circle-identity-is-an-allocated-serial.md)、[ADR-0013](./0013-drop-the-legacy-circle-id-compatibility-path.md)、[ADR-0039](./0039-one-data-repo-for-events-and-references.md)、[ADR-0041](./0041-scope-is-bounded-by-shippable-features.md)

## 問題

台灣同人展的主辦通常分兩次公布：先公布**錄取名單**，數週或數月後才公布**攤位編號**。每接一場新活動都會遇到同一個問題：錄取名單公布時可不可以先編目、先讓社團綁定？

實例（2026-08-30）：PF45 x RF14（2026-11-07／08）的[錄取名單](https://www.f-2.com.tw/pf45-x-rf14-%e7%a4%be%e5%9c%98%e9%8c%84%e5%8f%96%e5%90%8d%e5%96%ae%e5%85%ac%e4%bd%88/)只有三個欄位：

```text
攤位名稱 | 首日攤數 | 次日攤數
```

沒有攤位編號、沒有申請編號、沒有任何 per-circle 的穩定識別碼。同一頁另外公布了資料更新期限與**攤位轉讓申請**。

誘惑很明確：錄取公布是社團與讀者最有動機的一刻，而距離活動還有兩個多月。

## 決策

### 1. 社團身分只由可追溯的主辦攤位配置配發

`c-xxxxxx` 的配發證據是 `{ eventId, kind: "organizer-booth", value: "<day>:<booth>" }`，不接受其他來源。這不是新規則，是 [ADR-0010](./0010-circle-identity-is-an-allocated-serial.md) 與 [ADR-0013](./0013-drop-the-legacy-circle-id-compatibility-path.md) 的既有結論；本 ADR 把它明確延伸到「錄取名單」這個具體情境，讓每場活動不必重推一次。

程式已經是這樣：`scripts/circle-identity-registry.mjs` 的 evidence 建構寫死 `organizer-booth`，並以 exact coverage gate 要求 registry 的 booth sources 與 reviewed grouping 完全相等。

這裡約束的是**身分鍵與可追溯性**，不是把目前的 URL／repository transport 永久寫成產品限制。現行 pipeline 從主辦公開 `boothListUrls` 建立 evidence；依最新 [`PRODUCT.md`](../../PRODUCT.md)，未來通過驗證的 Organizer CSV／XLSX 匯入也可以成為 Organizer-owned placement 的輸入，但必須經過草稿、validation、預覽與發布，並產生等價的 `<day>:<booth>` evidence。Organizer 不應理解或手動編輯 registry。

### 2. 只有名稱的清單不足以編目

錄取名單唯一的 per-circle 鍵是名稱，而名稱在本專案明文不是身分（[`CONTEXT.md`](../../CONTEXT.md)、[社團目錄契約](../contracts/circle-catalog.md)「同名不是合併依據」、identity grouping「名稱相同本身不符合 linkage」）。

因此**錄取名單不可作為配號輸入**，即使它就是最終參展名單。

### 3. 修正成本的分界線是發布，不是配號

先修正一個容易講錯的地方：**配號本身不昂貴，發布才昂貴。**

現行 repository pipeline 把 `allocations.json`／`evidence.json` 與該活動 pin 放在同一張 main PR（[社團資料更新 runbook](../runbooks/catalog-data-update.md) 步驟 2–3）。那是目前的內部發布實作；永久契約的分界是資料是否已對 Reader 公開：

| 時機 | 修正成本 |
|---|---|
| 首次公開發布前 | 近乎零。沒有 Reader 收藏、沒有分享連結、沒有認領指向這些 ID，候選可以重建 |
| 首次公開發布後 | 高。收藏與行程存在使用者自己的瀏覽器（[ADR-0002](./0002-planning-data-stays-on-device.md)），分享連結帶著 `selectedCircle=c-…`，兩者都不在本站控制範圍內 |

這條界線清楚且可審，是刻意的設計。**「只增不減、不重用、不重算」是對已發布 ID 的承諾**，不是對工作樹中間狀態的限制。

在這個前提下，用錄取名單預先配號的問題仍然成立，但理由要說準：

- **不是「改不掉」，是沒有可配的鍵。** 錄取名單唯一的 per-circle 鍵是名稱，同名社團會被併成一個 ID。這在合併前確實可以重跑修正——但它表示配出來的東西從一開始就不對應任何可追溯的主辦事實。**配一組已知有錯的號，不會因為可以重跑就變得有用。**
- **錄取名單是可變的。** PF45 x RF14 那頁自己列了資料更新期限與攤位轉讓申請。可變本身不是否決理由——**新增社團是設計上的正常路徑，成本為零**；問題在刪減與換手，見決策 6。
- **攤數不等於攤位。** `首日攤數`／`次日攤數` 只說某社團有幾攤，不說是哪幾攤；`circle-identity-groups.json` 要求每個 `<day>:<booth>` 恰好出現一次，這在編號公布前無法滿足。

### 4. 現行活動定義也擋在攤位表之前

`event-definition/3` 要求 `officialData.boothListUrls` **每一個活動日**都有 HTTPS URL（`app/event-catalog.ts` 的 parser 逐日檢查）。錄取名單頁不是攤位表，所以連 `event.json` 都不能在編號公布前定案。

這是現行 repository pipeline 的既有行為，記在這裡是因為它常被誤以為「先建資料夾總可以吧」。它不是 Organizer P0 的 UI 形狀；未來 authenticated Organizer import 可以取代 URL transport，但不能省略 booth-level placement、來源紀錄、validation 或 draft／published 邊界。

### 5. 等待期不是空白：可平行進行的工作

以下不依賴攤位編號，應在等待期完成，讓編號公布時資料在等流程而不是流程在等資料：

- **references**：organizer、場館、場館空間與分類目錄。同一主辦或同一場館的既有 record 可直接沿用；現行內部流程由 wizard 建立候選檔，未來 Organizer UI 需提供等價的 Venue／Area／Space 建立與重用能力（[#85](https://github.com/dekkmarsvin/tw_doujin_event/issues/85) 的需求驅動路徑）。
- **地圖 authoring**：配置圖一公布就能描摹排、slot、柱子與出入口。**layout 不需要知道誰在哪一格**，這是等待期最大的一塊平行工作；現行是本機工具，Organizer P0 的 Web 流程由 [#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104) 收斂。
- 活動日、day id 與顯示 label。

### 6. 已發布後的名單變動目前沒有支援路徑

**這與是否預先編目無關——攤位編號公布後主辦同樣會調整**，因此記在這裡而不是留給實作發現。`scripts/circle-identity-registry.mjs` 對四種變動的現行行為：

| 變動 | 現行行為 |
|---|---|
| 新增社團 | 配發新 ID。**設計上的正常路徑，成本為零** |
| 社團退出（booth source 從官方清單消失） | `extra` 檢查拋錯：`Identity evidence has organizer booth sources outside the reviewed <eventId> grouping` |
| 攤位換手（同 booth、不同社團名） | name drift 檢查拋錯：`Organizer name drift for <day>:<booth>` |
| 主辦重編號 | 既有 evidence 全數變成 extra 而拋錯 |

後三者都是 fail closed **且沒有記載的復原方式**，而 [runbook](../runbooks/catalog-data-update.md) 另外明寫「不要手動配號或編輯 evidence」。現行測試涵蓋 cross-event、重跑 no-op、部分／衝突群組與覆蓋完整性，**沒有一個涵蓋「已配號的 booth source 從官方清單消失」**。

fail closed 本身是對的：這些情況需要人工判讀，自動處理會讓永久 ID 悄悄改變指向。缺的是**判讀之後該做什麼**。依最新 PRODUCT，修正 Organizer-owned placement 是 P0，不再只是維護者工序；處置記在 [#139](https://github.com/dekkmarsvin/tw_doujin_event/issues/139)，且最終流程不得要求 Organizer 操作 Git、CLI、generator flag 或 evidence 檔案。本 ADR 不預先決定 UI 形狀。

### 7. 使用者側的等待期需求另案處理

讀者與社團在這段時間能做什麼，屬於產品功能而非資料准入，記在 [#137](https://github.com/dekkmarsvin/tw_doujin_event/issues/137)，依 [ADR-0041](./0041-scope-is-bounded-by-shippable-features.md) 決策 1 各自論證價值。本 ADR 不預先授權任何一種。

## 功能面的變化

**本 ADR 不改變任何現行程式行為**，它把資料准入與發布後相容性約束寫成可引用的結論。落地的是**時程預期**；目前由 repository pipeline 執行，未來 Organizer UI 必須提供等價規則但不得暴露該 pipeline：

| 主辦階段 | 本站能做什麼 |
|---|---|
| 錄取名單公布 | references、地圖 layout（配置圖公布後）、活動日 —— 但**不編目、不配號、不開放社團綁定** |
| 攤位編號公布 | 匯入主辦攤位配置 → 驗證／配號 → 預覽 → 發布；社團可開始認領 |

對社團的具體意思：**攤位編號公布前無法在本站認領或填資料**，因為認領綁的是 `circle_id`，而那時它還不存在。

## 後果

- 每場新活動不必重推一次這個判斷；[社團資料更新 runbook](../runbooks/catalog-data-update.md) 的步驟順序因此有了理由，不只是順序。
- **接受的代價**：錄取公布到編號公布之間，本站對該活動沒有社團內容。這段可能長達數月，正好是社團與讀者最有動機的期間。這是刻意的取捨，換到的是永久 ID 從第一天就對應可追溯的主辦事實。
- **需要切換 transport 的訊號**：主辦若不公開攤位表，只由 authenticated Organizer 提供 CSV／XLSX，目前 `boothListUrls` pipeline 就不能工作。本 ADR 原則上接受這是第一方 Organizer input，但 #104 必須先完成身分、來源紀錄、validation、草稿與發布契約；在它落地前，不能只在 runbook 開特例。PF45 x RF14 的公告頁未說明編號公布方式，因此這個訊號現在就要確認。
- 若某主辦的錄取名單本身就帶穩定申請編號，決策 2 不因此鬆動——申請編號可作為 identity grouping 的 `organizer-stable-key` linkage（既有機制），但配號證據仍是攤位。
- **決策 6 揭出的缺口比本 ADR 的主題更急。** 「等攤位編號」只把編目往後推；名單變動的處置缺口**不會因為等而消失**，主辦公布編號後照樣調整。第一場非 FF47 的活動就會撞到，而 FF47 的名單在匯入時已定案，所以這條路徑至今沒有被走過，也沒有測試背書。

## 不在本 ADR 範圍

- 不改變 [ADR-0039](./0039-one-data-repo-for-events-and-references.md) 的跨活動 identity linkage 決定。
- 不定義 [#137](https://github.com/dekkmarsvin/tw_doujin_event/issues/137) 要做哪一種等待期功能。
- 不決定 [#139](https://github.com/dekkmarsvin/tw_doujin_event/issues/139) 的名單變動處置形狀，只記錄現況與缺口。
- 不定義 [#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104) 的 Organizer import／preview／publish UI，只要求它保留本 ADR 的 booth-level evidence 與首次公開發布邊界。
- 不規定主辦公布節奏的處理流程；那是 runbook 的事。
