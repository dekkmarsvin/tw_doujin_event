# 社團自助控制面契約

參展社團在獨立入口 `/circle` 維護**自己的**公開資料。它**補充**而非取代人工快照發布：主辦提供的攤位與社團身分仍由版本控制的快照決定，社團填寫的內容是疊加其上、可即時撤下的補充層。

**實作**：[`app/circle-portal/`](../../app/circle-portal)、[`app/circle-portal-handlers.ts`](../../app/circle-portal-handlers.ts)、[`app/circle-overrides.ts`](../../app/circle-overrides.ts)、[`app/portal-crypto.ts`](../../app/portal-crypto.ts)、[`db/identity-repository.ts`](../../db/identity-repository.ts)、[`functions/`](../../functions)
**測試**：`tests/circle-portal-route.test.mjs`、`tests/circle-overrides.test.mjs`、`tests/identity-repository.test.mjs`、`tests/portal-crypto.test.mjs`、`tests/portal-transport.test.mjs`
**部署與密鑰**：[部署 runbook](../runbooks/deployment.md)

> **實作狀態（2026-08-30）**：**寫入面**（登入、認領、編輯）仍由 `env.EVENT_ID` 決定唯一可操作活動；通用 `/circle`、登入後選場次與逐活動 ownership 已由 [ADR-0043](../adr/0043-the-circle-portal-is-event-agnostic.md) 定案，但 [#136](https://github.com/dekkmarsvin/tw_doujin_event/issues/136) 尚未實作。**公開讀取面**已放行多活動：每個已發布活動都服務自己的 `overrides.json`。

> 本文的「登入」指**社團為了維護自己的資料**而登入。這與 [資料匯入契約](./data-import.md) 裡「使用者授權外部服務以便匯入」是相反方向的兩件事，後者仍屬 P2 且未實作。

## 公開入口與 preview 邊界

正式入口是 <https://map.kotoban.top/circle>，不在 Cloudflare Access 內；任何人都能到達登入表單，但 Turnstile、email 一次性連結、session、認領證據與管理者角色仍逐層限制實際操作。隱私告知、保存期限與刪除機制已隨公開入口上線。

Pull request 與不可變 preview deployment 位於 `*.tw-catalog.pages.dev`，繼續由 Cloudflare Access 保護。CI 使用 Service Auth token 穿過 Access 後，才執行隔離 preview D1 上的完整流程；人工測試則使用維護者身分登入 Access。production 公開、preview 閘控的決策見 [ADR-0029](../adr/0029-public-production-gated-preview.md)，驗證方式見[部署 runbook](../runbooks/deployment.md#cloudflare-accessproduction-公開preview-閘控)。

## 入口分離

- **社團登入與編輯只存在於 `/circle`，不與閱讀端共用 bundle。** 閱讀端不得出現登入介面、寫入 route 或 session cookie 名稱，由 `tests/rendered-html.test.mjs` 以內容比對把關。
- **入口分離指的是程式邊界，不是把 `/circle` 藏起來。** 閱讀端必須有一處靜態指引說明參展社團可以來補充自己的資料並連向 `/circle`；目前在「使用說明」面板的「你是參展社團嗎？」段落，同樣由 `tests/rendered-html.test.mjs` 把關。第一次到站的社團成員只會看到閱讀端，沒有這個指引就等於沒有入口。連結是純靜態 `href`，不載入 Turnstile、不呼叫任何寫入 route，因此不牴觸上一條。
- 一般參觀者公開瀏覽、不需登入。社團登入**不介入**參觀者的收藏與行程。
- 社團入口不下載場刊：認領時的社團搜尋走 `/api/circle/search`，需要 session 且只回傳比對到的社團。

## 索取登入連結需要通過真人驗證

`POST /api/auth/request-link` 是站上唯一不需要 session 就會產生外送郵件的路徑。它要求一枚 Cloudflare Turnstile token，由 `/circle` 的登入表單取得；決策見 [ADR-0016](../adr/0016-human-verification-guards-the-mailer.md)。

- **驗證在讀取 email 之前執行。** 驗證失敗回 `403` 並明說原因；這不破壞「不可枚舉」，因為結果與信箱是否存在無關。通過驗證之後的回應仍然一律是 `202`，不論該信箱是否已註冊、位址是否合法。
- **驗證失敗不消耗任何額度。** 每小時每信箱 5 次、每 IP 20 次的計數在驗證通過後才遞增，機器人打不到它，也打不到 D1 與郵件供應商。
- **驗證器不可達時視為未通過。** siteverify 逾時、非 2xx 或回應無法解析一律拒絕。登入連結可以一分鐘後再要一次；一個任何人都能驅動的寄信端點不行。
- **sitekey 由 `GET /api/auth/config` 供給，不編進 bundle。** 因此 preview 與 production 可以持有不同金鑰而共用同一份 build。
- Turnstile 的 script 只在 `/circle` 載入，CSP 也只在該路徑放寬，見[資料傳輸與離線契約](./delivery-and-offline.md#快取標頭)與 `public/_headers`。

## 身分與擁有權

**email 一次性連結只證明控制某信箱，不證明身分。** 認領必須另有證據：

| 證據 | 結果 |
|---|---|
| 帳號網域與社團官網相符 | 自動通過 |
| 社團在已登錄於場刊的可抓取連結上公開驗證碼 | 自動通過 |
| 其餘 | 一律人工審核 |

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

- **「清除此欄」與「刪除這筆資料」是兩件事。** 前者寫入空值或 tombstone，資料列還在；後者刪掉資料列，`previous_fields_json` 與保存期限一併消失。介面上分屬兩區，措辭不得混用。
- **刪除前顯示即將刪除的內容摘要。** pretix 在刪除前強制先匯出，本站是它的弱化版：沒有人應該在看不見標的的情況下按下去。
- **確認不得是單一按鈕，也不重寄郵件。** session 有效期 30 天，單一按鈕會讓一個久未使用的分頁抹掉全部內容；重寄郵件則會把不可逆的動作卡在送達率上。實作是把社團代號輸入一次——這條在伺服器端把關（`confirm` 必須等於該社團 id），不只是介面上的一道關。
- **擁有權掛在社團身分上，不掛在帳號上。** 移轉後新擁有者可以刪除前任寫的內容；`audit_log` 的 `override.deleted` 記下是**哪個帳號**做的，那是移轉之後唯一分得出誰做了什麼的依據。稽核不留下被刪除的內容。
- **自助刪除與到期自動清除刪掉同一組東西**，否則兩條路徑會留下不同的殘骸。這條由測試把關。

帳號本身也可自助刪除（`DELETE /api/account`）：登入中的非管理者必須輸入完整 email 確認。帳號、tokens、sessions、claims 與仍由該帳號擁有的補充資料一併刪除，公開文件同步更新，稽核個資塗銷但 action 與時間保留。管理者需先由另一位管理者移出名單。來信協助仍走維運信箱（[ADR-0019](../adr/0019-personal-data-requests-go-to-the-mailbox-not-the-issue-tracker.md)、[ADR-0027](../adr/0027-personal-data-lifecycle-and-account-deletion.md)）。

## 可編輯範圍

**可編輯，儲存後約一分鐘內公開**：販售資訊、筆名、連結、縮圖、主辦分類目錄中的一項社團主題類別（`circleCategory`），以及作品／標籤類欄位（`creatorTypes`、`ageRatings`、`workTypes`、`referencedWorks`、`specialTags`）。

`circleCategory` 不是自由文字：控制面與寫入驗證共用 active event 的 `circleCategories`。選項集合來自主辦公開分類頁，但某社團選了哪一項仍是社團自述，不得標示為主辦認定。主辦 base 沒有逐社團分類，因此此欄的「繼承」在介面顯示為「尚未提供」。

**永不開放**：攤位、日期、`SourceLink`。

**社團名稱不可由社團編輯。** 它仍是與主辦公布攤位清單的比對鍵；但依 ADR-0010，名稱已不再參與 `circle.id`。名稱錯誤由管理者在**上游來源與 identity evidence registry** 更正。是否開放自行改名仍由 ADR-0007 管理，不能因 ID 穩定就順帶放寬。

`circle_name_key`、`circle_name_at_claim`、`source_row_at_claim` 保留為認領當時的稽核快照，不再用名稱推測或修復 identity。認領與補充資料一律以 `c-xxxxxx` 為鍵；舊 ID 的管理端 cutover 已隨相容路徑一併移除（[ADR-0013](../adr/0013-drop-the-legacy-circle-id-compatibility-path.md)）。

### 連結順序有語意

連結清單的順序**就是顯示順序**。地圖側欄只顯示前六個，其餘留在完整詳細資訊（見[社團目錄契約](./circle-catalog.md#資訊密度契約)），因此編輯器必須讓作者**看得到並改得動**這個順序，並說明第六個之後的界線在哪。

側欄是參觀者決定「要不要去這攤」的地方；把排序交給作者，等於把那個決定的依據交給最清楚的人。

### 欄位有三種狀態

每個可編輯欄位都明確區分三種狀態：

1. **沿用場刊**：override 不含該鍵，繼續使用 reviewed snapshot。
2. **社團自填**：override 含非空值，整組取代 snapshot；陣列不逐項合併。
3. **清除此欄**：空字串、空陣列或 thumbnail tombstone 明確移除 snapshot 的既有值。

編輯器必須顯示目前狀態，並提供「沿用場刊」與「清除此欄」動作。不得在送出前丟掉 tombstone，否則社團只能改寫、不能明確撤下自己先前提供的內容。

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

編輯會在公開 overlay 下一次 revalidation（最長約一分鐘）生效，**因此預覽更重要而非更不重要**：錯誤會很快對外，社團沒有機會先看到自己寫的內容長什麼樣。

`POST /api/circle/:circleId/preview` 以**閱讀端自己的投影元件**渲染草稿，唯讀、不寫入任何資料。預覽必須重用閱讀端元件，否則預覽會與實際呈現漂移。

社團補充內容欄位與保存期限的發布只有一條寫入路徑：「預覽並送出」先讓 server preview 重新驗證擁有權、活動目錄與序列化上限，只有成功回傳的版本才能出現「確認儲存」。server preview 拒絕時不呼叫寫入端點，並保留原草稿、保存期限選擇與焦點脈絡。活動後退出與自助刪除是獨立的可逆／刪除動作，不屬於這條內容發布路徑。

草稿的即時預覽、server preview 與公開文件共用 `projectCircleDraft` 投影及閱讀端 `CircleDetails` renderer；草稿變更只重算 client projection，不會自動儲存。確認頁可額外以「未提供」標示空白選填欄位，但不得把這些字寫入公開 projection。

三段版面是同一條工作流，不是三種儲存語意：

- `<= 760px`：「預覽並送出」進入全畫面檢查頁，只能返回修改或確認儲存，沒有直接儲存動作。
- `761–959px`：表單保持單欄，以明確動作在同頁開啟可返回的檢查區。
- `>= 960px`：左側表單、右側 sticky 即時公開卡預覽；準備儲存時，右側切換成 server preview 確認。

## 標示

社團自填內容一律附 `provider: "由社團填寫"`、`contentType: "circle"`、`status: "unverified"` 的來源條目，且不提供偽造的原始來源連結。

來源列**只顯示 `由社團填寫` 與最後更新日期**：`status` 是資料欄位，不轉成「尚未驗證」之類的畫面措辭（[DESIGN.md](../../DESIGN.md#copy)、[ADR-0036](../adr/0036-provenance-labels-name-the-source-not-its-trust-level.md)）。

**不得以任何版面權重、措辭或官方標誌暗示已獲主辦確認。**

## 活動後退出

社團可決定自己填寫的補充資料在活動結束後是否繼續公開（`POST /api/circle/:circleId/visibility`）。

- **範圍只限社團自述內容。** 主辦公布的社團名、攤位與日期不受影響，仍留在場刊。
- 退出的內容在活動結束後**完全不出現在公開文件中**，而非由用戶端隱藏。
- 公開文件在**活動階段改變時重建**——活動結束不是一次編輯，沒有任何寫入會觸發它。
- **每一次重建都以當下的活動階段重建。** 不只是階段改變那一次：活動結束後任何一次寫入（別的社團存檔、管理者撤下或撤銷認領）都會重建同一份文件，重建時若當成活動仍在進行，就會把所有退出的社團寫回去。`rebuildOverridesDoc()` 因此**不給 `phase` 預設值**，由呼叫端明講。
- **ETag 必須含活動階段**，否則快取會繼續提供已撤回的內容。
- **目前不主張任何例外。** 社團勾選退出，內容就從公開文件消失，沒有附帶條件。介面上不得出現本站尚無條款可依據的保留條款——曾經寫過一句比照 Comic Market 的「學術或研究用途的有限度查閱」例外，已於使用條款就緒前移除。日後若要主張任何例外，先有條款，再改介面。

**退出的語意是「不再公開」，不是「不再持有」。** `post_event_hidden` 只在活動結束後重建公開文件時把該列濾掉，資料列本身留著。補充資料的保存期限是另一個座標軸，見下一節。

## 保存期限與清除

**憑證到期就清掉，紀錄類保留不設期限**（[ADR-0021](../adr/0021-credentials-expire-and-are-purged-records-are-kept.md)）。

**實作**：[`db/retention-purge.ts`](../../db/retention-purge.ts)、[`workers/retention-purge/`](../../workers/retention-purge)
**測試**：`tests/retention-purge.test.mjs`

| 資料 | 保存期限 | 已實作 |
|---|---|---|
| `login_tokens` | 建立後 24 小時 | 是 |
| `sessions` | 到期或撤銷後 7 天 | 是 |
| `preview_mail_sink` | 7 天 | 是 |
| `audit_log.ip_hash` | 90 天後清空；action 與時間不刪 | 是 |
| `accounts`、`circle_claims` | 不設期限；帳號自助刪除時連帶刪除 | 是 |
| `audit_log`（IP 以外）、`admins` | 不設期限 | 不適用 |
| `circle_overrides` | 由社團自選（保留／活動後清除，90 天） | 是 |

- **清除跑在獨立的排程 Worker 上**，每天一次，不掛在任何使用者請求的路徑上（[ADR-0022](../adr/0022-expiry-runs-in-a-separate-cron-worker.md)）。Cron Trigger 是 Workers 的功能，Pages 沒有；而機會性清除會讓保存期限變成流量的函數。部署方式見[部署 runbook](../runbooks/deployment.md#排程清除-worker)。
- **`login_tokens` 依 `created_at` 清除，門檻必須大於一小時。** 那張表同時是每小時速率限制的計數來源（每信箱 5 次、每 IP 20 次），依「已使用」清除會把限制打穿。`purgeExpiredRecords` 對過短的視窗直接拋錯，不是靜靜照做。
- **排程 Worker 不建立 schema。** 建表仍由 repository 首次使用時完成；找不到的表列進 `skipped` 並跳過。這條由測試把關：對一個沒有任何表的資料庫執行清除之後，那個資料庫仍然沒有任何表。
- **每次執行寫一筆 `audit_log` 摘要**（`action = "retention.purged"`），包含什麼都沒刪的那些。這是「清除還在跑嗎」唯一的答案。
- 刪掉憑證不會立即失去證據：`auth.link_requested` 會把 IP 雜湊與 email 的 keyed HMAC 寫進 `audit_log`；IP 在 90 天後清空，帳號刪除時可連結個資會塗銷。

### 社團補充資料的保存期限

[ADR-0018](../adr/0018-retention-is-the-circles-choice.md) 在活動後退出**之外再加一個獨立的座標軸**：「保留」（預設）不主動刪除；「活動後清除」在活動結束滿 90 天時刪除該筆補充資料與其代管縮圖，**但在那 90 天內維持公開**。退出管的是活動後還公不公開，期限管的是資料還留多久，四種組合裡三種都有人會用。要更早消失的社團自己在控制面刪即可，不必等期限。

**選擇存在資料列上**：`circle_overrides.retention_choice`（`keep`／`purge`）與 `circle_overrides.retention_expires_at`。兩欄都可為 NULL 且**沒有 DEFAULT**——NULL 是「尚未表態」，與「已選擇保留」是不同的狀態，控制面靠這個差別決定要不要問。到期時間**自活動結束時間起算**，不是最後編輯時間，並且在寫入時就算好存進資料列，維運端因此能直接查出哪些列在什麼時候會消失，不必讀程式碼推論。90 天的值是 `app/circle-overrides.ts` 的 `OVERRIDE_RETENTION_PURGE_AFTER_MS`。

- **選擇隨內容一起送出**（`PUT /api/circle/:circleId/overrides` 的 `retention`），因為它是填寫時的決定，不是事後的設定。欄位缺席代表「這次沒有回答」，伺服器保留既有選擇，**永遠不會被解讀成選擇了清除**。
- **介面上兩個選項並列、同樣的視覺權重**，不預選任何一項，不得把清除收進摺疊或進階區塊。既有資料列讀回 `null` 時，控制面顯示一則請其表態的提示，但不擋住編輯。
- **選了清除的資料在等待刪除期間維持公開。** `listLiveOverrides` 與公開文件不看這兩個欄位；任何在讀取端過濾它們的作法都是錯的。
- **選擇改變時寫一筆 `audit_log`**（`action = "override.retention"`，含 `choice` 與到期時間）。清除本身只記錄發生過、不留下內容，所以「當事人要求過、在哪一天」只會留在這裡。

**清除接進上面那個排程 Worker**（`db/retention-purge.ts` 的 `purgeExpiredOverrides`），與憑證清除同一個部署單位、同一次執行，不另建，每天一次，**不掛在 `/data/events/:eventId/overrides.json` 上**——那條路徑的每一次 revalidation 都是一次 Function 呼叫（[#48](https://github.com/dekkmarsvin/tw_doujin_event/issues/48)），把清除掛上去等於把它變成流量的函數。清除的三條硬約束：

- **刪的是資料列，不是加一個旗標。** `fields_json` 與 `previous_fields_json` 一併消失，沒有可以還原的殘骸。若列帶有代管縮圖，先以可重試的 R2 delete 移除物件，再刪除 D1 列；公開文件依 `DELETE ... RETURNING` 的 id 同步移除。
- **公開文件同步失去該筆，且 revision 遞增。** `overrides_doc` 是衍生資料；revision 進 ETag，不遞增的話快取會繼續提供剛被刪掉的內容。
- **`audit_log` 留下刪除發生過，但不留下被刪除的內容**：每筆刪除寫一列 `override.purged`（`subject_id` 為社團 id，`detail_json` 只有 `eventId`），每次執行另有一列 `retention.purged` 摘要。與 #54 寫入的 `override.retention` 併讀，就能回答「當事人哪天要求、系統哪天執行」。

代管縮圖的 R2 位元組會在同一次排程作業中先行刪除；R2 delete 可重複執行，若後續 D1 失敗，下一次仍能安全重試。社團自助刪除、帳號刪除與管理者撤下使用同一個順序。

## 管理者

- **管理者名單存在資料庫（`admins` 表）而非設定值**，可在控制面即時增減、不需重新部署。
- **不得移除自己，也不得移除最後一位管理者**——兩者都是把自己鎖在門外的最短路徑。
- 名單為空時由 `ADMIN_EMAILS` 設定值重新灌入，作為救援路徑。上面兩道限制讓它不會正常地走到那一步。
- 管理者位址比對前先做與儲存時相同的正規化。
- 管理者可撤下任何社團補充資料；D1 公開文件立即移除，讀者端最長約一分鐘 revalidation 後不再顯示，不需額外用戶端內容過濾。

## 媒體安全

社團提供的縮圖來源限於**允許清單內的主機**（`THUMBNAIL_HOST_ALLOWLIST`），CSP 與寫入驗證共用這份清單。

依 [ADR-0012](../adr/0012-first-party-sources-only.md) 退場工作簿縮圖索引後，**社團自填是縮圖的唯一來源**，這份清單因此同時是 CSP `img-src` 的主機集合，見[資料傳輸與離線契約](./delivery-and-offline.md#快取標頭)。

代表圖採**本站代管為主、外部網址為輔**的雙線。已驗證的社團可上傳 JPEG／PNG／WebP，單檔上限 2 MiB，每個社團每個活動一張；伺服器驗證宣告 MIME 與檔案特徵，物件末段以內容 SHA-256 命名，不在 Worker 內重編碼。公開 URL 由 production `media.kotoban.top` 或 preview `media-preview.kotoban.top` 的 R2 custom domain 提供，帶一年 immutable 快取，**不經 Pages Function**。

檔案上傳只建立草稿物件並回填預覽，不直接改寫 overlay；經 server preview 與使用者確認儲存後，才把該物件連同其他欄位發布。更換圖片時先發布新物件與欄位，再移除舊物件；改用外部網址或清除欄位時會解除並刪除舊的代管物件。若代管線與外部網址都不可用，閱讀端維持文字卡。實作追蹤於 [#65](https://github.com/dekkmarsvin/tw_doujin_event/issues/65)。

## 聯絡窗口

依 [ADR-0019](../adr/0019-personal-data-requests-go-to-the-mailbox-not-the-issue-tracker.md)：功能問題、資料顯示錯誤與 bug 回報走公開 GitHub issue；**涉及個人資料的查詢、更正與刪除走維運信箱**，不走公開 issue——那會讓一筆刪除請求本身變成永久公開紀錄。兩個位址，都是網域信箱而非個人信箱：**個人資料與著作權爭議走 `maintain@kotoban.top`**，**控制面的使用問題與認領協助走 `circle@kotoban.top`**。兩者都必須出現在隱私告知與 `/circle` 上——只寫在 repo 裡的窗口，對不讀 repo 的人等於不存在。

**著作權與內容爭議走同一個信箱**，這是社團自述內容與代管縮圖的撤下入口。對外的完整說法見[隱私權與資料使用告知](../policy/privacy-notice.md)，站上版本在 `/privacy`，由該檔案於建置時產生，登入表單送出前可達。它描述的是實際行為——行為改了就在同一個 commit 改它。

## 公開端點

`/data/events/:eventId/overrides.json` 是唯一的公開補充資料端點，由 Pages Function 產出，帶 revision 與含活動階段的 strong ETag，使用 `public, max-age=60, must-revalidate`。閱讀端把它疊加在靜態 `circles.json` 之上；讀取失敗或 event mismatch 時只用 official base。

**每個已發布活動服務自己的 overlay，且用自己的日期作答。**「已發布」的定義是**這次部署實際上有該活動的靜態資料**，而不是另一份可能與部署漂移的清單；未部署該資料的活動一律 `404`。

活動階段是「**這一場**是否已結束」，因此不能沿用控制面那一場的 `eventEndsAt`：借用另一場的日期會讓選擇「活動後隱藏」的社團在錯誤的時間點被撤下——可能早幾個月，也可能晚幾個月。`etag` 逐活動區分，否則快取會把一場活動的 overlay 端給另一場。

這條讀取面與寫入面是分開的：寫入仍由 `env.EVENT_ID` 決定同一時間維護哪一場（[#136](https://github.com/dekkmarsvin/tw_doujin_event/issues/136) 之前的過渡），但讀者不會因此在第二場活動安靜地失去所有社團補充資料。

## 驗收條件

- 閱讀端 bundle 不含登入介面、寫入 route 或 session cookie 名稱，也不載入 Turnstile。
- 沒有 Turnstile token 或 token 未通過驗證時，索取登入連結不寄出郵件、不寫入 `login_tokens`。
- 社團無法透過任何路徑修改自己的名稱、攤位或日期。
- 儲存前預覽的呈現與儲存後的公開呈現一致。
- 社團選擇活動後退出時，活動結束後公開文件裡查不到該筆內容，且快取不會提供舊版本。
- 管理者無法移除自己或最後一位管理者。
- 縮圖主機不在允許清單時被拒絕，且錯誤訊息可讓社團理解原因。
- 所有認領與撤下決策都可在稽核記錄中查到。
- 過期的登入權杖、session 與 preview 信件會被清除，而清除不會動到速率限制視窗內的列。
- 對一個沒有任何表的資料庫執行清除之後，那個資料庫仍然沒有任何表。
