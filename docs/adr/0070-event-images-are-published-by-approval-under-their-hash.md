# ADR-0070：活動圖片由核准公開，以內容雜湊命名

- 狀態：已定案（2026-09-24）。由 [#396](https://github.com/dekkmarsvin/tw_doujin_event/issues/396) 實作。
- 相關 issue：[#396](https://github.com/dekkmarsvin/tw_doujin_event/issues/396)
- 延續：[ADR-0017](./0017-thumbnails-are-self-hosted-with-external-urls-kept.md)（公開圖片自行託管於 R2）、[ADR-0057](./0057-approval-starts-create-publication.md)（核准啟動發布）、[ADR-0068](./0068-published-event-settings-are-declared-amendments.md)（已發布活動的設定以宣告更正；本 ADR 擴充其允許清單）

## 問題

Google Search Console 對活動介紹頁的 Event 結構化資料回報「`image` 欄位未填」。全站品牌分享圖可以補上這個欄位，但所有活動都會顯示同一張圖；維護者決定讓主辦在建立活動時**選填**上傳活動自己的圖片。

活動內容只經核准 snapshot 發布，而發布 bundle 是寫進 event-data repo 的純文字檔，沒有二進位檔的路徑。社團代表圖雖然已經自行託管在公開的 `THUMBNAILS` bucket，但它屬於社團 overlay，不經核准；活動圖片若沿用同樣做法，未核准的圖片就會出現在公開網址。

## 決策

### 1. 圖片以內容雜湊命名，網址在上傳時就確定

- 公開位置是 `THUMBNAILS` bucket 的 `event-images/<sha256>.<ext>`。檔名只由位元組決定，所以上傳當下就知道核准後的公開網址；草稿、送審 snapshot 與 `event.json` 都直接記錄這個網址。產檔仍然不讀時鐘、網路或 bucket。
- 草稿記錄 `url`、`sha256`、`contentType`、`width`、`height`。網址必須等於由雜湊與類型推出的位置，草稿無法指向 bucket 裡的其他物件。
- 限制：JPEG、PNG 或 WebP，5 MiB 以內，寬度至少 1200 px，不限比例。沿用配置圖不解碼像素的結構檢查。

### 2. 上傳只暫存，核准才公開

- 上傳存進非公開的 `MAP_CONTRIBUTIONS` bucket，位於 `organizer-event-images/<candidateId>/`。依對外文案的最少必要資訊原則，不另設權利聲明勾選門檻。
- 儲存草稿或修正宣告時，若圖片有變，伺服器重新讀取暫存位元組並重新檢查，雜湊與尺寸都要與宣告相符，才接受儲存。
- **核准時、建立發布工作之前**，把暫存位元組複製到公開位置；只有對目前待審版本的核准會複製，過時的核准不會公開圖片。公開位置已存在就略過，所以重試核准、或保留原圖片的修正都不會重複寫入。複製失敗時核准以 503 退回，送審狀態不變，可以再次核准。
- 發布本身不碰 bucket，不改變發布 bundle 的格式，也不讓 dispatch Worker 取得新的 binding。

### 3. `event.json` 選填 `image`

- `event-definition/3` 新增選填的 `image: { url, width, height }`，沒有圖片時不寫出這個鍵。與 ADR-0068 的 `aliases` 相同：既有資料與已核准 snapshot 重建的位元組完全不變，**不升 schema 版本**。
- 活動介紹頁的 JSON-LD `image` 與 `og:image` 使用活動圖片；沒有圖片時使用品牌分享圖。社團頁與首頁一律使用品牌分享圖。

### 4. 擴充 ADR-0068 的更正允許清單

- 已發布活動的設定宣告新增「活動圖片」：宣告新圖片即更換，宣告 `null` 即移除。與基準相同時不保存，比對與其他設定相同。

## 後果

- 搜尋結果與分享卡片可以顯示活動自己的圖片，而且未核准的圖片從不出現在公開位置。
- 暫存上傳隨候選活動保存，候選活動不設期限。送審成功後刪除送審內容沒有使用的暫存；草稿可編輯期間不清理，因為協作者的儲存隨時可能指向任何一張暫存，提早刪除會讓草稿指向不存在的圖片。
- **接受的代價**：更換或移除後，舊的公開圖片仍留在 bucket。它不再被任何頁面引用，但舊版活動資料與還原流程可能仍指向它，因此不刪除。容量以張數計極小。
- 有圖片的核准多一次 R2 list，首次公開時再加一次 R2 寫入；每次送審多一次 list，有未使用的暫存時再加刪除。與既有用量相比可忽略，不新增 Cloudflare 產品或排程角色。

## 不在本 ADR 範圍

- 讀者端地圖畫面顯示活動圖片。
- 伺服器端轉檔或裁切。
- 清除不再被引用的公開活動圖片。
