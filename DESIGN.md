---
name: "FF47 場刊 MAP"
description: "高密度、可搜尋、可規劃的同人展電子場刊與向量地圖工具"
colors:
  shell-ink: "#202a35"
  text-muted: "#707a82"
  structural-line: "#dfe3df"
  paper-ground: "#f8f7f2"
  map-ground: "#f2f0e8"
  surface-soft: "#f9faf8"
  coral-current: "#e86f5d"
  mint-illustration: "#57a88e"
  blue-vtuber: "#4f83bd"
  amber-maker: "#d99b44"
  lilac-cosplay: "#8b72b1"
  gold-route: "#f4c65c"
  success-soft: "#edf8f3"
  success-deep: "#306d59"
  danger-soft: "#fff3f1"
  danger-deep: "#a43e30"
typography:
  headline:
    fontFamily: "Geist, system-ui, Noto Sans TC, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.02em"
  title:
    fontFamily: "Geist, system-ui, Noto Sans TC, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Geist, system-ui, Noto Sans TC, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  label:
    fontFamily: "Geist, system-ui, Noto Sans TC, sans-serif"
    fontSize: "9px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0.1em"
  data:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.06em"
rounded:
  xs: "5px"
  sm: "7px"
  md: "9px"
  lg: "12px"
  dialog: "18px"
  round: "50%"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.shell-ink}"
    textColor: "{colors.surface-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.shell-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  input-search:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.shell-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "42px"
  filter-selected:
    backgroundColor: "{colors.paper-ground}"
    textColor: "{colors.shell-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "7px 8px"
  status-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success-deep}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
  map-slot:
    backgroundColor: "{colors.map-ground}"
    textColor: "{colors.text-muted}"
    typography: "{typography.data}"
    rounded: "{rounded.xs}"
---

# Design System: FF47 場刊 MAP

## Overview

**Creative North Star: "攤位作戰桌"**

介面是一張在展前被反覆攤開、標記與修訂的作戰桌。使用者需要在大量社團中迅速搜尋作品、比較題材、收藏攤位並安排下一站。設計必須讓工具本身退後，讓社團內容、地圖位置與規劃狀態站到前景。

最終方向種子為 `local-extension-c`。整體採明亮、低彩度、紙張感的工具外殼；高密度不是壓縮一切，而是建立固定欄位、可預測的層級與精準的資料字體。桌機把規劃工具、向量地圖、詳情／行程並置，手機則以四頁籤讓地圖與當前工作保持在同一畫面。

這不是行銷網站、活動宣傳頁、企業儀表板或過度裝飾的娛樂頁面。大型形象視覺、空泛品牌文案與卡片堆疊都不得取代實際的攤位與作品資訊。

**Key Characteristics:**

- 高密度但每一層都有固定位置與可掃讀節奏。
- 地圖與社團詳情雙向定位，任何選取都必須在兩側同步表達。
- 同一筆社團資料依清單、詳情與地圖情境呈現不同密度，但欄位語意、來源與規劃狀態維持一致。
- 一般使用者使用成熟、熟悉的搜尋、篩選、收藏與路線操作。
- 外部內容永遠標示來源；資料暫缺不得阻斷本地社團、收藏與地圖流程。
- 管理功能與參觀者流程視覺分離，管理操作明確標示並集中處理。
- 動態只說明狀態變化，離散轉場維持 150 至 250ms，拖曳與縮放直接跟手。

**The Task-Surface Rule.** 每個畫面必須先回答使用者現在要找什麼、在哪裡、接下來去哪裡。任何不能改善這三個答案的裝飾都必須刪除。

## Colors

色彩策略是克制的工具外殼，加上僅用於資料語意的完整色盤。深墨色建立操作權威，暖紙色維持長時間瀏覽舒適度，分類色只在圖例、攤位與內容識別中出現。

### Primary

- **作戰桌深墨色** (`shell-ink`): 主操作、選取、標題與高對比資料。不得用於大面積裝飾背景。
- **目前位置珊瑚色** (`coral-current`): 日期選取、收藏與需要被立刻辨識的目前狀態。

### Secondary

- **插畫薄荷色** (`mint-illustration`): 繪圖與創作類型，以及成功狀態的核心色。
- **VTuber 藍** (`blue-vtuber`): VTuber 類型與入口方向資訊。
- **手作琥珀色** (`amber-maker`): 手作、模型與警告語意。
- **Cosplay 丁香色** (`lilac-cosplay`): Cosplay 類型。
- **路線金色** (`gold-route`): 下一站箭頭與品牌印記，只作小面積導向。

### Neutral

- **暖紙底** (`paper-ground`): 頁面與非地圖區域的基礎底色。
- **場館底紙** (`map-ground`): 地圖工作區、SVG 紙張與非互動攤位。
- **柔白表面** (`surface-soft`): 搜尋框、按鈕與工作面板。禁止使用純白作為新 token。
- **結構線** (`structural-line`): 欄位、控制項與群組的一像素邊界。
- **次要文字灰** (`text-muted`): 輔助資訊、計數標籤與非活躍內容。

**The Semantic Color Rule.** 分類色只能表示資料類型或狀態，不得用來裝飾標題、背景或分隔線。

**The Ten Percent Shell Rule.** 珊瑚色與金色在工具外殼中合計不得超過可見面積的 10%。地圖資料色不受此限制，但必須可由標籤與形狀補充辨識。

## Typography

**Display Font:** Geist，後接 system-ui 與 Noto Sans TC。

**Body Font:** Geist，後接 system-ui 與 Noto Sans TC。

**Label/Mono Font:** Geist Mono，後接 ui-monospace 與 monospace。

**Character:** 單一無襯線家族維持熟悉、冷靜的產品介面；等寬字只負責攤位代碼、數量、revision、方向與小型英文標籤。字級緊密，但以字重與固定位置建立明確層級。

### Hierarchy

- **Headline**，700、20px、1.2：地圖標題、管理標題與主要社團名稱。
- **Title**，700、14px、1.4：面板標題、狀態標題與重要內容名稱。
- **Body**，400、12px、1.65：說明、社團內容與管理引導；連續文字最長 72ch。
- **Label**，800、9px、0.1em：欄位名稱、區段標題與短英文導覽字，允許大寫。
- **Data**，700、10px、0.06em：攤位代碼、數量、時間、信心值與版本資訊。

**The Data-Is-Mono Rule.** 只有可比較、可排序或具座標意義的資料使用等寬字。按鈕名稱與一般中文標題禁止使用等寬字。

**The Tight-Scale Rule.** 產品字級階層維持約 1.15 至 1.2 的比例，不得突然加入巨型展示字搶走作品內容的注意力。

桌機頂部提供 100%、112%、124% 三段介面字級，並保存於本機；倍率套用至文字而不放大 SVG 地圖幾何。760px 以下維持 100%，避免把有限的地圖視野交給介面字級控制，同時仍支援瀏覽器原生縮放。

## Layout

桌機工作區採三欄：左欄切換搜尋／篩選與行程規劃，中欄保留可平移縮放的 SVG 地圖，右欄同時容納攤位詳情與當日行程。寬度低於 1050px 時右欄成為地圖右側浮層；760px 以下隱藏左右欄，改用底部工作面板的「篩選／結果／詳情／行程」四頁籤，地圖持續留在主畫面。管理地圖在 720px 以下成為貼底單欄面板；規劃資料管理在 760px 以下採相同的貼底模式。

全域間距使用 4、8、12、18、24px 節奏。桌機工作區高度扣除 130px 導覽列；手機底部面板最高 58vh、內容區最高 47vh，避免頁籤內容完全遮住地圖。

**The Three-Zone Rule.** 桌機永遠保留「規劃／探索、地圖、詳情／行程」三個任務區；中型畫面可覆蓋詳情，但不得移除地圖上下文。

**The Four-Tab Rule.** 手機只使用篩選、結果、詳情、行程四個工作頁籤；未選攤位時詳情頁籤停用，不建立第五種導航模型。

## Elevation & Depth

系統預設扁平，以暖色調表面差、一像素結構線與固定欄位建立深度。陰影只在真正離開基準平面的元件出現，例如地圖紙張、浮動控制器、桌面詳情浮層、管理面板與暫時路線提示。

### Shadow Vocabulary

- **控制器微浮起** (`0 4px 14px #2733291f`): 地圖縮放控制與小型浮動工具。
- **地圖紙張** (`0 7px 24px #202a3526`): SVG 場館平面與工作區中的主要紙張。
- **詳情浮層** (`0 14px 40px #2631293a`): 1050px 以下覆蓋地圖的社團詳情。
- **管理工作面板** (`0 28px 80px #11182066`): 僅供管理匯入的最高層面板。
- **焦點環** (`0 0 0 3px #dfe8e3`): 搜尋與表單欄位的鍵盤焦點。

**The Flat-By-Default Rule.** 靜止內容不得靠陰影區分群組。先使用間距、表面色與一像素邊界；只有覆蓋、浮動或互動回饋才能增加陰影。

**The No Decorative Glass Rule.** 透明與模糊只允許在管理面板的遮罩與黏著標頭，作用是保留上下文，不得用於一般卡片。

## Shapes

介面以小幅圓角和一像素結構線維持工具感。資料 chip 與攤位格使用 5px，工具控制使用 7px，表單與狀態群組使用 9px，地圖紙張與一般面板使用 12px；只有貼底工作面板與管理對話框使用 18px。圓形只保留給關閉、說明、指南針等已熟悉的單一圖示操作。

**The Radius-Follows-Layer Rule.** 元件越接近資料層，圓角越小；18px 只屬於離開頁面基準層的對話框與行動面板。

## Components

元件語氣是克制、精準、工具優先。互動元件必須具有 default、hover、focus-visible、active、disabled 與 loading 狀態；任何資料狀態不可只靠顏色表達。

本章描述現行實作。尚未實作的 minimap、OAuth、帳號、雲端同步與多人協作不得出現在一般操作流程中。

### Buttons

- **Shape:** 小型工具按鈕使用輕微圓角 7px；主要流程按鈕高度 38px；圓形關閉與說明按鈕只能用於公認圖示操作。
- **Primary:** 深墨底、柔白字，8px 12px 內距；主要 CTA 必須使用清楚動詞，例如「設為下一站」或「發布活動地圖」。
- **Hover / Focus:** hover 只調整明度；focus-visible 使用 3px 外框或等效焦點環；active 不得產生彈跳。
- **Secondary:** 柔白底、一像素結構線、深墨字；不可與 primary 具有相同視覺重量。
- **Disabled / Loading:** disabled 使用低彩度灰綠表面並保留標籤；loading 必須把動作改為進行式文字。

### Chips

- **Style:** 標籤與展區徽章使用 5px 圓角、緊密水平內距與低彩度底色。
- **State:** 選取 chip 使用深墨字與清楚邊界；分類 chip 必須保留文字，不得只顯示色點。

### Cards / Containers

- **Corner Style:** 小群組 9 至 12px；只有管理工作面板使用 18px。
- **Background:** 以暖紙底、柔白表面與場館底紙分層。
- **Shadow Strategy:** 靜態群組無陰影；覆蓋或浮動元件使用 Elevation 中的既定陰影。
- **Border:** 一像素中性邊界。禁止使用大於一像素的彩色側條。
- **Internal Padding:** 緊密群組 8 至 12px；詳情與管理區段 18 至 24px。

### Inputs / Fields

- **Style:** 搜尋欄高 42px、12px 圓角、柔白底與一像素結構線。
- **Focus:** 邊界變深並顯示 3px 低彩度焦點環，禁止只移除 outline。
- **Error / Disabled:** 錯誤使用淡紅表面、深紅文字與完整邊框；disabled 降低對比但保留可讀標籤。
- **Exploration Search:** 搜尋社團名、作品名、題材與介紹內容；結果可搭配日期、區域、分類與收藏狀態篩選。
- **Advanced Work Search:** 作品名稱／題材輸入從目前活動資料提供至多六筆浮動建議，支援方向鍵、Enter、Escape 與點按；跨語別同義名稱由獨立人工核對表擴展查詢，不改寫來源資料。套用詳細搜尋後，搜尋結果標題右側必須提供只重設詳細搜尋條件的操作。
- **Rating Search:** R18 與一般內容只匹配來源明確標記的分級；未知與 R15 不得推測成一般或 R18。
- **Map Locator Search:** 搜尋攤位代碼或社團名；結果選取後必須直接移動到對應攤位並保留目前倍率。
- **Visible Scope:** 搜尋欄附近必須顯示目前活動、日期、區域、篩選摘要與結果數，不讓使用者猜測搜尋範圍。
- **Result Volume:** 大量結果使用分頁或漸進載入，保留目前查詢與捲動位置；不得一次渲染全部結果造成介面失去回應。
- **Empty Results:** 顯示已套用條件、清除個別條件與清除全部的操作；保留原查詢，避免只能返回重打。

### Navigation

- **Style:** 頂部列承載活動、搜尋與品牌；第二列承載日期與場館。active 日期使用底部 3px 珊瑚指示，文字同時轉為深墨色。
- **Desktop:** 左欄在搜尋與行程間切換，中欄固定為地圖，右欄同時展示詳情與行程；這是規劃工作面的主要資訊架構。
- **Mobile:** 760px 以下改為單欄頂部列、三等分日期與場館選擇，並以「篩選／結果／詳情／行程」四頁籤承載工作內容。
- **Area Mode:** FF47 是單一展館，固定顯示全館且不呈現 A–K／L–W 切換；活動 catalog 仍保留 `switchable` 模式，供未來真正的多館或多層活動使用。
- **State:** 當前狀態同時使用位置、文字重量與色彩，不得只靠色彩。
- **URL Contract:** `event`、`day`、`area`、`query`、`genre`、`creator`、`work`、`workType`、`r18`、`favorite`、`favoriteGroup`、`visit`、`sort`、`density`、`media`、`selectedCircle` 與 `selectedBooth` 是可分享、可還原的檢視狀態。
- **Restoration:** 初始化、重新整理與 `popstate` 必須恢復篩選及選取；地圖資料延後完成時，以保存的攤位代碼重新聚焦。hover、動畫進度與尚未套用的篩選草稿不得寫入 URL。

### Circle Information Surfaces

- **List Card:** 用於快速掃讀，只顯示社團名、攤位、主要作品／題材、最多一張代表圖、來源提示與收藏控制。
- **Full Detail:** 顯示完整介紹、作品／販售資訊、所有適用圖片、外部來源連結、收藏分類、備註與行程動作。
- **Map Side Panel:** 顯示定位決策所需的社團名、攤位、主要作品、收藏／行程狀態與開啟完整詳情；不得複製完整頁面的所有內容。
- **Hero Shortcut:** 地圖側欄有代表圖時，整張圖片是開啟完整詳情的可聚焦按鈕；關閉與收藏等單圖示按鈕的 SVG 必須在固定點按區內水平、垂直置中。
- **Shared Contract:** 三種介面共用由 `CircleRecord + PlacementRecord` 投影出的 `CircleViewRecord`、來源元件與收藏控制；核心欄位順序一致，缺少的欄位直接省略，不使用空白卡片或虛構內容補位。社團身分不得和特定活動攤位欄位扁平綁死；同名公開列沒有人工核對證據時不得自動合併。

### Vector Map

- **Canvas:** 地圖工作區使用 22px 格線提示可拖曳座標空間，SVG 場館使用同一 viewBox 保存攤位、柱子與出入口。
- **Slots:** 未配置攤位低對比；有社團的攤位採分類色淡底；selected 使用實色與 3px 深色描邊；favorite 加入珊瑚圓點；next 加入深墨箭頭。
- **Interaction:** SVG slot 本身是互動元素，禁止在圖片上疊 HTML 按鈕；攤位使用單一 Tab 入口與方向鍵移動焦點，Enter／Space 開啟。地圖支援滑鼠拖曳、游標中心滾輪縮放、觸控單指平移與雙指縮放，固定控制器提供放大、縮小與重設；地圖畫布及其中所有文字不得被拖曳選取。
- **Controls:** 縮放、重設與指南針固定在地圖邊緣，不得跟隨 SVG 一起縮放。重設必須回到完整可用範圍。
- **Focus:** 搜尋結果、URL 或地圖選取攤位後，地圖只移動至對應座標並保留使用者目前倍率，不得回彈到預設倍率；單一搜尋結果可自動開啟詳情。
- **Zoom Range:** 完整地圖適配倍率是動態下限，使用者可放大到 600%；145% 起顯示具可追溯來源的社團縮圖，200% 以上固定控制器以 25% 級距縮放，方便快速進入可辨識縮圖的倍率。
- **User-facing Name:** 一般介面與輔助科技名稱使用「社團攤位配置圖」或「活動地圖」；「向量」只屬於實作技術，不顯示為地圖名稱。
- **Overview:** 目前不顯示 minimap；未來若活動包含多館或分層場域，仍須與主地圖共用同一 layout 投影，不建立第二份座標資料。

### Booth Details

- **Desktop:** 右欄只展示定位決策所需的社團名稱、攤位、類型、主打作品、來源摘要與規劃動作；分類、備註編輯與完整來源由「開啟完整詳情」對話框承載。
- **Intermediate:** 1050px 以下成為地圖上的右側浮層。
- **Mobile:** 760px 以下由底部工作面板的「詳情」頁籤承載；關閉與主要規劃動作保持可用，面板不獨占整個畫面。
- **Shared Booth:** 同一攤位有多筆社團時，使用緊密清單切換，不建立巢狀卡片。

### Favorites / Planning

- **Favorite Record:** `FavoriteRecord = eventId + circleId + groupId? + memo + createdAt + updatedAt`。是否存在此記錄是唯一收藏判定，不另存容易失真的 `isFavorite`。
- **Favorite Group:** `FavoriteGroup = id + name + color + sortOrder`。`name` 必填，色彩只作輔助；所有色點旁都要顯示群組名稱。
- **Visit Plan:** `VisitPlanEntry = eventId + day + circleId + status + routeOrder + updatedAt`。`day` 接受活動定義的字串或數字鍵；收藏、加入行程、設為下一站與已走訪是獨立動作，不因收藏自動排序。
- **Cross-Surface Sync:** 清單卡、完整詳情、地圖攤位與側欄使用同一狀態來源；任一處修改後立即同步，不要求重新整理。
- **Removal:** 取消收藏後顯示七秒 Undo；Undo 必須以原記錄完整恢復 `groupId`、`memo`、建立與更新時間，不因有備註或分類而降級。移除收藏不改變行程。
- **Route Ordering:** 每日行程可直接拖曳，亦保留可聚焦的往前／往後按鈕；每次移動後以連續 `routeOrder` 正規化。群組管理支援來源到目標的批次搬移。
- **Orphans:** catalog 找不到對應社團時仍保留收藏與行程，管理介面顯示未匹配 ID、備註／狀態並允許個別移除或匯出，不靜默丟棄。
- **On-site Mode:** 展場模式是可隨時退出的暫時投影：地圖只顯示所選日期的行程攤位，優先聚焦 `next` 或第一個未走訪項目，並顯示已走訪／剩餘數；不得清空使用者原本的搜尋與進階篩選。手機隱藏重複的發布 revision 與下一站浮條，保留可辨識的地圖視野。
- **Storage:** 規劃資料以 versioned `localStorage` 文件保存，並透過 `storage` 與同分頁自訂事件同步。舊版收藏可遷移；不相容或損壞內容必須保留原始字串、停止覆寫並提供下載。寫入失敗時保留本分頁狀態，顯示儲存異常與匯出備份指引。

### Source-aware Content

- **Source Label:** 外部圖片、介紹與連結旁顯示提供者名稱或圖示、內容類型與「查看原始來源」連結；不得呈現無來源圖片。
- **Local Authority:** 本地 `CircleRecord` 與活動攤位配置是社團身分及定位的基準，外部來源只補充媒體、描述或可驗證連結，不以同名結果直接覆寫。
- **Freshness (P1):** 已匯入內容顯示擷取／匯入時間、提供者與同步狀態；來源失效時保留本地核心資訊並說明外部內容暫不可用。
- **Disclosure:** 未驗證內容使用中性標籤，不以官方標誌、語氣或版面權重暗示已獲主辦確認。

### Display Settings

- **Density:** 提供「緊湊掃讀」與「資訊清單」兩種密度；切換只改變呈現，不改變搜尋結果集合。
- **Media:** 每筆顯示 0、1 或 3 張媒體預覽；完整詳情仍可檢視所有已授權內容。
- **Filters:** 日期、創作類別、區域、收藏分類與行程狀態可組合使用，頂部持續顯示已套用條件與結果數。
- **Sort:** 一般結果可依攤位、名稱或最近更新排序；收藏與行程另支援使用者規劃順序。
- **Commit Pattern:** 單一排序可立即套用；多條件側欄使用「套用／取消」，未套用草稿不改變結果或 URL。

### Icon System

- **Source:** 介面圖示統一由 `UiIcon` 輸出內嵌 SVG，使用 `currentColor`、圓端線條與 24px viewBox；不得混入 emoji、icon font 或另一套筆畫語言。
- **Semantics:** 純裝飾圖示設為 `aria-hidden` 且不可聚焦；只有圖示的按鈕必須由按鈕本身提供可讀 `aria-label`。
- **Map Marks:** 收藏、行程、下一站與已走訪直接以 SVG 圓點、箭頭或勾線呈現，並由可讀攤位名稱和狀態文字補足，不只依賴顏色。

### Keyboard and Gesture Access

- **Global Search:** `Command/Ctrl + K` 聚焦搜尋欄；畫面上的快捷鍵提示在手機隱藏。
- **Map Keyboard:** 地圖以 roving focus 限制大量 Tab 停靠點，方向鍵依幾何鄰近攤位移動，Enter／Space 選取。
- **Pointer and Touch:** 空白地圖區支援拖曳；觸控使用 pointer capture 維持單指平移與雙指縮放。攤位本身保留點按，不觸發背景拖曳。
- **Motion:** `prefers-reduced-motion` 時停用轉場；拖曳與縮放維持直接跟手，不加入彈性或慣性動畫。

### Admin Map Import and Fine-tuning

- **Scope:** 只用於管理員上傳、辨識、原圖對照、向量元素微調與發布；一般使用者介面不得出現檔案欄位。
- **Preview:** 原圖與向量結果並列，摘要先呈現信心、排數、攤位格、柱子與出入口。
- **Editor:** 管理員可拖曳或輸入座標調整一般攤位、柱子與出入口，並新增、命名、縮放或移除企業攤、舞台及其他非一般攤位區。方向鍵移動 1px，Shift 加方向鍵移動 10px。
- **Publish Gate:** 只有 A 至 W、988 格、28 根柱子、5 個出入口與信心門檻全部通過才可發布。
- **Responsive:** 720px 以下貼底並改為單欄預覽；主要發布動作固定在工作面板底部。

### Planning Data Import / Export

- **Phase:** P0 只開放復原用途的安全匯出；JSON／CSV 匯入、衝突預覽與寫入 UI 保留到 P2，一般介面目前不顯示匯入入口。
- **Boundary:** 「規劃資料」獨立面板只交換收藏群組、收藏、備註與行程，不包含瀏覽歷程或帳號憑證。
- **Export:** 支援版本化 JSON 與 CSV v1；CSV 對可能成為試算表公式的值安全轉義。
- **Import:** 使用者主動選擇 JSON／CSV 後先預覽新增、衝突、略過、錯誤與無法匹配社團；10 MiB 或 20,000 列以上整批拒絕，`source_url` 僅接受有效 HTTPS。
- **Commit:** 寫入前選擇保留目前資料、採用匯入資料或完整取代；確認前不得改變本機規劃，無法匹配的社團明確列出並略過。

## Do's and Don'ts

### Do:

- **Do** 讓搜尋、作品題材、攤位代碼與規劃狀態永遠比品牌裝飾更醒目。
- **Do** 使用固定三欄結構與明確斷點，1050px 處處理詳情覆蓋，760px 處重組一般使用者流程，720px 處重組管理面板。
- **Do** 使用一像素中性邊界、4/8/12/18/24px 節奏與 5/7/9/12/18px 圓角建立一致元件語彙。
- **Do** 為所有攤位狀態提供文字、描邊或圖形提示，確保色彩不是唯一線索。
- **Do** 讓收藏、下一站與路線形成同一套可回顧的規劃流程。
- **Do** 讓收藏分類同時顯示名稱與色彩，並在所有社團介面共用同一收藏元件。
- **Do** 為外部內容顯示提供者、內容類型、更新時間與原始來源連結。
- **Do** 使用 skeleton 或保留版面結構的狀態處理載入，不在內容中央放置孤立 spinner。

### Don't:

- **Don't** 做成行銷網站、活動宣傳頁、企業儀表板或過度裝飾的娛樂頁面。
- **Don't** 以大型形象視覺、空泛品牌文案或卡片堆疊取代實際的攤位與作品資訊。
- **Don't** 在圖片上疊互動按鈕；地圖必須由 SVG 向量元素直接承擔互動。
- **Don't** 使用大於一像素的彩色左側或右側條帶作為警告、卡片或清單裝飾。
- **Don't** 使用漸層文字、裝飾性 glassmorphism、彈跳動態或無狀態意義的動畫。
- **Don't** 為了風格重新發明搜尋、篩選、收藏、日期分頁或關閉按鈕等標準操作。
- **Don't** 在不同畫面重新設計同一種按鈕、輸入框、chip 或狀態提示。
- **Don't** 只用色點區分收藏分類，或讓收藏、行程與下一站互相隱性改寫。
- **Don't** 以同名搜尋結果自動合併社團、靜默覆寫本地資料，或隱藏外部內容來源。
- **Don't** 用純黑或純白建立新 token；所有中性色必須帶有深墨或暖紙色傾向。
