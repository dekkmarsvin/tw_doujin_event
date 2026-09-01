# ADR-0016：真人驗證擋在寄信入口，不擋全站

- 狀態：已定案（2026-08-18）；「全站入口維持 Access」部分已由 [ADR-0029](./0029-public-production-gated-preview.md) 取代，寄信入口的 Turnstile 決策不變
- 延續：[ADR-0011](./0011-ff47-is-not-a-public-launch.md)、[ADR-0015](./0015-access-lifts-when-no-third-party-bytes-remain.md)
- 相關契約：[社團自助控制面](../contracts/circle-portal.md#索取登入連結需要通過真人驗證)、[資料傳輸與離線](../contracts/delivery-and-offline.md#快取標頭)
- 相關流程：[部署](../runbooks/first-time-setup.md#真人驗證turnstile)

## 脈絡

`POST /api/auth/request-link` 是本站**唯一不需要 session 就會造成對外副作用的路徑**：送一個位址進去，Mailgun 就寄一封信出去。其餘寫入端點都在 session 之後。

它目前的防線是 D1 計數：每信箱每小時 5 次、每 IP 每小時 20 次。這擋得住一台機器重試同一個信箱，擋不住分散來源、每個位址只打一次的腳本——那正是拿別人的信箱灌信最自然的形狀。而且每一次嘗試都必須先寫入並讀回 D1 才知道該不該拒絕，濫用的成本落在我們這邊。

[ADR-0011](./0011-ff47-is-not-a-public-launch.md) 期間這條路徑誰也到不了，所以問題沒有發生。但 [ADR-0015](./0015-access-lifts-when-no-third-party-bytes-remain.md) 已經把解除條件寫成可判定的事實，並明白列出解除當下會發生什麼：「`/circle` 與 `/api/auth/*` 同時對外可達——任何人都能索取登入連結並送出 email。」這道防護必須在那一刻**之前**就位；等開放之後再補，中間那段時間就是沒有防護。

同一件事在全站入口做不到，原因是結構性的：

- 閱讀端是邊緣直送的靜態資產（[ADR-0008](./0008-static-public-reading-path.md)），Pages Function 根本不在請求路徑上，程式碼沒有地方可以插入驗證。
- 邊緣層的 WAF custom rule（Managed Challenge、rate limiting）只作用於自己 zone 內的主機。本專案目前只有 `tw-catalog.pages.dev`，它不在我們的 zone 裡。全站真人驗證的前提是先綁定正式網域，那是另一件事，不是這一件。
- 而閘控還在的期間，全站入口加 captcha 也不會改變任何人的可達性：Access 擋的是「不是你」，captcha 擋的只是「不是人」，前者嚴格涵蓋後者。

代價要先說清楚：Turnstile 是第三方 script。[ADR-0012](./0012-first-party-sources-only.md) 與 [ADR-0014](./0014-event-data-lives-outside-the-code-repo.md) 一路在收斂第三方位元組，而這個決策往反方向加了一個 `challenges.cloudflare.com`。差別在於那兩份 ADR 處理的是**內容的來源與授權**，這裡引入的是一段執行碼，不是別人的著作；而且它的供應商就是本站已經完全託管其上的那一家——瀏覽器的 IP、TLS 與每一個位元組本來就經過 Cloudflare。這不是把新的一方拉進來。

## 決策

**真人驗證只加在 `POST /api/auth/request-link`，使用 Cloudflare Turnstile；全站入口維持 Access，不加 captcha。**

- **驗證在讀取 email 之前執行。** 這是刻意的順序：真人驗證是這裡唯一**與信箱無關**的檢查，因此它可以誠實回 `403` 而不洩漏任何東西。通過之後的回應仍然一律 `202`，不論位址是否存在、是否合法。
- **失敗不消耗任何額度。** 速率限制的計數、D1 與 Mailgun 都在驗證之後，沒解開的腳本碰不到它們。
- **驗證器不可達視為未通過**（fail closed）。siteverify 逾時、非 2xx 或回應無法解析一律拒絕。
- **sitekey 由 `GET /api/auth/config` 供給，不編進 bundle。** 於是 preview 與 production 可以持有不同金鑰而共用同一份 build，金鑰的權威留在部署環境而不是 CI 設定。
- **CSP 只在 `/circle*` 放寬。** 閱讀端的策略一個字都不動。
- **preview 使用 Cloudflare 的 dummy 金鑰**，寫在 `wrangler.jsonc` 裡。E2E 驅動不是瀏覽器，解不了真的 widget。
- **既有的速率限制留著。** Turnstile 擋的是「不是人」，擋不了一個解完題就正常送出的人反覆索取；兩者防的不是同一件事。

## 後果

### 立刻改變的

- **本站有了第一個第三方執行碼，而且只在 `/circle`。** `public/_headers` 因此有兩份 CSP。Cloudflare 對多條命中的規則採**合併而非覆寫**，所以 `/circle*` 必須先 `! Content-Security-Policy` 移除站台層的策略再重新宣告——兩份同時生效會被瀏覽器取交集，反而擋掉元件。重新宣告的策略會漂移，所以兩者的關係（站台層 + 恰好兩個 Turnstile 來源）由 `tests/circle-overrides.test.mjs` 斷言，而不是靠人記得同步。
- **Turnstile 故障時沒有人能登入。** 這是 fail closed 的直接後果，也是接受的取捨：登入連結可以一分鐘後再要一次，一個任何人都能驅動的寄信端點不行。
- **production 多一個 secret（`TURNSTILE_SECRET`）與一個公開變數（`TURNSTILE_SITEKEY`）。** 缺任一個時 `/api/*` 回 503，與缺既有密鑰的症狀一致——不會有「驗證被靜默略過」的狀態。

### 必須知道的落差

- **「元件真的能在瀏覽器裡渲染」沒有自動化覆蓋。** preview 的 E2E 以 dummy 金鑰直接送 token，看不到 CSP 違規，也看不到 script 載入失敗。這件事只能以瀏覽器人工確認一次，步驟寫在[部署 runbook](../runbooks/first-time-setup.md#這件事只能用瀏覽器驗)。這是本決策確實留下的驗證缺口。
- **[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30) 的隱私告知多一段要寫。** 登入頁會讓使用者的瀏覽器直接對 `challenges.cloudflare.com` 發出請求。實質上不新增任何一方能看到的資訊（站台本來就在 Cloudflare 上），但告知文件描述的是行為，不是實質增量，所以仍要列出。
- **多了一道使用者要通過的關卡。** Managed 模式多數情況下零互動，但它不是零成本，尤其對使用輔助技術或隱私瀏覽器的人。社團端目前沒有真實使用者可以回饋這件事（ADR-0011），所以這個代價只能先記著。

## 不在本 ADR 範圍

- **綁定正式網域之後，是否以 WAF Managed Challenge 承接 Access 在閱讀端的角色。** 那是解除閘控時的決策，需要另寫一份，並處理 CI 的 service token 依賴會如何改變（[ADR-0015](./0015-access-lifts-when-no-third-party-bytes-remain.md) 已列出這條）。
- Turnstile pre-clearance（以 `cf_clearance` 涵蓋整站）。它同樣以綁定網域為前提。
- 其他寫入端點。它們都在 session 之後，session 只能由這條路徑取得。
