# 社團自助控制面契約

參展社團在獨立入口 `/circle` 維護**自己的**公開資料。它**補充**而非取代人工快照發布：主辦提供的攤位與社團身分仍由版本控制的快照決定，社團填寫的內容是疊加其上、可即時撤下的補充層。

**實作**：[`app/circle-portal/`](../../app/circle-portal)、[`app/admin/admin-review-queue.tsx`](../../app/admin/admin-review-queue.tsx)、[`app/admin/claim-batch.ts`](../../app/admin/claim-batch.ts)、[`app/circle-portal-handlers.ts`](../../app/circle-portal-handlers.ts)、[`app/circle-overrides.ts`](../../app/circle-overrides.ts)、[`app/mail-letter.ts`](../../app/mail-letter.ts)、[`app/portal-crypto.ts`](../../app/portal-crypto.ts)、[`db/identity-repository.ts`](../../db/identity-repository.ts)、[`functions/`](../../functions)
**測試**：`tests/circle-portal-route.test.mjs`、`tests/admin-claim-batch.test.mjs`、`tests/circle-overrides.test.mjs`、`tests/identity-repository.test.mjs`、`tests/mail-letter.test.mjs`、`tests/portal-crypto.test.mjs`、`tests/portal-transport.test.mjs`
**部署與密鑰**：[部署 runbook](../runbooks/deployment.md)
**實作**：`app/admin/admin-notification-panel.tsx`、`app/review-notifications.ts`、`app/portal-mail.ts`、`app/review-notification-scheduler.ts`、`db/review-notification-repository.ts`、`functions/api/admin/notification-preferences.ts`、`workers/publication-dispatch`
**測試**：`tests/review-notifications.test.mjs`

> **活動範圍**：`/circle` 是跨活動共用入口，寫入面與公開讀取面都支援多活動；帳號跨活動、認領逐活動，`env.EVENT_ID` 只是請求沒有指名活動時的預設值（[ADR-0043](../adr/0043-the-circle-portal-is-event-agnostic.md)）。

> 本文的「登入」指**社團為了維護自己的資料**而登入。這與 [資料匯入契約](./data-import.md) 裡「使用者授權外部服務以便匯入」是相反方向的兩件事，後者仍屬 P2 且未實作。

## 公開入口與 preview 邊界

正式入口是 <https://map.kotoban.top/circle>，不在 Cloudflare Access 內；任何人都能到達登入表單，但 Turnstile、email 一次性連結、session、認領證據與管理者角色仍逐層限制實際操作。隱私告知、保存期限與刪除機制已隨公開入口上線。

Pull request 與不可變 preview deployment 位於 `*.tw-catalog.pages.dev`，繼續由 Cloudflare Access 保護。CI 使用 Service Auth token 穿過 Access 後，才執行隔離 preview D1 上的完整流程；人工測試則使用維護者身分登入 Access。production 公開、preview 閘控的決策見 [ADR-0029](../adr/0029-public-production-gated-preview.md)，驗證方式見[部署 runbook](../runbooks/first-time-setup.md#cloudflare-accessproduction-公開preview-閘控)。

## 入口分離

- **社團登入與編輯只存在於 `/circle`，不與閱讀端共用 bundle。** 閱讀端不得出現登入介面、寫入 route 或 session cookie 名稱，由 `tests/public-artifact.test.mjs` 以建置產物比對把關。
- **入口分離指的是程式邊界，不是把 `/circle` 藏起來。** 閱讀端必須有一處靜態指引說明參展社團可以來補充自己的資料並連向 `/circle`；目前在「使用說明」面板的「你是參展社團嗎？」段落，同樣由 `tests/public-artifact.test.mjs` 把關。第一次到站的社團成員只會看到閱讀端，沒有這個指引就等於沒有入口。連結是純靜態 `href`，不載入 Turnstile、不呼叫任何寫入 route，因此不牴觸上一條。
- 一般參觀者公開瀏覽、不需登入。社團登入**不介入**參觀者的收藏與行程。
- [主辦單位工作區](./organizer-workspace.md)的 `/organizer` 是第三個入口：與 `/circle` 共用帳號、session cookie 與本節的登入機制，但不共用 bundle，也不出現在公開導覽。
- `/admin` 是獨立且 noindex 的管理入口，沿用同一 session；沒有登入表單，未登入時連向 `/circle`。非管理者不載入管理內容。`/circle` 只保留管理者身分與管理連結，不掛載管理面板或發出其管理 API 呼叫。管理資產不進 Reader precache，Reader 不新增管理導覽。
- 社團入口不下載場刊：認領時的社團搜尋走 `/api/circle/search`，需要 session 且只回傳比對到的社團。

## 登入有效期

所有帳號的登入 session 統一自成功登入起有效 **7 天**，一般讀取與已授權的操作使用同一到期時間，沒有另外的近期登入期限。登入角色與活動授權仍逐次驗證。既有較長期限的 session 亦按原登入時間套用 7 天上限；操作與輪詢不自動續期，登出或撤銷立即失效。一次性登入連結維持 15 分鐘。

`verify` 與 `session` 回傳 `expiresAt`，`/circle` 與 `/organizer` 顯示該到期時間；頁面到期、回到前景時已到期，或 API 回 401 時，介面回到登入表單並提示重新登入。403 角色拒絕不視為登出。

## 索取登入連結需要通過真人驗證

`POST /api/auth/request-link` 是站上唯一不需要 session 就會產生外送郵件的路徑。它要求一枚 Cloudflare Turnstile token，由 `/circle` 的登入表單取得；決策見 [ADR-0016](../adr/0016-human-verification-guards-the-mailer.md)。

- **驗證在讀取 email 之前執行。** 驗證失敗回 `403` 並明說原因；這不破壞「不可枚舉」，因為結果與信箱是否存在無關。通過驗證之後的回應仍然一律是 `202`，不論該信箱是否已註冊、位址是否合法。
- **驗證失敗不消耗任何額度。** 每小時每信箱 5 次、每 IP 20 次的計數在驗證通過後才遞增，機器人打不到它，也打不到 D1 與郵件供應商。
- **驗證器不可達時視為未通過。** siteverify 逾時、非 2xx 或回應無法解析一律拒絕。登入連結可以一分鐘後再要一次；一個任何人都能驅動的寄信端點不行。
- **sitekey 由 `GET /api/auth/config` 供給，不編進 bundle。** 因此 preview 與 production 可以持有不同金鑰而共用同一份 build。
- 請求可帶 `audience`（`circle` 或 `organizer`，預設 `circle`）。它只決定信件內容與連結指向哪個入口，不改變驗證、額度或回應；`audience` 記在 `login_tokens` 上。
- **登入信同時寄出 HTML 與純文字兩份內容**，由 `app/mail-letter.ts` 產生。純文字版必須能單獨使用：登入連結自成一行，preview 收信槽只存這一份，E2E 從這裡取連結。有效時間以台灣時間寫出。
- Pages 登入／邀請及排程摘要共用 `sendPortalMail` 收件路由：啟用 D1 preview 時，測試收信槽優先於人工白名單，其餘地址拒絕且不回退 production。只有此模式的人工白名單路徑可記錄最多 300 字的 Mailgun 拒絕本文；production 不記地址或本文，即使殘留白名單設定也不能開啟。
- **Organizer 邀請是唯一由他人代為鑄造登入連結的路徑**，因此不走本節的 Turnstile，改由三道獨立預算限制，並以 `login_tokens.minted_by` 與本人自助索取分開計數。規則寫在[主辦單位工作區契約](./organizer-workspace.md#邀請制不能自助開活動)。
- Turnstile 的 script 只在 `/circle` 載入，CSP 也只在該路徑放寬，見[資料傳輸與離線契約](./delivery-and-offline.md#快取標頭)與 `public/_headers`。

## 從地圖接續認領

桌機社團面板與手機完整資訊底部的「認領／管理資料」連到 `/circle?event=<eventId>&circle=<circleId>`。這只是表單目的地，不宣告是否已認領，也不授予擁有權；公開閱讀端不查詢認領狀態。

- 索取社團登入連結時，請求的活動範圍與 `circleId` 一併帶到信件；僅保留可服務活動及該活動中存在的社團。信件固定指向本站 `/circle`，不接受任意轉址。
- 登入後使用受 session 保護的 `GET /api/circle/search?circle=<circleId>&event=<eventId>` 精確取得社團、可用佐證連結及 `claimed`，不下載完整場刊。`claimed` 只表示該活動已有通過的認領，不含審核中，也不指出擁有者。單一社團的答案與送出認領時的拒絕相同，但這個查詢不計入每日認領上限，也不建立認領或稽核紀錄。不存在時提供重新搜尋。
- 尚未持有該社團認領時預選認領表單；他人已通過認領時不顯示表單，改用與送件拒絕相同的說明；本人認領處理中時顯示進度，不重複送件；新送出的驗證碼與貼碼說明在清單更新後仍保留；本人已通過時提供資料管理入口，並將該編輯器列在其他社團之前。
- 切換活動不沿用另一場的社團；登入連結保留目的地，因此換分頁或裝置開信也能接續。所有寫入仍受既有逐活動 claim 授權。

## 身分與擁有權

**email 一次性連結只證明控制某信箱，不證明身分。** 認領必須另有證據：

| 證據 | 結果 |
|---|---|
| 帳號網域與 provider 為「官方網站」的社團連結 hostname 相符（沿用移除 `www.` 的比對） | 自動通過 |
| 社團在已登錄於場刊的可抓取連結上公開驗證碼 | 自動通過 |
| 其餘 | 一律人工審核 |

連結整合頁、社群及其他非「官方網站」provider 不參與 email 網域自動認領，即使網址相同也不例外；無效 URL 略過。可抓取的已登錄連結仍可走驗證碼流程，其他情況沿用人工審核。

**驗證碼只存在於第二層。** 人工審核不發驗證碼：管理者看的是 `evidence_url` 與 `evidence_note`，判斷依據是人工核對。介面在人工審核路徑不得索取驗證碼。

資料庫層保證**一個社團同時只有一位擁有者**。所有認領與撤下決策寫入稽核記錄。

**驗證碼遺失或過期由社團自己解決。** 明文驗證碼不保存（只留 hash），所以遺失後沒有可再顯示的東西；恢復路徑是**撤回自己仍在審核中的認領，再重新送出**，重送會發新的驗證碼。這條路不需要管理者介入。

- 只有 claim 本人可以撤回，且只有 `pending` 可以撤回。已通過的認領不能用撤回放棄擁有權，管理者已裁決的也不能改寫。
- 撤回會清掉 challenge hash，**舊驗證碼立即失效**。
- 一個帳號對同一活動同一社團只有一筆認領資料列（唯一索引）。重送沿用該列並保留其 id，稽核記錄因此不會斷；`created_at` 更新為重送當下。
- 因此**撤回不能用來繞過每日認領上限**：資料列仍在 24 小時窗內計數。
- 認領被自己撤回記為 `claim.withdrawn`，與管理者的 `claim.admin_reject`／`claim.admin_revoke` 分開。
- 送出重複認領時的錯誤訊息必須指出可執行的恢復動作，不能只說「你已經送出過」。

**公開與擁有權同生共死。** 社團補充資料是以「這個社團本人」的名義公開的，所以它只在該社團實際有人持有時出現在公開投影：`/data/events/:eventId/overrides.json` 只收目前存在**已通過認領**的社團。因此管理者撤銷一筆錯誤認領，該擁有者先前發布的內容**在同一個動作內立即停止公開**，不需要記得再執行一次「撤下」。

這是投影條件而不是資料列上的旗標，兩者的差別是實際的：撤銷不刪資料列，`previous_fields_json`、保存期限與稽核記錄都留著，之後由正確的社團完成認領時，內容依正常流程重新公開，不需要另一條復原路徑。前擁有者在撤銷後仍然不能寫入。

**自助刪除沿用這條鏈**（`DELETE /api/circle/:circleId/overrides`）。[ADR-0020](../adr/0020-self-service-deletion-reuses-the-existing-ownership-chain.md) 決定不為刪除另發「持有即代表授權」的編輯連結——既有的登入加已驗證認領已經更強，而 bearer 連結會被轉寄、留在網址列，且撤不回來。

- **「不顯示」與「刪除資料」是兩件事。** 前者（clear）寫入空值或 tombstone，資料列還在；後者刪掉資料列，`previous_fields_json` 一併消失。介面上分屬兩區，措辭不得混用。
- **刪除前顯示即將刪除的內容摘要。** pretix 在刪除前強制先匯出，本站是它的弱化版：沒有人應該在看不見標的的情況下按下去。
- **確認不得是單一按鈕，也不重寄郵件。** session 有效期 7 天，單一按鈕會讓一個久未使用的分頁抹掉全部內容；重寄郵件則會把不可逆的動作卡在送達率上。實作是把社團代號輸入一次——這條在伺服器端把關（`confirm` 必須等於該社團 id），不只是介面上的一道關。
- **擁有權掛在社團身分上，不掛在帳號上。** 移轉後新擁有者可以刪除前任寫的內容；`audit_log` 的 `override.deleted` 記下是**哪個帳號**做的，那是移轉之後唯一分得出誰做了什麼的依據。稽核不留下被刪除的內容。
- **自助刪除與到期自動清除刪掉同一組東西**，否則兩條路徑會留下不同的殘骸。這條由測試把關。

帳號本身也可自助刪除（`DELETE /api/account`）：登入中的非管理者必須輸入完整 email 確認。帳號、tokens、sessions、claims 與仍由該帳號擁有的補充資料一併刪除，公開文件同步更新，稽核個資塗銷但 action 與時間保留。管理者需先由另一位管理者移出名單。來信協助仍走維運信箱（[ADR-0019](../adr/0019-personal-data-requests-go-to-the-mailbox-not-the-issue-tracker.md)、[ADR-0027](../adr/0027-personal-data-lifecycle-and-account-deletion.md)）。

## 可編輯範圍

**可編輯，儲存後寫入公開 overlay**：販售資訊、筆名、連結、縮圖、主辦分類目錄中的一項社團主題（`circleCategory`），以及作品／標籤類欄位（`creatorTypes`、`ageRatings`、`workTypes`、`referencedWorks`、`specialTags`）。已開啟頁面的更新時機與尚未達成的一分鐘可見性要求統一見[資料傳輸契約](./delivery-and-offline.md#更新可見性)。

`creatorTypes` 與 `ageRatings`（可複選）、`workTypes`（選一項）也不是自由文字：選項是 `circle-overrides.ts` 的固定清單，公開端搜尋讀同一份。寫入驗證只檢查長度與筆數，不檢查是否屬於清單——同一個驗證函式也是讀取端守門，收緊會讓既有帶舊值的資料列整列從公開文件消失（[ADR-0051](../adr/0051-three-circle-facets-move-to-fixed-options.md)）。`referencedWorks` 與 `specialTags` 仍是自由填寫。

`ageRatings` 提供全年齡、R15、R18，可複選並逐項顯示，不推導最高分級。它描述**販售內容**，同時出不同分級的本子是真的。各個已選分級的搜尋都要命中；儲存與重開保留全部值。未知舊值仍顯示為額外選項，可保留或由社團移除，不因此丟掉整列 overlay；`specialTags` 維持自由填寫。

`circleCategory` 不是自由文字：控制面與寫入驗證共用 active event 的 `circleCategories`。選項集合來自主辦公開分類頁，但某社團選了哪一項仍是社團自述，不得標示為主辦認定。主辦 base 沒有逐社團分類，因此此欄的「繼承」在介面顯示為「尚未提供」。

**永不開放**：攤位、日期、`SourceLink`。

**社團名稱不可由社團編輯。** 它仍是與主辦公布攤位清單的比對鍵；但依 ADR-0010，名稱已不再參與 `circle.id`。名稱錯誤由管理者在**上游來源與 identity evidence registry** 更正。是否開放自行改名仍由 ADR-0007 管理，不能因 ID 穩定就順帶放寬。

`circle_name_key`、`circle_name_at_claim`、`source_row_at_claim` 保留為認領當時的稽核快照，不再用名稱推測或修復 identity。認領與補充資料一律以 `c-xxxxxx` 為鍵；舊 ID 的管理端 cutover 已隨相容路徑一併移除（[ADR-0013](../adr/0013-drop-the-legacy-circle-id-compatibility-path.md)）。

### 連結順序有語意

連結清單的順序**就是顯示順序**。地圖側欄只顯示前六個，其餘留在完整詳細資訊（見[社團目錄契約](./circle-catalog.md#呈現契約)），因此編輯器必須讓作者**看得到並改得動**這個順序，並說明第六個之後的界線在哪。

側欄是參觀者決定「要不要去這攤」的地方；把排序交給作者，等於把那個決定的依據交給最清楚的人。

### 欄位有三種狀態

每個可編輯欄位都明確區分三種狀態：

1. **沿用場刊**（畫面上寫「目前顯示場刊資料」）：override 不含該鍵，繼續使用 reviewed snapshot。
2. **社團自填**（畫面上寫「目前顯示你填寫的內容」）：override 含非空值，整組取代 snapshot；陣列不逐項合併。
3. **清除此欄**（畫面上寫「目前不顯示」）：空字串、空陣列或 thumbnail tombstone 明確移除 snapshot 的既有值。

編輯器必須顯示目前狀態，並提供回到場刊資料與不顯示這兩個動作（畫面上是「使用場刊資料」與「不顯示」）。**這三個詞是內部詞彙**：契約、程式與 D1 用 inherit／replace／clear，介面一律寫使用者看得到的結果（#197）。不得在送出前丟掉 tombstone，否則社團只能改寫、不能明確撤下自己先前提供的內容。

### 欄位上限

上限存在的理由是：**一個社團不能讓每位讀者下載的公開文件無限膨脹**。

| 欄位 | 上限 |
|---|---|
| `pen` | 80 字 |
| `saleInfo` | 2000 字 |
| `circleCategory` | 活動分類目錄中的一項；可留空 |
| 清單類欄位項目數 | 20 |
| 清單類單項長度 | 60 字 |
| 連結數 | 12 |
| 序列化後總長度 | 8192 bytes |

## 儲存前預覽

儲存會更新公開 overlay，讀者重新取得資料時即可讀到，因此送出前必須能預覽實際呈現。

`POST /api/circle/:circleId/preview` 以**閱讀端自己的投影元件**渲染草稿，唯讀、不寫入任何資料。預覽必須重用閱讀端元件，否則預覽會與實際呈現漂移。

社團補充內容欄位的發布只有一條寫入路徑：「預覽並送出」先讓 server preview 重新驗證擁有權、活動目錄與序列化上限，只有成功回傳的版本才能出現「確認儲存」。server preview 拒絕時不呼叫寫入端點，並保留原草稿與焦點脈絡。活動後退出與自助刪除是獨立的可逆／刪除動作，不屬於這條內容發布路徑。

草稿的即時預覽、server preview 與公開文件共用 `projectCircleDraft` 投影及閱讀端 `CircleDetails` renderer；草稿變更只重算 client projection，**不會自動送出**。確認頁可額外以「未提供」標示空白選填欄位，但不得把這些字寫入公開 projection。

嵌在預覽裡的是閱讀端元件，控制面的表單樣式不得延伸進去（`.previewFrame` 內的按鈕沿用閱讀端自己的樣式）：預覽要長得像刊出來的樣子，不是像表單。

### 未儲存的內容留在這台裝置上

編輯器很長，內容通常一次寫完，關掉分頁不該讓它全部消失。未送出的編輯逐社團自動存進這個瀏覽器的 `localStorage`，下次進編輯器帶回並顯示它是什麼時候寫的，附「改用已儲存的版本」一鍵丟棄。儲存成功或刪除整筆資料後即清除，與伺服器內容相同時也不保留。

「未送出的編輯」是那一次送出會寫進去的全部內容，不只欄位：代管圖片的上傳憑證也在同一次送出裡，因此要一起留下、一起丟棄。帶回其中一項卻悄悄換掉另一項，等於替社團改了它沒改的答案。

保留草稿只依賴編輯器讀到了資料列本身。即時預覽是另一個可以失敗的請求，失敗時編輯器照常編輯，因此不得拿它當保留草稿的條件。資料列本身讀取失敗時則兩邊都不做：沒有伺服器內容可比，把「與伺服器相同」當成結論會刪掉作者仍然握著的草稿。

編輯器在資料列讀取完成前顯示「正在載入已儲存內容，完成前無法編輯。」並停用欄位與「預覽並送出」。資料列讀取失敗時顯示可理解的錯誤與「重試載入已儲存內容」；重試會重新讀取，成功後才套用伺服器內容或本機草稿並開始自動保存。讀取失敗不清空欄位，也不刪除本機草稿。

它是**還沒送出的東西**，不是資料的第二份權威：不同步、不跨裝置，瀏覽器拒絕儲存時編輯器照常運作。

三段版面是同一條工作流，不是三種儲存語意：

- `<= 760px`：「預覽並送出」進入全畫面檢查頁，只能返回修改或確認儲存，沒有直接儲存動作。
- `761–959px`：表單保持單欄，以明確動作在同頁開啟可返回的檢查區。
- `>= 960px`：左側表單、右側 sticky 即時公開卡預覽；準備儲存時，右側切換成 server preview 確認。

## 標示

社團自填內容一律附 `provider: "由社團填寫"`、`contentType: "circle"`、`status: "unverified"` 的來源條目，且不提供偽造的原始來源連結。

來源列**只顯示 `由社團填寫` 與最後更新日期**：`status` 是資料欄位，不轉成「尚未驗證」之類的畫面措辭（[DESIGN.md](../../DESIGN.md#copy)、[ADR-0036](../adr/0036-provenance-labels-name-the-source-not-its-trust-level.md)）。

**不得以任何版面權重、措辭或官方標誌暗示已獲主辦確認。**

## 活動維度

`/circle` 服務這次部署的**每一個已發布活動**，不為第二場活動另建控制面，也不要求維護者改設定才能讓社團使用（[ADR-0043](../adr/0043-the-circle-portal-is-event-agnostic.md)）。

**帳號跨活動，授權逐活動。** magic link、session 與帳號刪除都不帶活動；認領、補充資料、代管縮圖與地圖草稿都帶。

同一帳號亦可在 `/organizer` 申請建置活動，資格、送件開關、私人結果與管理審核依[主辦工作區契約](./organizer-workspace.md#活動申請)。Session 的 `canApplyForEvent`／`hasEventApplications` 只決定申請介面可達，不是 Organizer grant；未核准者不能讀寫任何候選。帳號刪除同步清除 pending 申請並去識別化已審核決策，不變更正式活動內容。

- **請求指名活動**：控制面每一條 event-scoped route 讀 `?event=<eventId>`。指名的活動就是這次請求唯一的授權範圍。
- **沒有指名才用預設**：`env.EVENT_ID` 只是「請求沒帶 `event` 時用哪一場」的 migration fallback。**指名一個服務不到的活動不會退回預設**——那會把針對甲活動的寫入跑在乙活動上——而是 `404`。
- **服務範圍的定義與公開 overlay 相同**：這次部署有沒有該活動的靜態資料。控制面與閱讀端因此永遠對「有哪些活動」給同一個答案，不另立活動 registry。
- **新活動不需要改 `wrangler.jsonc`，也不需要為控制面另做一次部署**：活動隨自己的資料發布進同一次 build 就能被社團使用。
- **ownership 一律用請求指名的活動判斷**：甲活動的認領對乙活動的寫入是 `403`；同一帳號可以在不同活動各自持有認領，兩者是不同的資料列，互不改寫。
- **認領 id 也逐活動判斷**：認領 id 是全域的，請求的授權範圍不是。撤回、驗證與管理者裁決都先確認該筆認領屬於請求指名的活動，否則視為不存在（`404`）。少了這道檢查，甲活動的認領可以透過乙活動的控制面被撤銷，而被重建的是乙活動的公開文件——甲活動那份會留著已撤銷的內容。
- **管理者裁決逐活動，讀取可跨活動**：`GET /api/admin/claims` 只列請求指名活動的認領；`GET /api/admin/review-queue` 一次列出這次部署服務的**每一場**活動的待審認領與待審獨立地圖草稿數，加上主辦工作區的待審申請與送審數。它只讀不寫，不服務的活動不列入（與 event-scoped route 回 `404` 同一個答案）；每筆認領帶 `eventId`，同名社團不會在兩場活動之間被混為一談，並帶 `circleClaimed` 表示該社團在該活動已有通過的認領。核准與婉拒仍逐筆走 `POST /api/admin/claims?event=<該筆認領的活動>`。
- **活動後顯示與保存期限依該筆資料所屬活動計算**：階段與 `retention_expires_at` 都用該活動自己的 `eventEndsAt`。

控制面前端把選到的活動記在瀏覽器與 URL 上，只是一個指標，不是授權：伺服器一律以請求指名的活動作答。只有一場已發布活動時不出現選擇器，直接進入。網址沒有指名、瀏覽器也沒有記錄時，`/circle` 與 `/admin` 裡需要單一活動的區塊依台北日期開在正在舉辦的活動，其次是最快開始的活動，全部結束時才是最近結束的那場；已發布清單的順序不決定控制面開在哪一場。

## 活動後退出

社團可決定自己填寫的補充資料在活動結束後是否繼續公開（`POST /api/circle/:circleId/visibility`）。

介面上是兩個並列選項——「繼續公開」（預設）與「不再公開」——寫入即生效，不隨草稿一起送出。

- **範圍只限社團自述內容。** 主辦公布的社團名、攤位與日期不受影響，仍留在場刊。
- 退出的內容在活動結束後**完全不出現在公開文件中**，而非由用戶端隱藏。
- 公開文件在**活動階段改變時重建**——活動結束不是一次編輯，沒有任何寫入會觸發它。
- **每一次重建都以當下的活動階段重建。** 不只是階段改變那一次：活動結束後任何一次寫入（別的社團存檔、管理者撤下或撤銷認領）都會重建同一份文件，重建時若當成活動仍在進行，就會把所有退出的社團寫回去。`rebuildOverridesDoc()` 因此**不給 `phase` 預設值**，由呼叫端明講。
- **ETag 必須含活動階段**，否則快取會繼續提供已撤回的內容。
- **目前不主張任何例外。** 社團選了「不再公開」，內容就從公開文件消失，沒有附帶條件。介面上不得出現本站尚無條款可依據的保留條款——曾經寫過一句比照 Comic Market 的「學術或研究用途的有限度查閱」例外，已於使用條款就緒前移除。日後若要主張任何例外，先有條款，再改介面。

**退出的語意是「不再公開」，不是「不再持有」。** `post_event_hidden` 只在活動結束後重建公開文件時把該列濾掉，資料列本身留著。補充資料的保存期限是另一個座標軸，見下一節。

## 保存期限與清除

**憑證到期就清掉，紀錄類保留不設期限**（[ADR-0021](../adr/0021-credentials-expire-and-are-purged-records-are-kept.md)）。

**實作**：[`db/retention-purge.ts`](../../db/retention-purge.ts)、[`workers/retention-purge/`](../../workers/retention-purge)
**測試**：`tests/retention-purge.test.mjs`

各表的保存期限見[資料 inventory](./data-inventory.md#保存期現行常數)，`db/retention-purge.ts` 的 `RETENTION_WINDOWS` 是權威。

- **清除跑在獨立的排程 Worker 上**，每天一次，不掛在任何使用者請求的路徑上（[ADR-0022](../adr/0022-expiry-runs-in-a-separate-cron-worker.md)）。Cron Trigger 是 Workers 的功能，Pages 沒有；而機會性清除會讓保存期限變成流量的函數。部署方式見[部署 runbook](../runbooks/deployment.md#排程清除-worker)。
- **`login_tokens` 依 `created_at` 清除，門檻必須大於一小時。** 那張表同時是每小時速率限制的計數來源（每信箱 5 次、每 IP 20 次），依「已使用」清除會把限制打穿。`purgeExpiredRecords` 對過短的視窗直接拋錯，不是靜靜照做。
- **排程 Worker 不建立 schema。** 建表仍由 repository 首次使用時完成；找不到的表列進 `skipped` 並跳過。這條由測試把關：對一個沒有任何表的資料庫執行清除之後，那個資料庫仍然沒有任何表。
- **每次執行寫一筆 `audit_log` 摘要**（`action = "retention.purged"`），包含什麼都沒刪的那些。這是「清除還在跑嗎」唯一的答案。
- 刪掉憑證不會立即失去證據：`auth.link_requested` 會把 IP 雜湊與 email 的 keyed HMAC 寫進 `audit_log`；IP 在 90 天後清空，帳號刪除時可連結個資會塗銷。

### 社團補充資料的保存期限

[ADR-0054](../adr/0054-the-retention-choice-is-withdrawn-publish-or-delete.md) 已撤下保存期限的介面選擇。現行表單只問活動結束後是否繼續公開；要刪除內容使用同頁的自助刪除。既有 API 與資料列的期限機制保留，與活動後是否公開分開判斷。

欄位為 `circle_overrides.retention_choice`（`keep`／`purge`）與 `retention_expires_at`，皆可為 NULL 且無 DEFAULT。NULL 表示未表態，行為同不主動刪除；`purge` 到期時間自活動結束滿 90 天起算，在寫入時保存，常數是 `app/circle-overrides.ts` 的 `OVERRIDE_RETENTION_PURGE_AFTER_MS`。

- **API 保留 `PUT /api/circle/:circleId/overrides` 的 `retention` 欄位**。缺席代表這次沒有回答，伺服器保留既有選擇，不解讀成選擇清除。
- **控制面不再問這個問題**（[ADR-0054](../adr/0054-the-retention-choice-is-withdrawn-publish-or-delete.md)）。編輯頁上只剩「活動結束後：繼續公開／不再公開」，`retention` 一律缺席，因此新資料列的 `retention_choice` 維持 NULL（語意同「保留」）。已經選過 `purge` 的資料列仍照原到期日清除，但社團在介面上看不到也改不回來。API、欄位與排程清除都沒有變動。這是 [ADR-0054](../adr/0054-the-retention-choice-is-withdrawn-publish-or-delete.md) 的決定，取代 [ADR-0018](../adr/0018-retention-is-the-circles-choice.md)「兩個選項並列、不預選、不得收進摺疊」的介面條款。
- **選了清除的資料在等待刪除期間維持公開。** `listLiveOverrides` 與公開文件不看這兩個欄位；任何在讀取端過濾它們的作法都是錯的。
- **選擇改變時寫一筆 `audit_log`**（`action = "override.retention"`，含 `choice` 與到期時間）。清除本身只記錄發生過、不留下內容，所以「當事人要求過、在哪一天」只會留在這裡。

**清除接進上面那個排程 Worker**（`db/retention-purge.ts` 的 `purgeExpiredOverrides`），與憑證清除同一個部署單位、同一次執行，不另建，每天一次，**不掛在 `/data/events/:eventId/overrides.json` 上**——那條路徑的每一次 revalidation 都是一次 Function 呼叫（[#48](https://github.com/dekkmarsvin/tw_doujin_event/issues/48)），把清除掛上去等於把它變成流量的函數。清除的三條硬約束：

- **刪的是資料列，不是加一個旗標。** `fields_json` 與 `previous_fields_json` 一併消失，沒有可以還原的殘骸。若列帶有代管縮圖，先以可重試的 R2 delete 移除物件，再刪除 D1 列；公開文件依 `DELETE ... RETURNING` 的 id 同步移除。
- **公開文件同步失去該筆，且 revision 遞增。** `overrides_doc` 是衍生資料；revision 進 ETag，不遞增的話快取會繼續提供剛被刪掉的內容。
- **`audit_log` 留下刪除發生過，但不留下被刪除的內容**：每筆刪除寫一列 `override.purged`（`subject_id` 為社團 id，`detail_json` 只有 `eventId`），每次執行另有一列 `retention.purged` 摘要。與 #54 寫入的 `override.retention` 併讀，就能回答「當事人哪天要求、系統哪天執行」。

代管縮圖的 R2 位元組會在同一次排程作業中先行刪除；R2 delete 可重複執行，若後續 D1 失敗，下一次仍能安全重試。社團自助刪除、帳號刪除與管理者撤下使用同一個順序。

## 管理者

### 個人待審通知

`/admin#review-notifications` 提供跨活動的個人收信開關與頻率；不隨活動切換卸載，不修改其他管理者，也不能指定其他收件地址。`GET`／`PUT /api/admin/notification-preferences` 只操作目前有效管理者，PUT 沿用 CSRF 檢查，以 `enabled`、`cadence`、`version` 儲存；過期版本回 409，介面保留輸入並提供重新載入。載入失敗不冒充已保存預設值，重新載入期間不能編輯或儲存。

預設開啟且每 5 分鐘彙整，另可選每小時或每日台北時間 09:00。五分鐘與小時模式採整點時段；每日 09:00 即 UTC 01:00。每位管理者的設定、排程及寄送結果獨立。首次初始化、加入管理者、關閉後重開都不補寄舊件；關閉取消尚未寄出的項目與重試，只變更頻率則保留待寄工作並改排下一時段。已送到 Mailgun 的信件不能撤回。

通知涵蓋活動申請、候選活動（含修訂）送審、人工待審認領及獨立地圖草稿；自動通過的認領與活動工作區內的地圖不另通知。送審與待寄項目寫入同一 D1 batch，按收件者及這次送審識別去重；退回或撤回後再送審是新一次通知，不能只按來源 ID 去重。通知不改變審核、核准快照或發布流程。

摘要只包含類型、活動代碼、筆數及既有審核入口，不附申請內容、證據或登入憑證；由 `app/mail-letter.ts` 產生，同時寄出 HTML 與純文字，並附通知設定連結。寄出前核對同一次送審仍待審、收件者仍為管理者且帳號未停用／刪除。沒有新項目不寄，不重複催辦；排程恢復只寄積欠摘要，不逐時段補信。

寄送由既有 publication-dispatch Worker 的獨立通知 tick 執行，每 tick 最多 10 位管理者。每人只允許一個 pending 摘要，以 120 秒 lease 防併發；新項目不混入正在重試的摘要。失敗由 1 分鐘倍增退避、上限 6 小時，成功記錄為 `accepted`（供應商受理，並非收件匣送達）。外部受理成功、D1 寫回前中斷可能重複寄送；不承諾 exactly-once。寄送總開關與 publication mode 分離，兩項工作互不阻斷。

管理者移除／帳號刪除會清除其通知設定與寄送紀錄；帳號停用取消待寄工作。已完成及取消紀錄由既有 retention Worker 在 30 天後刪除，production 不保存信件全文。Preview 沿用獨立 D1 mail sink／sandbox 白名單，設定錯誤不得回退到 production 寄信。

### 審核與帳號操作

- 認領審核、撤下補充資料、管理者名單、停用帳號與地圖審閱／候選匯出在 `/admin`。候選活動的 Owner、核准並發布與重試留在 `/organizer`；`/admin` 只顯示其待審數量並連過去。
- **`/admin` 開在跨活動的待審總覽，不先選活動。** 總覽列出每場未結束活動的待審認領與地圖草稿數（依舉辦中、即將到來排序）；已結束活動只在仍有待審時以一行出現。認領清單跨活動列出，可依活動篩選；網址的 `?event=` 只是預先套用的篩選與地圖審閱的起始活動，`#admin`、`#map-review`、`#review-notifications` 錨點不變。`/circle` 的「管理」連結不帶活動。
- 需要單一活動的區塊各自帶活動選單：地圖審閱切換時卸載前一場面板與表單；撤下表單的請求指名表單上選的活動，不跟隨地圖審閱。只有一場已發布活動時不顯示選單。管理者名單及帳號停用仍是帳號層操作。
- **批次核准與婉拒先確認。** 確認視窗依活動分組列出社團；已有通過認領的社團、以及同一活動同一社團勾選了兩筆以上時，這些認領列為「略過」並留在清單，由管理者逐筆決定。送出時逐筆請求、逐筆回報：清單上方一行總結，未完成的原因標在該列；登入失效或失去管理者資格時停止送出其餘各筆。單筆核准與婉拒不經確認。
- **核准與婉拒只作用於仍在待審的認領。** 清單可能落後其他管理者或其他分頁數秒；對已處理的認領送出核准或婉拒回 `409`「這筆認領已不在待審中。」，不改寫既有結果，也不重建公開文件。撤下擁有者只能用撤銷。
- `/admin` 顯示 session 到期時間，到期或 API 回 401 時移除管理內容並提供 `/circle` 重新登入連結；逐 endpoint 的管理者、CSRF、活動與 revision 檢查不因入口搬移改變。
- 待審總覽與認領清單在頁面可見時每 30 秒更新，切回頁面時立即更新，也可手動重新整理。更新失敗顯示錯誤，保留上次成功取得的清單；核准或婉拒送出期間不以背景更新替換清單。
- **只有首次載入與手動按下才改變「重新整理」按鈕的狀態**；背景更新照常換清單、照常回報失敗，但不把按鈕切成「更新中…」。讀者沒有按過的控制項每 30 秒閃一次，只是動作，不是資訊。
- 讀取待審認領、核准、婉拒與撤銷都要求同一個有效 session 與當下的管理者資格。到期時整個控制面回到登入畫面，不保留「已登入但管理功能因登入時間被鎖定」的第二種狀態。
- **管理者名單存在資料庫（`admins` 表）而非設定值**，可在控制面即時增減、不需重新部署。
- **不得移除自己，也不得移除最後一位管理者**——兩者都是把自己鎖在門外的最短路徑。
- 名單為空時由 `ADMIN_EMAILS` 設定值重新灌入，作為救援路徑。上面兩道限制讓它不會正常地走到那一步。
- 管理者位址比對前先做與儲存時相同的正規化。
- 管理者可撤下任何社團補充資料，D1 公開文件立即移除；已開啟讀者頁面的可見性限制見[資料傳輸契約](./delivery-and-offline.md#更新可見性)，不能把伺服器撤下等同用戶端立即更新。

## 媒體安全

社團提供的縮圖來源接受**任何 https 位址**：主機允許清單已於 [ADR-0052](../adr/0052-thumbnail-addresses-are-checked-as-images-not-hosts.md) 移除，寫入驗證只檢查協定，編輯器另外以瀏覽器實際載入該位址判斷它是不是圖片，載不出來就擋住送出。CSP `img-src` 因此是 `'self' data: https:`，見[資料傳輸與離線契約](./delivery-and-offline.md#快取標頭)。

依 [ADR-0012](../adr/0012-first-party-sources-only.md) 退場工作簿縮圖索引後，**社團自填是縮圖的唯一來源**。

**出處頁面與來源標示是選填**（[ADR-0053](../adr/0053-the-thumbnail-upload-asks-for-the-picture-only.md)）：上傳自己作品的社團就是出處，逼它指一個不存在的頁面只會換來湊數的網址。有填的出處仍必須是 https，來源標示仍受單項字數上限；空值的意思是「沒有另外標示」。沒有出處連結時，閱讀端的圖片來源列只顯示來源標示，兩者皆空則整列不出現（[ADR-0036](../adr/0036-provenance-labels-name-the-source-not-its-trust-level.md)）。

代表圖採**本站代管為主、外部網址為輔**的雙線。已驗證的社團可上傳 JPEG／PNG／WebP，單檔上限 5 MiB（[ADR-0053](../adr/0053-the-thumbnail-upload-asks-for-the-picture-only.md)），每個社團每個活動一張；伺服器驗證宣告 MIME 與檔案特徵，物件末段以內容 SHA-256 命名，不在 Worker 內重編碼。公開 URL 由 production `media.kotoban.top` 或 preview `media-preview.kotoban.top` 的 R2 custom domain 提供，帶一年 immutable 快取，**不經 Pages Function**。

檔案上傳只建立草稿物件並回填預覽，不直接改寫 overlay；經 server preview 與使用者確認儲存後，才把該物件連同其他欄位發布。更換圖片時先發布新物件與欄位，再移除舊物件；改用外部網址或清除欄位時會解除並刪除舊的代管物件。若代管線與外部網址都不可用，閱讀端維持文字卡。實作追蹤於 [#65](https://github.com/dekkmarsvin/tw_doujin_event/issues/65)。

## 聯絡窗口

依 [ADR-0019](../adr/0019-personal-data-requests-go-to-the-mailbox-not-the-issue-tracker.md)：功能問題、資料顯示錯誤與 bug 回報走公開 GitHub issue；**涉及個人資料的查詢、更正與刪除走維運信箱**，不走公開 issue——那會讓一筆刪除請求本身變成永久公開紀錄。兩個位址，都是網域信箱而非個人信箱：**個人資料與著作權爭議走 `maintain@kotoban.top`**，**控制面的使用問題與認領協助走 `circle@kotoban.top`**。兩者都必須出現在隱私告知與 `/circle` 上——只寫在 repo 裡的窗口，對不讀 repo 的人等於不存在。

**著作權與內容爭議走同一個信箱**，這是社團自述內容與代管縮圖的撤下入口。對外的完整說法見[隱私權與資料使用告知](../policy/privacy-notice.md)，站上版本在 `/privacy`，由該檔案於建置時產生，登入表單送出前可達。它描述的是實際行為——行為改了就在同一個 commit 改它。

## 公開端點

`/data/events/:eventId/overrides.json` 是唯一的公開補充資料端點，由 Pages Function 產出，帶 revision 與含活動階段的 strong ETag，使用 `public, max-age=60, must-revalidate`。閱讀端把它疊加在靜態 `circles.json` 之上；讀取失敗或 event mismatch 時只用 official base。

**每個已發布活動服務自己的 overlay，且用自己的日期作答。**「已發布」的定義是**這次部署實際上有該活動的靜態資料**，而不是另一份可能與部署漂移的清單；未部署該資料的活動一律 `404`。

活動階段是「**這一場**是否已結束」，因此不能沿用控制面那一場的 `eventEndsAt`：借用另一場的日期會讓選擇「活動後隱藏」的社團在錯誤的時間點被撤下——可能早幾個月，也可能晚幾個月。`etag` 逐活動區分，否則快取會把一場活動的 overlay 端給另一場。

讀取面與寫入面現在指向同一組活動：兩者都以「這次部署實際上有該活動的靜態資料」為準，不各自維護一份活動清單。

## 驗收條件

- 閱讀端 bundle 不含登入介面、寫入 route 或 session cookie 名稱，也不載入 Turnstile。
- 沒有 Turnstile token 或 token 未通過驗證時，索取登入連結不寄出郵件、不寫入 `login_tokens`。
- 社團無法透過任何路徑修改自己的名稱、攤位或日期。
- 儲存前預覽的呈現與儲存後的公開呈現一致。
- 社團選擇活動後退出時，活動結束後公開文件裡查不到該筆內容，且快取不會提供舊版本。
- 甲活動的認領無法對乙活動寫入；同一帳號在兩場活動各自持有的認領互不影響；服務不到的活動一律 `404`。
- 管理者無法移除自己或最後一位管理者。
- 代表圖位址載不出圖片時擋住送出，且錯誤訊息可讓社團理解原因。
- 只有圖片本身是代表圖的必要條件；有填的出處頁面不是 https 時擋住送出，未填時不擋。
- 送出被擋下時，畫面指得出是哪一個欄位；伺服器退件時回的也是那一個欄位的理由。
- 未儲存的編輯保留在這台裝置上，下次進編輯器會帶回並可一鍵改用已儲存版本；帶回的內容包含代管圖片的上傳憑證，儲存或刪除後不再保留。
- 即時預覽失敗不影響未儲存的編輯是否被保留。
- 所有認領與撤下決策都可在稽核記錄中查到。
- 過期的登入權杖、session 與 preview 信件會被清除，而清除不會動到速率限制視窗內的列。
- 對一個沒有任何表的資料庫執行清除之後，那個資料庫仍然沒有任何表。
