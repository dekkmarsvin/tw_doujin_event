# ADR-0003：社團身分以試算表主資料列為準

- 狀態：**已被 [ADR-0010](./0010-circle-identity-is-an-allocated-serial.md) 取代**（2026-08-14 實作完成）。本文只保留歷史脈絡。
- 原狀態：已定案（2026-08-09 實作完成）
- 相關契約：[社團目錄契約](../contracts/circle-catalog.md#身分規則)、[收藏與走訪規劃契約](../contracts/planning.md#儲存與版本)

## 脈絡

最初每一筆攤位列都產生獨立的 `circleId`。結果是：同一個社團跨日或有相鄰攤位時，從其中一個攤位收藏，另一個攤位不會顯示收藏狀態，備註也不共用。使用者看到的是同一個社團，資料模型看到的是三個不同的東西。

要修這件事，需要一個**穩定的身分證據**——而且必須是能自動判定、不需人工逐筆核對的證據。同名不算，同名的不同社團真實存在。

## 決策

**以 Excel 主資料列（`sourceRow`）作為社團身分的穩定證據。** 同一列登錄的跨日或連號攤位共用同一個 `CircleRecord.id`，各自保留自己的 `PlacementRecord`。

`CircleRecord.id` = `FNV-1a(試算表列號 + 社團名)`。

沒有這類證據的同名社團**仍維持分離**，不自動合併。

## 後果

- 規劃資料升級到 schema 2。schema 1 的 placement-scoped ID 會先合併備註再遷移：收藏衝突保留所有不同備註、採最近更新的群組與時間，行程依日期合併到同一社團。**不靜默清空本機資料。**
- URL 的 `selectedCircle` 使用 canonical circle ID；`selectedBooth` 保留實際配置定位。兩者必須互相驗證。
- 收藏與行程的 identity 判定必須用 `CIRCLE_CATALOG_BY_ID` / `isKnownCircleId()`，**不是**以 placement `recordId` 為 key 的 `CIRCLE_RECORDS_BY_ID`。用錯 seam 會讓有效收藏被誤列為「目前無法匹配」——這個 bug 實際發生過。
- **代價：ID 對上游列號敏感。** 上游插入一列或社團改名會讓其後所有 ID 改變。因此：
  - 重建場刊後、commit 之前必須跑 `npm run claims:check`，見[社團資料更新](../runbooks/catalog-data-update.md)。
  - 社團名稱不開放社團自行編輯，見 [ADR-0007](./0007-circle-name-is-not-circle-editable.md)。
- 搜尋 facet 必須以 `CircleRecord.id` 為鍵，不以攤位代碼作為社團身分。
