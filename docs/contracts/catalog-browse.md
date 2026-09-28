# 品書瀏覽契約

同一活動內，讀者由品書、作品或題材找社團，再收藏並定位正確日期與攤位。

**實作**：`app/catalog-browse-app.tsx`、`app/catalog-browse-projection.ts`、`app/catalog-browse-url.ts`、`app/catalog-browse-history.ts`、`app/reader-navigation.tsx`、`app/reader-planning.tsx`、`app/public-circle-search.ts`、`app/public-search-url.ts`、`app/public-share.ts`
**測試**：`tests/catalog-browse.test.mjs`、[tests/browser/catalog-browse.mjs](../../tests/browser/catalog-browse.mjs)
**決策**：[ADR-0075](../adr/0075-catalog-browse-shares-the-reader-catalog-and-public-search.md)

## 資料與結果

- 使用既有 catalog publication 的 reviewed base + circle overlay，收藏沿用 planning store；不新增資料來源或後端。
- 先套日期、場地及公開條件，再以 `CircleRecord.id` 分組。同名不同 ID、同攤不同社團各自成卡；跨日同 ID 合成一張。不同日期與場地仍保留各筆配置。
- 搜尋、分類、題材別名、排除、任一／全部及逐值分級，與地圖共用 predicate。關閉地圖私人篩選及導航時，在相同公開條件與範圍下，地圖的 distinct circle 集合必須等於品書卡與無品書文字卡的聯集。
- 社團數按 distinct ID；配置數按符合條件的 placement；品書數指有 `media.kind=catalog` 的社團數。代表圖不算品書。
- 以最早有效配置的日曆日期、活動場地順序、自然攤位碼排序；全失效社團排最後。有效配置連到正確 day／venue／circle／booth；moved／cancelled 不推測目的地，不提供錯誤地圖跳轉。
- 題材捷徑來自目前日期／場地的社團 facet 並按 ID 去重，先顯示兩項，可展開其餘項目。套用條件與詳細搜尋草稿分離。

## 圖片、分批與狀態

- 卡片僅讀第一張 catalog 的 `previewUrl`，以既有寬 640px、最高 960px 預覽尺寸保留空間，前端不再次裁切或拉伸；長品書在製作預覽時已有頂端裁切，完整內容由社團出展頁讀原圖。瀏覽頁不預讀完整圖片。
- 品書卡初始 24 張，按「載入更多」增加 24 張；無品書文字卡另以 24 筆分批。圖片 lazy load；兩區互不重複，文字區入口在品書前可見。
- base／overlay 未完成不顯示零結果；base 失敗與 overlay unavailable 分別提示，重試走既有 publication retry。成功但沒有品書時，區分整場、所選範圍及目前搜尋；搜尋零結果保留條件與可清除入口。
- 單張圖片失敗只替換圖片區塊，出展頁、收藏及配置入口仍可用。分級顯示原本全部明示值，不能以最高分級覆蓋其他值。

## 狀態、分享與導航

- URL 以[URL 契約](./url-state.md#品書瀏覽與檢視切換)為準；分享只含已套用公開條件，私人收藏／群組／行程／備註、選取與未套用草稿不外傳。
- 系統分享失敗後嘗試複製文字與連結，再失敗提供手動複製；使用者取消系統分享時不自行複製。分享為動態結果，內容會隨社團公開資料改變。
- 同文件地圖／逛品書切換共用 event-level planning owner，保存未能寫入儲存空間的記憶體資料、錯誤與 7 秒收藏復原；資料管理匯出同一份狀態。跨文件社團頁仍使用既有 localStorage／storage 協定。
- 卡片收藏不建立行程；具體活動日的行程由既有出展頁或地圖加入。
- 760px 以下兩個畫面共用底部「探索／行程／逛品書」，桌機切換在頁首（[ADR-0076](../adr/0076-phones-switch-reader-views-from-the-bottom-bar.md)）。從逛品書點探索回到面板收合的地圖；點行程以該筆 history state 一次性要求展開今日行程，地圖開啟後即清除；在逛品書點逛品書回到頁首。
- browse history entry 保存目前公開 URL、兩區已顯示筆數與 scrollY。返回／前進於資料完成後還原；搜尋或範圍變更重設為首批及頁首。位置資訊不寫入分享 URL，也不新增持久儲存。
- metadata 使用 browse 專屬 title／description 及活動 canonical；切換時不得殘留社團 canonical 或無效活動 noindex。活動選擇頁、Reader 頁首及活動介紹皆提供入口，不因目前無品書而隱藏。
