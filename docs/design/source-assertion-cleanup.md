# 原始碼斷言的等效覆蓋整理

本次為 2026-09-23 維護者要求的局部測試整理，從 `8fcceec` 開始。逐項移除已有行為覆蓋的斷言，不改產品行為、runner、必要 CI 或測試環境設定。#205 已結案，不將本次整理視為重新開啟該票或擴張其驗收。

## 移除對照

每列對應一處原始碼 assertion；名稱／片段是辨識原斷言的索引，不是新的實作要求。既有案例不整支刪除：同一案例內尚未等效覆蓋的斷言保留。

| 原測試 | 移除的比對 | 保留的行為證據 |
|---|---|---|
| organizer-entry | Vite `organizer: resolve(...organizer.html)` | `public-artifact` 檢查獨立 organizer entry chunk；`portal-organizer-entry` 開啟 built `/organizer` |
| organizer-entry | organizer HTML 的 `noindex, nofollow` | `portal-organizer-entry` 檢查 HTTP 回傳文件的 meta |
| organizer-entry | HTML 載入 `/organizer-main.tsx` | `portal-organizer-entry` 真正載入桌機工作區、等待建立活動按鈕 |
| organizer-entry | entry 原始碼出現 `OrganizerApp` | 同上；可重新命名元件但仍須真正掛載工作區 |
| organizer-entry | `請改用桌機` 存在於原始碼 | `portal-organizer-entry` 在 900px 實際顯示窄螢幕提示 |
| organizer-entry | `matchMedia("(min-width: 1040px)")` 寫法 | 同 journey 在 1440px 開啟工作區、900px 不提供 authoring；契約要求寬／窄畫面行為，未指定 1040 這個實作常數 |
| organizer-entry | `isDesktop ? <OrganizerWorkspace` JSX 寫法 | 同 journey 檢查窄螢幕沒有建立活動按鈕與活動列表 |
| organizer-entry | client 原始碼出現 `/api/organizer/events` | `portal-organizer-entry` 讀取活動；`portal-organizer-references` 真正建立、儲存、重讀活動 |
| organizer-entry | `場館與使用空間` 存在於原始碼 | `portal-organizer-references` 在活動項目 group 點選該項並編輯場館 |
| organizer-entry | `建立新場館` 存在於原始碼 | 同 journey 點擊該按鈕，驗證必填拒絕與成功建立／選取 |
| organizer-entry | `function GuidedTaskStation` 名稱 | 同 journey 依序完成活動名稱與來源、日期、場館任務，轉入建置冊 |
| organizer-entry | `儲存並切換` 存在於原始碼 | 同 journey 實際點擊未儲存 dialog 的該動作並等待拒絕訊息 |
| organizer-entry | `>取消<` JSX 字串 | 同 journey 從 dialog 取消回表單，繼續選取場館及空間 |
| organizer-entry | `"已儲存。"` 字面值 | 同 journey 檢查真正儲存後出現、再編輯時清除，並驗證儲存後重讀失敗可重試 |
| organizer-entry | `aria-label="活動項目"` JSX 字串 | 同 journey 透過具名 group 操作活動、場館、匯入與驗證項目 |
| organizer-entry | `A–K 區、L–W 區` 存在於原始碼 | 同 journey 在場館三層說明 group 檢查可見文字 |
| organizer-entry | `沒有分區` 存在於原始碼 | 同上，檢查第二個範例的可見文字 |
| organizer-entry | 三層說明的 `aria-label` JSX 字串 | 同 journey 必須透過該 accessible name 找到 group 才能檢查上述範例 |
| circle-portal-editor | `setHydrated(true)` 出現一次 | `portal-circle-claim` 延遲讀取時不得編輯，讀取成功後才解鎖；不綁定 state setter 的實作次數 |
| circle-portal-editor | `setHydrationError(errorMessage(error))` 寫法 | 同 journey 使 GET 回 503，必須出現載入失敗 alert |
| circle-portal-editor | `disabled={!hydrated || reviewOpen}` 寫法 | 同 journey 在延遲／失敗讀取時檢查欄位與提交停用；確認預覽時另檢查表單不可操作 |
| circle-portal-editor | 重試載入文案存在於原始碼 | 同 journey 點擊真正的重試按鈕，驗證第三次 GET 與恢復編輯 |
| circle-portal-editor | 禁止 `.catch(() => setFields({}))` 寫法 | 同 journey 的初次讀取失敗必須持續停用並可重試，不得把空欄位當作已載入而開放編輯 |
| circle-media-degradation | result card 的 `resultWithMedia` 條件 JSX | `reader-thumbnails` 量測實際 grid：無圖欄數少於有圖，有圖成功／失敗的欄數相同 |
| circle-media-degradation | `.resultWithMedia { grid-template-columns:58px` 寫法 | 同上；保護是否保留媒體欄，不固定欄寬或 CSS 排版 |

合計：**25 處 assertion**，organizer 18、circle editor 5、media 2。不新增 browser journey，也不改動其斷言來配合刪除。

## 核對後保留的缺口

- Organizer 表單送出的 login audience：browser 的 `signIn` helper 直接呼叫 API，沒有測 UI 寄信按鈕，不能代替原 source guard。
- Reader 不宣傳 organizer 入口：現有 journey 只 fetch 首份 HTML，無法攔到 client-rendered 的新連結；保留 source guard。
- Organizer 未儲存導覽、進度計數、儲存／後續 callback 順序、來源欄位、匯入列修正／排除／換檔清除，以及尚未逐項觀察的文案與 CSS：已有 journey 的部分操作不足以覆蓋每種失敗，維持原斷言。三層場館說明也保留實際場館名稱與「不是展區」的斷言。
- 社團 autosave：browser 驗證的是明確提交後重讀，沒有模擬 preview 失敗後 local draft 仍保存；保留 hydrated guard 與 effect 依賴保護。
- 社團 creatorTypes 多選、單選欄位替換、活動後公開狀態與失敗還原、刪除摺疊、圖片欄位、CSS、管理者靜默 refresh：現有 ageRatings／claim 流程不能代表這些獨立保護。
- 空圖片容器與詳情幾何：browser 只證明 full-details 沒有 img，沒有證明空 gallery frame／result span 不存在、詳情沒有空欄、portal container query 或直幅圖高度正確；這些 source guards 保留。
- modal-focus、Service Worker cache 策略、portal transport 腳本與 local portal runbook guards 沒有取得等效行為證據，本次不改。授權、資料完整性、pin／snapshot、retention 等整合測試維持。

這份對照是本次變更的驗收證據，不是新的排程或測試治理流程。保留項不自動產生新 issue。

## 驗證

- Node `24.20.0`、npm `11.19.0`；worktree 自行 `npm ci`，使用其 fixture build。
- 三個調整檔案與 `public-artifact`：31/31 通過。
- `reader-thumbnails` 3、`portal-organizer-entry` 4、`portal-organizer-references` 11、`portal-circle-claim` 10 checks 通過；journey 程式及斷言均未修改。
- ESLint、`tsc --noEmit --incremental false` 通過。
- Browser 在獨立 worktree 的 `127.0.0.1:8793` Pages runtime、本機 D1／收信槽執行；原工作區的 8788 portal 未動。僅暫存啟動程式調整本機 port／thumbnail origin，不修改專案 launcher 或設定。
- 全套 Node 測試與獨立 review：執行中，完成後補記。
