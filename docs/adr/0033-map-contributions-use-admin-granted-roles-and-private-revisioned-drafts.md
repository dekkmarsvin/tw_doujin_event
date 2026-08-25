# ADR-0033：地圖貢獻採管理者授權與私人版本化草稿

- 狀態：已定案（2026-08-24）
- 補充：2026-08-25 明文化 approved/exported 稿被新核准稿取代時的 `withdrawn` 狀態與保存期限
- 相關 issue：[#67](https://github.com/dekkmarsvin/tw_doujin_event/issues/67)、[#72](https://github.com/dekkmarsvin/tw_doujin_event/issues/72)、[#73](https://github.com/dekkmarsvin/tw_doujin_event/issues/73)

## 問題

現行地圖 authoring 是可信任的本機流程。把它擴張為產品內投稿控制面，會新增角色授權、私人原始檔、平行編輯、審閱紀錄與清除責任；這些不能由實作者在建立 route 或資料表時臨時決定。

## 決策

### 角色

1. `map_contributor` 使用現有 magic-link 帳號，但只由管理者授予或撤銷；社團認領不授予地圖貢獻權。
2. 撤銷立即阻止新增、修改與提交。既有審閱紀錄保留，但不得讓被撤銷者繼續持有可寫入能力。
3. 管理者授權、撤銷與緊急停權都寫入 audit。

### 草稿與審閱

1. 同一個 `eventId + day/period + venueSpaceId` 可有多份平行草稿。每份有不可變 draft ID 與遞增 revision，寫入使用 optimistic concurrency；revision 落後時拒絕覆寫並要求重新載入。
2. 同一活動空間同時只能有一個 approved revision。核准新 revision 前必須明確取代或撤回既有 approved revision。
3. 狀態機是 `draft -> submitted -> changes_requested -> submitted -> approved -> exported`；`rejected` 是終止狀態，不能直接 exported。需要重做時建立新 draft 或新 revision。核准同範圍的新稿時，既有 `approved` 或 `exported` 稿原子地轉為 `withdrawn`，新稿才轉為 `approved`；`withdrawn` 也是終止狀態。
4. `exported` 只表示已產生 event-data 候選檔；仍須經該 repo 的 diff、schema gate 與 repository review，不能直接發布到公開站。

### 原始檔

1. 接受 JPEG、PNG、WebP 與 PDF；單檔上限 20 MiB，PDF 最多 20 頁且不得加密。
2. 伺服器驗證宣告 MIME、檔案 signature、容量與 PDF 基本結構。原始檔只存私人儲存區，不在公開端 inline 顯示，也不執行 PDF 內嵌 script、action 或附件。
3. 審閱預覽只能使用不執行 active content 的安全呈現路徑；原始檔下載必須以 attachment、`nosniff` 與明確權限檢查回應。
4. 原始檔永久 metadata 只保留官方來源 URL、文件日期、頁碼、SHA-256、MIME、容量、尺寸／頁數及審閱結果，不公開檔案本身。

### 保存與帳號刪除

| 狀態／資料 | 處置 |
|---|---|
| `draft` 連續 180 天無活動 | 刪除草稿內容與原始檔 |
| `changes_requested` 連續 180 天無活動 | 刪除可編輯內容與原始檔；保留去識別化審閱紀錄 |
| `submitted` | 審閱完成前不自動刪除；以營運報表顯示長期未審案件 |
| `approved`、`rejected`、`exported`、`withdrawn` 的原始檔 | 決定發生 30 天後刪除；永久 metadata 與審閱結果保留 |
| 從未提交的 draft 所屬帳號刪除 | 立即刪除草稿與原始檔 |
| 已進入審閱流程的帳號刪除 | actor 去識別化；審閱紀錄保留，原始檔依狀態期限清除 |

Audit 列不設自動刪除期限，帳號刪除時清除可識別 actor；IP hash 沿用現行 90 天清除規則。所有清除 job 必須可重跑，且留下不含被刪內容的摘要紀錄。

## 後果

- 平行草稿不互相覆寫；真正競爭的只有 approved revision。
- `submitted` 不會因時間經過而在審閱中消失，但必須能被營運看見，避免無期限遺忘。
- PDF 仍可作為官方配置證據，但不能成為公開資產或執行 active content 的入口。
- 角色、草稿、原始檔、audit 與 retention 必須納入 data inventory；若對外行為影響投稿者決策，再以最少必要揭露同步 privacy notice。
- [#72](https://github.com/dekkmarsvin/tw_doujin_event/issues/72) 提供角色與私人資料基礎；[#73](https://github.com/dekkmarsvin/tw_doujin_event/issues/73) 在 #69 與 #72 完成後實作投稿、審閱、替代與候選匯出。
