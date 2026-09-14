# GitHub App token 驗證（2026-09-14）

對應 [#243](https://github.com/dekkmarsvin/tw_doujin_event/issues/243)、[PR #251](https://github.com/dekkmarsvin/tw_doujin_event/pull/251) 與 [ADR-0058](../adr/0058-publication-is-enforced-by-the-app-not-the-ruleset.md)。本文件保存工程驗證及正式驗收的實際邊界；即時狀態以 GitHub 為準。

## 版本與共同 gate

- PR head：`722c575bb4cf13168853d93929fcd8eb1370d8ad`；main merge：`d487a36e242317289ff14bea55a54e41dbd1498e`。
- 本機使用 Node `24.20.0`／npm `11.19.0`：`npm ci`、focused tests 45/45、module tier 422/422、D1 tier 204/204、lint、TypeScript、doc-map 與 diff check 通過。
- 本機完整 suite 668/669：`preview-mail-sink` 在檔案載入時出現 `fetch failed`／`bad port`；原樣單獨重跑 5/5 通過。原始失敗保留，基礎設施後續見 [#205 記錄](https://github.com/dekkmarsvin/tw_doujin_event/issues/205#issuecomment-5662005193)。沒有改弱 assertion 或將重跑冒稱首次成功。
- [同 head CI](https://github.com/dekkmarsvin/tw_doujin_event/actions/runs/34828917334) 在 Node `24.20.0`／npm `11.19.0` 下 673/673 tests 通過；Browser acceptance、Full preview portal E2E、preview deploy／smoke 與 CodeQL 通過。
- [合併後 CI](https://github.com/dekkmarsvin/tw_doujin_event/actions/runs/34829304799) 的 production 部署、Pages production-origin smoke、Browser acceptance 與 advisory custom-domain observation 通過。push 的 Full preview portal E2E 依 workflow 設計 skipped，不替代 PR head 的結果。

## 獨立 review

agy 使用獨立 conversation `770b0383-7b50-4878-9141-88208938be32`，helper exit 0、無 denied actions，實際結果 PASS；派發時配額 70.5457%。Astra/low 對實際 diff 的 token、權限、錯誤遮蔽與 route 接線複核亦 PASS，沒有 scope 內 findings。

review 與測試涵蓋 WebCrypto RS256、PKCS#1／PKCS#8、JWT 時差與期限、cache／singleflight、依到期時間更新、matching-token invalidation、401 重試一次、403 不刷新、固定 metadata probe、fresh-admin 與 secret sentinel。這些結果不替代已部署 runtime 的真實憑證驗收。

## 正式 runtime 驗收

`2026-09-14T09:44:07.052Z`，於 `https://map.kotoban.top` 的既有瀏覽器 session 呼叫固定 `POST /api/admin/integrations/github/probe`，body 為 `{}`，實際回應：

```json
{"error":"管理操作需要重新登入。","code":"admin_session_stale"}
```

HTTP 401、`Cache-Control: no-store`。請求停在既有 fresh-admin gate，尚未執行 GitHub mint/read，不能當作 installation token 成功證據。

重新登入時，登入連結未寄出，UI 回報「服務尚未設定完成」。production encrypted-secret 名稱清單未列 `TURNSTILE_SECRET`，但這份清單不能單獨證明同名 plain-text variable 不存在，亦未證明設定問題由本機或 CI 覆寫造成；先前將它直接判定為缺少 binding 的說法不夠精確。`GET /api/auth/config` 在 `2026-09-14T09:45:58.699Z` 回 200，公開 sitekey 與既有 Turnstile widget 相符。

將既有 widget secret 寫入 Pages production 的操作被自動核准審查拒絕（僅回 `blocked by policy`），main 未執行寫入。維護者後續回報已修正 `TURNSTILE_SECRET`。查核發現同一 main SHA 已有[新的成功部署](https://github.com/dekkmarsvin/tw_doujin_event/actions/runs/34832012962)（workflow_dispatch，建立於 `2026-09-14T10:12:35Z`），Pages deployment 為 `8d76dbfd-5f66-458e-aa28-0dc56a033d1e`。main 未重複覆寫密鑰或再次部署。

正常管理者登入後，`2026-09-14T10:22:10.144Z` 再次由正式站呼叫同一固定 probe，實際回應 HTTP 200、`Cache-Control: no-store`：

```json
{"ok":true}
```

固定 helper 只有在 Workers WebCrypto 簽發 App JWT、GitHub installation-token endpoint 回 201，且 `dekkmarsvin/tw_doujin_event-data` metadata 回 200 並核對 repository identity 後才回成功。這次結果證明真實 runtime 的 token 簽發及唯讀 API 可用；回應不含 private key、JWT 或 installation token。

較早一次成功登入後的 probe 觀察超過 browser tool 預設三秒期限，未取得回應，未列為成功或失敗證據；上述結果來自明確設定十五秒觀察期限的下一次唯讀 probe。

publication mode 保持 disabled，未對 CH20 執行 retry、reopen 或發布。沒有把 secret 值、private key 或 token 保存至本文件、log、audit 或回給瀏覽器的內容。#243 的真實 token 簽發條件已具證據；ADR-0058 其餘啟用條件與 #212 正式發布／failure-retry 仍須分別驗收。登入設定修復屬維運補救，不記為 Organizer 正常首次發布流程。
