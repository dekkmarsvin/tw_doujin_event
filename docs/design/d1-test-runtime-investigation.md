# 本機 D1 測試耗時與 TCP 連接埠診斷

日期：2026-09-23。以 `11a611a` 的獨立 worktree 分析；先前的原始碼斷言清理已提交。此輪交付分析，不修改產品、測試案例、runner、依賴或 Windows TCP 設定。

## 結論

1. **本機連接埠耗盡已重現，不再只有 TIME_WAIT 偏高的推測。** 在指定 Node 版本、起跑時 47 個 TIME_WAIT、D1 檔案併行數 4 的條件下，取得 Miniflare → Undici → `connect EADDRINUSE 127.0.0.1` 的完整 cause，以及同時新增的 TCP/IP 4227 系統事件。
2. **大量短連線的直接來源是 Miniflare 的非同步平台 proxy。** 鎖定版本在 `DispatchFetchDispatcher.dispatch()` 設定 `options.reset = true`；Undici 因而送出 `connection: close`。測試每次取得 D1 非同步結果通常都建立一條新 TCP 連線。單純呼叫 `dispose()` 不會立即清除 OS 的 TIME_WAIT。
3. **耗時還有另一層成本：Node 與 workerd 間大量同步／非同步 RPC。** 只恢復 keep-alive 能減少連線，微量測沒有顯示查詢明顯加速。fixture 的完整清理與場館重建平均每次約 441 ms，其中 `prepare`／`bind` 等同步 proxy 操作占了大部分。
4. 不建議以刪除 D1 安全／資料完整性案例、縮短 Windows TIME_WAIT 或直接 monkey patch 套件作為交付修正。先讓本機執行方式可控，再針對 fixture 往返做一個有界的改善。

## 環境與方法

- Windows，本機 32 logical CPUs，`os.availableParallelism() = 32`；Node `24.20.0`、npm `11.19.0`。
- lockfile 的 Miniflare `5.20260804.0-alpha`、workerd `1.20260804.1`、Undici `7.29.0`。
- IPv4／IPv6 TCP 動態範圍皆為 49152–65535，共 16,384 個號碼；IPv4 另有落在此範圍的 660 個排除號碼。因此不能把 16,384 當成任一時刻的可用連線數，也不能拿 TIME_WAIT 列數當精確剩餘容量。
- `scripts/run-tests.mjs` 不傳 `--test-concurrency`。Node 預設為 `availableParallelism() - 1`，本機因此可同時執行 31 個檔案，16 個 Miniflare 檔案可能一起跑。分層清單的排列不是分層依序執行。[Node 24.20 CLI 文件](https://github.com/nodejs/node/blob/v24.20.0/doc/api/cli.md#--test-concurrency)
- 診斷只使用本機、可丟棄的 Miniflare D1。以 `diagnostics_channel` 記錄非同步 Undici request／connect／error，不記 headers 全文、SQL、token 或資料內容；同步 fetch worker 的連線未包含在此計數，所以它不是所有 TCP 活動的總數。
- 原始 log、量測腳本與 JSON 在忽略版控的 `outputs/d1-investigation/`。含逐事件記錄的耗時是診斷樣本，不是無負擔的正式 benchmark。

## 連接埠證據

| 實驗 | 結果 |
|---|---|
| 既有 stock 全 89 檔、concurrency=1 | 891/891 通過，355.9 秒；詳見原始碼斷言清理驗證 |
| stock D1 16 檔、concurrency=4 | 出現 `EADDRINUSE`；高壓後停止，未完成，不能當成效能成功樣本 |
| 同次 stock trace | 停止前已記錄 15,288 個非同步 HTTP 請求、15,282 次成功 connect、6 次 socket error |
| 同次 OS 觀測 | TIME_WAIT 從 47 升到 15,347，其中 15,305 涉及 IPv4 loopback |
| 同次系統事件 | 2026-09-23 08:10:56 +08:00，TCP/IP 4227 |

底層錯誤可由 `d1-c4/errors.json` 與 `d1-c4/tests.ndjson` 查到；第一筆是 `connect EADDRINUSE 127.0.0.1:62988`。這是**對 workerd 建立傳出連線失敗**，不是 portal 的 8788 listen port 已被占用。

每次抽樣的 `Get-NetTCPConnection` 在壓力下變慢，抽樣間隔由約 3 秒拉長到十多秒；12,000 的停止門檻沒有保證峰值停在 12,000。該次失敗與達門檻後已停止自己的測試行程樹，沒有關閉其他專案程序。最早 socket error 出現在最後高峰之前，不能把最後的 15,347 說成精確失敗門檻。

Microsoft 說明高 TIME_WAIT 本身不足以確認耗盡，需搭配錯誤或系統事件；本次取得了兩者。TIME_WAIT 在行程結束後仍可存在，因此高壓後立即重跑、或只降低併行度再重跑，不能視為乾淨的比較。[Microsoft 診斷說明](https://learn.microsoft.com/en-us/troubleshoot/windows-client/networking/tcp-ip-port-exhaustion-troubleshooting)

### 為何每次重建連線

鎖定版本的 `src/http/fetch.ts` 明確設 `reset = true`，上游註解指出是為避免 keep-alive socket 意外斷線的競態。這不是本專案每個案例重建 Miniflare 所致：大部分檔案已共用一個 runtime，並在 `after()` dispose。[Miniflare 鎖定版本原始碼](https://github.com/cloudflare/workers-sdk/blob/miniflare%405.20260804.0-alpha/packages/miniflare/src/http/fetch.ts)

只在獨立診斷程序中攔截該旗標為 false，同一組 100 次小查詢得到：

| 操作 | stock 耗時 | stock 新連線 | keep-alive 對照耗時 | 對照新連線 |
|---|---:|---:|---:|---:|
| 每次新建 `prepare().bind().first()`，100 次 | 1,508 ms | 101 | 1,520 ms | 2 |
| 重用已綁定 statement，`first()` 100 次 | 371 ms | 100 | 412 ms | 0 |
| 建立 100 個 statement 後一次 batch | 615 ms | 1 | 590 ms | 0 |
| 在 workerd 內執行 100 次查詢、回傳一次結果 | 146 ms | 2 | 153 ms | 0 |

多出的少量請求包含 proxy GC 的 `FREE`；連線數只計各量測區間新增連線，不含先前已開啟的連線。statement 重用案例固定參數為 1，其餘以 0–99 驗算加總；這是機制對照，不是等效產品操作的效能比較。

再執行同一組 16 檔、concurrency=4、只改診斷程序內的 reset 旗標：**305/305 通過，零略過，Node runner 133.84 秒**；trace 共 21,005 個非同步請求、110 次 connect、零 socket error。TIME_WAIT 起始／抽樣峰值為 733，結束為 123；背景 TIME_WAIT 正在自然消退，這是全主機值，不是測試獨占計數。結果在 `d1-c4-keepalive/`。

**此對照只用來確認原因，不是採納 monkey patch。** 它會取消上游刻意保留的競態處理；短程成功也不能證明 idle、重啟、streaming 等行為安全。stock concurrency=4 沒有完成，concurrency=1 的 355.9 秒又是全 89 檔，不能把 133.84 秒與兩者相除宣稱加速比例。診斷覆寫只在單次 Node 程序內生效，沒有寫入 node_modules 或正式 preload。

## D1 時間花在哪裡

沿用相同 D1 內容、stock concurrency=1 的成功全套 log，305 個 D1 tier 案例回報時間加總為 **289.39 秒**。這是案例 duration 加總，不是 D1 CPU、純 SQL 或網路等待時間；該 tier 也包含 2 個 workerd fetch 契約案例。

| 檔案 | 案例數 | 案例時間加總 |
|---|---:|---:|
| `organizer-repository.test.mjs` | 44 | 51.60 秒 |
| `circle-portal-route.test.mjs` | 78 | 45.21 秒 |
| `organizer-handlers.test.mjs` | 19 | 36.33 秒 |
| `map-contribution-handlers.test.mjs` | 27 | 35.04 秒 |
| `organizer-reopen-handlers.test.mjs` | 27 | 28.82 秒 |
| 其餘 11 檔 | 110 | 92.40 秒 |

前五檔合計占 68.1%。31 個原始碼字串案例的毫秒級成本無法解釋這個分布。

### Schema 已快取；每案 fixture 重建仍昂貴

直接載入現有 `createIdentityRepository`，使用真實 Miniflare D1，量測現有初始化／清理函式：

| 操作 | 量測 | 觀察 |
|---|---:|---|
| 新 runtime 與取得 binding | 241 ms | 一次性啟動樣本 |
| 新 DB 的 `ensureTables()` | 911 ms | 143 次 prepare、3 次 batch、32 次 run、11 次 first |
| 同 repository 再呼叫 ensure 100 次 | 0.076 ms | 沒有 D1 呼叫；快取有效 |
| `clearPreviewData()`，5 次 | 416–468 ms，平均 441 ms | 每次 64 prepare、30 bind、2 batch、10 first、10 run |
| admin／owner／editor fixture | 102 ms | 7 prepare、7 bind、3 first、4 run |

`clearPreviewData()` 會刪除 34 張表的資料，再由 `seedOrganizerVenueCatalog()` 重建場館、空間與 reference records。刪除已使用 batch；不能把它描述成 34 次逐筆 DELETE 的非同步連線。整個 reset 仍有 22 個非同步結果往返，及更多同步 prepare／bind／method lookup 往返。prepare 與 bind 的量測時間合計約占 reset 的 57%。

12 個檔案、196 個案例的 `beforeEach` 使用這個完整 reset；以本次孤立平均外推約 **86 秒**，只是量級估算，沒有逐一量測所有 hook，也不是保證可省下 86 秒。其他 fixture、安全驗證及發布步驟還有必要的 SQL 與往返。

## 建議的下一個切片

1. **本機執行先可控。** 在 runner 提供明確的檔案 concurrency 選項，Windows D1 採有成功證據的 1 作為保守值；保留 module 等層的併行與所有案例、CI gate。4 已在乾淨 TIME_WAIT 起點失敗，不能當作已驗證的安全值。一次只跑一組 D1，因為多個 worktree 共用主機的 port 資源；1 的既有成功也不是所有主機負載下的保證。
2. **效能先針對 fixture 往返。** 選最重的一個檔案，以現有 `publication-workerd.test.mjs` 的 esbuild／Miniflare 模式，試驗讓 setup/reset 在 workerd 內使用真實 repository 一次完成，或局部重用不變的 prepared statements。保留同一 schema、資料隔離、seed 結果與競態案例；先量前後 reset 時間與 TCP 數，再決定是否擴大，不先搬整個測試框架。
3. **連線策略需依上游相容性處理。** 若要恢復 proxy keep-alive，必須先處理上游註記的 idle／reload 競態；現有證據只支持其為 port churn 的來源，不支持直接永久覆寫。此次未證明某個新版套件已修正，不能用無根據的升級承諾替代驗證。

暫時需要完整本機驗證時，可在符合 `.nvmrc`／npm 版本且連線壓力已恢復的環境，先做 fixture build，再直接執行同一個完整檔案集合：

```powershell
npm run build
$testFiles = Get-ChildItem -LiteralPath tests -Filter '*.test.mjs' -File |
  Sort-Object Name | ForEach-Object { $_.FullName }
node --test --test-concurrency=1 --test-reporter=spec $testFiles
```

這是已成功的本機替代執行方式，不改寫 `npm test` 或 required CI，也不把本次故障診斷的中止結果記成通過。分析完成與實作改善分開驗收；本次沒有新增 issue、遠端資源或排程。
