# 社團自助控制面契約

參展社團在獨立入口 `/circle` 維護**自己的**公開資料。它**補充**而非取代人工快照發布：主辦提供的攤位與社團身分仍由版本控制的快照決定，社團填寫的內容是疊加其上、可即時撤下的補充層。

**實作**：[`app/circle-portal/`](../../app/circle-portal)、[`app/circle-portal-handlers.ts`](../../app/circle-portal-handlers.ts)、[`app/circle-overrides.ts`](../../app/circle-overrides.ts)、[`app/portal-crypto.ts`](../../app/portal-crypto.ts)、[`db/identity-repository.ts`](../../db/identity-repository.ts)、[`functions/`](../../functions)
**測試**：`tests/circle-portal-route.test.mjs`、`tests/circle-overrides.test.mjs`、`tests/identity-repository.test.mjs`、`tests/portal-crypto.test.mjs`、`tests/portal-transport.test.mjs`
**部署與密鑰**：[部署 runbook](../runbooks/deployment.md)

> 本文的「登入」指**社團為了維護自己的資料**而登入。這與 [資料匯入契約](./data-import.md) 裡「使用者授權外部服務以便匯入」是相反方向的兩件事，後者仍屬 P2 且未實作。

## 目前不對外開放

**FF47 期間 `/circle` 在 Cloudflare Access 閘控內，沒有 Bypass。** 本契約描述的行為全部已實作且有測試覆蓋，但沒有任何真實社團可以到達它——決策見 [ADR-0011](../adr/0011-ff47-is-not-a-public-launch.md)。

因此社團端的功能驗收只能在 preview 環境進行，見[部署 runbook](../runbooks/deployment.md)。邀請真實社團之前，還需要先完成隱私告知、保存期限與刪除政策。

## 入口分離

- **社團登入與編輯只存在於 `/circle`，不與閱讀端共用 bundle。** 閱讀端不得出現登入介面、寫入 route 或 session cookie 名稱，由 `tests/rendered-html.test.mjs` 以內容比對把關。
- 一般參觀者公開瀏覽、不需登入。社團登入**不介入**參觀者的收藏與行程。
- 社團入口不下載場刊：認領時的社團搜尋走 `/api/circle/search`，需要 session 且只回傳比對到的社團。

## 身分與擁有權

**email 一次性連結只證明控制某信箱，不證明身分。** 認領必須另有證據：

| 證據 | 結果 |
|---|---|
| 帳號網域與社團官網相符 | 自動通過 |
| 社團在已登錄於場刊的可抓取連結上公開驗證碼 | 自動通過 |
| 其餘 | 一律人工審核 |

資料庫層保證**一個社團同時只有一位擁有者**。所有認領與撤下決策寫入稽核記錄。

## 可編輯範圍

**可編輯，儲存後約一分鐘內公開**：販售資訊、筆名、連結、縮圖、作品／標籤類欄位（`creatorTypes`、`ageRatings`、`workTypes`、`referencedWorks`、`specialTags`）。

**永不開放**：攤位、日期、`SourceLink`。

**社團名稱不可由社團編輯。** 它仍是攤位比對鍵與縮圖索引 join key；但依 ADR-0010，名稱已不再參與 `circle.id`。名稱錯誤由管理者在**上游來源與 identity evidence registry** 更正。是否開放自行改名仍由 ADR-0007 管理，不能因 ID 穩定就順帶放寬。

`circle_name_key`、`circle_name_at_claim`、`source_row_at_claim` 保留為認領當時的稽核快照，不再用名稱推測或修復 identity。D1 cutover 只接受與靜態 catalog 相同的永久 mapping；受保護的管理端遷移會一起更新 claims、overrides、公開文件與 audit，未知或碰撞 ID 在寫入前拒絕。

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

## 管理者

- **管理者名單存在資料庫（`admins` 表）而非設定值**，可在控制面即時增減、不需重新部署。
- **不得移除自己，也不得移除最後一位管理者**——兩者都是把自己鎖在門外的最短路徑。
- 名單為空時由 `ADMIN_EMAILS` 設定值重新灌入，作為救援路徑。上面兩道限制讓它不會正常地走到那一步。
- 管理者位址比對前先做與儲存時相同的正規化。
- 管理者可撤下任何社團補充資料；D1 公開文件立即移除，讀者端最長約一分鐘 revalidation 後不再顯示，不需額外用戶端內容過濾。

## 媒體安全

社團提供的縮圖來源限於**允許清單內的主機**（`THUMBNAIL_HOST_ALLOWLIST`）。任意主機會讓每位讀者的瀏覽器對外發出請求並暴露 IP——這是內容安全問題，不是樣式問題。收緊主機清單也是未來讓 CSP `img-src` 從 `https:` 收緊的前提。

## 公開端點

`/data/events/:eventId/overrides.json` 是唯一的公開補充資料端點，由 Pages Function 產出，帶 revision 與含活動階段的 strong ETag，使用 `public, max-age=60, must-revalidate`。閱讀端把它疊加在靜態 `circles.json` 之上；讀取失敗或 event mismatch 時只用 reviewed base。

## 驗收條件

- 閱讀端 bundle 不含登入介面、寫入 route 或 session cookie 名稱。
- 社團無法透過任何路徑修改自己的名稱、攤位或日期。
- 儲存前預覽的呈現與儲存後的公開呈現一致。
- 社團選擇活動後退出時，活動結束後公開文件裡查不到該筆內容，且快取不會提供舊版本。
- 管理者無法移除自己或最後一位管理者。
- 縮圖主機不在允許清單時被拒絕，且錯誤訊息可讓社團理解原因。
- 所有認領與撤下決策都可在稽核記錄中查到。
