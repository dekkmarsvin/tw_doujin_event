# ADR-0017：縮圖由本站代管，外部網址保留為第二條線

- 狀態：已定案（2026-08-19）
- 延續：[ADR-0012：資料來源只留主辦官網與社團本人](./0012-first-party-sources-only.md)
- 相關契約：[社團自助控制面契約](../contracts/circle-portal.md)、[資料傳輸與離線契約](../contracts/delivery-and-offline.md)
- 相關 issue：[#40](https://github.com/dekkmarsvin/tw_doujin_event/issues/40)、[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30)、[#48](https://github.com/dekkmarsvin/tw_doujin_event/issues/48)

## 脈絡

[ADR-0012](./0012-first-party-sources-only.md) 把「縮圖是否改為本站自行代管而非只依賴社團提供的 URL」列在不在範圍的最後一條。當時這是錦上添花：工作簿還供應著 262 張縮圖，社團自填只是補充。

[#34](https://github.com/dekkmarsvin/tw_doujin_event/issues/34) 退場那批 Drive 縮圖之後，這件事換了性質——**社團自填成為縮圖的唯一來源**，而那條路目前只有一種走法：社團自己先把圖託管在別處，再把網址貼進來。

問題出在「別處」是什麼。`THUMBNAIL_HOST_ALLOWLIST` 有五個主機，但只有 `i.imgur.com` 與 `drive.google.com` 是使用者能主動上傳的圖床；`i.pximg.net`、`pbs.twimg.com`、`lh3.googleusercontent.com` 是別的服務的 CDN，社團拿得到的通常是熱連結。熱連結會因為原站改版、隱私設定或防盜連而失效，而**失效時本站沒有任何補救手段**——我們手上只有一個已經指不到東西的字串。

## 決策

**本站以 R2 代管社團上傳的縮圖，同時保留貼外部網址這條路。兩條線並存，代管是預設。**

保留第二條線不是猶豫。已經把作品圖放在 pixiv、Twitter 或 Drive 的社團，不應該為了本站再上傳一次；而代管線一旦故障或撞上配額，外部線仍然能讓社團把圖放上去。代價是 CSP 的 `img-src` 不會收斂到只剩 `'self'`，這是明知並接受的。

介面上兩條線不對等：上傳是主要動作，貼網址是次要選項，並在旁說明熱連結可能失效且本站無法修復。

### 三個實作時不能選錯的約束

**一、代管圖片絕不經 Pages Function 服務。** R2 public bucket 加自訂網域，讓 Cloudflare CDN 擋在前面，只有 cache miss 才計入 Class B。若改成由 Function 代理圖片，一頁 30 張 × 3,000 名訪客就是 90,000 次／天，光是圖片就吃掉免費方案每日 100,000 次的 Worker 請求配額。

這條約束比 [#40](https://github.com/dekkmarsvin/tw_doujin_event/issues/40) 原本估的更緊：[#48](https://github.com/dekkmarsvin/tw_doujin_event/issues/48) 的實測確認 `/data/events/:eventId/overrides.json` 的**每一次 revalidation 都是一次 Function 呼叫，包含回 304 的那些**。overlay 已經獨佔了那份配額，圖片不能再進來分。撞上 Error 1027 的後果不是圖片變慢，是 overlay 一起消失。

**二、上傳路徑只做 MIME 與容量把關，不在 Worker 內做影像處理。** Function 的免費 CPU 額度是 10 ms／次。串流上傳到 R2 不耗 CPU（等待不計入），但影像縮放或重新編碼一定超。尺寸要求因此由社團自行處理，介面必須明說要求而不是默默拒絕。付費的 Cloudflare Images 不在本 ADR 採用範圍。

**三、檔名是內容雜湊。** 這讓代管圖片可以設長 `max-age` 加 `immutable`，也讓同一張圖重複上傳不佔額外空間。

### 上傳邊界

| 項目 | 值 |
|---|---|
| 格式 | JPEG、PNG、WebP |
| 單檔容量 | 2 MB |
| 每個社團每個活動 | 1 張（縮圖欄位本來就是單值） |
| 檔名 | 內容 SHA-256，副檔名由驗證後的 MIME 決定 |

1,341 個社團各一張、平均 500 KB 約 670 MB，佔 R2 免費 10 GB-month 的 7%；上傳次數以千計，對每月 1,000,000 次 Class A 沒有壓力。**免費額度不是這件事的約束，服務方式才是。**

## 這個決策沒有解決什麼

**它不改變已經貼進來的外部網址。** 既有的熱連結不會因為代管上線就自動搬家，也不打算批次搬——那需要本站主動抓取第三方 CDN 的位元組，正是 [ADR-0012](./0012-first-party-sources-only.md) 不做的事。舊網址失效時的降級行為仍然是既有的那個：沒有可用圖片就維持文字卡。

**它不減少責任，它增加責任。** 「本站存了一個指向別處的網址」與「本站儲存並散布這份位元組」在侵權上不是同一件事。撤下機制已經存在（管理者可即時移除），但正式條款必須有對應的說法，而正式條款是 [#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30) 的一部分。

## 後果

- **代管圖片落入 [#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30) 的資料 inventory。** 它是本站儲存的二進位內容，需要和文字欄位一樣有目的、保存期限、刪除規則與負責人。活動後退出（post-event opt-out）目前只處理文字補充資料，代管圖片要一併定義。**具體的保存期限數值由 #30 決定，本 ADR 只確定它必須被涵蓋。** 一個方向已經確定：管理者撤下與社團退出時採**刪除**，不是保留但不公開——留著位元組正是責任的來源。
- **`wrangler.jsonc` 目前只綁了一個 D1。** R2 binding 要加，而且 `d1_databases` 的先例已經證明：`env.preview` 不繼承頂層 binding，preview 要各自宣告一份，否則 preview 會直接沒有 bucket。preview 必須是不同的 bucket，理由和 preview 用不同 D1 一樣。
- **`img-src` 從五個外部主機變成五個外部主機加代管網域。** `THUMBNAIL_HOST_ALLOWLIST` 仍然是唯一權威，`public/_headers` 與它的一致性仍由 `tests/circle-overrides.test.mjs` 斷言。代管網域是新增項，不是替換。
- **社團端多了一條寫入路徑。** 目前 `/circle` 只有文字欄位，沒有 file input、沒有 multipart 處理。這是社團端第一次接受使用者上傳的位元組，容量與型別的把關失效會直接變成儲存空間與內容問題。

## 不在本 ADR 範圍

- R2 bucket 名稱、自訂網域與 DNS 設定。
- 保存期限與刪除的實際數值（[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30)）。
- 既有外部網址是否、以及何時搬進代管。
- 付費的 Cloudflare Images 或任何伺服器端影像處理。
- 社團端重新開放的時點——依 [ADR-0015](./0015-access-lifts-when-no-third-party-bytes-remain.md)，那是 [#38](https://github.com/dekkmarsvin/tw_doujin_event/issues/38) 加上重寫 git 歷史之後的事。在那之前代管沒有使用者，所以本決策可以先定，實作不急。
