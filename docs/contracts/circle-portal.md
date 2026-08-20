# 社團自助控制面契約

參展社團在獨立入口 `/circle` 維護**自己的**公開資料。它**補充**而非取代人工快照發布：主辦提供的攤位與社團身分仍由版本控制的快照決定，社團填寫的內容是疊加其上、可即時撤下的補充層。

**實作**：[`app/circle-portal/`](../../app/circle-portal)、[`app/circle-portal-handlers.ts`](../../app/circle-portal-handlers.ts)、[`app/circle-overrides.ts`](../../app/circle-overrides.ts)、[`app/portal-crypto.ts`](../../app/portal-crypto.ts)、[`db/identity-repository.ts`](../../db/identity-repository.ts)、[`functions/`](../../functions)
**測試**：`tests/circle-portal-route.test.mjs`、`tests/circle-overrides.test.mjs`、`tests/identity-repository.test.mjs`、`tests/portal-crypto.test.mjs`、`tests/portal-transport.test.mjs`
**部署與密鑰**：[部署 runbook](../runbooks/deployment.md)

> 本文的「登入」指**社團為了維護自己的資料**而登入。這與 [資料匯入契約](./data-import.md) 裡「使用者授權外部服務以便匯入」是相反方向的兩件事，後者仍屬 P2 且未實作。

## 目前不對外開放

**FF47 期間 `/circle` 在 Cloudflare Access 閘控內，沒有 Bypass。** 本契約描述的行為全部已實作且有測試覆蓋，但沒有任何真實社團可以到達它——決策見 [ADR-0011](../adr/0011-ff47-is-not-a-public-launch.md)。

因此社團端的功能驗收只能在 preview 環境進行，見[部署 runbook](../runbooks/deployment.md)。

閘控**不留 Bypass**，所以解除的那一刻 `/circle` 與 `/api/auth/*` 同時對外可達，任何人都能索取登入連結並送出 email。隱私告知、保存期限與刪除政策因此**不能晚於解除**，而不只是邀請真實社團前的前置，見 [ADR-0015](../adr/0015-access-lifts-when-no-third-party-bytes-remain.md)。

## 入口分離

- **社團登入與編輯只存在於 `/circle`，不與閱讀端共用 bundle。** 閱讀端不得出現登入介面、寫入 route 或 session cookie 名稱，由 `tests/rendered-html.test.mjs` 以內容比對把關。
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

資料庫層保證**一個社團同時只有一位擁有者**。所有認領與撤下決策寫入稽核記錄。

**自助刪除沿用這條鏈，尚未實作。** [ADR-0020](../adr/0020-self-service-deletion-reuses-the-existing-ownership-chain.md) 決定不為刪除另發「持有即代表授權」的編輯連結——既有的登入加已驗證認領已經更強。目前沒有任何刪除端點：欄位的「清除此欄」是寫入空值或 tombstone，不是刪除資料列。實作時的硬約束記在這裡：介面必須把「清空內容」與「刪除這筆資料」呈現為兩件事、刪除前顯示即將刪除的內容、確認不得是單一按鈕（session 有效期 30 天）、擁有權移轉後新擁有者可刪前任內容但 `audit_log` 要留下是誰刪的。帳號本身的刪除不在自助範圍。

## 可編輯範圍

**可編輯，儲存後約一分鐘內公開**：販售資訊、筆名、連結、縮圖、作品／標籤類欄位（`creatorTypes`、`ageRatings`、`workTypes`、`referencedWorks`、`specialTags`）。

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

編輯器必須顯示目前狀態，並提供「沿用場刊」與「清除此欄」動作。不得在送出前丟掉 tombstone，否則社團只能改寫、不能移除錯誤內容，工作簿就仍然控制欄位是否存在。

### 欄位上限

上限存在的理由是：**一個社團不能讓每位讀者下載的公開文件無限膨脹**。

| 欄位 | 上限 |
|---|---|
| `pen` | 80 字 |
| `saleInfo` | 2000 字 |
| 清單類欄位項目數 | 20 |
| 清單類單項長度 | 60 字 |
| 連結數 | 12 |
| 序列化後總長度 | 8192 bytes |

## 儲存前預覽

編輯會在公開 overlay 下一次 revalidation（最長約一分鐘）生效，**因此預覽更重要而非更不重要**：錯誤會很快對外，社團沒有機會先看到自己寫的內容長什麼樣。

`POST /api/circle/:circleId/preview` 以**閱讀端自己的投影元件**渲染草稿，唯讀、不寫入任何資料。預覽必須重用閱讀端元件，否則預覽會與實際呈現漂移。

## 標示

社團自填內容一律附 `provider: "社團本人"`、`contentType: "circle"`、`status: "unverified"` 的來源條目，顯示為「**社團自述／尚未驗證**」，且不提供偽造的原始來源連結。

**不得以任何版面權重、措辭或官方標誌暗示已獲主辦確認。**

## 活動後退出

社團可決定自己填寫的補充資料在活動結束後是否繼續公開（`POST /api/circle/:circleId/visibility`）。

- **範圍只限社團自述內容。** 主辦公布的社團名、攤位與日期不受影響，仍留在場刊。
- 退出的內容在活動結束後**完全不出現在公開文件中**，而非由用戶端隱藏。
- 公開文件在**活動階段改變時重建**——活動結束不是一次編輯，沒有任何寫入會觸發它。
- **ETag 必須含活動階段**，否則快取會繼續提供已撤回的內容。
- **目前不主張任何例外。** 社團勾選退出，內容就從公開文件消失，沒有附帶條件。介面上不得出現本站尚無條款可依據的保留條款——曾經寫過一句比照 Comic Market 的「學術或研究用途的有限度查閱」例外，已於使用條款就緒前移除。日後若要主張任何例外，先有條款，再改介面。

**退出目前的語意是「不再公開」，不是「不再持有」。** `post_event_hidden` 只在活動結束後重建公開文件時把該列濾掉，資料列本身留著；`db/identity-repository.ts` 的 `DELETE FROM` 只出現在刪管理者與測試清空兩處，**沒有任何依到期時間清除資料的機制**。

[ADR-0018](../adr/0018-retention-is-the-circles-choice.md) 已決定在這之外**再加一個獨立的座標軸**——保存期限，**尚未實作**：「保留」（預設）不主動刪除；「活動後清除」在活動結束滿 90 天時刪除該筆補充資料與其代管縮圖，**但在那 90 天內維持公開**。期限與退出是兩件事：退出管的是活動後還公不公開，期限管的是資料還留多久，四種組合裡三種都有人會用。要更早消失的社團自己在控制面刪即可，不必等期限。

實作時的硬約束：期限與到期時間存成 `circle_overrides` 的欄位而非程式裡的常數、90 天自活動結束時間起算、清除是刪除資料列而非再加一個旗標、`audit_log` 記下刪除發生過但不留下被刪除的內容。清除跑在獨立的排程 Worker 上（[ADR-0022](../adr/0022-expiry-runs-in-a-separate-cron-worker.md)）——Cron Trigger 是 Workers 的功能，Pages 沒有——而**絕不得掛在 `/data/events/:eventId/overrides.json` 上**，那條路徑的每一次 revalidation 都是一次 Function 呼叫（[#48](https://github.com/dekkmarsvin/tw_doujin_event/issues/48)）。其餘各表的保存期限見 [ADR-0021](../adr/0021-credentials-expire-and-are-purged-records-are-kept.md)：憑證類（`login_tokens` 24 小時、`sessions` 到期後 7 天、`preview_mail_sink` 7 天）到期即刪，紀錄類（`accounts`、`circle_claims`、`audit_log`）不設期限。**`login_tokens` 的清除門檻必須大於一小時**，那張表同時是每小時速率限制的計數來源。

## 管理者

- **管理者名單存在資料庫（`admins` 表）而非設定值**，可在控制面即時增減、不需重新部署。
- **不得移除自己，也不得移除最後一位管理者**——兩者都是把自己鎖在門外的最短路徑。
- 名單為空時由 `ADMIN_EMAILS` 設定值重新灌入，作為救援路徑。上面兩道限制讓它不會正常地走到那一步。
- 管理者位址比對前先做與儲存時相同的正規化。
- 管理者可撤下任何社團補充資料；D1 公開文件立即移除，讀者端最長約一分鐘 revalidation 後不再顯示，不需額外用戶端內容過濾。

## 媒體安全

社團提供的縮圖來源限於**允許清單內的主機**（`THUMBNAIL_HOST_ALLOWLIST`）。任意主機會讓每位讀者的瀏覽器對外發出請求並暴露 IP——這是內容安全問題，不是樣式問題。

依 [ADR-0012](../adr/0012-first-party-sources-only.md) 退場工作簿縮圖索引後，**社團自填是縮圖的唯一來源**，這份清單因此同時是 CSP `img-src` 的主機集合，見[資料傳輸與離線契約](./delivery-and-offline.md#快取標頭)。

**目前社團只能貼網址，沒有上傳能力**：代表圖是三個文字欄位（圖片網址、出處頁面、來源標示），沒有 file input 也沒有 multipart 處理。允許清單裡只有 `i.imgur.com` 與 `drive.google.com` 是社團能主動上傳的圖床，另外三個是別的服務的 CDN，貼進來的通常是熱連結——失效時本站無法補救，降級行為是維持文字卡。

[ADR-0017](../adr/0017-thumbnails-are-self-hosted-with-external-urls-kept.md) 已決定改為**本站代管為主、外部網址為輔**的雙線，**尚未實作**。實作時的硬約束記在這裡，避免日後被無意違反：代管圖片以 R2 public bucket 加自訂網域服務、**絕不經 Pages Function**（見[資料傳輸與離線契約](./delivery-and-offline.md#快取標頭)）；上傳只做 MIME 與容量把關，不在 Worker 內做影像處理；檔名為內容 SHA-256；格式限 JPEG／PNG／WebP，單檔 2 MB，每個社團每個活動一張。代管圖片的保存期限與刪除規則屬於 [#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30) 的資料 inventory。

## 聯絡窗口

依 [ADR-0019](../adr/0019-personal-data-requests-go-to-the-mailbox-not-the-issue-tracker.md)：功能問題、資料顯示錯誤與 bug 回報走公開 GitHub issue；**涉及個人資料的查詢、更正與刪除走維運信箱**，不走公開 issue——那會讓一筆刪除請求本身變成永久公開紀錄。位址尚未設立，設立後必須同時出現在隱私告知與 `/circle`，並且不是個人信箱。

**著作權與內容爭議走同一個信箱**，這是社團自述內容與代管縮圖的撤下入口。對外的完整說法見[隱私權與資料使用告知](../policy/privacy-notice.md)（草案，尚未公開），它必須在閘控解除前上線，且描述的是實際行為——行為改了就在同一個 commit 改它。

## 公開端點

`/data/events/:eventId/overrides.json` 是唯一的公開補充資料端點，由 Pages Function 產出，帶 revision 與含活動階段的 strong ETag，使用 `public, max-age=60, must-revalidate`。閱讀端把它疊加在靜態 `circles.json` 之上；讀取失敗或 event mismatch 時只用 reviewed base。

## 驗收條件

- 閱讀端 bundle 不含登入介面、寫入 route 或 session cookie 名稱，也不載入 Turnstile。
- 沒有 Turnstile token 或 token 未通過驗證時，索取登入連結不寄出郵件、不寫入 `login_tokens`。
- 社團無法透過任何路徑修改自己的名稱、攤位或日期。
- 儲存前預覽的呈現與儲存後的公開呈現一致。
- 社團選擇活動後退出時，活動結束後公開文件裡查不到該筆內容，且快取不會提供舊版本。
- 管理者無法移除自己或最後一位管理者。
- 縮圖主機不在允許清單時被拒絕，且錯誤訊息可讓社團理解原因。
- 所有認領與撤下決策都可在稽核記錄中查到。
