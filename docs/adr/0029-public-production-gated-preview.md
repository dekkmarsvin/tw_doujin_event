# ADR-0029：production 公開、preview 持續受 Access 保護

- 狀態：已定案（2026-08-21）；Error 1027 實測 gate 已由 [ADR-0031](./0031-quota-exhaustion-is-not-a-release-gate.md) 取代
- 具體化：[ADR-0015](./0015-access-lifts-when-no-third-party-bytes-remain.md)
- 部署驗證調整：[ADR-0034](./0034-production-origin-gates-deployment.md)
- 相關 issue：[#48](https://github.com/dekkmarsvin/tw_doujin_event/issues/48)

## 決策

完成資料與隱私 gates 後，production 移除 Cloudflare Access，preview deployment 仍留在 Access 內。CI 必須分開檢查：production deployment origin 不帶 service token 仍可讀取靜態首頁，正式自訂網域則以不阻擋部署的匿名觀測確認公開邊界；preview 不帶 token 必須被導向 Access，帶 token 才能跑 smoke 與 portal E2E。

正式公開入口是 <https://map.kotoban.top/>。`tw-catalog.pages.dev` 是 Pages 提供的 production origin，維持公開，只供部署 smoke 與故障排查，不作為對外正式入口；`*.tw-catalog.pages.dev` 涵蓋 PR alias 與不可變 deployment URL，維持 Access 閘控。

`overrides.json` 的 304 由 Pages Function 讀 D1 後決定，因此節省頻寬但不節省 Function invocation。production 公開前必須取得實際 Error 1027／配額耗盡時的行為證據；在那之前只把「靜態 base 應可繼續」視為待驗證假設，不寫成契約。

## 後果

- Access service token 繼續是 preview CI secret，但不得被 production smoke 當成成功前提。
- preview 的 D1、R2、mail 與 secrets 繼續與 production 分離；non-inheritable binding 必須逐環境完整宣告。
- 真正移除 Access 與改 CI 的 commit 要和部署 runbook、README、PRODUCT 現況文字同步。
