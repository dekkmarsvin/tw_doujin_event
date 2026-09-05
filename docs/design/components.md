# 元件與介面規格

各介面表面的現行視覺規格。色彩、字體、層級與圓角的系統規則在 [`DESIGN.md`](../../DESIGN.md)；文案規則在 [對外文案](./copy.md)；功能行為、資料模型與驗收條件在 [`../contracts/`](../contracts)。


元件語氣是克制、精準、工具優先。互動元件必須具有 default、hover、focus-visible、active、disabled 與 loading 狀態；任何資料狀態不可只靠顏色表達。

本章描述現行實作。尚未實作的 minimap、OAuth、使用者帳號、雲端同步與多人協作不得出現在一般操作流程中。社團自助維護所需的登入只存在於獨立入口 `/circle`，不得滲入一般參觀者的瀏覽、收藏或行程流程。公開閱讀端的「使用說明」集中說明搜尋、地圖、規劃與備份，並明說網頁尚未提供匯入；局部操作附近仍保留直接、可執行的提示。

> **本文只管視覺與版面。** 功能行為、資料模型、URL 參數與驗收條件在 [`docs/contracts/`](../contracts)，不在這裡重複。同一條規則只有一個家。

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
- **Ask When The Value Exists:** 能從既有資料推導的欄位不放在初始設定要人手打；等資料進來後由系統推導，把結果呈現出來讓使用者核對與挑錯（例如展區由匯入的攤位名單決定）。推導結果以唯讀欄位呈現，錯誤在推導的那一步指出要修的是來源資料還是設定。
- **Fixed Value Sets:** 值域固定的欄位一律用下拉選單，不用自由輸入，並在選單下方預覽這個選擇的後果（例如地圖模板能否自動辨識配置圖、存檔時依什麼檢查）。既有資料中不在清單內的值原樣保留為額外選項，不靜默改寫。
- **Worked Example Before Data:** 需要外部檔案的匯入介面在還沒選檔時，呈現一份以該活動自己的值寫成、而且可下載的範例表，不用空白畫面或格式說明散文。範例要能被同一個介面讀回來，否則它教的是錯的格式。
- **Grouped Controls Get A Border:** 一個欄位需要兩個以上控制項才能填完時（例如「來源欄位／固定值」這種先選方式再給值的組合），整組放進一張有邊界的 `fieldset`，標題用 `legend`，每個控制項各有自己的小標。多欄網格裡並排的欄位若只靠間距分隔，會被橫向讀成表格的兩列。單一控制項的欄位維持 `label`，只套同一張卡片的外觀。

> 搜尋範圍、結果量、空結果與分級規則見[搜尋、篩選與顯示設定契約](../contracts/search.md)。

### Navigation

- **Style:** 頂部列承載活動、搜尋與品牌；第二列承載日期與展區。active 日期使用底部 3px 珊瑚指示，文字同時轉為深墨色。
- **Desktop:** 一般模式左欄固定搜尋與篩選、中欄固定地圖、右欄展示詳情與精簡行程；導航模式左欄改為完整行程與購物規劃，右欄只展示詳情。
- **Mobile:** 760px 以下改為單欄頂部列、三等分日期與展區選擇，並以「篩選／結果／詳細資訊／行程」四頁籤承載工作內容。
- **State:** 當前狀態同時使用位置、文字重量與色彩，不得只靠色彩。
- **Area Switcher:** 地圖標題顯示活動定義的場館名稱與目前展區標籤。FF47 的展區全在同一個場館內，`areaMode` 為 `single`，因此固定顯示全館、不出現展區切換控制。

> 可分享的檢視狀態、URL 參數與恢復規則見 [URL 檢視狀態契約](../contracts/url-state.md)。

### Circle Surfaces

同一筆社團資料在三種介面的**版面**規則。欄位內容、資料投影與來源標示規則見[社團目錄契約](../contracts/circle-catalog.md)。

- **List Card:** 用於快速掃讀，最多一張代表圖，收藏控制固定在卡片同一位置。
- **Full Detail:** 有媒體時桌機使用左側媒體幻燈片與右側獨立捲動的資訊欄；760px 以下改為媒體在上、資訊在下的單欄順序。切換控制與圖片來源置於影像之外。**沒有媒體時整個媒體區收起，桌機改為單欄本文**，不留空框或佔位圖——縮圖只剩社團自填一個來源，這是常態。
- **Map Side Panel:** 桌機為右欄；1050px 以下成為地圖上的右側浮層；760px 以下由底部工作面板的「詳細資訊」頁籤承載，面板不獨占整個畫面。
- **Media Shortcut:** 側欄代表圖是**純圖片**，整張是開啟完整詳情的可聚焦按鈕。圖片上不得疊加作品、販售、攤位、DAY、提示文字或其他互動控制；關閉與收藏按鈕也離開圖片表面。
- **Empty Fields:** 缺少的欄位直接省略，不使用空白卡片或虛構內容補位。

### Map Canvas

地圖的**視覺語彙**。互動、鍵盤、縮放與座標契約見[活動地圖契約](../contracts/event-map.md)。

- **Canvas:** 地圖工作區使用 22px 格線提示可拖曳座標空間；SVG 場館使用同一 viewBox 保存攤位、柱子與出入口。
- **Slots:** 未配置攤位低對比；有社團的攤位採分類色淡底；selected 使用實色與 3px 深色描邊；favorite 加入珊瑚圓點；next 加入深墨箭頭。**任何狀態都必須有形狀或文字補充，不得只靠顏色。**
- **Controls:** 縮放、重設與指南針固定在地圖邊緣，不跟隨 SVG 縮放。
- **No HTML Overlay:** SVG 元素本身承擔互動，禁止在圖片上疊 HTML 按鈕。
- **Selection:** 地圖畫布及其中所有文字不得被拖曳選取。
- **User-facing Name:** 一般介面與輔助科技名稱使用「社團攤位配置圖」或「活動地圖」；「向量」只屬於實作技術，不顯示為地圖名稱。

### Planning Surfaces

收藏、行程與導航模式的**呈現**規則。資料模型、狀態轉移與同步契約見[收藏與走訪規劃契約](../contracts/planning.md)。

- **Group Label:** 所有色點旁都要顯示群組名稱。關閉色彩後仍須能辨識每筆收藏所屬群組。
- **Action Separation:** 收藏、加入行程、設為下一站與已走訪的動作標籤必須分開，不得共用同一個按鈕或暗示彼此連動。
- **Undo:** 取消收藏後顯示七秒 Undo 提示，不因有備註或分類而改變呈現。
- **Route Ordering:** 每日行程可直接拖曳，同時保留可聚焦的往前／往後按鈕。
- **Orphans:** 未匹配的收藏與行程在資料管理介面可見，顯示 ID、備註與狀態，並允許個別移除或匯出。
- **Navigation Mode:** 桌機左欄改為完整行程、購物項目與預算，右欄只保留詳情，不同時顯示第二份行程。手機隱藏重複的發布 revision 與下一站浮條，保留可辨識的地圖視野。

### Source Labels

- **Source Label:** 外部圖片、介紹與連結旁顯示提供者名稱或圖示、內容說明與 `原始來源` 連結；不得呈現無來源圖片。
- **Disclosure:** 來源以中性標籤呈現，**不以官方標誌、語氣或版面權重暗示已獲主辦確認**；標籤只寫來源，不附加驗證狀態或信任措辭（[ADR-0036](../adr/0036-provenance-labels-name-the-source-not-its-trust-level.md)）。
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

> 地圖的 roving focus、方向鍵移動與觸控手勢契約見[活動地圖契約](../contracts/event-map.md#互動契約)。

### Loading States

- **Shell First:** 首屏必須先畫出頂部列、日期、篩選與面板結構。
- **Skeleton:** 搜尋結果在資料載入前顯示**保留版面的 skeleton** 與「正在讀取社團資料…」，不得以空白畫面或孤立 spinner 代替。
- **Filter Vocabulary:** 篩選選項屬於活動定義，必須在資料抵達前就可見；只有依賴資料的計數可以稍後補上。
- **Failure:** 讀取失敗時保留介面結構，明確說明是社團資料讀取失敗並提示重新整理；**不得偽裝成「查無結果」**。

> payload 邊界、Service Worker 策略與快取標頭見[資料傳輸與離線契約](../contracts/delivery-and-offline.md)。

### Circle Portal Surfaces

社團自助控制面在 `/circle`，與閱讀端**視覺分離**。身分、認領、可編輯範圍與退出機制見[社團自助控制面契約](../contracts/circle-portal.md)。

- **Separate Entry:** 閱讀端不得出現登入介面或任何指向寫入操作的控制。
- **Locked Fields:** 不可編輯的欄位以唯讀樣式呈現並說明原因，不用 disabled 輸入框假裝「暫時不能改」。
- **Preview Parity:** 儲存前預覽必須重用閱讀端的社團詳細資訊元件，否則預覽會與實際呈現漂移。
- **Attribution Badge:** 社團自填內容以 `由社團填寫` 中性標示，**不得以版面權重暗示已獲主辦確認**；不再追加自述、未驗證或責任歸屬說明。
- **Admin Separation:** 管理功能與社團自己的編輯區視覺分離，管理操作明確標示並集中處理。
- **Contributor Separation:** 地圖貢獻角色、私人草稿與審閱區只對已授權帳號呈現；介面必須持續說明「核准／匯出候選不等於公開發布」。

### Local Authoring Surfaces

地圖 authoring 只在本機環境。完整流程見[地圖 authoring runbook](../runbooks/map-authoring.md)。

- **Not Public:** 公開 Pages 介面不得出現檔案欄位、管理入口或寫入 route。公開站讀取失敗只說明公開資料錯誤，不提供管理修復入口。
- **Side-by-side Preview:** 原圖與向量結果並列，摘要先呈現辨識信心、排數、攤位格、柱子與出入口。
- **Source Choice:** 既有 revision、重新匯入配置圖與空白地圖是三個可辨識的起點；空白地圖不得繼承先前圖片的來源說明或方向資訊。
- **Responsive:** 720px 以下貼底並改為單欄預覽，主要發布動作固定在工作面板底部。**此規則不增加任何公開 Pages route。**
