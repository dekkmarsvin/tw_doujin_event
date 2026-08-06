# WebCatalog 收藏測試驗證補記

紀錄日期：2026-08-06

本補記延續 [資訊介面、收藏與資料串接紀錄](./comike-webcatalog-information-favorites-integration-research.md) 的收藏測試。

## 已驗證結果

- 收藏顏色由橘色改為藍色後，離開頁面再回到社團詳情，藍色分類仍存在。
- 在收藏 Memo 輸入 `research-check`、關閉浮層並經過免費會員 5 分鐘重置後，社團詳情仍顯示該 Memo，證明 Memo 會跨頁及跨等待狀態持久保存。
- 再次點擊實心愛心後，按鈕恢復灰色空心未收藏狀態。
- 重新載入社團詳情後，測試 Memo 不再存在，證明移除收藏時會一併清除該收藏的顏色與 Memo。
- 測試完成時帳號未留下 `ハルノヤマ` 的研究用收藏或 `research-check` Memo。

## 收藏資料語意

由上述結果可確認 WebCatalog 的收藏記錄實際上是同一個生命週期內的複合資料：

```text
favorite = circleId + colorId + memo
```

移除收藏不是只切換畫面上的愛心，而是刪除對應顏色與 Memo；本專案若採用相似模型，刪除前應明確決定是否需要確認或復原機制。
