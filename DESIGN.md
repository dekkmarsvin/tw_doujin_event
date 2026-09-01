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

對外文案規則獨立成篇：[對外文案](docs/design/copy.md)。

## Components

各介面表面的元件規格獨立成篇：[元件與介面規格](docs/design/components.md)。

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
