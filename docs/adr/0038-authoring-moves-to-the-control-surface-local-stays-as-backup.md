# ADR-0038：authoring 介面搬到控制面，本機環境降為備援

- 狀態：已定案（2026-08-28）
- **取代**：[ADR-0035](./0035-new-event-onboarding-is-data-driven.md) 決策第 4 點（選項 B 的優先序與定位），並裁決該 ADR「未決」章最後一項
- 相關 issue：[#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104) §4、[#112](https://github.com/dekkmarsvin/tw_doujin_event/issues/112)、[#117](https://github.com/dekkmarsvin/tw_doujin_event/issues/117)
- 延續：[ADR-0008](./0008-static-public-reading-path.md)、[ADR-0033](./0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md)
- 相關文件：[地圖 authoring runbook](../runbooks/map-authoring.md)、[地圖貢獻控制面基礎契約](../contracts/map-contributions.md)

## 脈絡

ADR-0035 列出四個選項，對 A、C、D 定案，把 B（把 authoring editor 搬到 Pages，置於既有管理者身分之後）排在最後，理由是它「屬於可及性改善而非能力改善」。

該定位不成立。Pages build 的 rollup input 逐字只有兩個 entry：

```js
// vite.pages.config.ts
input: {
  index: resolve(import.meta.dirname, "index.html"),
  circle: resolve(import.meta.dirname, "circle.html"),
}
```

`/editor` 只由本機 `vite.config.ts`（vinext）建置，不在任何 Pages deployment 內。因此在 B 落地前，「不開 IDE 完成一個新活動」不是慢，是做不到——它是能力缺口，不是可及性缺口。

ADR-0035 另外寫下一個推導：「採用 B 等於明確推翻 [authoring runbook](../runbooks/map-authoring.md) 的『`PUT` route 沒有身分驗證，不部署到 Pages』一句」。逐段讀過控制面後，該推導同樣不成立，見決策第 2 點。

## 決策

### 1. 採用 B，並將它由可及性改善升為能力前置

authoring 介面搬到 `circle.html` 之下的管理者 route。B 不再排在 C 之後作為選配，它是「新活動不需要 IDE」的必要條件之一（另一個是控制面的多活動定址，[#113](https://github.com/dekkmarsvin/tw_doujin_event/issues/113)）。

### 2. 被推翻的禁令比 ADR-0035 假設的窄

- **未驗證的 `PUT /api/events/:eventId/map` 仍不部署到 Pages。這句禁令維持有效，B 不需要它。**
- authoring 的持久化改走 `/circle` 既有的管理者授權、私人草稿與版本化候選匯出路徑（ADR-0033、[#72](https://github.com/dekkmarsvin/tw_doujin_event/issues/72)、[#73](https://github.com/dekkmarsvin/tw_doujin_event/issues/73)）。該路徑已在 Pages 上運作、本身帶身分，B 不新增任何未驗證的寫入 route。
- 真正被限縮的是 runbook 開頭「公開 Pages 介面不得出現檔案欄位、管理入口或寫入 route」的**無條件措辭**。該句自 #72／#73 落地起就已與現況不符：`functions/api/map-contributions/files/index.ts` 是 Pages 上的檔案上傳，`functions/api/admin/*` 是 Pages 上的管理入口。它現在只約束**讀者介面**（`index.html`）；`circle.html` 是自起草時就與讀者分離的獨立 entry。

ADR-0008 約束的是公開閱讀路徑，本決策不擴大該路徑的動態成分。

### 3. 本機 authoring 環境保留為離線備援，不退場

`/editor`、`db/event-map-repository.ts` 與未驗證的 `PUT` route 維持現狀。保留的理由是它與控制面共用同一個 `MapLayoutEditor`，維護成本近乎零。退場的唯一理由會是它開始需要獨立維護，屆時另行決定。

**但「備援」只在 #117 落地後成立。** 在那之前本機環境仍是新活動地圖的**唯一**路徑：`app/circle-portal/map-contribution-panel.tsx` 建立草稿的唯一入口是 `loadStaticEventMap(ACTIVE_EVENT.id)`，新活動沒有公開地圖，這一步必定失敗。runbook 必須維持「目前仍是唯一路徑」的敘述，直到瀏覽器端的空白／描摹起點實作完成才改寫。

### 4. 不可讓步的邊界不變

核准後仍只產出候選 `map.json`，仍須經 event-data repository 的 diff、測試與 review 才會公開。ADR-0035 決策第 5 點原封不動。

## 後果

- [`docs/runbooks/map-authoring.md`](../runbooks/map-authoring.md) 開頭段限縮為只約束讀者介面，並附原文與修訂理由。`PUT` route 禁令那條同步註明「B 定案後仍然有效」。
- ADR-0035 的「未決」章最後一項（本機 authoring 是否保留）由本 ADR 決策第 3 點結案。
- #117 的驗收條件因決策第 3 點多一項：runbook 中「本機仍是唯一路徑」的敘述必須在該 PR 內一併改寫，否則文件會落後於行為。
- 本決策不涉及控制面對外寫入的能力。控制面持有 GitHub 憑證是另一個信任面，記於 [ADR-0037](./0037-the-control-plane-opens-pull-requests-with-a-scoped-token.md)。

## 未決

- 搬移後 `/editor` 是否仍需要自己的 `vite.config.ts` build，或改為只在測試中掛載。等 #117 看實際共用面積再決定。
