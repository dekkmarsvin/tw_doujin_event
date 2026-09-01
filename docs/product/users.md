# 使用者

三種使用者是誰、他們要做什麼、做到了長什麼樣。產品目的與範圍在 [`PRODUCT.md`](../../PRODUCT.md)。

## Users

### 1. 一般讀者 / Reader

Fancy Frontier 與其他台灣同人活動的一般參加者。主要在活動前搜尋、收藏與規劃，活動現場以手機定位下一個攤位。

Reader 的核心流程：

```text
搜尋或瀏覽
→ 找到社團
→ 查看攤位與社團資訊
→ 收藏
→ 收藏直接反映在地圖
→ 現場定位
```

P0 不要求 Reader 登入；收藏可保留在瀏覽器本機。

### 2. 參展社團 / Circle

參展社團本人或其管理者。主辦已經提供活動、日期與攤位等官方資料；社團只補充自己的內容，不建立或改寫官方配置。

Circle 的核心流程：

```text
找到自己的官方條目
→ 認領
→ 補充 Circle Cut / 簡介 / 作者 / SNS / Tag
→ 預覽
→ 公開
```

### 3. 活動主辦 / 維運 / Organizer

建立與維護活動資料的人。Organizer 的產品目標不是學會 repository workflow，而是透過 UI 完成活動建立、資料匯入、檢查、預覽與發布。

Organizer 的核心流程：

```text
建立活動
→ 設定日期
→ 選擇既有場館
→ 設定區域 / 攤位配置
→ 匯入 CSV / XLSX 社團資料
→ 驗證
→ 預覽
→ 發布
```

**P0 完成定義：以上流程不得要求修改 source code、手動編輯 production JSON/YAML、操作 Git、執行 CLI 或依賴 AI agent。**

既有 repository、pin、CI、review 等流程可以暫時作為內部發布實作，但不能被視為 Organizer 產品流程的最終完成狀態。

## Success Outcomes

### Reader

- 不需要人工把社團名單與配置圖交叉比對。
- 搜尋結果可以一個操作直接定位攤位。
- 收藏後立即能在地圖辨識位置。
- 手機上能在搜尋、社團資訊與地圖之間快速切換。

### Circle

- 可以找到並認領自己的官方條目。
- 可以自行維護自己的展示資訊，而不需要請網站維運者代改。
- 不能誤改 Organizer-owned placement。

### Organizer

最重要的成功指標：

> **建立下一場活動需要的 production code 修改次數 = 0。**

且最終產品流程同時滿足：

- Git 操作 = 0
- CLI 操作 = 0
- AI Agent 依賴 = 0
- 新活動新增 repository = 0
- 新活動新增 PAT / secret = 0

內部實作若仍暫時需要 repository review，應被視為待收斂的 implementation detail，而不是產品能力完成。
