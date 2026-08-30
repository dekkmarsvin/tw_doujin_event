# ADR-0045：名單變動要宣告，不從差異推論

- 狀態：已定案（2026-08-30）
- 相關 issue：[#139](https://github.com/dekkmarsvin/tw_doujin_event/issues/139)、[#140](https://github.com/dekkmarsvin/tw_doujin_event/issues/140)、[#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104)
- 延續：[ADR-0044](./0044-an-accepted-circle-list-is-not-yet-catalogable.md) 決策 6 揭出的缺口。本 ADR 只補上「人工判讀之後該做什麼」，不改變 0044 的任何結論。
- 延續：[ADR-0010](./0010-circle-identity-is-an-allocated-serial.md)、[ADR-0002](./0002-planning-data-stays-on-device.md)

## 問題

主辦公布攤位編號後仍會調整名單。[ADR-0044](./0044-an-accepted-circle-list-is-not-yet-catalogable.md) 決策 6 記下四種變動與現行行為：新增社團正常運作，退出、換手與重編號一律 fail closed，**且沒有記載的復原方式**。

fail closed 本身是對的：這些情況需要人工判讀，自動處理會讓永久 ID 悄悄改變指向。缺的是判讀之後的路。

缺口的形狀很具體。以「甲社從 `1:A01` 退出」為例，generator 會拋：

```text
Identity evidence has organizer booth sources outside the reviewed <eventId> grouping: 1:A01
```

而 runbook 另外明寫「不要手動配號或編輯 evidence」。維護者因此無路可走。

## 決策

### 1. 變動由人宣告，不由 generator 推論

**「攤位從主辦名單消失」與「主辦名單抓壞了」在資料上是同一個形狀。** 一個截斷的網頁、一次半完成的匯入、一個改版的 HTML 結構，看起來都像一批社團同時退出。若 generator 從差異推論，這些情況會直接把真實社團標成已取消。

因此變動必須**明確宣告**。未宣告的差異維持 fail closed，行為與本 ADR 之前完全相同。

宣告寫在既有的 `circle-identity-groups.json`（升為 `circle-identity-groups/2`）：

```json
{
  "schema": "circle-identity-groups/2",
  "eventId": "ff47",
  "groups": [ … ],
  "transitions": [
    { "source": "1:A01", "kind": "withdrawn", "reference": "https://organizer.example/notice" },
    { "source": "1:A02", "kind": "moved", "to": "1:C09" },
    { "source": "1:B01", "kind": "released" }
  ]
}
```

放在既有檔案而不是新檔案，是因為它與 grouping 是**同一次人工判讀的產物**，由同一個人在同一次審閱中決定；拆成兩份會讓 review 需要來回比對兩個檔案，也會多一個 pin 檔。`circle-identity-groups/1` 仍然有效，只是不能帶 `transitions`——既有 pin 因此不需要重新產生。

### 2. 三種變動，差別在攤位而不在社團

| kind | 主辦名單上的攤位 | 社團 |
|---|---|---|
| `withdrawn` | 已消失 | 退出，ID 保留 |
| `moved` | 已消失，`to` 出現 | 同一個社團換位置，ID 保留 |
| `released` | **仍在**，但屬於別的社團 | 前一個社團失去該攤位，ID 保留 |

`withdrawn` 與 `released` 對社團的效果相同；差別在攤位有沒有新的主人，而那個差別決定了讀者在該攤位看到什麼。

每一種都逐項對照主辦名單驗證：宣告退出但攤位還在、宣告換手但攤位已消失、移動到不存在的攤位、對從未配號的攤位宣告變動、同一個攤位宣告兩次、以及「宣告換手但名單上仍是同一個社團」，全部 fail closed。**宣告與資料不符時拒絕，比接受一個描述錯誤的宣告安全。**

### 3. 已發布的 ID 永遠不跟著攤位走

這是整份 ADR 的核心，也是三種變動共同的不變式：

> **攤位換手時，新的社團拿到新的 ID。**

前一個社團的 `c-xxxxxx` 留在前一個社團身上。收藏與分享連結帶的是 `c-xxxxxx`（[ADR-0002](./0002-planning-data-stays-on-device.md)），若 ID 跟著攤位走，讀者收藏的「甲社」會在某天變成「丙社」——而那是本站控制範圍外的資料，沒有補救路徑。

移動則相反：ID 跟著**社團**走到新攤位，因為那確實是同一個社團。

### 4. 退出的社團留在 catalog 裡

退出的社團不從 `circles.json` 消失，而是保留為 `status` 為 `cancelled` 或 `moved` 的 placement。

直接刪除是更糟的失敗：收藏與分享連結帶著 `c-xxxxxx`，一個憑空消失的社團會讓那些連結指向不存在的東西，讀起來像「連結壞了」而不是「這個社團沒有參加」。

placement id 的處理：沒有新主人的攤位保留原本的 `<day>-<code>`，讓當時分享出去的連結仍然解析得到；換手的攤位由**新的主人**取得該 id，離開的社團改用帶自己 ID 的形式。

Reader 如何呈現 `cancelled` 與 `moved` 由 [#140](https://github.com/dekkmarsvin/tw_doujin_event/issues/140) 決定，不在本 ADR。

### 5. 套用前先看見受影響的項目

`identity:generate` 的 summary 增加 `retirements`，逐項列出這次會改變的**已發布** placement：社團 ID、社團名、攤位、變動種類與去向。

這對應 #139 的「Organizer 在套用變更前能看見受影響項目與 validation error」。目前它是 CLI 的輸出；[#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104) 的 UI 必須呈現等價資訊，但**不得要求 Organizer 閱讀 registry 或編輯 evidence**。

## 功能面的變化

在沒有任何 `transitions` 的情況下，本 ADR **不改變任何現行行為**：既有 pin、既有 grouping 檔與既有 evidence 檔的輸出逐位元相同。`circle-identity-evidence/2` 只在真的有攤位退役時才寫入。

## 後果

- 四種變動都有了可執行的路徑，而且都留下可審閱的紀錄。
- **接受的代價**：宣告是人工的。主辦一次重編號一千個攤位時，`transitions` 會有一千行。這是刻意的——那一千行正是「有人確認過這確實是重編號，而不是抓壞了」的證據。若日後真的遇到，可以再談產生工具，但產生工具的輸出仍然要經過同一份審閱。
- **仍然缺的**：這是 migration path，不是 Organizer 產品流程。它要求維護者編輯 JSON 並執行 CLI，[`PRODUCT.md`](../../PRODUCT.md) 明確不接受那作為 P0 的完成狀態。#104 必須把它收斂成 UI，而本 ADR 的資料形狀是為此設計的：UI 產生的就是同一份宣告。
- ADR-0044 決策 6 說「第一場非 FF47 的活動就會撞到」，現在撞到時有路可走。

## 不在本 ADR 範圍

- 不決定 Reader 如何呈現 `cancelled` 與 `moved`（[#140](https://github.com/dekkmarsvin/tw_doujin_event/issues/140)）。
- 不決定 Organizer UI 的形狀（[#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104)），只要求它保留本 ADR 的宣告語意與 ID 不隨攤位移轉的保證。
- 不做完整 audit／version browser 或 rollback UI，兩者都是 #139 明列的非目標。
- 不改變 [ADR-0044](./0044-an-accepted-circle-list-is-not-yet-catalogable.md) 的錄取名單准入結論，也不改變跨活動 identity linkage。
- 不推測主辦未提供的退出或移動理由；`reference` 是選填的來源連結，不是理由欄位。
