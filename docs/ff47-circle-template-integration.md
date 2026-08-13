# FF47 社團模板與 WebCatalog 顯示整合紀錄

更新日期：2026-08-11

## 資料來源與邊界

- 線上權威來源：`https://docs.google.com/spreadsheets/d/1LvbfijXkjcoK6nKw06U2YBZ655vcIXWvyEVX-pP0ovU/edit?usp=sharing`；版本化本機快照為 `data_source_test/FF47 完整攤位整理.xlsx`。
- 社團模板來源工作表：`攤位整理表 請在此填寫資訊`，共 1,336 筆具名稱的社團列。
- `DAY1`、`DAY2`、`DAY3` 只用於核對活動配置；不以同名推測社團身分。
- Excel 的縮圖欄本身沒有 URL，而是透過 `IMPORTRANGE` 查詢公開縮圖索引：`https://docs.google.com/spreadsheets/d/1f7uHQQgxgff8nh6aFDrh_cqkeFpcVPsvJILesm778_0/`；本次使用的固定快照位於 `data_source_test/ff47-thumbnail-index.csv`。
- 生成資料包含 5,137 個外部連結、336 筆販售資訊與 262 張具原始 Drive 連結的縮圖。未出現在來源中的欄位不補值；沒有來源圖片時維持文字卡。
- 來源第 452 列的「攤位名稱」欄被填入貼文網址而非社團名。生成器以主辦當日攤位清單為權威修正該列（D09 = 紅色荔枝樹），修正表以貼上的網址為鍵而非列號——上游插入一列會讓列號鍵的修正套到別的社團身上。任何名稱欄為網址但無對應修正的列，會讓生成器失敗而非發布出去。

## 社團模板匹配契約

1. 名稱先做 Unicode NFKC、前後空白與連續空白正規化。
2. 優先以「正規化名稱 + 活動日 + 攤位代碼」比對同一 Excel 列。
3. 只有名稱在主表中唯一時，才允許退回單一名稱匹配。
4. 同一 Excel 列登錄的跨日或連號攤位共用一個 `CircleRecord`，各自保留 `PlacementRecord`。
5. 沒有編號攤位的已知社團仍保留於 `CIRCLE_CATALOG`，但不虛構地圖位置。

生成結果位於 `app/ff47-circle-templates.generated.json`；型別、索引與匹配邏輯位於 `app/circle-records.ts`（原 `app/ff47-circle-templates.ts` 已併入該檔，因為場刊資料改以靜態快照傳輸，不再打包進 bundle）。`app/ff47-circle-templates.manifest.json` 記錄生成器版本、兩個輸入檔與輸出檔的 SHA-256，以及資料筆數。

模板再經 `scripts/export-static-circle-catalog.mjs` 併入攤位資料，輸出執行期讀取的 `public/data/events/ff47/circles.json`；`npm run build` 以 `catalog:snapshot:check` 逐位元組驗證該快照與來源一致。

- 重新生成：`npm run catalog:generate`。
- 驗證工作簿、縮圖快照與輸出未漂移：`npm run catalog:check`。
- 比對線上工作簿與本機快照：`npm run source:check`；更新快照並重新生成 catalog：`npm run source:update`。
- 生成器只使用 Node.js 內建模組解析 XLSX／CSV，位於 `scripts/generate-ff47-circle-templates.mjs`，不依賴未鎖定的全域套件或即時網路資料。
- `app/event-catalog.ts` 的 `FF47_EVENT.dataUpdatedAt` 是公開 catalog 的資料版本日期；活動更新標籤、社團 `updatedAt` 與逐來源 `fetchedAt` 共用此值，避免同步工作簿後顯示不同日期。

## 對照 Comike WebCatalog 的介面落地

- 搜尋卡、詳細資訊與地圖攤位共用同一份 `CircleRecord`。
- 詳情顯示社團縮圖、筆名／創作者類型、分級、作品、販售資訊、標籤、社群、贊助、品書、通販與試閱連結。
- 側欄與完整詳情的圖片保持純影像，不疊加作品、販售、攤位或 DAY；定位資料移至資訊欄。完整詳情以 `media[]` 為幻燈片資料，桌機置於左側、手機置於資訊上方，切換控制與來源連結皆在影像之外。
- 外部連結保留平台名稱、內容類型與原始 URL；縮圖另保留來源 URL，不把媒體當成社團身分。
- 搜尋結果的「每筆媒體」顯示設定只呈現具來源的圖片。
- 地圖縮放達 145% 時，具縮圖的攤位切換為圖片攤位；低於門檻時回到高辨識度的色塊與代碼。

## 地圖縮放契約

- 最大放大倍率：600%。
- 最小倍率不再是固定值，而是 `min((viewportWidth - padding) / floorWidth, (viewportHeight - padding) / floorHeight, 6)`。
- 重設、按鈕、滑輪與雙指縮放共用同一最小倍率；縮小到邊界後完整場館必須仍在可視區內。
- 視窗尺寸改變時，若使用者原本停在完整場館倍率，地圖會重新置中並套用新的完整場館倍率。

## 驗證摘要

- 自動測試涵蓋 1,336 個模板、2,977 筆配置、跨攤位模板共用、未配置社團保留、縮圖來源、完整場館倍率、置中與圖片門檻。投影後的社團數應恰為 1,336——高於此數代表有攤位比不到模板而退回位置式身分。
- 實際瀏覽器驗證：614 × 430 地圖可視區的完整場館倍率為 38%；再縮小仍維持 38%，且場館四邊均在可視區內。
- 實際瀏覽器驗證：148% 時 DAY 1 地圖呈現 211 個來源縮圖攤位；縮圖成功載入為 800 × 400。
