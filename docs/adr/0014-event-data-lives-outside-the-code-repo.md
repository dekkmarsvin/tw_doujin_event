# ADR-0014：活動資料移出程式碼 repo，以固定 commit 引用

- 狀態：已定案（2026-08-18）
- 部分取代：[ADR-0011：FF47 期間全站不公開](./0011-ff47-is-not-a-public-launch.md) 的「FF47 的資料與地圖留在 repo 內」一句
- 延續：[ADR-0008](./0008-static-public-reading-path.md)、[ADR-0010](./0010-circle-identity-is-an-allocated-serial.md)、[ADR-0012](./0012-first-party-sources-only.md)
- 相關契約：[社團目錄契約](../contracts/circle-catalog.md)、[資料傳輸與離線契約](../contracts/delivery-and-offline.md)
- 相關流程：[社團資料更新](../runbooks/catalog-data-update.md)、[地圖 authoring](../runbooks/map-authoring.md)、[本機開發與驗證](../runbooks/local-development.md)

## 脈絡

[ADR-0011](./0011-ff47-is-not-a-public-launch.md) 寫下「FF47 的資料與地圖留在 repo 內，作為已驗證的第一份活動範例」。同一份 ADR 也寫下長期方向是「開源的同人展地圖網站」。這兩句話能並存的時間有限，現在到期了。

**一、根目錄的 `LICENSE` 宣稱涵蓋不屬於本專案的東西。** repo 是 MIT。但 `data_source_test/FF47 完整攤位整理.xlsx` 是社群維護者的勞動成果，`FF47社團攤位配置圖.jpg` 是主辦的著作。[ADR-0012](./0012-first-party-sources-only.md) 已經指認過這個問題的內容面——「把它們重新發布，本站沒有可以指向的授權依據」——repo 面是同一個問題更難辯解的版本：內容還能用「暫不公開」緩衝，`LICENSE` 沒有這個緩衝，它從 clone 的第一秒就生效。

**二、資料的重量已經超過程式碼。**

| 項目 | 大小 |
|---|---|
| 版控追蹤總量 | 9.06 MB |
| 其中 per-event 資料 | 7.29 MB（80%） |
| 其中跨活動的 identity registry | 0.46 MB |
| `.git` | 17 MB |

per-event 那 7.29 MB 裡，`circles.json`（1.9 MB）、`ff47-circle-templates.generated.json`（1.6 MB）與 `app/ff47-booths.ts`（0.75 MB）都是**衍生物**：每跑一次 `source:update` 就整份重寫，git 歷史線性膨脹，內容卻能從來源重新產生。`app/ff47-booths.ts` 還特別值得指出——它是活動資料偽裝成程式碼，放在 `app/` 底下，只有 `export-static-circle-catalog.mjs` 讀它。

**三、這兩件事都是逐活動的。** FF47 的授權狀態、公開時程與閘控是 FF47 的，不是本站的。把它們放進本站的 repo，等於讓每個新活動繼承上一個活動的授權債。

### 考慮過但不採用：build 時從資料庫或物件儲存直接拉

先評估過「CI 階段從 D1 或 R2 拉資料打包，repo 完全不存資料」。技術上可行，產物仍是靜態資產，不違反 [ADR-0008](./0008-static-public-reading-path.md) 的「不經 Worker」。不採用是因為它會拆掉四件正在承重的事：

- ADR-0008 的最後一句——「靜態快照是公開資料的唯一真相。未經 review 的本機 D1 或圖片不會因部署而公開」——會失效。
- `catalog:check` 與 `catalog:snapshot:check` 是逐位元組比對，會失去比對對象。
- PR diff 消失，26 筆官網與工作簿名稱衝突的人工裁決、identity registry 的差異審閱都沒有掛載點。
- 同一個 commit 不再可重現，revert 還原程式碼但還原不了那次拉到的資料。

**問題不在位元組住哪個 repo，而在資料變更有沒有一個可 review 的 diff。** 保住這件事之後，住哪裡才是次要的。

## 決策

**活動資料移出程式碼 repo。切分線是「per-event」與「跨活動」，不是「資料」與「程式碼」。**

1. **跨活動的資產留在本 repo**：`data/circle-identities/`（[ADR-0010](./0010-circle-identity-is-an-allocated-serial.md) 明定序號不含活動範圍、跨活動延續，它不屬於任何一個活動）、schema、驗證器與測試 fixture。這些全是本站自己產出的，MIT 涵蓋它們沒有問題。
2. **per-event 的資產移出**：`data_source_test/*`、`public/data/events/<event>/*`、`app/ff47-circle-templates.{generated,manifest}.json`，以及以程式碼形式存在的活動資料 `app/ff47-booths.ts`、`app/ff47-vw-booths.ts`、`app/ff47-official-booths.ts`。
3. **一個活動一個資料 repo**，各自帶自己的授權宣告。不是一個資料 repo 分目錄——授權狀態與公開時程逐活動不同，混在一起會回到同一個問題。
4. **以固定 commit SHA 引用**，不用浮動 branch。本 repo 保留一份 pin 檔記錄「活動 id → 資料 repo → commit SHA → 產物 SHA-256」，它進版本控制，改資料版本就是一個可 review 的 commit。
5. **build 前取得並校驗，不符即中止。** 取得之後的 build 維持離線，且對同一組 `(程式碼 commit, 資料 commit)` 逐位元組可重現。`catalog:check` 與 `catalog:snapshot:check` 的角色不變，只是輸入來自 pin 的資料樹。
6. **人工裁決與資料 review 隨資料移動**：名稱衝突裁決、來源快照差異在資料 repo 的 PR 上進行。

## 後果

### 直接獲得

- **`LICENSE` 恢復只涵蓋本專案的產出。** 這是開源準入（issue #36）少一個沒辦法解釋的地方。
- **git 不再因衍生物膨脹。** 上游每次更新不再往歷史裡壓 3.5 MB 可重新產生的位元組。
- **每個活動的授權與公開時程各自獨立。** FF48 不繼承 FF47 的債。
- **`app/` 底下不再有活動資料。** 這順帶讓多活動化（issue #35）少一類要拆的東西。

### 必須處理的代價

- **一次上游更新變成兩個 PR，而且有順序。** 生成器的輸入與模板產物在資料 repo，配號表在本 repo。落地順序是「資料 repo 先合併取得 SHA → 本 repo 同一個 PR 更新配號表與 pin」。把兩邊綁在一起的仍然是 `catalog:check`：registry、manifest 與產物不同步就中止。
- **本機開發要取得兩份東西。** 只想改 UI 的貢獻者不該被迫先拿到完整活動資料，因此**必須提供一份最小 fixture 活動**，讓前台在沒有真實資料時仍能跑起來。這不是 nice-to-have，沒有它就等於把貢獻門檻提高。
- **腳本裡硬編的路徑要常數化。** `data_source_test/...`、`app/ff47-circle-templates.generated.json`、`public/data/events/ff47/` 目前寫死在多個腳本裡。
- **歷史仍然留著那些位元組。** 搬走只讓 HEAD 乾淨；`git log` 裡的工作簿與配置圖還在。在決定是否重寫歷史之前，**不得宣稱本 repo 不含第三方資料**。
- **本 ADR 不解決授權本身。** 第三方來源退場（[ADR-0012](./0012-first-party-sources-only.md)）仍是主線工作；把檔案搬到另一個 repo 只是不再用 MIT 宣稱它們。
- **[ADR-0011](./0011-ff47-is-not-a-public-launch.md) 的閘控不變。** 被取代的只有「留在 repo 內」，不是「不公開」。

## 不在本 ADR 範圍

- 資料 repo 是公開還是私有，以及它的授權宣告內容。
- 是否重寫 git 歷史以移除既有的第三方位元組。
- pin 與取得機制的具體實作（submodule、release artifact 或 CI checkout），以及 pin 檔的格式。
- 程式碼的多活動化（issue #35）。搬走資料不會讓程式碼變通用——以 `ff47` 命名的路徑有 16 條，其中 6 條是程式碼與腳本，那是另一份工作。
- FF47 之外的活動何時建立自己的資料 repo。
