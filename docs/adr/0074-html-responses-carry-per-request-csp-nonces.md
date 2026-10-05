# ADR-0074：HTML 回應使用每次請求的 CSP nonce

- 狀態：部分被取代；[ADR-0077](./0077-circle-share-images-follow-published-media.md) 新增社團分享 HTML 重寫／持久化讀取例外，CSP nonce 與快取規則不變。本 ADR 部分取代 ADR-0008 的 HTML 直送要求。
- HTML 不重寫／無持久化讀取的社團分享例外見 [ADR-0077](./0077-circle-share-images-follow-published-media.md)；CSP nonce 與快取規則不變。
- 相關契約：[資料傳輸與離線](../contracts/delivery-and-offline.md)

## 決策

保留 Cloudflare Bot Fight Mode 與 JavaScript Detections，讓 HTML 經既有 Pages Functions middleware 產生 256-bit 隨機 CSP nonce。公開場刊、地圖 JSON、JS、CSS、字型、圖片、manifest、Service Worker 與 sitemap 仍靜態直送；`public/_routes.json` 明列 HTML 與既有 API／overlay 路由，不新增 Worker 或持久化讀寫。

HTML body 不重寫。既有同源 scripts 繼續由 `'self'` 放行；Cloudflare 從 origin CSP 取得 nonce 並加到其偵測腳本。不得替任意 inline script 自動加 nonce，也不加入 script `unsafe-inline`、`unsafe-eval` 或固定 nonce。Turnstile 僅在原 `/circle*`、`/organizer*` policy 放行。

HTML 網路回應為 `private, no-store`，亦明確禁止 CDN 快取。轉交靜態資產前移除條件式與 range headers，回應移除 ETag／Last-Modified，避免 304 把舊 body 與新 nonce 拼接。API 私人預覽的 sandbox CSP 與公開 overlay ETag 不受影響。

Reader 的離線 Cache API 仍以單一 Response 保存完整 body 與 CSP，離線回放同一文件時維持配對；不拆開更新 nonce，也不共用到其他使用者的 CDN 快取。重新連線取得的新 HTML 必須有新 nonce。`public/_headers` 保留原嚴格政策作靜態／fail-open 備援；備援可載入 Reader，但不保證 JSD 執行。

## 成本與驗收

每次線上 HTML 請求新增一次既有 Pages Function invocation，無 D1／R2 操作；不把每次 JS、圖片或場刊讀取變成 Function。依 Workers Paid 帳號用量核算，HTML 月請求量尚未量測，不推算固定金額。

測試涵蓋 nonce 唯一性、policy 同步、條件式請求、HEAD、API sandbox 與 route 排除。部署驗收另需在受 Cloudflare Bot Fight Mode 保護的網域比對 CSP nonce 與 JSD script nonce，確認 Reader、登入入口及離線載入。純本機／pages.dev 檢查不能代替 JSD 邊緣注入驗收。
