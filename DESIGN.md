---
name: "場刊 Map"
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

# Design System: 場刊 Map

## Overview

**Creative North Star: "攤位作戰桌"**

介面是一張在展前被反覆攤開、標記與修訂的作戰桌。使用者需要在大量社團中迅速搜尋作品、比較題材、收藏攤位並安排下一站。設計必須讓工具本身退後，讓社團內容、地圖位置與規劃狀態站到前景。

最終方向種子為 `local-extension-c`。整體採明亮、低彩度、紙張感的工具外殼；高密度不是壓縮一切，而是建立固定欄位、可預測的層級與精準的資料字體。桌機把規劃工具、向量地圖、詳細資訊／行程並置，手機則以四頁籤讓地圖與當前工作保持在同一畫面。

這不是行銷網站、活動宣傳頁、企業儀表板或過度裝飾的娛樂頁面。大型形象視覺、空泛品牌文案與卡片堆疊都不得取代實際的攤位與作品資訊。

**Key Characteristics:**

- 高密度但每一層都有固定位置與可掃讀節奏。
- 地圖與社團詳細資訊雙向定位，任何選取都必須在兩側同步表達。
- 同一筆社團資料依清單、詳細資訊與地圖情境呈現不同密度，但欄位語意、來源與規劃狀態維持一致。
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

桌機工作區採三欄：一般模式由左欄承載搜尋／篩選，中欄保留可平移縮放的 SVG 地圖，右欄容納攤位詳細資訊與一份精簡當日行程；導航模式則把含購物項目與預算的完整行程移到左欄，右欄只保留攤位詳細資訊，不同時顯示第二份行程。寬度低於 1050px 時右欄成為地圖右側浮層；760px 以下隱藏左右欄，改用可上下拖曳的底部工作面板承載「篩選／結果／詳細資訊／行程」四頁籤，地圖持續留在主畫面。「資料管理」固定在頂部「關於」旁，管理對話框在手機採貼底模式；地圖 authoring 不屬於公開 Pages 版面。

全域間距使用 4、8、12、18、24px 節奏。桌機工作區高度扣除 130px 導覽列；手機底部面板提供精簡、半展開、完整三段高度：精簡只保留拖曳把手與四頁籤，半展開不超過約 44vh，完整展開不超過約 82vh。搜尋結果與社團詳細資訊可在三段間上下拖曳，半展開詳細資訊省略圖片、外部連結與來源摘要，以保留可操作地圖視野。

**The Three-Zone Rule.** 桌機永遠保留「規劃／探索、地圖、詳情／行程」三個任務區；中型畫面可覆蓋詳情，但不得移除地圖上下文。

**The Four-Tab Rule.** 手機只使用篩選、結果、詳細資訊、行程四個工作頁籤；未選攤位時詳細資訊頁籤停用，不建立第五種導航模型。再次點擊目前頁籤可收合為精簡模式，拖曳把手或點擊把手可切換半展開與完整高度。

## Elevation & Depth

系統預設扁平，以暖色調表面差、一像素結構線與固定欄位建立深度。陰影只在真正離開基準平面的元件出現，例如地圖紙張、浮動控制器、桌面詳情浮層、管理面板與暫時路線提示。

### Shadow Vocabulary

- **控制器微浮起** (`0 4px 14px #2733291f`): 地圖縮放控制與小型浮動工具。
- **地圖紙張** (`0 7px 24px #202a3526`): SVG 場館平面與工作區中的主要紙張。
- **詳情浮層** (`0 14px 40px #2631293a`): 1050px 以下覆蓋地圖的社團詳情。
- **管理工作面板** (`0 28px 80px #11182066`): 僅供管理匯入的最高層面板。
- **焦點環** (`0 0 0 3px #dfe8e3`): 搜尋與表單欄位的鍵盤焦點。

**The Portal Rule.** 對話框必須掛到文件根層，不留在觸發它的面板裡。地圖縮放列與行動工作台各自建立 stacking context，掛在裡面的對話框在 390px 下會被它們蓋住——這不是 z-index 調得不夠大，是層級歸屬錯了。

**The Flat-By-Default Rule.** 靜止內容不得靠陰影區分群組。先使用間距、表面色與一像素邊界；只有覆蓋、浮動或互動回饋才能增加陰影。

**The No Decorative Glass Rule.** 透明與模糊只允許在管理面板的遮罩與黏著標頭，作用是保留上下文，不得用於一般卡片。

## Shapes

介面以小幅圓角和一像素結構線維持工具感。資料 chip 與攤位格使用 5px，工具控制使用 7px，表單與狀態群組使用 9px，地圖紙張與一般面板使用 12px；只有貼底工作面板與管理對話框使用 18px。圓形只保留給關閉、說明、指南針等已熟悉的單一圖示操作。

**The Radius-Follows-Layer Rule.** 元件越接近資料層，圓角越小；18px 只屬於離開頁面基準層的對話框與行動面板。

## Copy

對外文案採**最少必要資訊**，預設是少寫。一件事實不會因為它為真、資料模型裡有、方便稽核、技術上相關或容易解釋，就該被顯示。決策脈絡見 [ADR-0024](docs/adr/0024-user-facing-copy-uses-minimum-necessary-disclosure.md) 與 [ADR-0036](docs/adr/0036-provenance-labels-name-the-source-not-its-trust-level.md)。

只顯示能實質幫助使用者做到下列其中一件事的資訊：

- 理解自己正在看什麼；
- 做出決定；
- 執行一個動作；
- 理解一項重要的限制或後果。

**The Removal Test.** 刪掉一句話後，如果使用者的理解與行動都沒有改變，就刪掉它。

### Values Over Explanations

用精簡標籤與事實值，不用解釋性散文。

- **可以：** `主辦單位`、`Fancy Frontier 47`、`匯入 2026.08.21`、`原始來源`、`由社團填寫`、`最後更新 2026.08.27`。
- **不可以：** `此資料來自主辦單位，可供核對`、`此內容由社團本人自行提供`、`本站尚未驗證此資料`、`點擊此處可查看原始資料來源`。

版面結構、標籤、連結與日期本身就要把這些事實講完，不另外附加說明。

### Plain Words, No Programming Knowledge

介面文案一律假定讀者沒有任何程式設計知識，主辦單位工作區這類只有少數人使用的內部工具也一樣——使用它的是活動主辦人員，不是工程師。

把資料模型、版本控制與流程實作的詞彙翻成使用者自己的話：

- **可以：** `編輯中`、`待修正清單`、`第 3 版`、`活動代碼`、`場館空間 ID`、`工作表`、`負責人`、`協作者`。
- **不可以：** `引導中`、`目前阻擋項`、`Revision 3`、`eventId`、`Venue-space ID`、`Worksheet`、`Owner`、`Editor`、`scope`、`mapping`、`metadata`、`immutable`、`API`。

翻譯是換詞，不是加解釋：`儲存` 取代 `儲存 revision`，而不是改寫成一段說明版本紀錄如何運作的散文。欄位意義真的看不出來時，一行短句就夠。

技術詞彙留在程式碼、型別、契約文件與 `CONTEXT.md`，不出現在畫面上。

### Internal Process Stays Internal

除非使用者需要，否則不呈現內部或維運中繼資料：驗證流程、審核狀態、匯入方法、同步細節、內部 provenance 術語、信心或信任標籤、維護責任歸屬、實作細節與資料 pipeline 行為。

內容由社團填寫時，`由社團填寫` 就夠了。不再補充它是自述、未驗證、未經獨立確認，或由社團自行負責。

**The No Redundant Provenance Rule.** 除非那個區分會實質改變使用者的判讀或行動，否則不加入「可核對」、「可追溯」、「已驗證」、「主辦來源」、「官方來源」、「自述」、「尚未驗證」、「僅供參考」這類措辭。有原始連結時，`原始來源` 這個標籤就足夠。

### No Defensive Disclosure

不為了預防而加入法律、資安、隱私或維運者免責聲明。預設避免的例子：`未經法律專業人士審閱`、`非正式法律意見`、`本站不保證資料正確`、`使用者應自行判斷`、`本站不負相關責任`。

一般網頁實作的技術後果——IP 傳輸、HTTP 標頭、DNS、CDN、快取與 referrer 行為——不寫進介面，除非該行為不尋常且對使用者有實質影響。

**The Reduction-Is-Reduction Rule.** 刪掉多餘資訊後不得用別的東西補回來：不新增輔助文字、tooltip、徽章、括號註記、警告圖示或說明副標。減少就是減少。

### Copy Hierarchy

決定什麼該進介面時，依序排：

1. 實際內容或值。
2. 目前可用的動作。
3. 相關日期或狀態。
4. 實質的警告或限制。

其餘一般都省略。

**The Material-Risk Exception.** 下列事項不得為了精簡而隱藏：資安、敏感資料處理、破壞性或不可復原的操作、非預期的第三方資料分享、付款或帳務、使用者資料遺失，以及法律要求的揭露。它們仍要講清楚，但只出現在使用者需要它的那一步。

### Copy Review

修改既有頁面時，主動刪除不必要的對外文字。特別找：對顯而易見標籤的解釋、provenance 評論、稽核導向措辭、防禦性免責、推測性警告、實作細節、重複的中繼資料，以及只為了展示透明度而存在的文字。

問：**這段文字不在的話，使用者會有什麼不同做法？** 答案是「沒有」就刪掉。

## Components

元件語氣是克制、精準、工具優先。互動元件必須具有 default、hover、focus-visible、active、disabled 與 loading 狀態；任何資料狀態不可只靠顏色表達。

本章描述現行實作。尚未實作的 minimap、OAuth、使用者帳號、雲端同步與多人協作不得出現在一般操作流程中。社團自助維護所需的登入只存在於獨立入口 `/circle`，不得滲入一般參觀者的瀏覽、收藏或行程流程。公開閱讀端的「使用說明」集中說明搜尋、地圖、規劃與備份，並明說網頁尚未提供匯入；局部操作附近仍保留直接、可執行的提示。

> **本文只管視覺與版面。** 功能行為、資料模型、URL 參數與驗收條件在 [`docs/contracts/`](docs/contracts)，不在這裡重複。同一條規則只有一個家。

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
- **Suggestion Popover:** 浮動建議最多六筆，支援方向鍵、Enter、Escape 與點按；建議層使用工作面板的表面色與一像素邊界，不另建視覺語言。
- **Draft Panels:** 需要草稿的多條件面板使用「套用／取消」按鈕組，兩者視覺重量不同；單一排序類控制立即生效，不放按鈕。
- **Applied Conditions:** 已套用條件以文字 chip 顯示在結果區上方，每個 chip 自帶清除操作。

> 搜尋範圍、結果量、空結果與分級規則見[搜尋、篩選與顯示設定契約](docs/contracts/search.md)。

### Navigation

- **Style:** 頂部列承載活動、搜尋與品牌；第二列承載日期與展區。active 日期使用底部 3px 珊瑚指示，文字同時轉為深墨色。
- **Desktop:** 一般模式左欄固定搜尋與篩選、中欄固定地圖、右欄展示詳情與精簡行程；導航模式左欄改為完整行程與購物規劃，右欄只展示詳情。
- **Mobile:** 760px 以下改為單欄頂部列、三等分日期與展區選擇，並以「篩選／結果／詳細資訊／行程」四頁籤承載工作內容。
- **State:** 當前狀態同時使用位置、文字重量與色彩，不得只靠色彩。
- **Area Switcher:** 地圖標題顯示活動定義的場館名稱與目前展區標籤。FF47 的展區全在同一個場館內，`areaMode` 為 `single`，因此固定顯示全館、不出現展區切換控制。

> 可分享的檢視狀態、URL 參數與恢復規則見 [URL 檢視狀態契約](docs/contracts/url-state.md)。

### Circle Surfaces

同一筆社團資料在三種介面的**版面**規則。欄位內容、資料投影與來源標示規則見[社團目錄契約](docs/contracts/circle-catalog.md)。

- **List Card:** 用於快速掃讀，最多一張代表圖，收藏控制固定在卡片同一位置。
- **Full Detail:** 有媒體時桌機使用左側媒體幻燈片與右側獨立捲動的資訊欄；760px 以下改為媒體在上、資訊在下的單欄順序。切換控制與圖片來源置於影像之外。**沒有媒體時整個媒體區收起，桌機改為單欄本文**，不留空框或佔位圖——縮圖只剩社團自填一個來源，這是常態。
- **Map Side Panel:** 桌機為右欄；1050px 以下成為地圖上的右側浮層；760px 以下由底部工作面板的「詳細資訊」頁籤承載，面板不獨占整個畫面。
- **Media Shortcut:** 側欄代表圖是**純圖片**，整張是開啟完整詳情的可聚焦按鈕。圖片上不得疊加作品、販售、攤位、DAY、提示文字或其他互動控制；關閉與收藏按鈕也離開圖片表面。
- **Empty Fields:** 缺少的欄位直接省略，不使用空白卡片或虛構內容補位。

### Map Canvas

地圖的**視覺語彙**。互動、鍵盤、縮放與座標契約見[活動地圖契約](docs/contracts/event-map.md)。

- **Canvas:** 地圖工作區使用 22px 格線提示可拖曳座標空間；SVG 場館使用同一 viewBox 保存攤位、柱子與出入口。
- **Slots:** 未配置攤位低對比；有社團的攤位採分類色淡底；selected 使用實色與 3px 深色描邊；favorite 加入珊瑚圓點；next 加入深墨箭頭。**任何狀態都必須有形狀或文字補充，不得只靠顏色。**
- **Controls:** 縮放、重設與指南針固定在地圖邊緣，不跟隨 SVG 縮放。
- **No HTML Overlay:** SVG 元素本身承擔互動，禁止在圖片上疊 HTML 按鈕。
- **Selection:** 地圖畫布及其中所有文字不得被拖曳選取。
- **User-facing Name:** 一般介面與輔助科技名稱使用「社團攤位配置圖」或「活動地圖」；「向量」只屬於實作技術，不顯示為地圖名稱。

### Planning Surfaces

收藏、行程與導航模式的**呈現**規則。資料模型、狀態轉移與同步契約見[收藏與走訪規劃契約](docs/contracts/planning.md)。

- **Group Label:** 所有色點旁都要顯示群組名稱。關閉色彩後仍須能辨識每筆收藏所屬群組。
- **Action Separation:** 收藏、加入行程、設為下一站與已走訪的動作標籤必須分開，不得共用同一個按鈕或暗示彼此連動。
- **Undo:** 取消收藏後顯示七秒 Undo 提示，不因有備註或分類而改變呈現。
- **Route Ordering:** 每日行程可直接拖曳，同時保留可聚焦的往前／往後按鈕。
- **Orphans:** 未匹配的收藏與行程在資料管理介面可見，顯示 ID、備註與狀態，並允許個別移除或匯出。
- **Navigation Mode:** 桌機左欄改為完整行程、購物項目與預算，右欄只保留詳情，不同時顯示第二份行程。手機隱藏重複的發布 revision 與下一站浮條，保留可辨識的地圖視野。

### Source Labels

- **Source Label:** 外部圖片、介紹與連結旁顯示提供者名稱或圖示、內容說明與 `原始來源` 連結；不得呈現無來源圖片。
- **Disclosure:** 來源以中性標籤呈現，**不以官方標誌、語氣或版面權重暗示已獲主辦確認**；標籤只寫來源，不附加驗證狀態或信任措辭（[ADR-0036](docs/adr/0036-provenance-labels-name-the-source-not-its-trust-level.md)）。
- **Degradation:** 來源失效時保留本地核心資訊並以文字說明外部內容暫不可用，不留空框。

### Icon System

- **Source:** 介面圖示統一由 `UiIcon` 輸出內嵌 SVG，使用 `currentColor`、圓端線條與 24px viewBox；不得混入 emoji、icon font 或另一套筆畫語言。
- **Semantics:** 純裝飾圖示設為 `aria-hidden` 且不可聚焦；只有圖示的按鈕必須由按鈕本身提供可讀 `aria-label`。
- **Map Marks:** 收藏、行程、下一站與已走訪直接以 SVG 圓點、箭頭或勾線呈現，並由可讀攤位名稱和狀態文字補足，不只依賴顏色。

### Keyboard and Gesture Access

- **Global Search:** `Command/Ctrl + K` 聚焦搜尋欄；畫面上的快捷鍵提示在手機隱藏。
- **Focus Ring:** focus-visible 使用 3px 低彩度焦點環，禁止只移除 outline。
- **Modal Lifecycle:** 對話框開啟後聚焦標題或第一個適當控制；Tab／Shift+Tab 留在 modal 內；Escape、關閉按鈕或遮罩關閉後焦點回到原觸發按鈕。被遮住的背景控制不可取得焦點。
- **Motion:** `prefers-reduced-motion` 時停用轉場；拖曳與縮放維持直接跟手，不加入彈性或慣性動畫。

> 地圖的 roving focus、方向鍵移動與觸控手勢契約見[活動地圖契約](docs/contracts/event-map.md#互動契約)。

### Loading States

- **Shell First:** 首屏必須先畫出頂部列、日期、篩選與面板結構。
- **Skeleton:** 搜尋結果在資料載入前顯示**保留版面的 skeleton** 與「正在讀取社團資料…」，不得以空白畫面或孤立 spinner 代替。
- **Filter Vocabulary:** 篩選選項屬於活動定義，必須在資料抵達前就可見；只有依賴資料的計數可以稍後補上。
- **Failure:** 讀取失敗時保留介面結構，明確說明是社團資料讀取失敗並提示重新整理；**不得偽裝成「查無結果」**。

> payload 邊界、Service Worker 策略與快取標頭見[資料傳輸與離線契約](docs/contracts/delivery-and-offline.md)。

### Circle Portal Surfaces

社團自助控制面在 `/circle`，與閱讀端**視覺分離**。身分、認領、可編輯範圍與退出機制見[社團自助控制面契約](docs/contracts/circle-portal.md)。

- **Separate Entry:** 閱讀端不得出現登入介面或任何指向寫入操作的控制。
- **Locked Fields:** 不可編輯的欄位以唯讀樣式呈現並說明原因，不用 disabled 輸入框假裝「暫時不能改」。
- **Preview Parity:** 儲存前預覽必須重用閱讀端的社團詳細資訊元件，否則預覽會與實際呈現漂移。
- **Attribution Badge:** 社團自填內容以 `由社團填寫` 中性標示，**不得以版面權重暗示已獲主辦確認**；不再追加自述、未驗證或責任歸屬說明。
- **Admin Separation:** 管理功能與社團自己的編輯區視覺分離，管理操作明確標示並集中處理。
- **Contributor Separation:** 地圖貢獻角色、私人草稿與審閱區只對已授權帳號呈現；介面必須持續說明「核准／匯出候選不等於公開發布」。

### Local Authoring Surfaces

地圖 authoring 只在本機環境。完整流程見[地圖 authoring runbook](docs/runbooks/map-authoring.md)。

- **Not Public:** 公開 Pages 介面不得出現檔案欄位、管理入口或寫入 route。公開站讀取失敗只說明公開資料錯誤，不提供管理修復入口。
- **Side-by-side Preview:** 原圖與向量結果並列，摘要先呈現辨識信心、排數、攤位格、柱子與出入口。
- **Source Choice:** 既有 revision、重新匯入配置圖與空白地圖是三個可辨識的起點；空白地圖不得繼承先前圖片的來源說明或方向資訊。
- **Responsive:** 720px 以下貼底並改為單欄預覽，主要發布動作固定在工作面板底部。**此規則不增加任何公開 Pages route。**

## Do's and Don'ts

### Do:

- **Do** 讓搜尋、作品題材、攤位代碼與規劃狀態永遠比品牌裝飾更醒目。
- **Do** 使用固定三欄結構與明確斷點，1050px 處處理詳情覆蓋，760px 處重組一般使用者流程，720px 處重組管理面板。
- **Do** 使用一像素中性邊界、4/8/12/18/24px 節奏與 5/7/9/12/18px 圓角建立一致元件語彙。
- **Do** 為所有攤位狀態提供文字、描邊或圖形提示，確保色彩不是唯一線索。
- **Do** 讓收藏、下一站與路線形成同一套可回顧的規劃流程。
- **Do** 讓收藏分類同時顯示名稱與色彩，並在所有社團介面共用同一收藏元件。
- **Do** 為外部內容顯示提供者、內容類型、更新時間與原始來源連結。
- **Do** 讓標籤、值、連結與日期自己把事實講完；能刪掉的說明就刪掉。
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
- **Don't** 在介面加入 provenance 評論、稽核措辭、防禦性免責，或只為展示透明度而存在的文字。
- **Don't** 用純黑或純白建立新 token；所有中性色必須帶有深墨或暖紙色傾向。
