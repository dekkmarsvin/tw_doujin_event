# ADR-0035：新活動 onboarding 以資料驅動，authoring 逐步搬離本機

- 狀態：**已定案（2026-08-26 起草，2026-08-28 對選項 B 定案）** — **選項 A 與選項 C 的 authoring 面已實作**，**選項 B 已定案但尚未實作**（見決策第 7–9 點），**選項 D 已否決**。B 的實作範圍由 [#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104) §4（[#117](https://github.com/dekkmarsvin/tw_doujin_event/issues/117)）承擔。
- 相關 issue：[#85](https://github.com/dekkmarsvin/tw_doujin_event/issues/85)、[#86](https://github.com/dekkmarsvin/tw_doujin_event/issues/86)（已切分並關閉）、[#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104)
- 輸入研究：[台灣同人展主辦官方攤位頁面盤點](../research/taiwan-organizer-booth-pages.md)
- 延續：[ADR-0008](./0008-static-public-reading-path.md)、[ADR-0012](./0012-first-party-sources-only.md)、[ADR-0014](./0014-event-data-lives-outside-the-code-repo.md)、[ADR-0032](./0032-shared-reference-data-is-public-and-pinned.md)、[ADR-0033](./0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md)

## 問題

FF47 於 2026-08-23 結束，它是目前唯一一份真實活動資料。接第二場活動時，維護者要跨三個 repository 完成十個步驟：

| # | 步驟 | 性質 |
|---|---|---|
| 1 | 建 `venue/1`、`venue-space/1` 記錄 | 手寫 JSON + PR |
| 2 | 建 `event.json`（organizer、catalog pin、venue assignment） | 手寫 JSON + 跨 repo 對照 ID |
| 3 | 寫該主辦官網的 booth 表格 adapter | **寫程式** |
| 4 | 新增 `mapTemplate` 的 validator、metadata 與辨識器 | **寫程式** |
| 5 | 本機 authoring：`npm run dev` → `/editor` → 辨識 → 微調 → 發布本機 D1 | 需要 node、repo checkout、本機 D1 |
| 6 | `npm run map:snapshot` 匯出到 event-data repo | 命令列 |
| 7 | identity evidence 人工核對與 ID 配發 | 人工判斷 |
| 8 | 更新 `reference-data-pin.json`（完整 commit + 逐檔 SHA-256） | **手抄雜湊值** |
| 9 | 更新 `data/event-data-pins/<event>.json` | **手抄雜湊值** |
| 10 | 跑 gate、開 PR、合併、等 GitHub Actions | 命令列 |

本專案由單人維護。上表有三種不同性質的成本，混在一起會導致錯誤的最佳化：

- **機械勞動**（第 8、9、10 步）：沒有判斷成分，手抄雜湊值錯了會 fail closed，但要花時間才查得出來。
- **每場活動重複的程式工作**（第 3、4 步）：每接一個新場館或新主辦就要寫一次 TypeScript。這是「無法脫離技術細節」的主要來源。
- **本機環境依賴**（第 5、6 步）：必須坐在有 checkout 的機器前。

第 7 步是人工判斷，不在本 ADR 的最佳化範圍內；`data/circle-identities/` 的跨活動沿用核對必須維持人工。

一個容易誤判的事實：**配置圖辨識完全在瀏覽器內執行**（[`app/map-admin-importer.tsx`](../../app/map-admin-importer.tsx) 以 canvas `getImageData` 取像素）。`/editor` 需要本機伺服器的唯一原因，是它要寫本機 D1 並執行匯出腳本，而不是運算本身有本機依賴。

### 第 4 步的真正成因：編輯器沒有排的原語

初稿把「每場活動要寫辨識器」當成一個**選擇**，並據此推導出「應該把 template 資料化」。這個推導的前提是錯的。

資料模型本身以排為結構：

```ts
type BoothRow = { label: string; orientation: MapOrientation; confidence: number; slots: BoothSlot[] };
```

但編輯器的新增攤位操作（[`app/map-layout-editor.tsx`](../../app/map-layout-editor.tsx)）把 `rowIndex` 寫死為 `0`，且在沒有排時塞入單一 label 為 `"NEW"` 的排。所有手動新增的格子都落入第 0 排，**編輯器沒有任何建立一排的介面**。

因此：

- 手動繪製一張非 FF47 的完整地圖**在結構上做不到**，不是慢，是不可行。以[台灣同人展主辦官方攤位頁面盤點](../research/taiwan-organizer-booth-pages.md)的駁二為例，33 個排前綴、四百餘筆攤位無法逐格手動放置。
- FF47 的地圖之所以存在，是因為為它寫了辨識器。辨識器一直是**唯一產出過真實地圖的途徑**。
- 「每個場館都要寫辨識器」不是既有決策，是編輯器缺口的後果。

補上排的原語之後，辨識器整個類別不再是必要工作。這改變了選項 C 的形狀，見下。

### 排原語之前還有三道硬阻擋

後續針對「從無到有登錄一個全新活動」逐段檢視程式碼，發現排原語其實是**第二層**問題。在它之前，編輯器對一個新活動根本不可達：

1. **編輯畫布只在有 `report` 時渲染**（`app/map-admin-importer.tsx`）。`report` 只能來自「已發布地圖」或「辨識成功」，全新活動兩者皆無。
2. **`recognizeMapTemplate` 對未註冊 template 直接 `throw`**（`app/map-template-registry.ts`）。新場館＝新 template＝上傳必定失敗，`report` 永遠是 `null`。
3. **發布端要求 `sourceName` 非空且 `confidence` 介於 0.85–1**（`app/event-map-route-handlers.ts`）。人工繪製兩者都給不出來。

也就是說：**「每個場館都要寫辨識器」不只是效率問題，而是唯一可行路徑。**

附帶發現：`MapLayoutEditor` 早已支援把配置圖鋪在 SVG 底下作為描摹底圖（`backgroundImageUrl`）。**手動描摹的能力一直都在，只是走不到那一步。**

## 考慮過的選項

### A. 只自動化機械工序

新增單一 onboarding 腳本：讀 event-data repo 的 commit → 計算所有 SHA-256 → 寫入兩份 pin → 執行共同 gate → 以 `gh` 開 PR。

- 消除第 8、9、10 步，也就是最容易出錯的部分。
- 不觸碰任何信任邊界；pin 的內容與 fail-closed 行為完全不變，只是不再由人手抄。
- 不解決本機依賴，也不解決每場活動的程式工作。

### B. 將 authoring editor 搬到 Pages，置於既有管理者身分之後

重用 [ADR-0033](./0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md) 與 [#73](https://github.com/dekkmarsvin/tw_doujin_event/issues/73) 已實作的機制：magic-link 身分、管理者角色、私人 R2 原始檔、D1 版本化草稿、審閱與候選匯出。`/editor` 由獨立 authoring build 改為 `circle.html` 之下的管理者 route。

- 消除第 5、6 步的本機依賴。
- [地圖 authoring runbook](../runbooks/map-authoring.md) 現行寫明「`PUT` route 沒有身分驗證，不部署到 Pages，也不得因地圖貢獻控制面存在而重新公開」。採用本選項等於**明確推翻該句**。推翻的理由是該句的前提——「沒有身分驗證」——在掛上 #73 既有的管理者授權後即不成立。
- [ADR-0008](./0008-static-public-reading-path.md) 約束的是**公開閱讀路徑**。社團端控制面已是 Function-backed 且不在該路徑上，本選項不擴大公開閱讀路徑的動態成分。
- 不解決每場活動的程式工作：新場館仍要寫 validator 與辨識器，只是改成在瀏覽器裡也寫不出來。

### C. 在編輯器補上排的原語，使手動繪製任何場館成為可行路徑

> 本節在 2026-08-26 依「第 4 步的真正成因」一節重寫。初稿的 C 是「將 `mapTemplate` 由程式碼改為資料」，該版本假設 template descriptor 是必要的；那個假設已不成立，保留說明見本節末。

新增一個**建立排**的操作：排標籤 + 方向 + 兩個端點 + 格數 + 編號規則 → 產生 N 個 slot。

- 消除第 4 步的成因，而非其症狀。手動繪製從「結構上做不到」變成可行，辨識器隨之由必要工作降為 FF47 的既有實作。
- 排標籤是字串，因此駁二的地支 `子丑寅卯辰巳午未` 與 CWT 的 `商` 區段不需要任何特殊處理。每排格數不均一本來就是逐排參數。
- 駁二由四百餘次逐格放置降為約 33 次排定義。
- [#86](https://github.com/dekkmarsvin/tw_doujin_event/issues/86) 的三點錨定推算是同一原語的進階形式——不必輸入端點，改由圖上標記推得。因此**先做端點輸入版，錨定版為第二輪**。
- 同一種降級適用於第 3 步：以「貼上官方表格 → 預覽差異 → 確認」取代逐主辦撰寫爬蟲。主辦網站改版時不會壞。這一項**不因排原語而消失**，是獨立問題。

**template descriptor 可能整個不需要。** `official-booths.json` 已是該場活動所有攤位代碼的權威來源，而 [`app/map-contribution-draft.ts`](../../app/map-contribution-draft.ts) 已在據此計算 `missing_booth`、`unknown_booth` 與 `overlap`。FF47 的 template 常數（23 排、988 格）與該清單是重複的檢查。真正的驗證始終是「畫出的 slot 集合是否蓋滿官方清單」，而該驗證不需要 descriptor。descriptor 是否仍有存在理由列為未決。

### D. 全面 CMS 化，放棄 git 作為真相來源

場館、活動與地圖全部保存在 D1，管理介面直接編輯，build 時自 D1 讀取。

- 步驟數最少，但會失去可審閱的 diff、不可變 pin、逐檔 SHA-256 provenance，以及「靜態快照是公開資料唯一真相」這個性質。
- 單人維護時 pull request review 本來就是自我 review，**但 diff 本身仍是稽核紀錄**。要回答「這格攤位為什麼屬於這個社團」時，需要的是那份 diff，不是一列沒有歷史的 D1 record。這正是 [ADR-0012](./0012-first-party-sources-only.md) 的「只用官方來源」宣稱唯一撐得住的憑據。
- 合併三個 repository 一併否決：[ADR-0014](./0014-event-data-lives-outside-the-code-repo.md) 的理由是每場活動的授權與公開時程各自獨立，[ADR-0026](./0026-public-sanitized-event-data-and-history-rewrite.md) 另外預留歷史重寫空間。這些邊界與維護負擔無關，合併只會讓它們更難維持。

## 決策

1. **採用 A、C、B，依此順序；否決 D。**
2. **A 先行**：onboarding 腳本不改變任何契約，只把既有手動步驟自動化。pin 的計算與 fail-closed 語意維持不變。
3. **C 次之，優先於 B**：B 只是把相同的技術細節換一個地方執行；C 才真正將技術細節移出流程。**C 的第一階段是解除上述三道硬阻擋並補上編輯器的排原語，不是 template descriptor。**辨識與上傳解耦、可從空白畫布開始、來源說明改為維護者填寫的必填欄位，三者缺一則排原語無處可用。
4. **B 最後**：屬於可及性改善而非能力改善，且 C 完成後需要搬移的程式面積會顯著縮小。
5. **不可讓步的邊界**：無論 B 或 C，核准後仍只產出候選 `map.json`，仍須經 event-data repository 的 diff、測試與 review 才會公開。任何「按一下即公開」的路徑都不在本 ADR 授權範圍內。
6. **不預先建立 template descriptor。** 先做排原語，再以實際使用判斷 descriptor 是否仍有存在理由。初稿把 descriptor 當成 C 的核心，該定位已撤回。

### 選項 B 的定案（2026-08-28）

7. **採用 B：authoring 介面搬到 `circle.html` 之下的管理者 route。** 起草時 B 被定位為「可及性改善而非能力改善」（決策第 4 點）。該定位不成立：Pages build 的 rollup input 只有 `index.html` 與 `circle.html`（`vite.pages.config.ts`），`/editor` 只由本機 `vite.config.ts` 建置，因此 **B 未落地前「不開 IDE 完成一個新活動」不是慢，是做不到**。B 從可及性改善升為能力前置。

8. **被推翻的禁令比起草時假設的窄。** 起草時把「採用 B 等於推翻 `PUT` route 不得部署那句」寫進本 ADR，但那個推導不必要：

   - **未驗證的 `PUT /api/events/:eventId/map` 仍不部署到 Pages。** 這句禁令**維持有效**，B 不需要它。
   - authoring 的持久化改走 `/circle` 既有的管理者授權、私人草稿與版本化候選匯出路徑（ADR-0033、#72、#73），該路徑已在 Pages 上運作，本身就帶身分。B 不新增任何未驗證的寫入 route。
   - 真正被推翻的是 [authoring runbook](../runbooks/map-authoring.md) 開頭「公開 Pages 介面不得出現檔案欄位、管理入口或寫入 route」的**無條件措辭**。該句在 #72／#73 落地時就已與現況不符——`/circle` 早已有檔案上傳與管理入口。它應被限縮為只約束**讀者介面**（`index.html`），而 `circle.html` 是自起草時就與讀者分離的獨立 entry。

9. **本機 authoring 環境保留為離線備援，不退場。** `/editor`、`db/event-map-repository.ts` 與未驗證的 `PUT` route 維持現狀，但**不再是新活動的必要路徑**，也不隨新功能擴充。保留的理由是它與 B 共用同一個 `MapLayoutEditor`，維護成本近乎零；退場的唯一理由會是它開始需要獨立維護，屆時再另行決定。

## 後果

### 落地狀態（2026-08-28 覆核）

- **選項 A 已落地。** `npm run event:onboard`（`scripts/onboard-event.mjs`）取得固定 event-data commit、計算 SHA-256、驗證 reference pin 與 schema、staging 並原子更新 pin。第 8、9 步的手抄雜湊值已消失。見 [#90](https://github.com/dekkmarsvin/tw_doujin_event/issues/90)。
- **選項 C 的 authoring 面已全數落地，含第二輪。** 三道硬阻擋已解除、排原語（`generateRowSlots`／`createRow`）已可建立整排；選項 C 定為「第二輪、屬主線前置」的三點錨定推算亦已實作（`inferRowFromAnchors`，[#99](https://github.com/dekkmarsvin/tw_doujin_event/issues/99)）。其後另有四項效率工作落地：逐步 undo/redo（[#96](https://github.com/dekkmarsvin/tw_doujin_event/issues/96)）、所有矩形型別的四角縮放與畫布尺寸可編輯（[#97](https://github.com/dekkmarsvin/tw_doujin_event/issues/97)）、多選與批次操作（[#98](https://github.com/dekkmarsvin/tw_doujin_event/issues/98)）、審閱留言串與草稿衝突具名（[#100](https://github.com/dekkmarsvin/tw_doujin_event/issues/100)、[#101](https://github.com/dekkmarsvin/tw_doujin_event/issues/101)）。**手動繪製任何場館已是可行路徑，#87 列出的五項 authoring 效率缺口已解決四項**（未解的活動選擇器不影響繪製速度，見下）。
- **C 的第 3 步（貼上官方表格取代逐主辦爬蟲）不在上述範圍內。** 選項 C 已標明它「不因排原語而消失，是獨立問題」；它仍未實作，由 [#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104) §2 承擔。
- **選項 B 已於 2026-08-28 定案，尚未實作。** 決策第 4 點把 B 定位為「可及性改善而非能力改善」。#104 §4a 指出這個定位不成立：`/editor` 只由 `vite.config.ts`（本機 vinext）建置，Pages build 的 rollup input 只有 `index.html` 與 `circle.html`（`vite.pages.config.ts`），因此**在 B 落地前，「不開 IDE 完成新活動」不是慢，是做不到**。B 另有一項本 ADR 未預見的前置：控制面在資料上只能定址目前 Pages 設定的單一 `eventId`（#104 §0）。B 的完整範圍移交 #104 §4（#117）；定案內容見決策第 7–9 點。

### 既有後果

- 接一場新活動的步驟由十步降為以資料填寫為主，程式變更只在出現全新配置拓樸時才需要。
- [地圖 authoring runbook](../runbooks/map-authoring.md) 關於**未驗證 `PUT` route 不得部署**的敘述**維持有效**，B 不推翻它（決策第 8 點）。被限縮的是同一份 runbook 開頭「公開 Pages 介面不得出現檔案欄位、管理入口或寫入 route」的無條件措辭，它現在只約束讀者介面。
- 控制面持有 GitHub 寫入憑證另立 [ADR-0037](./0037-the-control-plane-opens-pull-requests-with-a-scoped-token.md)：可 push 新分支與開 PR，不得合併。決策第 5 點的「不得按一下即公開」因此不變。
- 自動辨識由「每個場館都要有」降級為「FF47 既有實作保留，新場館不強制提供」。既有 FF47 辨識器不移除。
- **不新增任何場館專屬辨識器。** 原敘述為「排原語落地前不新增」；排原語已落地，該限制轉為常設邊界，不因落地而解除。
- [#86](https://github.com/dekkmarsvin/tw_doujin_event/issues/86) 要求的重新切分**已完成**：錨定推算切為 #99（主線前置，已實作），審閱協作切為 #100／#101（次要，亦已實作），效率缺口切為 #96／#97／#98。#86 已於 2026-08-27 關閉。
- [#85](https://github.com/dekkmarsvin/tw_doujin_event/issues/85) 與本決策**正交**。場館 reference 記錄不受排原語影響，可獨立進行。初稿把 #85 列為 C 的阻擋項，該敘述已撤回。截至 2026-08-28 該編目仍未進行。
- 人工繪製的 layout 沒有 template 完整性規則可擋，逐格核對成為人工責任；已發布快照也無法在資料層區分人工繪製與滿分辨識，追溯只靠 `sourceName`。兩者都寫入[活動地圖契約](../contracts/event-map.md)。

## 未決

- descriptor 是否仍有存在理由。判準是排原語落地後，是否還有官方攤位清單無法表達的驗證需求。
- ~~是否為 `PublishedEventMap` 增加 provenance 欄位。~~ **已裁決（2026-08-27，[#89](https://github.com/dekkmarsvin/tw_doujin_event/issues/89) 以 not planned 關閉）：不加。**理由是目前沒有任何消費者會因 provenance 不同而改變發布、審閱或呈現行為；`ReportOrigin` 只存在 authoring UI，已發布快照仍由必填 `sourceName` 與 `confidence` 承載來源語意。出現明確消費者（例如人工繪製須套用不同審閱政策）時可重新開啟。
- 排原語的編號規則要支援到什麼程度（等距、雙面對排、跳號、連格如 `A01,A02` 與 `A01A02`）。應由駁二與 CWT 的實際編號決定，見[主辦官方攤位頁面盤點](../research/taiwan-organizer-booth-pages.md)。
- 企業／商業攤的表示方式。FF47 於 authoring 階段以 landmark 人工加入，CWT 的 `商` 則是官方編號的一等公民。排原語必須先解這一題。
- 「貼上官方表格 → 預覽差異」的輸入格式是否共用[資料匯入契約](../contracts/data-import.md)的 CSV v1，或另立格式。
- ~~B 落地後，本機 authoring 環境是否保留為離線備援，或完全退場。~~ **已裁決（2026-08-28）：保留為離線備援，見決策第 9 點。**
