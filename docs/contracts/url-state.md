# URL 檢視狀態契約

URL 是跨模組的共享狀態，因此獨立成一份契約：搜尋、地圖、規劃篩選與顯示設定都往同一組查詢參數寫入。任何模組新增可分享狀態，都必須先在這裡登記。

**實作**：[`app/event-url-state.ts`](../../app/event-url-state.ts)（schema、defaults、codec、活動解析與 history intent）、[`app/event-entry.tsx`](../../app/event-entry.tsx)（選擇器與讀者畫面的分流）、[`app/event-chooser.tsx`](../../app/event-chooser.tsx) 與 [`app/event-calendar.ts`](../../app/event-calendar.ts)（活動日期、排序及分組）、[`app/map-view-state.ts`](../../app/map-view-state.ts)（選取解析）、[`app/event-workspace-projection.ts`](../../app/event-workspace-projection.ts)（共享衍生狀態）
**測試**：`tests/event-url-state.test.mjs`、`tests/event-chooser-component.test.mjs`、`tests/map-view-state.test.mjs`、`tests/event-workspace-projection.test.mjs`

## 參數

所有可分享狀態都掛在根路徑的 query string，不建立會和 Pages `index.html` 正規化衝突的 SPA rewrite。

| 參數 | 負責模組 | 說明 |
|---|---|---|
| `event` | 活動 | 目前活動 ID，永遠寫出。只接受已發布活動 |
| `day` | 活動 | 活動日，永遠寫出 |
| `area` | 活動 | 展區，永遠寫出。讀取時接受 legacy 別名 `hall`。另接受讀者端的 `ALL`（目前場館空間的全部展區）|
| `venueSpaceId` | 活動 | 場館空間 stable ID；只有活動分配多個場館空間時寫出 |
| `query` | 探索搜尋 | 一般關鍵字 |
| `genre` | 探索搜尋 | 社團主題；值為目前活動分類目錄中的顯示名稱 |
| `creator` | 詳細搜尋 | 創作內容 |
| `work` | 詳細搜尋 | 作品名稱／題材。**可重複**，一枚題材一個參數 |
| `workMode` | 詳細搜尋 | 多枚題材的組合方式；只有 `all` 會寫出，`any` 是預設 |
| `workExclude` | 詳細搜尋 | 排除的作品名稱／題材。**可重複** |
| `workType` | 詳細搜尋 | 作品取向；`male`、`female` 或 `general`。退役的 `original`／`derivative` 視為未設定 |
| `r18` | 詳細搜尋 | 分級；`include` 為 R18、`r15` 為 R15、`general`（舊 `exclude` 別名）只匹配明確一般分級；逐值匹配，無最高分級推導 |
| `favorite` | 規劃篩選 | `1` 代表只看收藏 |
| `favoriteGroup` | 規劃篩選 | 收藏群組 ID |
| `visit` | 規劃篩選 | 行程狀態 |
| `sort` | 顯示設定 | 結果排序 |
| `density` | 顯示設定 | 資訊密度 |
| `media` | 顯示設定 | 每筆媒體數 |
| `selectedCircle` | 地圖／詳情 | canonical `CircleRecord.id` |
| `selectedBooth` | 地圖／詳情 | 實際 `PlacementRecord` 的攤位代碼 |

除 `event`、`day`、`area` 外，**參數在等於預設值時從 URL 移除**，不留下無意義的殘留條件；多場館空間活動的 `venueSpaceId` 是例外，必須寫出以消除 `area` 歸屬歧義。

## 規則

- **活動選擇頁只呈現已發布活動。** 依「即將到來 → 舉辦中 → 過往活動」分組，各組按開始日期由新到舊排序，同日以活動 ID 固定順序；不顯示空群組，零活動時顯示「目前沒有公開活動」。分類使用 `Asia/Taipei` 日曆日，包含首日與末日及中間的夜間；開著頁面每分鐘及重新可見時更新。這是日期狀態，不代表現場開放入場。
- **選擇頁日期由已有資料推導。** 使用逐日 ISO 日期，並相容既有「月日・星期」標示；舊標示的年份由 `eventEndsAt` 的台灣結束日期定位，跨年回推。顯示單日 `YY.mm.dd`、同月 `YY.mm.dd-dd`、跨月 `YY.mm.dd-mm.dd`、跨年 `YY.mm.dd-YY.mm.dd`。不修改原始 `dateRangeLabel` 或地圖內日期文案。無法解析的日期保留原文；結束日期已過可歸入過往，否則置於「日期待確認」，不捏造開始日期。分組不新增 URL／schema 欄位，也不攔截原有 deep link。

- **`selectedCircle` 與 `selectedBooth` 必須互相驗證。** 兩者都在時取交集；只有 `selectedCircle` 時取該社團在該日的第一筆配置；無效或已變更的關聯降級為只開啟仍有效的活動與區域，**不顯示錯誤社團**。
- **攤位範圍 deep link 在 selection seam 解析。** `selectedCircle` 若帶的是攤位範圍 ID（`1-e19`、`1-e19-0`），先從 records 解析為 allocated ID，再與日期／攤位取交集；成功恢復後只會重新序列化 canonical `c-*`。舊的 `ff47-<hash>` ID 已無相容路徑，解析不到就 fail closed（[ADR-0013](../adr/0013-drop-the-legacy-circle-id-compatibility-path.md)）。
- **`event` 先於其他所有參數解析。** 它是唯一決定「其餘參數在講哪一場活動」的參數，因此不能像未知的 `day` 或 `genre` 那樣退回預設值。`resolveUrlEvent` 有三種結果：

| URL | 結果 |
|---|---|
| `event` 指向已發布活動 | 進入該活動 |
| 沒有 `event`，且只有一場已發布活動 | 進入該活動 |
| 沒有 `event`，且有多場已發布活動 | 顯示活動選擇器（[ADR-0042](../adr/0042-the-public-entry-is-an-event-chooser.md)） |
| `event` 指向未發布或不存在的活動 | **fail closed**：顯示選擇器並說明該連結無法開啟，不改用其他活動作答 |

  最後一列是刻意的：在別人分享的連結底下安靜地端出另一場活動的地圖，比誠實說「這個連結打不開」更糟。未發布活動不出現在選擇器，也不能由 `event` 定址。

- **已發布活動的既有連結永遠有效。** 連結是本站唯一的跨裝置狀態轉移方式（[ADR-0002](../adr/0002-planning-data-stays-on-device.md)），壞掉沒有補救路徑，因此新增活動不得讓既有 `?event=…&day=…&selectedCircle=…` 解析到不同畫面。
- **一次只呈現一場活動。** codec 與 workspace projection 都接受 event definition；選定活動後，篩選、選取與 planning 都在該活動範圍內，不跨活動洩漏。切換活動會以新的活動定義重新掛載讀者畫面，不沿用上一場的日期或展區。
- **defaults 從 event definition 推導。** `day` 與 genre 預設取活動定義的第一筆，不在 codec 內硬編碼 FF47 的 `1` 或「全部類別」。`area` 的預設是**該場館空間的全區**：由第一個展區決定落在哪個場館空間，再開在那個空間的全部展區上。
- **`ALL` 是讀者端的展區代碼，不是活動資料裡的一筆。** 展區由主辦的攤位名單推導，因此活動的 `areas` 只會有名單裡出現過的代碼，沒有一個代表「全部」；讀者自行補上 `ALL`。FF47 的定義自行宣告了同名展區，兩者因此重合而不衝突。`ALL` 一律指**目前場館空間**的全部展區，不是整場活動——地圖 artifact 的單位是「活動日 × 場館空間」，別的空間的攤位在目前這張圖上沒有座標。只有一個展區的場館空間不提供 `ALL`，`?area=ALL` 在那裡正規化成那個展區。
- **場館空間與展區成對驗證。** `area` 是活動分區，`venueSpaceId` 是 pinned 場館空間，兩者不得互換。無效的 space 或不屬於該 space 的 area 一律回到該活動的預設 assignment；單一場館空間活動會移除殘留的 `venueSpaceId`。`ALL` 屬於每一個場館空間，本身不指定空間，因此寫出時的 `venueSpaceId` 取自讀者目前的場館空間狀態，不由 `area` 反推。
- **不提供展區切換的活動，`area` 只有一個可達值。** 單一場館空間的活動不出現展區切換（見 [`event-map.md`](event-map.md)），因此 `?area=` 指名個別展區時放寬成全區，而不是把讀者留在一個他沒有控制項可以解除的篩選裡。活動、日期與選取不受影響，篩選只會放寬不會收窄，原本看得到的東西不會消失。
- `genre` 只接受目前活動的衍生分類字彙；舊工作簿類別或其他活動的值一律回到「全部類別」，不跨活動猜測對應。
- **恢復時機**：初始化、重新整理與 `popstate` 必須恢復篩選及選取。地圖資料延後完成時，以保存的攤位代碼定位並保留倍率；使用者已手動操作則取消過時的自動定位，仍恢復有效選取。
- **延後套用選取**：可分享連結的社團與攤位選取要等社團快照可解析後才套用。**在此之前不得改寫 URL**，否則會把使用者分享的深層連結洗掉。
- **不寫入 URL 的狀態**：hover、拖曳中的 viewport、動畫進度、尚未套用的篩選草稿、詳細搜尋題材輸入框裡尚未加入的文字，以及桌機探索／行程頁籤和詳情展開狀態。
- 桌機詳情 X／Escape 與手機摘要「取消選取」／Escape 移除 `selectedCircle`／`selectedBooth`，建立一筆歷史並保留日期、搜尋、篩選及視域。重新整理不因唯一搜尋結果而重新選取；自動選取只由使用者當次搜尋觸發。查看全場、手機把手收合、回結果及工作入口切換仍保留選取。完整資訊 X／Escape／遮罩只返回原摘要或詳情，保留選取及 URL、不新增歷史。前進／後退恢復有效選取並開詳情，無選取則收起，不另 push。決策見 [ADR-0063](../adr/0063-reader-dismissal-clears-selection.md)。
- 多場活動時，桌機與手機的活動名稱整區以「切換活動」連結返回根路徑的選擇頁，清除目前 query string 及 hash；這是新的導覽歷史，不依賴上一頁存在。選另一場不帶入舊條件，瀏覽器上一頁可回原活動 URL 狀態；只有一場時不顯示切換入口。本機收藏、行程與字級設定保留。
- **多值條件用重複參數，不用分隔字元。** `work` 與 `workExclude` 各自 `getAll`／`append`；作品名稱本身可能含逗號或斜線，分隔字元會讓一個題材把自己拆成兩個條件。空白與只差空白／連字號的重複拼法在解析時就收斂。
- **歷史紀錄**：只有使用者透過明確操作改變選取或篩選時才建立歷史紀錄；連續平移與縮放不得淹沒瀏覽器上一頁。
- **桌機與手機使用相同的 URL 狀態與結果集合**，不建立第二套參數語意。
- 搜尋結果、地圖 markers、selection、planning、active filters 與桌機／手機 panels 都消費同一份 event-scoped workspace projection；rendering 與 pointer gestures 不進入該 domain seam。
- 同社團當日多攤位的行程／下一站／導航預設使用快照順序中的第一筆 active 配置，active 優先於已異動配置；不承諾重新排序快照後仍選同一預設攤位。啟用導航時，若目前選取是目標社團同日的有效攤位，保留該選取與 `selectedBooth`，不跳到相鄰攤位。此偏好不新增持久化欄位。

## 驗收條件

- 複製任一 URL 到新瀏覽器工作階段後，可恢復有效的查詢、篩選與選取。
- 套用詳細搜尋後重新整理，詳細搜尋參數與結果都還在；未套用的草稿不在 URL 裡。
- 多枚 `work` 與 `workExclude` 依原順序還原；只有一枚題材時不留下 `workMode` 殘留。
- 舊的單一 `work=X` 連結仍還原成一枚題材，不需要相容分支。
- 深層連結（含 `selectedCircle`）在快照載入完成前不被改寫。
- 切換資訊密度、媒體數量或排序會更新 URL，但不改變結果 ID 集合。
- 瀏覽器上一頁可逐步退回明確的操作，不會退回到平移或縮放的中間狀態。
