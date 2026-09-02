# ADR-0048：一份地圖涵蓋一個活動日的一個場館空間

- 狀態：已定案（2026-09-02）
- 延續：[ADR-0028](./0028-versioned-json-event-definitions.md)、[ADR-0035](./0035-new-event-onboarding-is-data-driven.md)、[ADR-0038](./0038-authoring-moves-to-the-control-surface-local-stays-as-backup.md)

## 問題

CWT*K51 高雄場在同一個場館空間辦兩天，兩天的攤位配置不同：Day 1 的 B–G 區是 01–26／27–52，Day 2 是 01–24／25–48，A 區與 H 區的格數也不一樣。這不是特例，隔夜重新配置是常見做法。

資料層本來就支援這件事。`map-manifest.json`（`event-map-manifest/1`）以「`periodKey` × `venueSpaceId`」為鍵，`validateStagedEventArtifacts` 的覆蓋檢查也已經是這兩者的笛卡兒積。organizer 工作區更是**每一組「活動日 × venue-space」各建一份地圖草稿**，還提供「從同場館空間複製」把 Day 1 當 Day 2 的起點。

缺的只有一個判斷條件，而它問錯了問題：

```ts
if (event.venueAssignments.length === 1) { /* 只有一份 map.json */ }
```

這行（以及 reader、authoring scope、staging、onboarding、smoke 共七處相同的複本）用**場館空間數**決定要不要走 manifest。單一場館空間的活動因此無論幾天都只會有一份 `map.json`，authoring 端畫好的第二天配置沒有地方可以發布，reader 也沒有地方可以讀。

## 決策

### 1. 判準是 scope 數，不是場館空間數

新增 [`eventUsesScopedMaps()`](../../app/event-catalog.ts)：`days.length * venueAssignments.length > 1`。所有與地圖 artifact 形狀有關的判斷改走它。

它刻意**不是** `eventUsesVenueSpaceSwitcher()`。後者回答的是「reader 要不要出現場館空間切換」，單一場館的活動無論幾天都該是 false。兩個問題長得像，答案不同，所以是兩個述詞而不是一個共用的。

`scripts/` 這一側有一份同名的孿生實作在 `event-data-pin-utils.mjs`，因為 Node 腳本不載入 TS。

### 2. 沒有 manifest 就退回單一 `map.json`

FF47 是一個場館空間、兩天，只發布了一份 `map.json`；`fixtures/events/sample` 與 `sample-two` 同樣如此。決策 1 一旦生效，這些活動就會被要求提供 manifest 而 staging 失敗。

因此：**多 scope 但沒有 `map-manifest.json` 時，退回單一 `map.json`，視為每一天共用同一份配置。**

這確實放棄了一部分 fail closed——少一份地圖不再一定會被擋下。取捨如下：

- 代價**只落在單一場館空間**。多場館空間的活動仍然必須提供 manifest，缺了就失敗，與本 ADR 之前完全相同。這保留了「一份 layout 假裝涵蓋多個場館空間」這個原本要防的錯誤。
- manifest **一旦存在，嚴格檢查完全不變**：必須恰好覆蓋每個活動日 × 每個場館空間一次，路徑必須等於由 scope 推導的值。退回只在「完全沒有 manifest」時成立，不是「manifest 不完整時容忍」。
- 反面做法是把 FF47 與兩份 fixture 一起遷移成 manifest 形狀。那要改動已 pin 的 data repo 內容、重簽 SHA-256、更新 pin，且沒有任何人因此看到不同的地圖——付出的是不可變 pin 的變動，換到的只是形狀一致。

「腳本要不要讀 manifest」一律由**檔案在不在**決定，不由活動定義推論；`event-data-pin-utils.mjs` 的 pin 規則本來就是這樣寫的，現在 staging、onboarding 與 smoke 也一致。

### 3. 候選活動的第一份地圖可以含沒有社團的攤位格

`unknown_booth` 原本一律是 error：layout 裡出現主辦攤位資料沒有的代碼就拒絕。

配置圖畫的是整個場地，包含沒賣掉的攤位，而那些格子沒有任何匯入列或 placement 可以指認。已發布活動不受影響，因為 `existingBoothCodes` 會把 reviewed snapshot 的空格帶進允許清單——FF47 的 988 格就是這樣通過的。但那份 snapshot 當初是走本機備援路徑建立的，那條路徑不做攤位覆蓋檢查。換句話說，**新活動走正式入口反而畫不出完整格網**，兩條路徑的規則不一致。

因此 `MapDraftProblem` 新增 `severity`（未標示即 error），候選活動 scope 的 `unknown_booth` 降為 warning：代碼照樣列出來給人看，但不擋住送審。`missing_booth`、`overlap` 與幾何錯誤不受影響，打錯字仍然看得見。

哪一種 scope 適用寫在 scope 自己身上（`allowsUnallocatedBooths`），不由呼叫端各自決定。

## 後果

- CWT*K51 這類「單一場館空間、每日重排」的活動可以完整上架。
- 既有活動與 fixtures 一行資料都不用改。
- 少一份每日地圖不會在 staging 被擋下，只會讓那一天沿用同一份配置。多場館空間不受影響。
- 候選活動的地圖與官方攤位清單的逐格核對成為人工責任，與本機 authoring 路徑一致（見 [map authoring runbook](../runbooks/map-authoring.md) 第 5 節）。

## 未決

- 大場地的規模。實測 2,856 格（12,168 個 SVG 節點）在 production build 下 mount 28–37ms、選取後重繪中位數 13–15ms、最差 65ms，通過門檻；但選取重繪會整份重畫所有攤位，成本隨格數線性成長，行動裝置未測。真的要更大時，先做 slot 記憶化再考慮 culling。
- 設施只有 `landmark`（矩形 + 文字）與 `accessPoint`（entrance／exit + 四方位）兩種詞彙，電梯、手扶梯、廁所、更衣區、逃生門都壓成同一種灰框或同一種箭頭。這是失真，不是阻擋，另案處理。
