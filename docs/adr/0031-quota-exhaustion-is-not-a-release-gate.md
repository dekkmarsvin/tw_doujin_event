# ADR-0031：配額耗盡不作發布 gate，Pages Functions 設為 fail-open

- 狀態：已定案（2026-08-24）
- 取代：[ADR-0029](./0029-public-production-gated-preview.md) 的 Error 1027 實測 gate，以及 [ADR-0017](./0017-thumbnails-are-self-hosted-with-external-urls-kept.md) 對耗盡後果的未實測斷言
- 相關 issue：[#48](https://github.com/dekkmarsvin/tw_doujin_event/issues/48)

## 問題

Workers Free 每日請求額度耗盡時會觸發 Error 1027。Cloudflare Pages 可設定 fail-open，在 Functions 額度耗盡時改為服務靜態資產；也可設定 fail-closed，直接回傳錯誤頁。

Cloudflare 沒有提供把帳號每日額度調低或模擬 Error 1027 的測試介面。取得真正的耗盡證據只能消耗帳號當日額度，會影響同帳號服務，也無法成為一般 pull request 可重複執行的驗收方式。以這項證據阻擋發布，等同建立一個無法安全且穩定完成的 gate。

## 決策

1. Error 1027 的實際端到端耗盡實驗不再是 production 發布 gate；不為測試刻意消耗正式帳號額度。
2. `tw-catalog` Pages project 的 production 與 preview deployment config 都必須是 `fail_open: true`。部署流程使用 Cloudflare Pages project API 校正並驗證這項設定。
3. 公開閱讀的 reviewed base 保持純靜態；overlay 無法使用時，client 既有的 base-first／overlay-optional 行為不變。
4. 不把未執行的 Error 1027 實驗寫成已實測結果。文件只承諾可驗證的專案配置與應用程式降級行為。

## 後果

- [#48](https://github.com/dekkmarsvin/tw_doujin_event/issues/48) 可依「沒有安全、可重複的實測介面；配置已收斂為 fail-open」結案，不再阻擋後續工作。
- Pages project 的 dashboard 漂移會在下一次部署被校正，而不是只靠人工記憶。
- fail-open 只提供靜態資產；需要 Functions 的登入、寫入與即時 overlay 在額度耗盡時不可用。公開 base 本身不依賴這些路徑。
- Cloudflare 日後若提供官方模擬器或隔離的可調額度環境，可另增非阻塞驗證；不需回復發布 gate。
