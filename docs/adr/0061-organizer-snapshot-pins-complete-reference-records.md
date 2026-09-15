# ADR-0061：Organizer 送審固定完整 reference 記錄

- 狀態：Accepted（2026-09-14）
- 依據：#248 與其已核定接口；供 #244／#212 首次發布使用。
- 延續：ADR-0030、ADR-0039 的公開 reference 格式與版本邊界。

Organizer 可在活動設定建立或選取主辦與分類目錄。主辦恰好一位 lead，可有協辦／合作夥伴；分類目錄必須屬於已選單位，且分類不可空白。名稱、分類與官方 HTTPS 來源由使用者輸入，系統產生識別碼。首版只有建立與選取，沒有修改既有公開記錄的介面。

控制面以 `organizer_reference_records` 保存 canonical JSON、固定擷取時間與建立者；建立／audit 為同一交易，並檢查 candidate 版本、可編輯狀態及角色。建立可重用記錄不等於套用候選；套用仍走原本的 versioned draft save。主辦／分類／場館／空間共用公開 parser，不複製另一套較寬鬆的格式。

新送審採 `organizer-submission-snapshot/3`：包含完整 reference selection、各 path 的原始 JSON bytes 與 SHA-256。validate、preview、submit 使用同一 resolver。`contentUpdatedAt` 固定為該候選 revision 的建立時間。既有 `/1`、`/2` snapshot 與 hash 不改寫；#244 不可為缺少 reference 的舊 snapshot 推測資料。

既有場館 seed 的 adoption 只填補缺少的 canonical 記錄，不在每次初始化覆寫。FF47 場館／空間採 data commit `8c645303fa6838383549fbe8433ece081c514e1e` 原 bytes（`2026-08-25T03:43:00Z`）；其餘 seed 依 #248 的官方來源查核固定 `2026-09-14T10:31:38Z`。選單友善名稱與公開名稱分開；「全館」不改写「爭艷館展區」。新增場館／空間在建立交易內固定 canonical 記錄。缺少完整來源的舊記錄拒絕送審，不以目前時間或其他活動來源補值。

此決策僅完成產檔前置。#244 負責將已核准記錄加入 data repository、保留既有相同內容及產生 pin；不在本切片接通 publication 或啟用 production。發布後更正仍留在 #190／#104 的下一里程碑。

2026-09-15 真實 CH20 驗收補充（#212）：既有非 seed 場館／空間已有來源 URL，但早於 canonical 記錄功能建立。允許使用者在 UI 重新核對來源、明確輸入公開名稱與網址，為該候選已選取且仍缺記錄的項目建立 canonical bytes。時間代表此次明確核對，不能在背景初始化或送審時自動推測；僅建立缺漏記錄，既有公開記錄、目錄友善名稱及歷史 snapshot 仍不可改寫。
