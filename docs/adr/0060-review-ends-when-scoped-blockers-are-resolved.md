# ADR-0060：範圍內 blocker 解決後，review 必須結束

- 狀態：Accepted（2026-09-14）
- 依據：維護者已確認的最小 Agent review 流程修正；#212 的 reviewer 執行安排
- 部分取代：[ADR-0040](./0040-review-findings-are-bounded-by-the-ticket.md) 決策 2–4 中的 finding 處置與熔斷方式；保留其歷史理由及本機資料維運威脅模型

## 脈絡

近期 review 已能限制單一 PR，卻仍把非阻擋觀察轉成獨立 Issue，並讓後續 review 重啟同一工作。需要明確的開票門檻、聚焦 verification 與完成條件，讓第二場真實活動的發布持續前進。

## 決策與取代範圍

可執行規則唯一保存在 [review-fix loop](../agents/review-loop.md)。ADR-0040 決策 2–3 的必要修正之外，允許可選的局部改善；超範圍不再直接要求另開 Issue。決策 4 的「修正新增檔案即停止」改由需求是否擴張判斷，三輪熔斷按同一工作累計，不因換 PR 或 reviewer 重置。其餘編成、證據與 Done 條件由該流程定義。

本決策不改 ADR-0040 決策 1 的適用範圍，也不把它延伸至網路 publication。既有 required CI checks、發布安全邊界、產品驗收及 #104 的發布後更正範圍不變。

## 後果

非阻擋觀察可以直接結束或留在既有承接處；重大風險的新證據仍須重新判斷。Review Done 不要求清空 backlog，也不等同產品里程碑完成。
