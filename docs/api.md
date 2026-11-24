# 後端 API

後端重寫（[#546](https://github.com/dekkmarsvin/tw_doujin_event/issues/546)）要相容的規格：前端實際呼叫的每個端點，以及重寫後各自保留、修改或刪除。前端行為不變是重寫的前提，所以**請求與回應的形狀以前端 client 的 TypeScript 型別為準**，本文只指出型別在哪裡，不重抄欄位。

- 社團入口與管理頁：[`app/circle-editor-client.ts`](../app/circle-editor-client.ts)
- 主辦工作區：[`app/organizer-client.ts`](../app/organizer-client.ts)
- 行程分享：[`app/planning-share-client.ts`](../app/planning-share-client.ts)
- 錯誤代碼：[`app/i18n/api-error-codes.ts`](../app/i18n/api-error-codes.ts)

表中「呼叫端」是上列檔案裡的函式名稱；沒有寫檔名的都在 `circle-editor-client.ts`，「主辦」開頭的在 `organizer-client.ts`。

## 共同約定

- **同源與 CSRF**：所有非 GET／HEAD 請求必須帶同源 `Origin`，且 `content-type: application/json`（即使沒有 body）。例外只有檔案上傳的 `multipart/form-data`：社團代表圖與品書、主辦活動圖片與地圖底圖。跨站表單送不出 JSON，加上 `SameSite=Lax` 的 session cookie，不需要 CSRF token。
- **登入狀態**：session cookie。未登入回 401，前端據此顯示重新登入。
- **錯誤格式**：`{ "error": "<給使用者看的中文訊息>", "code"?: "<ApiErrorCode>" }`。有 `code` 的端點與狀態碼列在 `api-error-codes.ts`，前端依 `code` 翻譯；其他端點只顯示 `error`。
- **活動範圍**：社團與認領相關端點用查詢參數 `?event=<eventId>` 指定活動，未帶時用環境變數 `EVENT_ID`。主辦端點以路徑中的 `candidateId` 決定活動。
- **快取**：`/api/*` 一律 `cache-control: no-store`，只有 `GET /api/shares/:shareId` 例外（匿名快照，可短暫私人快取）。

## 權限等級

| 等級 | 意思 |
|---|---|
| 匿名 | 不需登入 |
| 登入 | 有效 session |
| 社團擁有者 | 登入，且在該活動對該社團有已驗證的認領；管理者也可以 |
| 活動成員 | 登入，且是該候選活動的成員；管理者也可以。#546 起不再區分 Owner／Editor |
| 管理者 | 登入，且在管理者名單上 |

## 公開

分享清單（`/api/shares*` 與 `/s/:shareId`）階段 5 起由 shares 模組（[`server/shares.ts`](../server/shares.ts)）提供，API 經單一 router。

| 方法 | 路徑 | 權限 | 呼叫端 | #546 |
|---|---|---|---|---|
| GET | `/data/events/:eventId/overrides.json` | 匿名 | Reader（`static-circle-overrides-client.ts`） | 保留。社團補充資料，撤下後立即消失，帶 ETag |
| GET | `/data/events/:eventId/v/:version/*.json` | 匿名 | Reader（`static-circle-catalog-client.ts`、`static-event-map-client.ts`）、Service Worker | 階段 4d 新增：頁面載入時的版本；只提供目前版本，被取代的版本 404 |
| GET | `/data/events/:eventId/*.json` | 匿名 | 開發伺服器、舊頁面、部署 smoke | 階段 3 起由 Function 依 R2 的 `index.json` 讀出目前版本，路徑不變 |
| GET | `/data/events/index.json` | 匿名 | Reader、社團入口、管理頁 | 階段 3 新增：已發布活動與目前版本，供 Service Worker 快取。頁面另由 middleware 在 HTML 內嵌同一份清單 |
| POST | `/api/shares` | 匿名 | `planning-share-client.ts` `createShortLink` | 保留。有速率限制 |
| GET | `/api/shares/:shareId` | 匿名 | `planning-share-client.ts` `readShortLink` | 保留 |
| GET | `/s/:shareId` | 匿名 | 短網址頁 | 保留 |

## 登入與帳號

階段 5e 起由 auth 模組（[`server/auth.ts`](../server/auth.ts)）經單一 router `functions/api/[[path]].ts` 提供；尚未重寫的領域仍由各自的 function 檔回應。

| 方法 | 路徑 | 權限 | 呼叫端 | #546 |
|---|---|---|---|---|
| GET | `/api/auth/config` | 匿名 | `readTurnstileSitekey` | 保留 |
| POST | `/api/auth/request-link` | 匿名 | `requestLoginLink` | 保留。必須通過 Turnstile，有速率限制 |
| POST | `/api/auth/verify` | 匿名 | `verifyLoginToken` | 保留 |
| GET | `/api/auth/session` | 登入 | `readSession` | 保留。回應 `PortalSession` 的 `isMapContributor` 在階段 5 移除 |
| DELETE | `/api/auth/session` | 登入 | `signOut` | 保留 |
| DELETE | `/api/account` | 登入 | `deleteMyAccount` | 保留。body `{ confirm: <自己的 email> }` |
| GET／PUT | `/api/account/notification-preferences` | 登入 | `readAccountNotificationPreferences`、`saveAccountNotificationPreferences` | 階段 5c：只剩通知語言 `{ version, locale }`；頻率已移除 |

## 社團與認領

階段 5 起由 circle 模組（[`server/circle.ts`](../server/circle.ts)）提供：`/api/claims*` 與 `/api/circle/*` 經單一 router，公開的 `/data/events/:eventId/overrides.json` 保留自己的 function 檔並呼叫同一模組。

| 方法 | 路徑 | 權限 | 呼叫端 | #546 |
|---|---|---|---|---|
| GET | `/api/circle/search?q=` 或 `?circle=` | 登入 | `searchCircles`、`readClaimCircle` | 保留 |
| GET | `/api/claims` | 登入 | `listMyClaims` | 保留 |
| POST | `/api/claims` | 登入 | `createClaim` | 保留。每日次數上限 |
| DELETE | `/api/claims/:claimId` | 登入（本人） | `withdrawClaim` | 保留 |
| POST | `/api/claims/:claimId/challenge` | 登入（本人） | `runChallenge` | 保留 |
| GET／PUT／DELETE | `/api/circle/:circleId/overrides` | 社團擁有者 | `readMyOverride`、`saveOverride`、`deleteMyOverride` | 保留 |
| POST | `/api/circle/:circleId/preview` | 社團擁有者 | `previewOverride` | 保留。不寫入 |
| POST | `/api/circle/:circleId/visibility` | 社團擁有者 | `setPostEventVisibility` | 保留 |
| GET | `/api/circle/:circleId/thumbnail` | 社團擁有者 | 攤位導覽（`booth-guide/portal-guide.tsx`） | 保留。讀已上傳的代表圖原檔，`private, no-store` |
| POST | `/api/circle/:circleId/thumbnail` | 社團擁有者 | `uploadThumbnail` | 保留。multipart |
| POST | `/api/circle/:circleId/catalog-image` | 社團擁有者 | `uploadCatalogImage` | 保留。multipart |

## 網站管理

階段 5 起由 admin 模組（[`server/admin.ts`](../server/admin.ts)）提供，經單一 router。主辦擁有者在自己活動的認領審核與撤下沿用同一套步驟。`/api/admin/organizer/*` 屬於主辦工作區，見下節。

| 方法 | 路徑 | 權限 | 呼叫端 | #546 |
|---|---|---|---|---|
| GET | `/api/admin/review-queue` | 管理者 | `listReviewQueue` | 保留 |
| GET | `/api/admin/claims` | 管理者 | 前端未使用 | **刪除** |
| POST | `/api/admin/claims` | 管理者 | `decideClaim` | 保留。決定後寄單封通知 |
| GET／POST | `/api/admin/overrides` | 管理者 | `searchTakedownCircles`、`takedownOverride` | 保留。撤下立即生效 |
| GET | `/api/admin/circles/:circleId` | 管理者 | `readAdminCircleDetail` | 保留 |
| GET／POST | `/api/admin/admins` | 管理者 | `listAdmins`、`manageAdmin` | 保留 |
| GET | `/api/admin/accounts?email=` 或 `?circle=` | 管理者 | `readAdminAccountDetail`、`searchAdminAccountsByCircle` | 保留 |
| POST | `/api/admin/accounts` | 管理者 | `disableAccount` | 保留 |
| GET／PUT | `/api/admin/site-settings` | 管理者 | `readAdminSiteSettings`、`saveAdminSiteSettings` | 修改：`AdminSiteSettings` 移除 `publicationMode`、`publicationActivities`，設定移除 `publicationEnabled` 與兩個通知開關 |
| POST | `/api/admin/service-check` | 管理者 | `requestAdminServiceCheck` | 修改：目前由排程 Worker 執行，改為請求內直接檢查寄信設定；`publication` 項目移除 |
| GET／PUT | `/api/admin/notification-preferences` | 管理者 | `readNotificationPreferences`、`saveNotificationPreferences` | **已刪除**（階段 5c） |
| GET／POST | `/api/admin/references` | 管理者 | 主辦 `readSharedReferences`、`saveSharedReference` | 保留 |
| POST | `/api/admin/integrations/github/probe` | 管理者 | 前端未使用 | 已刪除（階段 4b） |

## 主辦工作區

階段 5 起由 organizer 模組提供，經單一 router：[`server/organizer.ts`](../server/organizer.ts)（申請、活動候選、工作區、協作者與邀請、主辦擁有者的認領審核、公告與撤下）、[`server/organizer-content.ts`](../server/organizer-content.ts)（場館與參照、匯入、地圖、活動圖片、驗證與預覽）、[`server/organizer-publication.ts`](../server/organizer-publication.ts)（送審、管理者審核發布、重試、重新開啟與修正）。

| 方法 | 路徑 | 權限 | 呼叫端 | #546 |
|---|---|---|---|---|
| GET／POST | `/api/organizer/applications` | 登入 | 主辦 `listEventApplications`、`submitEventApplication` | 保留 |
| POST | `/api/admin/organizer/applications/:applicationId` | 管理者 | 主辦 `reviewEventApplication` | 保留 |
| POST | `/api/admin/organizer/events` | 管理者 | 主辦 `createOrganizerEvent` | 保留 |
| GET | `/api/organizer/events` | 登入 | 主辦 `listOrganizerEvents` | 保留 |
| GET／PATCH | `/api/organizer/events/:candidateId` | 活動成員 | 主辦 `readOrganizerEvent`、`saveOrganizerEvent` | 修改：`OrganizerEventDetail` 的發布資訊簡化為「已核准並發布」的結果，移除 job 步驟與技術詳細資訊 |
| PATCH | `…/:candidateId/workspace` | 活動成員 | 主辦 `saveOrganizerWorkspacePreference` | 保留 |
| POST | `…/:candidateId/workspace/complete-onboarding` | 活動成員 | 主辦 `completeOrganizerOnboarding` | 保留 |
| GET／POST | `…/:candidateId/venues` | 活動成員 | 主辦 `listOrganizerVenues`、`createOrganizerVenue` | 保留 |
| POST | `…/:candidateId/venues/:venueId/spaces` | 活動成員 | 主辦 `createOrganizerVenueSpace` | 保留 |
| POST | `…/:candidateId/references` | 活動成員 | 主辦 `createOrganizerReferenceEntry` | 保留 |
| PUT | `…/:candidateId/imports` | 活動成員 | 主辦 `putOrganizerImport` | 保留 |
| GET／POST | `…/:candidateId/maps` | 活動成員 | 主辦 `listOrganizerMaps`、`createOrganizerMap` | 保留 |
| GET／PATCH | `…/:candidateId/maps/:draftId` | 活動成員 | 主辦 `readOrganizerMap`、`saveOrganizerMap` | 保留 |
| GET／PUT | `…/:candidateId/maps/:draftId/background` | 活動成員 | 主辦地圖底圖 | 保留。PUT 為 multipart |
| GET／PUT | `…/:candidateId/image` | 活動成員 | 主辦 `uploadOrganizerEventImage`、`organizerEventImagePreviewPath` | 保留。PUT 為 multipart |
| POST | `…/:candidateId/validate` | 活動成員 | 主辦 `validateOrganizerEvent` | 保留。不寫入 |
| POST | `…/:candidateId/preview` | 活動成員 | 主辦 `previewOrganizerEvent` | 保留。不寫入 |
| POST | `…/:candidateId/submit` | 活動成員 | 主辦 `submitOrganizerEvent` | 修改：目前限 Owner，改為任何成員都能送審 |
| POST | `…/:candidateId/collaborators` | 活動成員 | 主辦 `manageOrganizerMember` | 階段 5b 起：單一「成員」的邀請、重寄與移除，`role` 欄位不再使用；每個活動至少保留一位成員 |
| GET／POST | `…/:candidateId/claims` | 活動成員 | 主辦 `listOrganizerClaims`、`decideOrganizerClaim` | 保留 |
| GET／POST | `…/:candidateId/overrides` | 活動成員 | 主辦 `searchOrganizerTakedownCircles`、`takedownOrganizerOverride` | 保留 |
| GET／PUT／DELETE | `…/:candidateId/notice` | 活動成員 | 主辦 `readOrganizerNotice`、`saveOrganizerNotice`、`clearOrganizerNotice` | 保留 |

`…` 代表 `/api/organizer/events`。

## 核准、發布與更正

| 方法 | 路徑 | 權限 | 呼叫端 | #546 |
|---|---|---|---|---|
| POST | `/api/admin/organizer/events/:candidateId/review` | 管理者 | 主辦 `reviewOrganizerEvent` | 修改（階段 4a 起）：核准時在同一個請求內產生公開檔、寫入 R2 新版本與社團配號表，最後改寫 `index.json`。成功回應即代表已公開；失敗不改動公開內容，可重試 |
| POST | `/api/organizer/events/:candidateId/amendments` | 活動成員 | 主辦 `startOrganizerAmendment` | 修改（階段 4a 起）：保留名單異動宣告，基準改從 R2 讀取並與公開的 `circles.json` 核對 |
| GET／PUT | `/api/organizer/events/:candidateId/amendment` | 活動成員 | 主辦 `readOrganizerAmendment`、`saveOrganizerAmendment` | 保留：維護者 2026-11-22 決定保留宣告，以免社團 ID 變動使讀者收藏失效 |
| POST | `/api/organizer/publications/:jobId/retry` | 活動成員 | 主辦 `retryOrganizerPublication` | 保留：R2 發布仍可能遇到可重試的失敗（例如另一筆發布剛完成） |
| POST | `/api/admin/organizer/publications/:jobId/retry` | 管理者 | 前端未使用 | 已刪除（階段 4b） |
| POST | `/api/organizer/events/:candidateId/reopen` | 活動成員 | 主辦 `reopenOrganizerEvent` | 保留：核對 R2 尚未公開這筆核准後，把失敗的候選退回修改 |
| POST | `/api/admin/organizer/events/:candidateId/abandon` | 管理者 | 主辦 `abandonOrganizerAmendment` | 已刪除（階段 4b） |

## 地圖貢獻（階段 5a 已刪除）

依 #546 決策移除地圖貢獻者角色。以下端點、`PortalSession.isMapContributor`，以及社團入口與管理頁的對應畫面一起刪除：

- `POST /api/admin/map-contributors`（`manageMapContributor`）
- `GET /api/admin/map-contributions`
- `GET /api/admin/map-contributions/drafts`、`GET …/drafts/:draftId`、`POST …/drafts/:draftId/review`、`POST …/drafts/:draftId/export`
- `GET／POST /api/map-contributions/drafts`、`GET／PUT …/drafts/:draftId`、`POST …/drafts/:draftId/submit`、`POST …/drafts/:draftId/comments`
- `POST /api/map-contributions/files`、`GET …/files/:fileId`、`GET …/files/:fileId/preview`

## 測試與整合

| 方法 | 路徑 | 用途 | #546 |
|---|---|---|---|
| POST | `/api/integrations/github/webhook` | 喚醒發布 job | 已刪除（階段 4b） |
| GET／POST／DELETE | `/api/preview/mail` | preview 環境的收信槽，供 E2E 讀登入信 | 保留到 CI 重整時再決定 |
