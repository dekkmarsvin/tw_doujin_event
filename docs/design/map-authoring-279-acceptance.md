# 地圖精準描摹 #279 驗收

## 切片一：畫布放置

本機 Chrome 153、1600×1100，透過真正的 Organizer 與地圖貢獻介面操作；API 使用 sample 合成回應與記憶體保存，不代表正式環境驗收，不寫正式資料。

- 所有設施工具只進入放置模式；預覽不新增元素，Escape、切換工具、pointercancel 均不留元素。
- 柱子拖曳外框、企業攤單擊置中、入口單擊座標在儲存 payload 逐項比對；原有全部攤位保持相同。
- 每次放置選取新元素、退出一次性工具；一次復原移除整個元素，重做可恢復。
- 切回排段拖出 T01–T02，下一段自動從 3 開始；一次復原移除整段。手動畫攤位的 Escape 不建立元素。舞台、其他區域、出口單擊與復原均通過。
- 15 項相關模組測試、局部 ESLint、TypeScript 通過。required CI 與正式部署結果記於對應 PR。

可重跑 journey：`tests/browser/map-authoring-placement.mjs`，由 `npm run test:browser` 自動發現。[機器報告](assets/map-authoring-279/placement-report.json)。

![Organizer 放置與選取](assets/map-authoring-279/organizer-placement.png)
![地圖貢獻切回連續排段工具](assets/map-authoring-279/contribution-row.png)

輔助線／吸附及底圖／精度仍由 #279 下一切片承接；本切片不代表 #279 全部完成。
