# ADR-0043：社團入口是通用的，登入後才選場次

- 狀態：已定案（2026-08-30）
- **取代**：[ADR-0042](./0042-the-public-entry-is-an-event-chooser.md) 後果段「控制面仍是單活動……本 ADR 只動前者」一句
- 相關 issue：[#119](https://github.com/dekkmarsvin/tw_doujin_event/issues/119)、[#134](https://github.com/dekkmarsvin/tw_doujin_event/issues/134)
- 延續：[ADR-0016](./0016-human-verification-guards-the-mailer.md)、[ADR-0020](./0020-self-service-deletion-reuses-the-existing-ownership-chain.md)、[ADR-0027](./0027-personal-data-lifecycle-and-account-deletion.md)、[ADR-0033](./0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md)、[ADR-0039](./0039-one-data-repo-for-events-and-references.md)

## 問題

[ADR-0042](./0042-the-public-entry-is-an-event-chooser.md) 把讀者端改為多活動，並明說控制面維持單活動、「讀者端的多活動與控制面的單活動是兩件事」。**那句話在第二場活動上站不住。**

社團補充資料的公開端點 `/data/events/:eventId/overrides.json` 從 URL 路徑取 `eventId`，但 [`app/circle-portal-handlers.ts:1454`](../../app/circle-portal-handlers.ts) 對不等於 `env.EVENT_ID` 的活動一律回 `404`：

```ts
if (eventId !== config.eventId) return json({ error: "找不到這個活動的社團補充資料。" }, 404, …);
```

讀者端有了活動選擇器之後，非 `EVENT_ID` 的那一場活動**完全沒有社團補充資料**。因為閱讀端是 base-first／overlay-optional（[資料傳輸與離線契約](../contracts/delivery-and-offline.md)），它不會壞掉、不會報錯——它會安靜地把整個「社團自助維護」功能對那場活動關掉。這是最糟的失敗形狀：看起來正常。

另一條路是每場活動各自維護一個社團入口。那表示每場活動一組 Pages 設定、一次部署與一份要記得更新的 `EVENT_ID`，與 [ADR-0039](./0039-one-data-repo-for-events-and-references.md) 收斂出的 single-maintainer 姿態正好相反——那份 ADR 花了整篇說明為什麼「每加一場活動就多一個要維護的東西」是失敗判準。

## 現況比預期好：收束點只有一個

寫這份 ADR 前逐層核對過，資料層**已經**支援一個帳號跨多場活動：

| 層 | 現況 |
|---|---|
| `accounts`、`login_tokens`、`sessions`、`admins` | **沒有** `event_id`。身分本來就是全域的 |
| `circle_claims` | 有 `event_id`；unique `(event_id, circle_id, account_id)`，verified 唯一擁有者 unique `(event_id, circle_id)` |
| `circle_overrides`、`overrides_doc` | 有 `event_id`；unique `(event_id, circle_id)` |
| `map_drafts` | 依 `(event_id, period_key, venue_space_id)` 分域 |
| `db/retention-purge.ts` | 已依 `byEvent` 分組發布文件更新 |
| `db/identity-repository.ts` 全部呼叫 | `eventId` 是**參數**，不是常數 |

單活動的約束只有一行：[`functions/_portal.ts:253`](../../functions/_portal.ts) 的 `const eventId = env.EVENT_ID;`——一個注入一次、再穿進所有 handler 的常數。

這不是巧合，是 [ADR-0027](./0027-personal-data-lifecycle-and-account-deletion.md) 與 [ADR-0033](./0033-map-contributions-use-admin-granted-roles-and-private-revisioned-drafts.md) 當初就把帳號與內容分開的結果。本 ADR 因此不是重寫控制面，是**把已經存在的能力接出來**。

## 決策

### 1. `/circle` 是通用社團入口，不隨活動另外部署

一個入口、一組 Pages 設定、一個 D1。新活動不新增控制面部署，不更新 `EVENT_ID`。

### 2. 登入先於選場次

身分是**帳號**，不是「某活動的某社團」。流程是：真人驗證 → email 一次性連結登入 → 選擇活動 → 在該活動內認領或維護自己的社團。登入頁不先問活動。

已登入且只在單一活動有認領的帳號，直接進入該活動，不多問一次。

### 3. 綁定逐活動，不跨活動沿用

[ADR-0039](./0039-one-data-repo-for-events-and-references.md) 已決定不建立跨活動 identity linkage：同一個社團在不同活動有不同的 `c-xxxxxx`。因此**在 FF47 認領過的帳號，在下一場活動仍須重新認領並提出該活動的證據。**

這是明知並接受的代價，寫在這裡是為了日後不被當成 bug 修掉。認領證明的是「你是這場活動的這個攤位」，而那是逐活動的事實。email 只證明控制信箱（[`CONTEXT.md`](../../CONTEXT.md)）。

控制面**可以**在介面上提示「你在 FF47 認領過同名社團」，但那是導引，不是免除證據。真的要跨活動沿用，必須先推翻 ADR-0039 的 linkage 決定，那是另一份 ADR。

### 4. `EVENT_ID` 不再是控制面的範圍

`env.EVENT_ID` 從「控制面服務哪一場活動」降為「未指定時的預設活動」，或直接移除。每個 route 的活動由 session 當下選擇的活動或 URL 決定，並照現行方式逐次傳進 repository。

**授權判斷不得改用預設活動。** 任何 `ownsCircle`、`hasVerifiedClaim` 與草稿 scope 檢查都必須用請求實際指定的活動；把預設值當 fallback 會讓一個活動的擁有權在另一個活動生效。

### 5. `publicOverrides` 服務所有已發布活動

`eventId !== config.eventId → 404` 改為：已發布活動正常服務，未發布活動 `404`。這條與 [#119](https://github.com/dekkmarsvin/tw_doujin_event/issues/119) 綁在一起——讀者端有了第二場活動而這條沒改，等於那場活動的社團補充資料靜默消失。

### 6. 活動相位逐活動計算

`currentPhase()` 目前讀單一 `eventEndsAt` 判斷 during／after，決定活動後退出與 [ADR-0018](./0018-retention-is-the-circles-choice.md) 的保存期限起算。改為依該筆資料所屬活動計算。

`circle_overrides.retention_expires_at` 已經把期限存在資料列上，不必重算——這正是 ADR-0018 當初把期限做成欄位而不是文件裡一句話的好處。

## 後果

- **#119 的範圍再增一項**：`publicOverrides` 的活動閘控。它與讀者端選擇器是同一次交付，理由見決策 5。
- **控制面的多活動 UI 是另一張票**，不擋第二場活動：只要 `publicOverrides` 放行、`EVENT_ID` 指向新活動，社團端就能運作——只是同一時間只服務一場。那是可接受的過渡，而讀者端的靜默資料消失不是。
- **[社團自助控制面契約](../contracts/circle-portal.md)與[地圖貢獻控制面契約](../contracts/map-contributions.md)都要改寫。** 後者現在寫著「所有 contributor 與管理 route 都只列出、讀取或修改目前 Pages 設定的 `eventId`」，那句話會失效。
- **管理者介面會看到跨活動的資料。** 撤下、認領審核與逾期草稿報表原本天然被 `EVENT_ID` 限縮，之後必須自己帶活動維度，否則管理者會在一份清單裡看到兩場活動的同名社團而分不出來。
- **稽核與帳號刪除不受影響**：`audit_log` 與 `deleteAccount` 本來就以帳號為單位，跨活動是它們原本的語意。
- 代價：社團在每一場活動都要重新認領。對只參加一場的社團沒有差別；對常態參展的社團是每場一次的成本，換到的是認領證據始終對應當場活動的事實。

## 不在本 ADR 範圍

- 不推翻 ADR-0039 的跨活動 identity linkage 決定。
- 不決定控制面多活動 UI 的版面或路由。
- 不改變真人驗證、magic link、session 期限或帳號刪除機制。
- 不改變地圖貢獻的授權模型；`map_contributor` 仍由管理者授予，是否逐活動授權留給實作該票時定案。
