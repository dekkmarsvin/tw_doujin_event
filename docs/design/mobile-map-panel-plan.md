# 手機地圖面板：方案 B 設計參考

設計日期：2026-09-12。此文件保存視覺方向與取捨；實作進度及待辦由 [GitHub issue #202](https://github.com/dekkmarsvin/tw_doujin_event/issues/202) 維護，不在 repo 複製狀態表。

## 參考與取捨

[選定的視覺參考](./assets/mobile-panel-implementation-2026-09-12/selected-reference.png) 將手機畫面重心留給地圖，以底部摘要承接選取，再用完整資訊視窗閱讀長內容。它解決舊面板混合工作入口與選取結果、返回地圖後失去選取脈絡的問題。

方案 A 僅壓縮原詳情，仍混合工作入口與結果；方案 C 以全畫面閱讀為主，離開地圖脈絡較遠。方案 B 因能同時保留位置與社團概要而被採用。正式決策與適用範圍見 [ADR-0056](../adr/0056-mobile-map-uses-workspace-and-selection-summary.md)。

生成圖用作版面參考，不是活動資料來源。實際攤位排、場館與社團內容以 pinned 活動資料及公開補充內容為準，不重排攤位來符合生成圖，也不補入虛構作品介紹。品牌、字體、色票與圖示沿用專案設計系統。

## 文件分工

- 外觀、字級及元件排列：[元件規格](./components.md)。
- 可見區、fit、選取與操作：[活動地圖契約](../contracts/event-map.md)。
- 分享連結與工作區投影：[URL 檢視狀態契約](../contracts/url-state.md)。
- 本機量測、截圖、重現命令與設備限制：[驗收紀錄](../../design-qa.md)。
