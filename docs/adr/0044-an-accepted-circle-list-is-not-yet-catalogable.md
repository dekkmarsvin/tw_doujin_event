# ADR-0044：錄取名單不等於可編目，身分等主辦攤位證據

- 狀態：已定案（2026-08-30）
- 相關 issue：[#137](https://github.com/dekkmarsvin/tw_doujin_event/issues/137)、[#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104)
- 延續：[ADR-0010](./0010-circle-identity-is-an-allocated-serial.md)、[ADR-0012](./0012-first-party-sources-only.md)、[ADR-0013](./0013-drop-the-legacy-circle-id-compatibility-path.md)、[ADR-0039](./0039-one-data-repo-for-events-and-references.md)、[ADR-0041](./0041-scope-is-bounded-by-shippable-features.md)

## 問題

台灣同人展的主辦通常分兩次公布：先公布**錄取名單**，數週或數月後才公布**攤位編號**。每接一場新活動都會遇到同一個問題：錄取名單公布時可不可以先編目、先讓社團綁定？

實例（2026-08-30）：PF45 x RF14（2026-11-07／08）的[錄取名單](https://www.f-2.com.tw/pf45-x-rf14-%e7%a4%be%e5%9c%98%e9%8c%84%e5%8f%96%e5%90%8d%e5%96%ae%e5%85%ac%e4%bd%88/)只有三個欄位：

```text
攤位名稱 | 首日攤數 | 次日攤數
```

沒有攤位編號、沒有申請編號、沒有任何 per-circle 的穩定識別碼。同一頁另外公布了資料更新期限與**攤位轉讓申請**。

誘惑很明確：錄取公布是社團與讀者最有動機的一刻，而距離活動還有兩個多月。

## 決策

### 1. 社團身分只由主辦攤位證據配發

`c-xxxxxx` 的配發證據是 `{ eventId, kind: "organizer-booth", value: "<day>:<booth>" }`，不接受其他來源。這不是新規則，是 [ADR-0010](./0010-circle-identity-is-an-allocated-serial.md) 與 [ADR-0013](./0013-drop-the-legacy-circle-id-compatibility-path.md) 的既有結論；本 ADR 把它明確延伸到「錄取名單」這個具體情境，讓每場活動不必重推一次。

程式已經是這樣：`scripts/circle-identity-registry.mjs` 的 evidence 建構寫死 `organizer-booth`，並以 exact coverage gate 要求 registry 的 booth sources 與 reviewed grouping 完全相等。

### 2. 只有名稱的清單不足以編目

錄取名單唯一的 per-circle 鍵是名稱，而名稱在本專案明文不是身分（[`CONTEXT.md`](../../CONTEXT.md)、[社團目錄契約](../contracts/circle-catalog.md)「同名不是合併依據」、identity grouping「名稱相同本身不符合 linkage」）。

因此**錄取名單不可作為配號輸入**，即使它就是最終參展名單。

### 3. 預先配號的代價不可逆

`c-xxxxxx` 只增不減、不重排、不重用、不重算。用名稱先配號會產生三種改不掉的結果：

- **同名社團被併成一個永久 ID**，之後拆開等同重算，而重算正是 ADR-0010／0013 消滅掉的東西。
- **錄取名單是可變的。** PF45 x RF14 那頁自己列了資料更新期限與攤位轉讓申請；對一份還會換手的清單配發永久 ID，是最糟的組合。
- **攤數不等於攤位。** `首日攤數`／`次日攤數` 只說某社團有幾攤，不說是哪幾攤；`circle-identity-groups.json` 要求每個 `<day>:<booth>` 恰好出現一次，這在編號公布前無法滿足。

### 4. 活動定義本身也擋在攤位表之前

`event-definition/3` 要求 `officialData.boothListUrls` **每一個活動日**都有 HTTPS URL（`app/event-catalog.ts` 的 parser 逐日檢查）。錄取名單頁不是攤位表，所以連 `event.json` 都不能在編號公布前定案。

這是既有行為，記在這裡是因為它常被誤以為「先建資料夾總可以吧」。

### 5. 等待期不是空白：可平行進行的工作

以下不依賴攤位編號，應在等待期完成，讓編號公布時資料在等流程而不是流程在等資料：

- **references**：organizer、場館、場館空間與分類目錄。同一主辦或同一場館的既有 record 可直接沿用；新場館由 wizard 建立候選檔（[#85](https://github.com/dekkmarsvin/tw_doujin_event/issues/85) 的需求驅動路徑）。
- **地圖 authoring**：配置圖一公布就能描摹排、slot、柱子與出入口。**layout 不需要知道誰在哪一格**，這是等待期最大的一塊平行工作。
- 活動日、day id 與顯示 label。

### 6. 使用者側的等待期需求另案處理

讀者與社團在這段時間能做什麼，屬於產品功能而非資料准入，記在 [#137](https://github.com/dekkmarsvin/tw_doujin_event/issues/137)，依 [ADR-0041](./0041-scope-is-bounded-by-shippable-features.md) 決策 1 各自論證價值。本 ADR 不預先授權任何一種。

## 功能面的變化

**本 ADR 不改變任何現行行為**，它把一條既有約束寫成可引用的結論。落地的是**時程預期**：

| 主辦階段 | 本站能做什麼 |
|---|---|
| 錄取名單公布 | references、地圖 layout（配置圖公布後）、活動日 —— 但**不編目、不配號、不開放社團綁定** |
| 攤位編號公布 | 匯入官方攤位表 → 配號 → pin → 上線；社團可開始認領 |

對社團的具體意思：**攤位編號公布前無法在本站認領或填資料**，因為認領綁的是 `circle_id`，而那時它還不存在。

## 後果

- 每場新活動不必重推一次這個判斷；[社團資料更新 runbook](../runbooks/catalog-data-update.md) 的步驟順序因此有了理由，不只是順序。
- **接受的代價**：錄取公布到編號公布之間，本站對該活動沒有社團內容。這段可能長達數月，正好是社團與讀者最有動機的期間。這是刻意的取捨，換到的是永久 ID 從第一天就對應可追溯的主辦事實。
- **需要重新評估的訊號**：主辦若改為只把攤位編號隨入場證私下寄給各社團、不在官網公開發布，[ADR-0012](./0012-first-party-sources-only.md) 的「只接受主辦官網」與 `boothListUrls` 的前提就不成立。**那需要一份新 ADR 定義可接受的其他主辦證據形式，不是在 runbook 裡開特例。** PF45 x RF14 的公告頁未說明編號公布方式，因此這個訊號現在就要確認。
- 若某主辦的錄取名單本身就帶穩定申請編號，決策 2 不因此鬆動——申請編號可作為 identity grouping 的 `organizer-stable-key` linkage（既有機制），但配號證據仍是攤位。

## 不在本 ADR 範圍

- 不改變 [ADR-0039](./0039-one-data-repo-for-events-and-references.md) 的跨活動 identity linkage 決定。
- 不定義 [#137](https://github.com/dekkmarsvin/tw_doujin_event/issues/137) 要做哪一種等待期功能。
- 不規定主辦公布節奏的處理流程；那是 runbook 的事。
