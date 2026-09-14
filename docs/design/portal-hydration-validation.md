# 社團編輯器初始讀取驗證（2026-09-14）

對應 [#237](https://github.com/dekkmarsvin/tw_doujin_event/issues/237)、[PR #249](https://github.com/dekkmarsvin/tw_doujin_event/pull/249) 與[社團自助控制面契約](../contracts/circle-portal.md)。這份文件保存有日期的驗證證據；即時狀態以 GitHub 為準。

## 版本與環境

- 驗證 head：`7b3573edcd3805bca98b7f7fc3f772464d5bfeac`；合併 SHA：`70a905153d2d88c9460afc97540e5bbfc617c9ae`。
- Windows、Edge/Chromium `153.0.4234.32`、1440 × 900。使用隔離 local D1/R2、fictional sample 與 `.test` 收信槽，沒有正式資料或真實寄信。
- [同輪報告](assets/portal-hydration-2026-09-14/browser-report-portal-circle-claim.json)時間：`2026-09-14T08:16:37.970Z`。保留[載入](assets/portal-hydration-2026-09-14/portal-editor-hydrating.png)、[讀取失敗](assets/portal-hydration-2026-09-14/portal-editor-load-error.png)、[載入完成](assets/portal-hydration-2026-09-14/portal-editor-hydrated.png)與[確認面板](assets/portal-hydration-2026-09-14/portal-review-open.png)的原始截圖。這是桌面瀏覽器證據，不代表 iOS／Android 真機驗收。

## 實際瀏覽器結果

`tests/browser/portal-circle-claim.mjs` 完成 8 項檢查，0 page errors：登入、認領待審、管理者核准、延遲初始讀取、503 讀取失敗、重試成功、儲存前確認與儲存。

- 主動攔住初始 GET，確認筆名及預覽／送出控制項維持原生 disabled，顯示載入提示；放行後才可編輯。
- 另一次 GET 回 503，確認欄位仍停用；按重試後確實發出新的 GET，成功才解鎖。
- 填入「驗收用筆名」，確認預覽與送出內容正確；重新載入後仍讀回已儲存筆名。保留原有內容斷言，未使用固定 sleep 掩蓋競態。

## 獨立檢查與共同 gate

首次獨立視覺檢查指出停用 input／textarea 仍呈白底、與可編輯狀態難以區分。補上停用樣式後，以同一 head 重建並重新擷取全部畫面；agy 與另一位未參與實作的代理各自讀取載入、失敗、載入完成及確認面板四張截圖，均通過。兩者的視覺判斷與執行者的 browser report 分別記錄，未將看圖冒稱親自操作。

本機 `npm ci`、`npm test`（658/658）、lint、TypeScript、doc-map、diff check 通過，但當時使用 Node 24.11.1／npm 11.6.2，低於 repository 要求。指定版本的完整驗證來自[同 head CI](https://github.com/dekkmarsvin/tw_doujin_event/actions/runs/34821729311)：依 `.nvmrc`／package 約束執行，`Verify and deploy`、`Full preview portal E2E`、`Browser acceptance` 與 CodeQL 通過。CI 的 `browser-acceptance` artifact 保存該 CI 執行的報告與截圖，與上述本機執行分開。

[合併後 CI](https://github.com/dekkmarsvin/tw_doujin_event/actions/runs/34822204700) 的部署、Pages production-origin smoke、Browser acceptance 與 advisory custom-domain observation 通過；push 的 Full preview portal E2E 依 workflow 設計 skipped，不拿它代替 PR head 的成功結果。

重跑本機隔離 journey：

```powershell
$env:MAP_TEST_URL = "http://127.0.0.1:8788"
$env:MAP_TEST_OUTPUT = "outputs/portal-hydration-validation"
node tests/browser/portal-circle-claim.mjs
```

先依[本機開發](../runbooks/local-development.md) 啟動隔離 portal 並準備 Playwright；若該 port 已由其他工作使用，改用獨立設定與資料目錄，不清除既有手動資料。
