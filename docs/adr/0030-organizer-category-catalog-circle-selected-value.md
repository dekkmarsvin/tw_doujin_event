# ADR-0030：主辦分類目錄是活動資料，逐社團類別是社團自述

- 狀態：已定案（2026-08-21）
- 來源：[開拓動漫祭社團主題類別](https://www.f-2.com.tw/%E7%A4%BE%E5%9C%98%E4%B8%BB%E9%A1%8C%E9%A1%9E%E5%88%A5/)

## 問題

官方-only cutover 已移除工作簿提供的逐社團內容，但 production `event.json` 仍保留「繪圖・創作、Cosplay、VTuber、手作・模型、學生社團、代理社團」作為篩選選項。畫面因此顯示一套已沒有資料權威、也與主辦現行分類不一致的空分類。

社團控制面同時只有自由文字作品 facet，無法從活動主辦公布的分類中選擇自己的主要類別。

## 決策

1. `event-definition/3` 以 organizer ID、catalog ID 與 revision 選取 `reference-data-pin/2` 固定的 `category-catalog/1`；分類字彙、定義、來源網址與擷取時間只保存在 reference record。
2. 共用程式驗證 pin／selection 後才解析與投影分類目錄；FF47 的十四項名稱不寫進 event JSON、元件或 TypeScript 常數。
3. 官方 base 不替個別社團指定類別。經驗證的社團可在 overlay 的單值 `circleCategory` 從 active event 目錄選一項；寫入端拒絕目錄外文字。
4. 閱讀端主要類別篩選、URL `genre`、地圖與清單全部消費同一個衍生值。舊工作簿分類不做別名或自動遷移。
5. 分類目錄是主辦來源；逐社團選擇仍標示為「社團自述／尚未驗證」。兩種 provenance 不合併。

## 後果

- 新活動只需在其版本化 event definition 選取 pinned 分類目錄；共用 UI 與 validator 不因主辦或類別數量改碼。
- 主辦日後調整分類時，reference-data repo 發布新 revision，event-data repo 更新 reference pin／selection，主 repo 最後更新 event-data pin；舊版本仍可重現。
- 尚未自填的社團歸在「全部類別」而不被猜測分類。選取特定類別只會顯示已自行選擇該類別的社團。
