# Organizer 互動預覽驗收

2026-09-15，#212 CH20 首次發布前實測在 main `8e69a02` 發現預覽已配置攤位黑底、點擊無結果。缺少 tone 與 onSelect／selected 接線，阻擋互動預覽驗收；公開 Reader 的接線完整，未受同一問題影響。

修正起點 `894bc0d`，聚焦複查指出 Organizer 沒有 Reader 的 mint token；`85993b4` 改用 Organizer 既有 coral。驗收只涵蓋此缺漏，不重新審查其他 Reader 功能。

本機 `127.0.0.1:8788`、local D1 `.wrangler/local-portal` 的假候選「預覽互動驗收」含两天同代碼 S01／S02，第一日北風畫室，第二日南風工房。UI 實際結果：

- 預覽 0 errors／warnings；未選取攤位淺底深字，選取格反白且有外框。
- 滑鼠點 S01 顯示「S01 · 北風畫室」。
- ArrowRight → Enter 顯示「S02 · 北風畫室」。
- 切第二日回到選取提示；再選 S01 顯示「S01 · 南風工房」，不沿用第一日資訊。

證據：[第一日選取](assets/organizer-preview-2026-09-15/first-day-selection.png)、[第二日選取](assets/organizer-preview-2026-09-15/second-day-selection.png)。沒有寫入 production 候選；CH20 實際修正版預覽及送審另留在 #212，不以本機驗收當作正式發布。
