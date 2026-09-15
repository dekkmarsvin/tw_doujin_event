# Reader 介面驗收紀錄

## 2026-09-15：活動選擇頁日期分類與詳細搜尋底色

範圍及設計預設見 [本輪設計紀錄](docs/design/reader-event-chooser-ideas.md)。活動選擇頁採「即將到來 → 舉辦中 → 過往活動」及組內日期遞減；過往活動維持可點擊，名稱改較柔和的灰綠。詳細搜尋移除外層底色及重複縮排，和收藏控制對齊。

- 實際 CH20／FF47 於本機 staged 資料驗證：CH20 顯示 `26.10.09` 在即將到來；FF47 顯示 `26.08.21-23` 在過往活動。桌機 1440×900 與手機 390×900 的選擇頁、詳細搜尋共 4 張截圖與 [matrix.json](docs/design/assets/reader-event-calendar-2026-09-15/matrix.json) 同次執行產生。
- [桌機選擇頁](docs/design/assets/reader-event-calendar-2026-09-15/published-chooser-1440.png)、[手機選擇頁](docs/design/assets/reader-event-calendar-2026-09-15/published-chooser-390.png)、[桌機搜尋](docs/design/assets/reader-event-calendar-2026-09-15/published-search-1440.png)、[手機搜尋](docs/design/assets/reader-event-calendar-2026-09-15/published-search-390.png)：無水平溢出；搜尋按鈕左右與收藏控制一致，外層透明。
- Fixture 瀏覽器旅程另驗 1440／360px、5 個日期的狀態與排序、跨午夜更新、過往卡片鍵盤聚焦及開啟地圖，以及桌機／手機搜尋開啟與取消後焦點還原，共 13 項；[報告](docs/design/assets/reader-event-calendar-2026-09-15/fixture-report.json) 與[即將到來／舉辦中畫面](docs/design/assets/reader-event-calendar-2026-09-15/fixture-upcoming-and-ongoing.png) 為該次測試資料證據。
- 原有活動選擇旅程 5 項通過，包含失效活動連結、Back／Forward 及條件不跨活動。日期與元件測試 8 項通過，含跨月、跨年、閏日、台灣日期界線、空集合與不可辨識日期。
- TypeScript、doc-map（12 contracts）、本機 lint（排除既有 `.tmp/` 備份生成檔）、Impeccable layout scan 通過。
- `map-viewport.mjs` representative 模式另通過 21 項既有地圖擷取／操作斷言。
- 獨立主要 reviewer 檢查 `a1429ed` 相對 `3ce4574` 的程式、日期驗證邊界與 5 張提交截圖，並實際操作 CH20／FF47 桌機及 390px 頁面；確認排序、日期、過往活動可開啟，以及詳細搜尋開啟／取消焦點還原。沒有本輪 blocker，Review Done。

以上為 Chrome 瀏覽器及模擬尺寸驗收，不代表 iOS／Android 真機。日期分類精度為台灣日曆日，沒有宣稱活動實際開門／閉門時間。

## 2026-09-15：活動頂部、切換活動與取消選取

受測實作：`aa5e16d`。Chrome 153.0.8010.37，本機 staged 官方 CH20／FF47；以下證據為瀏覽器尺寸測試，不代表 iOS Safari／Android Chrome 真機驗收。

### 頂部版面與工具

[本次矩陣](docs/design/assets/reader-header-2026-09-15/matrix.json) 記錄 CH20／FF47 × 1706×898、1440×900、1024×768、761×844、760×844、390×844、360×640 × 三段字級，共 42 組。活動名稱、日期及場館完整可讀；搜尋在窄視窗或放大字級時移至下一列。切換入口至少 44px 高，字級群組及相鄰桌機工具同為 44px 外框、7px 圓角；頁面無水平溢出。

矩陣與保留的 7 張代表截圖來自同一次 `reader-header.mjs` 執行（2026-09-15T03:55:10Z）；未封存的截圖欄位標為 null，完整測量仍保留。

- [CH20 原問題尺寸](docs/design/assets/reader-header-2026-09-15/header-ch-20-1706-898-0.png)
- [CH20 窄桌機最大字級](docs/design/assets/reader-header-2026-09-15/header-ch-20-761-844-2.png)
- [CH20 短手機最大字級](docs/design/assets/reader-header-2026-09-15/header-ch-20-360-640-2.png)
- [FF47 桌機對照](docs/design/assets/reader-header-2026-09-15/header-ff47-1440-900-0.png)

### 地圖與選取流程

`map-viewport.mjs` 最終完整執行（2026-09-15T03:59:56Z）通過 93 項擷取／斷言；[執行報告](docs/design/assets/reader-header-2026-09-15/map-regression/browser-report-full.json)、[手機幾何矩陣](docs/design/assets/reader-header-2026-09-15/map-regression/matrix.json) 與保留的[手機摘要](docs/design/assets/reader-header-2026-09-15/map-regression/390-844-standard-summary.png)、[窄桌機選取](docs/design/assets/reader-header-2026-09-15/map-regression/761-844-extra-selected.png) 同源。完整圖檔留在該次本機輸出，repo 保留代表畫面。

桌機 X／Escape 與手機「取消選取」移除社團、攤位深網址並保留條件及視野。完整資訊 X／Escape／遮罩關閉返回原摘要／詳情，保留選取及網址並還原觸發焦點。手機把手收合及一般工作面板「收起」維持既有視野操作語意。行為依 [ADR-0063](docs/adr/0063-reader-dismissal-clears-selection.md)，下方 2026-09-12 紀錄的「收起保留 URL」是當時版本的歷史證據。

Fixture 旅程另行通過：取消選取 4 項、活動選擇 5 項、攤位異動 3 項、縮圖 3 項、session 到期 10 項。新增旅程涵蓋唯一搜尋結果重新整理、瀏覽器前後頁、SVG 鍵盤焦點、完整資訊三種關閉方式與桌機／手機斷點切換；fixture 證據不冒充官方活動資料。

### 獨立視覺及操作審查

未參與實作的主要 reviewer 已獨立檢查 `aa5e16d` 相對 `22daf8f` 的程式與受影響契約、7 張 header 截圖及 2 張地圖回歸截圖，並實際操作官方 CH20 A01 的桌機及 390×844 手機流程。確認完整資訊 X 返回原面板、選取及 URL 保留、開啟按鈕焦點還原；摘要取消後參數移除，Back 恢復原選取，「切換活動」到乾淨 `/`。未發現本次範圍的阻擋問題，Review Done。

TypeScript noEmit、doc-map（12 contracts）通過。本機 lint 排除既有 `.tmp/` worktree 備份內的生成檔後通過：`npm run lint -- --ignore-pattern '.tmp/**'`；未變更 lint 設定，PR CI 仍執行標準完整 lint。

重現頂部比較：先 `npm run data:fetch -- --published`、`npm run data:stage -- --published`，啟動 `vite --config vite.pages.config.ts`，以該 origin 設定 `MAP_TEST_URL`，再以 `HEADER_TEST_EVENTS=ch-20,ff47` 執行 `node tests/browser/reader-header.mjs`。`npm run test:browser:matrix` 另外涵蓋固定 FF47 矩陣、fixture 旅程及既有 portal 旅程。

## 2026-09-12：方案 B 手機地圖驗收

final result: passed

2026-09-12；範圍為本機 Chrome 桌面及手機尺寸驗收，真機驗收未完成。


## 視覺對照

目標為使用者選定的 [參考圖](docs/design/assets/mobile-panel-implementation-2026-09-12/selected-reference.png)，853×1844 正規化至 390×844；[最終畫面](docs/design/assets/mobile-panel-implementation-2026-09-12/summary-final-390.png) 使用相同尺寸與 OriginZero／A01 選取；實測未套用搜尋，地圖比例沿用真實 fit／選取行為。

- 版面：精簡 header、日期／場館浮層、右側縮放與全場、底部摘要及探索／行程兩入口已完成。
- 字體：沿用專案字體；摘要名稱 18px／700，三種字級均檢查。修正標題、工具及導覽排列衝突。
- 顏色與圖示：沿用既有色票、品牌和圖示；摘要白底、深色行程按鈕、收藏及完整資訊次要按鈕。
- 圖像與資料：保留官方 FF47 攤位幾何，不依生成圖重排 A01。搜尋造成非命中攤位退色屬既有行為。真實資料無介紹時顯示「尚未提供作品與販售介紹」，不使用生成圖的虛構文案。
- 已修正 P1/P2：短螢幕大字級按鈕被遮住、標題重疊、全場控制文字太小、右側控制覆蓋 fit、結果容器雙層捲動。既有品牌及圖示與示意圖不同屬保留的產品設計。
- 驗收階段另做獨立視覺檢查（檢查者未參與實作，只看截圖）：指出選取攤位的浮動標籤被「查看全場」控制蓋住且社團名被切斷，已修正並加上攤位圓點標記。

## 瀏覽器與幾何

[手機矩陣](docs/design/assets/mobile-panel-implementation-2026-09-12/matrix.json)：360×640、390×844、430×932、760×844 × 標準／較大／最大，共 12 組，均無水平溢出，摘要操作未被導覽覆蓋，選取在可見區。390×844 標準字級有效地圖高度 391px，超過 240px 目標。360×640 採緊湊摘要，最大字級僅保留完整資訊入口。

最新尺寸矩陣與對應尺寸截圖由同一次 `tests/browser/map-viewport.mjs` 執行產出，`mapHeight` 固定為 `dock.top − tools.bottom − 32`，與腳本的 240px 斷言同源，重跑即可重現：

```bash
npm run test:browser:matrix
```

761×844 與 1440×900 × 三種字級共 6 組桌機回歸通過，截圖同樣來自該次執行。

實際 Chrome 操作通過：結果選取、回結果、收藏、行程、導航、搜尋退出導航、換日、完整資訊 Escape 與焦點還原、收起保留 URL／位置／倍率、手動平移、把手收起、工作面板展開不改 fit。篩選返回結果實測 scrollTop 844 → 844。重新啟動預覽後瀏覽器 error log 為空。

## 程式驗證

- 完整 npm test：626 通過，0 失敗（新增三項雙攤位投影測試）。
- 完整 lint 與 TypeScript noEmit 通過。
- 修復交付時記錄正式 build:staged 通過；FF47 1340 社團、2953 配置通過資料檢查。
- `tests/browser/map-viewport.mjs` 實際執行通過，93 項擷取與斷言，涵蓋手機導航目標、行程狀態、工具選單出口、換日失效選取、網址恢復與 390→761→390 斷點來回。執行前有一次桌機「加入今日行程」等待元素穩定逾時，重跑同一版程式即通過；未確定逾時根因。

## 尚未驗證

iOS Safari／Android Chrome 真機不可用；軟鍵盤、原生雙指縮放、安全區及旋轉需後續真機驗收。本報告的 passed 不代表完成真機測試。
