# ADR-0034：production origin 阻擋壞部署，自訂網域提供非阻塞可用性訊號

- 狀態：已定案（2026-08-24）
- 調整：[ADR-0029](./0029-public-production-gated-preview.md) 的 production CI gate

## 問題

GitHub-hosted runner 在 2026-08-21 與 2026-08-24 的 `main` 部署後，對 `map.kotoban.top` 的 `/` 與 `/api/auth/session` 都持續收到 403；同一時間 Pages deployment 已成功，從其他網路位置匿名請求正式網域與 `tw-catalog.pages.dev` 則分別得到預期的 200 與 401。

`map.kotoban.top` 經過專案 zone 的安全規則，單一 GitHub runner 的結果同時量到「應用程式是否上線」與「該 runner 是否被邊緣規則接受」。目前 workflow 在部署完成後才執行這項 smoke，因此 403 不會阻止或回滾部署，只會把已上線的 workflow 標成失敗，也沒有保存可查 Security Events 的 Ray ID。

## 決策

1. `main` 部署後，以公開的 Pages production origin `tw-catalog.pages.dev` 作為必須通過的 deployment smoke：`/` 必須是 200，`/api/auth/session` 必須是應用程式自己的匿名 401。失敗時 deployment job 失敗。
2. 正式入口 `map.kotoban.top` 仍在另一個 job 以完全匿名請求檢查同一組狀態碼，但結果是 advisory：成功時確認讀者路徑，失敗時產生 warning，不改寫已通過的 deployment 結論。
3. 正式入口失敗時保存並輸出 UTC 時間、HTTP status、`date`、`server`、`cf-ray`、`cf-mitigated`、`cf-cache-status`、`location`、`content-type` 與最多 512 bytes 的 body preview，供 Cloudflare Security Events 對照。正常成功路徑不增加輸出。
4. production 的兩項檢查都不得攜帶 Access service token。不得為了讓 GitHub runner 通過而替正式站新增 Access Bypass、廣泛略過 WAF，或把會變動的 hosted-runner IP 範圍當成信任身分。
5. 正式入口仍是唯一對外網址；production origin 只作部署驗證與故障排查，不進入產品文件或使用者連結。

## 後果

- 壞掉的 Pages production deployment 仍會阻擋 workflow；custom domain、DNS、Access 或 zone 安全設定的異常會留下 warning 與可追查資料。
- GitHub Actions 的單一觀測點不再被當成完整的正式站可用性結論。看到 custom-domain warning 時，需用 Ray ID 查 Security Events，並從另一個網路位置重測正式入口。
- custom-domain job 是部署後觀測，不是回滾機制。若需要持續告警或多地可用性判定，應另設外部 uptime monitor，而不是擴大 CI 的安全例外。
