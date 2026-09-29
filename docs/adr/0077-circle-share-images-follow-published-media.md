# ADR-0077：社團分享縮圖使用已公開的圖片選擇

- 狀態：已定案；依維護者要求在 `/circle` 的「分享公開頁」提供縮圖選項。
- 部分取代 [ADR-0070](./0070-event-images-are-published-by-approval-under-their-hash.md) 的社團頁固定品牌圖，以及 [ADR-0074](./0074-html-responses-carry-per-request-csp-nonces.md) 的 HTML 不重寫／無持久化讀取限制。

## 決策

社團可在「分享公開頁」選擇品牌通用圖、目前代表圖或其中一張品書，選擇與其他欄位一起預覽、確認儲存。`shareImage` 存在既有 overlay 的 `fields_json`，預設為品牌圖，不新增資料表、上傳入口或圖片產生服務。品書以完整圖片 URL 識別，重新排序不改變選擇；移除所選圖片時回到品牌圖，不讀取已移除的 URL。

成功回傳社團介紹 HTML 的既有 Pages Function 讀取該活動、該社團目前可公開的補充資料，只改寫 `og:image` 與已知尺寸。標題、描述、canonical 與官方內容仍使用靜態 HTML；未知代表圖尺寸時移除通用圖的尺寸。選擇不放在 query string，分享同一公開網址都使用已儲存的設定。

公開查詢共用 overlay 的 live、verified claim 與活動結束後隱藏條件，直接讀取單一社團，不觸發 schema 初始化、文件重建、修復或稽核寫入。活動仍以這次部署的靜態資料為準。讀取失敗、未選圖、圖片已移除、資料撤下或不再公開時使用品牌圖。HTML 不內嵌 overlay，不保留草稿或私人資訊。

沿用 HTML 的每次回應 CSP nonce 與 `private, no-store`；不替任何 script 加 nonce。靜態場刊、地圖、圖片、JS/CSS、字型、manifest 與 Service Worker 路由不變。分享平台本身可能保留舊縮圖，介面不承諾立刻刷新第三方快取。

## 成本

不新增產品、Worker、排程或持久化層。每次成功的社團 HTML GET 新增一次限定活動與社團的 D1 SELECT，沒有 D1／R2 寫入；每個 isolate 首次使用活動時沿用既有靜態場刊快取載入。其他 HTML、HEAD、redirect、404 與非 HTML 不新增這次查詢。月社團頁請求量尚未量測，不推算固定費用。
