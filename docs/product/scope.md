# 交付範圍與完成定義

每一項功能落在哪一個優先級、以及「做完了」的判準。產品目的、定位與決策 gate 在 [`PRODUCT.md`](../../PRODUCT.md)；各介面現況與驗收條件在 [`../contracts/`](../contracts)。

## P0 — Core Scope

P0 是產品成立所需的最小閉環；新增工作優先服務以下功能。

### Reader

- 互動地圖：拖曳、縮放、點擊攤位
- 日期切換
- 樓層 / Hall / Area 切換
- 社團名稱搜尋
- 作者名稱搜尋
- 攤位號搜尋
- Genre / Tag 篩選
- 社團卡片 / 詳細資訊
- Circle Cut
- SNS / Website 外部連結
- 收藏
- 收藏直接標示於地圖
- 可分享的活動 / 社團 / 攤位 URL state
- Mobile-first 操作

### Circle

- 社團認領
- 查看官方活動 / 日期 / 攤位資料
- 修改 Circle Cut
- 修改簡介
- 修改作者
- 修改 SNS / Website / Pixiv
- 修改 Tag
- 成人向標示
- 預覽公開結果
- 顯示最後更新時間

### Organizer

- 建立 / 修改活動
- 多日活動
- 選擇 / 管理 Venue、Floor、Area
- 建立 / 維護 Space
- CSV / XLSX 匯入社團資料
- 匯入前預覽
- 必要欄位驗證
- 重複攤位檢查
- 不存在的 Day / Space 檢查
- 避免錯誤匯入留下部分正式狀態
- 草稿 / 預覽 / 公開
- 修正 Organizer-owned data
- 管理入口、出口、廁所、本部等必要 POI

## P1 — Convenience Scope

P0 穩定後才優先考慮：

### Reader

- 個人 Memo
- 收藏分類 / 顏色
- 已逛 / 未逛
- 頒布物名稱搜尋
- 我的逛攤清單
- 收藏依配置排序
- 分享逛攤清單
- PWA / Offline Map

### Circle

- 頒布物與圖片
- 新刊 / 既刊
- 完售標示
- 暫時離席
- 複製上一場社團資料
- 跨活動 Circle Profile
- 多位成員共同管理

### Organizer

- 複製上一場活動
- 視覺化場地 Editor
- Drag & Drop 攤位
- 匯入欄位 Mapping
- Import Diff
- Version / rollback
- 多管理員
- 活動封存

## P2 — Optional Scope

只有在有實際需求時再做：

- PDF / 列印地圖
- CSV 收藏匯出
- 自動逛攤路線排序
- 社團更新通知
- 收藏跨裝置同步
- 跨活動追蹤社團
- 使用 / 收藏統計
- QR Code 分享
- 公開 API / Open Data Export

## Existing Features Outside the New Priority

既有程式可能已實作超過本文件 P0 / P1 的能力，例如進階行程、購物預算、地圖 contribution/revision、複雜 provenance / publication workflow 等。

本文件不要求為了「符合新 PRD」立即刪除已穩定存在的功能；但：

1. 它們不得自動成為後續新工作的優先理由。
2. 新 issue 必須能對應 P0 / P1 或有明確使用者需求。
3. 若維護成本持續高於使用價值，可以另外提出簡化或退役。
4. 不應為維持內部流程而阻止 Organizer 無程式建立新活動的產品目標。

## MVP Definition of Done

### Organizer

一名未接觸 repository 的活動管理者可以：

1. 登入管理介面。
2. 建立活動。
3. 選擇既有 Venue。
4. 建立活動日期。
5. 匯入社團資料。
6. 修正匯入錯誤。
7. 預覽互動地圖。
8. 發布活動。

全程不修改程式、不操作 Git、不執行 CLI、不使用 agent。

### Reader

可以：

1. 打開活動。
2. 搜尋社團 / 作者 / 攤位。
3. 定位到地圖。
4. 查看 Circle Cut 與必要資料。
5. 收藏。
6. 在地圖看到收藏位置。

### Circle

可以：

1. 找到自己的社團。
2. 完成認領。
3. 修改 Circle Cut。
4. 修改社團簡介。
5. 新增外部連結與 Tag。
6. 在公開頁看到更新。
