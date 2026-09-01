# ADR-0013：移除舊 circle ID 的相容路徑

- 狀態：已定案（2026-08-18）
- 部分取代：[ADR-0010：社團身分改用配發的流水號](./0010-circle-identity-is-an-allocated-serial.md) 的「對照表要進版本控制並永久保存」一項
- 相關契約：[社團目錄契約](./../contracts/circle-catalog.md#身分規則)、[收藏與走訪規劃契約](../contracts/planning.md#儲存與版本)、[URL 檢視狀態契約](../contracts/url-state.md)

## 脈絡

[ADR-0010](./0010-circle-identity-is-an-allocated-serial.md) 把社團身分從內容推導改成配發序號，並保留一份 `legacy-id-map.json` 把舊的 `ff47-<hash>` ID 接回新的 `c-xxxxxx`。當時的理由寫得很清楚：「對照表本身要進版本控制並保存，因為它是唯一能把舊資料接回去的東西。」

那句話有一個沒有寫出來的前提——**有舊資料**。

這個前提現在不成立。依 [ADR-0011](./0011-ff47-is-not-a-public-launch.md)，站台全站在 Cloudflare Access 閘控下、含社團端，從未對外開放過。沒有使用者的瀏覽器裡有 schema 1 或 schema 2 的規劃資料，也沒有真實社團在 D1 裡留下以舊 ID 為鍵的認領或補充資料。對照表接的是一批不存在的資料。

代價卻是實在的，而且散在五個地方：一份 1,341 筆的版本控制檔案、公開快照裡一個 `legacyCircleIds` 欄位（每位讀者都要下載）、規劃儲存的 schema 1／2 遷移路徑、D1 的一次性 cutover endpoint 與其驗證邏輯，以及 registry 的對照表 schema 驗證。

還有一個測試把這件事說破了：它斷言 `legacyCircleIds` 的筆數等於模板數。上游工作簿新增 5 個社團後這條就紅了——新社團從來沒有過舊 hash ID，所以這個等式在資料一長就必然破。**維護一份對照不存在資料的對照表，其成本已經開始表現為假警報。**

## 決策

**移除舊 circle ID 的整條相容路徑。身分只有 `c-xxxxxx` 一種。**

- 刪除 `data/circle-identities/legacy-id-map.json`。
- 公開快照移除 `legacyCircleIds` 欄位，schema 由 `circle-catalog/1` 升到 `circle-catalog/2`。
- 規劃儲存只讀 schema 3。schema 1／2 文件**保留原始字串並停止覆寫**，回報為不相容版本——照 [ADR-0002](./0002-planning-data-stays-on-device.md) 的既有慣例，不靜默清空。
- 移除 D1 的 `migrateCircleIds` 與 `/api/admin/circle-id-migration`。
- registry 不再驗證對照表 schema。

**保留**攤位範圍 ID（`1-e19`、`1-e19-0`）到 circle ID 的解析。它不需要任何儲存的對照表——由手上的 records 即時推導——而分享出去的連結可能帶著它。相應地把 `circleIdMigrationTargets` 更名為 `resolveCircleIdAliases`：遷移沒了，別名還在，名字要說實話。

## 後果

- **schema 1／2 的規劃資料從「會被遷移」變成「會被拒絕」。** 拒絕不等於銷毀：原始字串保留、可匯出，使用者看得到明確訊息。這是這個決策唯一會被真人感受到的行為改變，而目前沒有真人處在這個狀態。
- **公開快照變小。** 1,341 筆對照從每位讀者的下載中消失。
- **`circle_claims` 的三個 breadcrumb 欄位徹底變成稽核資訊。** [ADR-0010](./0010-circle-identity-is-an-allocated-serial.md) 已經把它們降級，這裡拿掉了最後一個會讀它們的機制。
- **這扇門關上了。** 日後若真的需要接回某批舊資料，對照表已經不在版本控制裡——要從 git 歷史取回，或重新以證據建立。這是刻意的：留著一條沒有人走的路，只會讓每個經過的人都要先確認它通往哪裡。

## 不在本 ADR 範圍

- 是否開放社團編輯名稱。[ADR-0007](./0007-circle-name-is-not-circle-editable.md) 的前兩個理由（攤位比對鍵、縮圖索引 join key）仍然成立。
- 未來跨活動的規劃資料 schema 變更如何處理。屆時**會有**真實使用者，本 ADR 的理由不適用。
