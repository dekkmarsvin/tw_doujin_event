# 專案文件與實作一致性審查（2026-08-13）

## 文件狀態

- 審查日期：2026-08-13
- 基準 commit：`40c5c46`（`feat: let a circle withdraw its own content after the event`）
- 範圍：`README.md`、`PRODUCT.md`、`DESIGN.md`、`docs/` 全部 11 份文件，對照 `app/`、`functions/`、`db/`、`scripts/`、`tests/`、`.github/workflows/` 的實際實作。
- 目的：列出文件之間、文件與實作之間的衝突，並排出下一步。**本文件只記錄落差與規劃，不修改任何既有 P0／P1／P2 決策，也不代表衝突已修復。**
- 前一份收斂紀錄為 `docs/project-design-conformance-repair-record.md`（最後一輪為 2026-08-11）。

## 驗證基線

以 Node.js `v22.22.2` 於乾淨 `npm ci` 後執行，全部通過：

| Gate | 結果 |
| --- | --- |
| `npm test`（含 Pages production build） | 145 pass / 0 fail |
| `npm run lint` | 0 problems |
| `npx tsc --noEmit --incremental false` | 0 errors |

**因此以下所有衝突都不是「壞掉的程式」，而是契約敘述與實作事實的漂移。**現行 gate 無法偵測這類漂移——它只驗證程式自洽，不驗證程式是否符合文件。

## 衝突清單

### A. 文件之間互相衝突

#### A1｜`FavoriteGroup` 欄位名不一致（`label` vs `name`）

| 位置 | 內容 |
| --- | --- |
| `docs/favorites-and-visit-planning-design.md:28-33` | `FavoriteGroup = { id; label; color; sortOrder }` |
| 同檔 `:50` | 不變量寫「`FavoriteGroup.label` 去除前後空白後必須非空」 |
| `DESIGN.md:292` | `FavoriteGroup = id + name + color + sortOrder` |
| `app/planning-store.ts:7-12` | 實作為 `name` |

模組文件是唯一使用 `label` 的地方，且 `parsePlanningDocument()`（`app/planning-store.ts:95`）在缺少 `name` 時會直接丟棄該群組。照模組文件寫的匯入資料會被靜默丟棄。

**性質：機械性修正**（實作、`DESIGN.md`、`PRODUCT.md` 三者已一致，只有模組文件過時）。

#### A2｜`VisitPlanEntry` 缺少 `purchaseMemo` 與 `budget`

| 位置 | 內容 |
| --- | --- |
| `docs/favorites-and-visit-planning-design.md:37-44` | `VisitPlanEntry = eventId + day + circleId + status + routeOrder + updatedAt` |
| `DESIGN.md:293` | 另含 `purchaseMemo` 與 `budget`，且要求「每日行程彙整已填寫攤數與預算總額」 |
| `PRODUCT.md:27`、`:36` | 核心任務 3 與成功結果明列「為每站記錄購買項目與預算」 |
| `app/planning-store.ts:25-34`、`:260-268` | 已實作，含非負整數正規化 |
| `app/event-workspace-panels.tsx:108-133` | 已實作購物摘要與預算合計 |

模組文件的核心互動、儲存與版本、P0／P1／P2 邊界、驗收條件四節都沒有提到購物規劃，等於這個已上線的 P0 功能在自己的模組契約裡完全不存在。

**性質：機械性修正。**

#### A3｜`docs/cloudflare-pages-deployment.md` 自我矛盾

同一份文件的兩段互相否定：

| 位置 | 內容 |
| --- | --- |
| `:8`、`:24-25` | `functions/` 承載社團身分與管理 route；binding 有一個 D1（`DB`）；需要 5 個 Pages secrets |
| `:67`（首次啟用 §2） | 「專案不需要 Functions、D1、R2、KV 或 runtime secret」 |
| `:38`、`:42` | 實際只使用一個 Pages project `tw-catalog`；push `main` **只有一次部署**，沒有先發開發環境再晉升 |
| `:63`（首次啟用 §2） | 要求 `wrangler pages project create dev-tw-catalog` |
| `:87`（首次啟用 §4） | 「第一次 workflow 就會依序建立 development 與 production deployment」 |
| `.github/workflows/deploy-pages.yml:76-78` | 實際只 `--project-name=tw-catalog`，branch 依 PR 或 `github.ref_name` 決定 |

「首次啟用」整章是社團控制面上線之前的舊文。照它做會建出一個 CI 永遠不會用到的 `dev-tw-catalog`，並且漏掉全部 5 個 secret 與 D1 binding——而漏設 secret 的症狀（所有 `/api/*` 回 503）在同一份文件 `:27` 才有解釋。

**性質：機械性修正（重寫首次啟用章節）。**

#### A4｜`docs/circle-data-sources-and-import-design.md` 的領域模型已與實作型別脫節

| 文件宣告（`:14-48`） | 實作（`app/circle-records.ts`） |
| --- | --- |
| `CircleRecord` 六欄：id／name／nameReading／description／categories／updatedAt | `:75-94` 另有 pen、work、creatorTypes、ageRatings、workTypes、referencedWorks、saleInfo、specialTags、media、externalLinks、sources、sourceRow |
| `PlacementRecord` 無座標 | `:97-108` 另有 id、x、y、tone |
| `SourceLink` 有 `externalId`、無 `label` | `:11-18` 有必填 `label`、無 `externalId` |
| `ExternalContent` 型別 | 實作中不存在；補充內容改由 `CircleOverride`（`app/circle-overrides.ts`）承載 |

文件的權威順序（`:50-55`）與身分比對規則（`:57-63`）仍然正確且有效，過時的只有型別宣告本身。但型別宣告是這份文件最容易被當成 API 抄的部分。

**性質：機械性修正**，但需決定是同步型別、還是改為「型別以 `app/circle-records.ts` 為準」的指向式敘述。建議後者——把可執行的型別複製進 Markdown，只會製造下一次漂移。

#### A5｜`docs/event-map-design.md` 的 renderer 契約缺少 `showMedia`

`docs/event-map-design.md:28-33` 宣告：

```ts
type AccessibleEventMapRendererProps = {
  eventName; layout; slots; onSelect;
};
```

實作（`app/accessible-event-map-renderer.tsx`）另有 `showMedia`，由 `app/event-map-app.tsx:678` 以 `shouldShowMapMedia(zoom)` 傳入。這正是 `DESIGN.md:278`「145% 起顯示具可追溯來源的社團縮圖」的實作機制——也就是說地圖模組文件漏掉了一個已經寫進 `DESIGN.md` 的行為的 seam。

**性質：機械性修正。**

### B. 文件與實作衝突

#### B1｜進階搜尋：兩份具約束力的文件對「應該是什麼」不一致 ⚠️ 需決策

這是本次審查中唯一的**契約層級**衝突，其餘都是敘述落後。

| 位置 | 要求 |
| --- | --- |
| `docs/project-design-conformance-repair-record.md:78-91`（「已確認的進階搜尋決策」） | 第一版**至少**包含：搜尋範圍切換、多主題條件、排除主題、創作屬性、分級、創作類別、命中結果數 |
| 同檔 `:145-153`（驗收條件） | 需可指定兩個主題並顯示採用的 AND／OR 規則；排除主題後摘要同步；結果卡需說明主要命中欄位 |
| 同檔 `:18`、`:180`（狀態註記） | 「多主題 AND／OR、排除主題及命中原因保留後續迭代」 |
| `DESIGN.md:246`（Advanced Work Search） | 已改寫為目前實作：單一作品／題材輸入 + 至多六筆浮動建議 + 別名擴展；**不再提多主題或排除** |
| `app/circle-search.ts:17-22` | 實際只有 `creatorType`、`workQuery`、`workType`、`adultContent` 四項 |

實作與 `DESIGN.md` 一致，但 repair record 的決策節與驗收節仍以現在式描述未實作的行為，且該文件自稱「依據」`DESIGN.md`。結果是兩份文件同時具約束力而互相矛盾：以 repair record 驗收會失敗，以 `DESIGN.md` 驗收會通過。

「後續迭代」的狀態註記寫在文件開頭的收斂段，離驗收條件 130 行遠——任何人從驗收條件讀起都會得到錯誤結論。

**需要的決策**：把 repair record 的未實作項正式降級為具名 backlog（例如新增 R9），或把 `DESIGN.md` 的 Advanced Work Search 改回目標敘述並承認目前是部分實作。兩者都可以，但不能繼續並存。**建議前者**：`DESIGN.md` 的職責是描述現行實作（該檔 `:217` 自己這麼寫），repair record 才是待辦清單的所在。

#### B2｜「行程、收藏與顯示」面板不符 R6 的對話框焦點契約

`app/display-filter-controls.tsx:35` 宣告 `role="dialog" aria-modal="false"`，但：

- 開啟後不移入焦點
- 沒有 Tab／Shift+Tab 圈限
- 沒有 Escape 關閉
- 關閉後不把焦點送回觸發按鈕

對照組就在同一個 codebase 裡：`app/advanced-circle-search.tsx:41-69` 對結構完全相同的「套用／取消」面板做了全套處理，而 `app/use-modal-focus.ts` 已經是共用 hook（`planning-tools.tsx:36` 與 `event-map-app.tsx:260` 都在用）。

牴觸的契約：

- `DESIGN.md:200-201`（焦點環）、`:322-327`（Keyboard and Gesture Access）
- `docs/project-design-conformance-repair-record.md:196-202`（R6 驗收：「只使用鍵盤即可完成開啟、瀏覽、取消及回到原位置」）——R6 在 `:14` 被標記為已完成，但這個面板不在當時的檢查範圍內
- `DESIGN.md:390`「**Don't** 在不同畫面重新設計同一種按鈕、輸入框、chip 或狀態提示」

附帶：該檔所有 `<button>` 都缺 `type="button"`（`:34`、`:36`、`:40`、`:42`）。目前不在 `<form>` 內所以無害，但與專案其他元件的寫法不一致。

**性質：實作缺口，P0／基本無障礙。**

#### B3｜精簡詳情側欄顯示了 `DESIGN.md` 未列的外部連結 ⚠️ 需決策

- `DESIGN.md:284`：「右欄**只**展示定位決策所需的純代表圖、社團名稱、攤位、DAY、類型、主打作品、來源摘要與規劃動作；分類、備註編輯與完整來源由『開啟完整詳情』對話框承載。」
- `app/event-workspace-panels.tsx:186`：`compact` 時 `externalLinks.slice(0, 6)`
- 同檔 `:196`：實際渲染這些連結，並在超出時顯示「完整詳細資訊另有 N 個連結」

實作多顯示了一整個連結區塊。`DESIGN.md:267` 的 Map Side Panel 條目同樣寫「不得複製完整頁面的所有內容」。

**需要的決策**：更新 `DESIGN.md` 承認連結屬於側欄（六個上限與「另有 N 個」的降級已經是刻意設計，不像是意外），或把連結移出 compact。**建議前者**——通販與試閱連結對「要不要去這攤」的決策有直接作用，而且六個上限本身就是為了不複製完整頁面。

#### B4｜identity 資料表沒有 drizzle migration，靠執行期 DDL 建立

- `db/schema.ts:5-6` 註解：「`drizzle.config.ts` points at this file alone, so the identity tables are re-exported here to stay visible to `npm run db:generate`」
- `drizzle/0000_perfect_hedge_knight.sql` 只有 `event_maps`
- `drizzle/meta/0000_snapshot.json` 的 tables 也只有 `event_maps`
- 8 張 identity 表（accounts、admins、login_tokens、sessions、circle_claims、circle_overrides、overrides_doc、audit_log）實際由 `db/identity-repository.ts:47-165` 的 `ensureTables()` 於每次 route 呼叫時以 `CREATE TABLE IF NOT EXISTS` 建立

兩條路徑都能運作，但 repo 現在同時宣稱兩者。`npm run db:generate` 從未對 identity schema 跑過，所以 `db/identity-schema.ts` 的任何欄位變更都不會產生 migration，只會靜默依賴 `identity-repository.ts:151` 那段「Columns added after a table already existed somewhere」的補丁邏輯——那段註解本身就是這個漂移的症狀。

**需要的決策**：補跑 `npm run db:generate` 讓 migration 成為真相，或明文記載 identity 表刻意由執行期 DDL 管理、`db/schema.ts` 的 re-export 只為型別推導。**建議後者並移除誤導性註解**——Pages Functions 沒有 migration 執行時機，`ensureTables()` 是這個部署形態下的合理選擇。

#### B5｜`app/globals.css` 保留整套前 SVG 時代的 HTML 地圖樣式（死碼）

以下 global class 在 `app/` 的任何 `.tsx` 都沒有引用：

`.booth`、`.hall-shape`、`.zone`、`.center-aisle`、`.cross-aisle`、`.entrance`、`.exit`、`.cover`、`.close`、`.empty`、`.guide`、`.help`、`.hint`

（`map-layout-editor.tsx:352` 的 `styles.entrance` / `styles.exit` 來自 `map-layout-editor.module.css`，與這裡無關。）

這是地圖改為 SVG renderer 之前的 HTML 攤位樣式。留著有三個問題：

1. `.close` 帶 `backdrop-filter: blur(4px)`，直接牴觸 `DESIGN.md:205`「The No Decorative Glass Rule」。雖然不會渲染，但它是 codebase 裡唯一的裝飾性模糊範例，下一位維護者照抄的機率不低。
2. `.cover` 用 `#fff2` / `#fff5` / `#fff1` 疊裝飾圓形，屬於 `DESIGN.md:385`「不以大型形象視覺取代實際攤位與作品資訊」明確排除的作法。
3. `@media (max-width:760px)` 內的 `.floor { width:1900px; height:950px }`（`app/globals.css:34`）永遠被 `event-map-app.tsx:678` 的 inline style 覆蓋，是無效規則。

**性質：清理，非功能性。**

#### B6｜README 沒有提到公開站目前處於 Access 閘控

- `README.md:7`：「公開閱讀路徑是純靜態的……由靜態邊緣直接服務，不經過任何 Worker。」
- `docs/cloudflare-pages-deployment.md:11-13`：「在來源授權確認前，`/` 與 `/data/*` 維持閘控」，並列出 Zero Trust 必須 Bypass 的路徑

兩者技術上不衝突（Cloudflare Access 在邊緣層，確實不是 Worker），但 README 是新進者的入口文件，讀完會以為站台已完全公開。閘控是目前的營運事實，且是一個會影響「為什麼我打不開」的事實。

**性質：機械性修正（README 補一句並連到部署文件）。**

### C. 決策缺口（不是衝突，是懸而未決）

#### C1｜研究用途例外條款已上線，但使用條款不存在 ⚠️ 需決策

- `PRODUCT.md:65` 把它標為「**待確認的條款**……此措辭需經營運者確認後寫入使用條款，目前僅在社團端介面說明」
- `app/circle-portal/portal-app.tsx:355` 已經在 UI 顯示：「勾選後，本站於學術或研究用途的有限度查閱仍可能包含這些內容。」
- 全 codebase 沒有任何使用條款或隱私政策頁面（`grep 使用條款|隱私` 於 `app/` 無命中）

也就是說：社團被要求在一段沒有對應條款的例外聲明下做退出決定。同時，portal 已在收集 email（`db/identity-schema.ts` accounts）、雜湊 IP（`app/circle-portal-handlers.ts:104-107`）與稽核記錄，這些都沒有對外的隱私說明。

`DESIGN.md:348` 的 Post-event Opt-out 已經把技術面做對了（退出內容在階段變更後**完全不出現在公開文件中**，而非用戶端隱藏，ETag 也含階段）。缺的純粹是法務／營運面。

**需要的決策**：營運者確認措辭並產出條款頁，或先把 portal 那句話拿掉直到條款就緒。**建議後者作為短期處置**——現在的狀態是最糟的組合：聲明已生效，依據不存在。

#### C2｜repair record 沒有涵蓋社團自助控制面

`docs/project-design-conformance-repair-record.md` 的最後一輪紀錄是 2026-08-11「公開測試準入修復」（最後更動於 `14adc2d`，2026-08-11），其 `:44` 明文寫「登入……不在本次準入範圍」。但在 2026-08-12 至 08-13 之間，下列 8 個 commit 交付了整個社團自助控制面：

`76e2229`（身分與編輯）、`e31877a`（內容疊加）、`ca0ef30`（server-side 搜尋）、`b6edd02`（D1 管理者名單）、`5428953`、`15880bc`、`8b09a01`（鎖定社團名 + 發布前預覽）、`40c5c46`（活動後退出）

這些工作在 `DESIGN.md`（Circle Self-Service Control Plane）與 `docs/cloudflare-pages-deployment.md` 有契約，但沒有進入收斂紀錄，因此：

- 文件狀態欄仍是「部分完成；R2 已完成，R3 第一版已完成」（`:6`），沒反映 R1／R4～R8 皆已完成
- 沒有對應的驗收紀錄可供下一輪審查對照

**性質：紀錄補齊。**

## 已確認一致、無須再審的部分

為避免下一輪重複檢查，以下項目本次逐條核對後確認實作與契約相符：

- **URL 契約**：`DESIGN.md:260` 列出的 17 個參數全部實作（`app/event-map-app.tsx:159-205` 恢復、`:309-337` 寫入），草稿與 hover 不入 URL，快照載入前不改寫 URL（`:302-304`）。
- **收藏／行程語意分離**：`addToVisitPlan()` 固定建立 `planned`（`app/planning-store.ts:257`），只有 `setNextStop()` 產生 `next`；同活動同日最多一筆 `next` 由 `normalize()` 保證（`:80-88`）。
- **七秒 Undo 與完整恢復**：`event-map-app.tsx:255-258`、`:685`，經 `restoreFavorite()` 以原記錄還原。
- **孤兒規劃資料**：`planning-tools.tsx:40-41`、`:57` 保留、可個別移除、可匯出，且以 `isKnownCircleId()` 在 catalog 就緒後才判定。
- **匯入分期（R7 決策）**：`planning-transfer.ts` 具備完整 preview／merge 能力，但一般介面只暴露匯出（`planning-tools.tsx:49`），符合「維持原分期」。
- **地圖縮放契約**：600% 上限、145% 縮圖門檻、200% 以上 25% 級距、動態最小倍率（`app/map-viewport.ts:8-21`、`event-map-app.tsx:486`）。
- **社團名不可編輯**：`app/circle-overrides.ts:122-129` 以未知鍵拒絕整筆而非靜默丟棄；`circle-records.ts:193` 註明 name 取自 template／booth。
- **社團自述來源標示**：`circle-records.ts:174-183` 固定 `provider: "社團本人"`、`contentType: "circle"`、`status: "unverified"`、無偽造原始連結。
- **管理者名單防鎖死**：`circle-portal-handlers.ts:539-548` 不得移除自己、不得移除最後一位。
- **縮圖主機允許清單**：`circle-overrides.ts:66-93`，並在註解說明這是內容安全而非樣式問題。
- **活動後退出**：`circle-portal-handlers.ts:576-598` 於階段變更時重建公開文件，ETag 含階段。
- **離線 shell**：`app/service-worker-source.js` 三種策略與 `DESIGN.md:337` 完全對應，且拒絕快取 redirected／非 JSON 回應。
- **FF47 單館**：`eventUsesAreaSwitcher()` 固定 `ALL`，`switchable` 模式保留（`event-map-app.tsx:59-61`、`:628`）。
- **結果分頁**：`event-workspace-panels.tsx:11`、`:65`、`:89` 以 80 筆漸進載入，符合 `DESIGN.md:250`。

## 下一步規劃

依「先解鎖決策、再修實作、最後補文件」排序。前置決策沒定案就動文件，只會製造下一輪漂移。

### 第 1 批：解鎖三個決策（無程式碼變更）

需要營運者／擁有者拍板，各自只有兩個選項：

1. **B1 進階搜尋分期**——建議：repair record 新增 R9 收納多主題 AND／OR、排除主題、命中原因，並把「已確認的進階搜尋決策」節標題改為「R9 目標」，`DESIGN.md` 維持描述現況不動。
2. **B3 側欄外部連結**——建議：更新 `DESIGN.md:284` 與 `:267`，把「最多六個外部連結 + 超出時提示」納入側欄允許欄位。
3. **C1 研究用途條款**——建議：短期先移除 `portal-app.tsx:355` 該句，待條款頁就緒再放回；同時決定隱私說明（email、IP 雜湊、稽核記錄）的落地位置。

**驗收**：三項在 `PRODUCT.md` / `DESIGN.md` / repair record 中各自只有一種說法。

### 第 2 批：實作修復（P0）

1. **B2 焦點生命週期**——`display-filter-controls.tsx` 改用既有的 `useModalFocus`，補 Escape、焦點圈限與觸發點復原，並補齊 `type="button"`。
   - **測試**：現有測試沒有覆蓋任何面板的焦點行為（`tests/` 全為純函式與 route 測試）。建議至少補一支斷言 `aria-modal`／`role` 組合與關閉後焦點目標的測試，否則這個缺口會第二次發生。
2. **C1 短期處置**——依第 1 批決策移除或保留 portal 那句聲明。

**驗收**：僅以鍵盤可完成「行程、收藏與顯示」的開啟、修改、取消、套用與回到觸發按鈕；`npm test`、`npm run lint`、`tsc` 全綠。

### 第 3 批：文件同步（機械性，可一次提交）

1. **A1 + A2**——`docs/favorites-and-visit-planning-design.md`：`label` → `name`；`VisitPlanEntry` 補 `purchaseMemo` / `budget`；核心互動節補購物規劃與預算合計；P0 邊界補列。
2. **A3**——重寫 `docs/cloudflare-pages-deployment.md` 的「首次啟用」章節：刪除 `dev-tw-catalog` 建立步驟與「依序建立 development 與 production」敘述；把 D1 binding 與 5 個 secret 的設定移進首次啟用流程（目前散在發布邊界節）。
3. **A4**——`docs/circle-data-sources-and-import-design.md` 的型別區塊改為指向 `app/circle-records.ts` 與 `app/circle-overrides.ts`，只保留權威順序與比對規則等不隨實作變動的契約。
4. **A5**——`docs/event-map-design.md` renderer props 補 `showMedia`，並說明它承載 145% 縮圖門檻。
5. **B6**——`README.md` 在「目前邊界」補一句閘控現況並連到部署文件。

**驗收**：以本文件的衝突清單逐項複查，`A1`–`A5`、`B6` 全部關閉。

### 第 4 批：清理與紀錄

1. **B4**——依決策補 migration 或修正 `db/schema.ts:5-6` 的註解；若選後者，同時在 `docs/cloudflare-pages-deployment.md` 記載 identity 表由 `ensureTables()` 管理。
2. **B5**——移除 `app/globals.css` 的死碼樣式與失效的 760px `.floor` 規則。
   - **注意**：刪除前確認 `circle.html` 入口不依賴這些 global class（`app/circle-portal/` 使用自己的 module CSS，但 `globals.css` 同時被兩個 entry 載入）。
3. **C2**——在 `docs/project-design-conformance-repair-record.md` 補一節「2026-08-13 社團自助控制面」，記錄 8 個 commit 的交付範圍與驗收方式，並更新文件狀態欄。

**驗收**：`npm test` 全綠且公開產物大小不因刪除死碼而異常；repair record 的狀態欄與內文一致。

### 建議在此輪之後才考慮的事

- 讓 gate 具備偵測本類漂移的能力（例如以測試斷言 `DESIGN.md` 的 URL 參數清單與 `event-map-app.tsx` 實際讀寫的參數集合相同）。這是本次審查最有價值的觀察：**三個 gate 全綠，仍有 11 項契約漂移**。
- `docs/` 已有 11 份文件、5 份具約束力、6 份研究紀錄，但沒有索引說明哪份是契約、哪份是追溯紀錄。`README.md:110` 只籠統寫「產品、互動、資料及分期契約」。

## 不在本審查範圍

- 不評估未實作功能（OAuth、跨裝置同步、協作、minimap、P2 匯入）的設計品質。
- 不重新開啟 P0／P1／P2 分期決策。
- 不審查 `data_source_test/` 的資料正確性或 `public/data/` 快照與上游試算表的一致性——`npm run source:check` 與 `catalog:snapshot:check` 已覆蓋。
- 不做瀏覽器實測；本次結論全部來自程式碼與文件比對，B2 的焦點缺口是靜態分析結果，實測可再確認一次。
