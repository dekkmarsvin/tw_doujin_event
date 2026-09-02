# 場刊 Map

同人展逛攤地圖。介面把社團搜尋、SVG 攤位地圖、收藏分組、備註與每日行程整合在同一個工作區，支援桌面與行動版。

正式網站：<https://map.kotoban.top/>。一般閱讀不需登入；參展社團可在 <https://map.kotoban.top/circle> 登入並維護補充資料。

受邀的主辦單位在 <https://map.kotoban.top/organizer> 建立活動、匯入攤位資料、畫地圖、驗證、預覽並送審，不需要修改程式、操作 Git 或執行 CLI。核准後的發布步驟尚未啟用（[ADR-0046](docs/adr/0046-approved-organizer-publications-may-merge-app-owned-pull-requests.md)、[#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104)）。

## 網站使用方式

### 一般參觀者：公開閱讀端

開啟 <https://map.kotoban.top/> 後：

1. 先選活動日期與展區，再搜尋社團、攤位或作品；「詳細搜尋」可依創作者、作品類型與分級縮小結果，也可加入多枚作品題材（符合任一或全部符合）並排除不想看的題材。結果卡會說明這一筆為什麼在結果裡。
2. 從搜尋結果或地圖攤位開啟社團資訊。兩個入口共用同一筆收藏、備註與行程狀態；地圖可拖曳、縮放，也支援方向鍵與 Enter／空白鍵操作攤位。
3. 「收藏」、「加入行程」與「設為下一站」是三個獨立動作。行程可排序、記錄購買項目與預算，並在「導航模式」只看當日預定攤位與已走訪狀態；本站不做 GPS 定位或自動路徑推算。
4. 收藏群組、備註與行程只存在目前瀏覽器。「資料管理」可匯出 JSON／CSV 備份；一般網頁尚未提供匯入或跨裝置同步。

詳細行為見[搜尋契約](docs/contracts/search.md)、[活動地圖契約](docs/contracts/event-map.md)與[規劃契約](docs/contracts/planning.md)。

### 參展社團與地圖貢獻者：`/circle`

- 社團在 <https://map.kotoban.top/circle> 通過真人驗證並以 email 一次性連結登入，認領社團後補充販售資訊、連結、代表圖與作品標籤。送出前可預覽；社團名稱、攤位與日期無法在此修改。
- 經管理者另外授權的地圖貢獻者，登入同一控制面後可建立私人地圖草稿、綁定官方來源檔並送審。核准與匯出只產生 event-data 候選，不會直接發布公開地圖。

- 審閱者可對整份草稿或單一攤位留言；被要求修改時，貢獻者會看到指向該攤位的請求。草稿版本落後時提示會指名目前版本，不是一句籠統的失敗。

完整邊界見[社團自助控制面契約](docs/contracts/circle-portal.md)與[地圖貢獻控制面契約](docs/contracts/map-contributions.md)。

### 主辦單位：`/organizer`

- 工作區採邀請制：候選活動由全域管理者建立並指定 Owner，受邀者以 email 一次性連結登入 <https://map.kotoban.top/organizer>。Owner 可再邀請 Editor。
- 六個步驟走完一場活動：活動基本資料 → 場館空間與展區 → CSV／XLSX 攤位匯入 → 每個「活動日 × 場館空間」一份地圖 → 驗證與 Reader 預覽 → 送審。原始試算表只在瀏覽器解析與雜湊，不上傳。
- 送審會固定一份不可改寫的 approval snapshot，由全域管理者核准或要求修改。核准後的發布步驟目前關閉。
- 桌機介面；地圖沿用既有的 layout 編輯器與 template 辨識器。

完整邊界見[主辦單位工作區契約](docs/contracts/organizer-workspace.md)。地圖 authoring 的流程見[地圖 authoring runbook](docs/runbooks/map-authoring.md)。

## 功能狀態

| 範圍 | 現況 |
|---|---|
| 公開場刊與地圖 | **已實作**：入口是活動選擇器，build 承載 `data/published-events.json` 列出的全部已發布活動（目前只有 FF47）；公開端提供搜尋、詳細搜尋、互動地圖、分享 URL 與離線 shell。|
| 收藏與走訪規劃 | **已實作**：收藏群組、備註、行程、下一站、已走訪、購買項目、預算、導航模式與 JSON／CSV 匯出。資料只存於目前瀏覽器。|
| 社團自助維護 | **已實作**：登入、認領、預覽、補充資料、代表圖、保存期限、活動後退出、自助刪除與管理者撤下。|
| 地圖貢獻控制面 | **已實作**：角色授權、私人 revision、官方來源檔、送審、核准替換、event-data 候選匯出、錨定推算、審閱留言串、指向單一 slot 的局部修改請求與具名版本衝突提示。|
| 主辦單位工作區 | **已實作到送審**：邀請制入口、活動與場館草稿、CSV／XLSX 匯入、逐「活動日 × 場館空間」地圖、驗證、Reader 預覽、送審與管理者核准。**發布仍關閉**，核准只留下一筆待處理的發布工作（[#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104)）。|
| 本機地圖 authoring | **已實作**：可從既有 revision、辨識結果或空白畫布開始，建立整排與個別地圖元素。已降為離線／事故備援，不是主辦單位的正式流程。|
| 規劃資料匯入、外部服務、跨裝置同步 | **P2，未對外開放**：底層已有 JSON／CSV 解析與衝突預覽，但一般介面只有安全匯出。|
| 詳細搜尋進階語意 | **已實作**：創作者、作品、原創／二創、分級，以及多枚題材的「符合任一／全部符合」、排除題材與結果卡的命中原因。|

交付範圍以**使用者能完成的任務**為界，不以完備性為界；判準與代價見 [ADR-0041](docs/adr/0041-scope-is-bounded-by-shippable-features.md)。GitHub issues 是會持續變動的追蹤面，不在 README 複製一份容易失真的清單。每張要排入開發的票都必須對應 `PRODUCT.md` 的既有使用者與 Core User Task；issue 本身不能新增產品使用者、資料 ownership 或完成定義。若需要改變這些邊界，先更新 `PRODUCT.md`；若同時推翻既有技術或流程決策，再新增 ADR 明確取代舊決策，之後才排實作。

## 快速開始

需要 Node.js `>=22.13.0` 與 npm。公開前台不需要 Cloudflare 帳號或 D1。

```bash
npm install
```

```bash
npm run dev:pages
```

交付前要跑共同 gate，開發途中可以只跑受影響的測試——兩者都見[本機開發與驗證](docs/runbooks/local-development.md)。

要回報問題或送出改動，請先閱讀[貢獻指南](CONTRIBUTING.md)與[行為準則](CODE_OF_CONDUCT.md)。

## 文件

完整索引見 [docs/README.md](docs/README.md)：它有一張「我想知道…／去哪裡」的路由表，涵蓋產品、設計、契約、流程、決策紀錄與對外文件。

> 社團 ID 的配發、候選重建與首次公開發布後相容性規則，以[社團目錄契約](docs/contracts/circle-catalog.md)、[ADR-0010](docs/adr/0010-circle-identity-is-an-allocated-serial.md)與[ADR-0044](docs/adr/0044-an-accepted-circle-list-is-not-yet-catalogable.md)為準。

## 專案結構

哪個檔案由哪份契約管，見[契約索引](docs/contracts/INDEX.md)（由 `scripts/check-doc-map.mjs` 產生）。

- `app/`：閱讀端、社團控制面與主辦工作區的介面與領域模組
- `functions/`：Cloudflare Pages Functions（身分、認領、編輯、管理與公開端點）
- `db/`：D1 schema、repository 與保存期限清除
- `scripts/`：build 步驟、資料 pipeline、authoring 與維運 CLI
- `fixtures/`、`data/`：共同 build／test fixtures，以及 data pin 與社團 ID 配號等版控狀態
- `workers/retention-purge/`：獨立部署的排程清除 Worker
