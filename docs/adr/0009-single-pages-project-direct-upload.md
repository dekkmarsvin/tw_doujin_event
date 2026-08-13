# ADR-0009：單一 Pages project + GitHub Actions Direct Upload

- 狀態：已定案
- 相關流程：[部署](../runbooks/deployment.md)

## 脈絡

Cloudflare Pages 有兩種部署路徑，而且**不允許同一個 project 在兩者之間切換**：

1. **Dashboard 的 Git integration**——Cloudflare 自己拉 repo 並 build。
2. **Direct Upload**——由外部 CI build 完再上傳。

這個選擇在建立 project 的那一刻就定死了，之後要換只能重建 project 並重新綁定網域。

另一個問題是環境數量。原本規劃了 `dev-tw-catalog` 與 `tw-catalog` 兩個 project，走「先發開發環境、驗證後晉升 production」的流程。

## 決策

**GitHub Actions + Wrangler Direct Upload，單一 project `tw-catalog`。**

preview 與 production 以 **Cloudflare Pages 的 branch deployment** 區分，不是兩個 project：

- push 到 `main` → branch `main` → production。
- pull request → branch `pr-<number>` → `pr-<number>.tw-catalog.pages.dev`，不覆蓋 production。

**只有一次部署，沒有先發到開發環境再晉升的流程。**

## 後果

- **完整 gate 跑在 GitHub Actions 裡**（`npm ci`、`npm test`、lint、typecheck），通過才上傳。Dashboard Git integration 做不到這件事——它只會 build，不會替你決定要不要發布。
- fork pull request **不執行 deploy job**：拿不到 deployment secrets，也不該把 Cloudflare token 暴露給外部程式碼。
- **preview 環境不繼承 production 的 secrets。** 要在 PR preview 測社團入口，五個 secret 需另以 `--env preview` 設定一次。這是 branch deployment 的代價。
- `package.json` 仍保留 `pages:deploy:dev` 指向 `dev-tw-catalog`，供需要完全獨立環境時手動使用。**CI 不會用到它**，那個 project 也不需要存在。
- Pages 要求使用 repository root 的標準 `wrangler.jsonc`；本機 vinext authoring 因此必須在 `vite.config.ts` 明確覆寫自己的 Worker 與 D1 binding。
- 回滾走 Pages 的不可變 deployment 清單，但**必須同時在 repository 回復問題變更**，否則下一次 build 會再發一次。
