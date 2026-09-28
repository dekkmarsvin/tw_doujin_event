# ADR-0075：品書瀏覽共用 Reader 場刊與公開搜尋

狀態：生效

## 脈絡

地圖適合定位攤位；展前尚未決定要逛哪些社團的讀者，需要先看品書及作品內容。重建名單、收藏或搜尋語意會使兩個入口出現不同結果，跨日配置也不能被當成不同社團。

## 決策

1. 根 query `view=browse` 增加內容瀏覽視圖，仍使用同一個 EventEntry、catalog publication、CircleRecord 與 planning store，不新增 router、資料 API 或 Cloudflare 產品。
2. 抽出公開搜尋與 URL codec，地圖私人篩選仍由地圖處理。瀏覽結果先限縮配置再依社團 ID 聚合；預設全日期、全場地，切換規則見 URL 契約。
3. 使用既有 catalog 預覽與出展頁原圖；首批 24 張並明確載入更多，不建立獨立圖片快取或預抓策略。
4. 同文件 Reader 視圖由共同 owner 保存 planning 記憶體狀態與復原期限，避免儲存失敗時切換視圖丟失資料。出展頁仍是獨立文件。
5. 分享的是公開搜尋結果，不是固定社團清單，也不包含私人規劃資料。既有地圖定位與出展頁路徑不變。

## 代價與邊界

Reader bundle 增加瀏覽介面；以 bundle 與 300 社團 journey 量測代價，不先增加懶載入路由或 Service Worker 規則。實作與 fixture 驗證不代表真實活動已有足夠的社團品書；正式內容採用必須由實際公開資料另行驗收。

## 契約

[品書瀏覽](../contracts/catalog-browse.md)、[URL 狀態](../contracts/url-state.md)、[收藏規劃](../contracts/planning.md)、[社團目錄](../contracts/circle-catalog.md)。
