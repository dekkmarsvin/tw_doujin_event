import type { ApiErrorCode } from "../app/i18n/api-error";
import { circleOverrideFieldsProblem, circleRetentionExpiresAt, isRetentionChoice, type CircleOverrideFields } from "../app/circle-overrides";
import { getEventDefinition } from "../app/event-catalog";
import { randomChallengeCode, sha256Hex } from "../app/portal-crypto";
import type { OverridesPhase } from "../db/identity-repository";
import { DYNAMIC_OVERLAY_CACHE_POLICY } from "../app/catalog-publication";
import { json, readJson } from "./http";
import {
  catalogKeyOf, catalogKeysOf, catalogObjectPrefix, circleObjectPrefix, deleteObjectKeys, hostedCatalogImage, hostedThumbnailFields, prepareHostedCatalogImage, prepareHostedThumbnail,
} from "../app/hosted-thumbnails";
import type { Auth } from "./auth";
import type { PortalDependencies } from "../app/circle-portal-handlers";
import { createEventScope } from "./event-scope";

/**
 * Circle module (#546 phase 5): claims and their challenge, catalog search,
 * the circle's own content (fields, thumbnail, sale-sheet pages, post-event
 * visibility) and the public overlay readers load.
 */

const errorCode = (code: ApiErrorCode) => code;
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;

const LIMITS = {
  claimsPerAccountPerDay: 3,
  challengeAttemptsPerClaim: 10,
};

/** Hosts a Worker can actually fetch. The rest are bot-walled, so they go to review. */
const FETCHABLE_EVIDENCE_PROVIDERS = new Set(["官方網站", "連結整合頁", "其他連結", "pixivFANBOX", "Fantia"]);

const SEARCH_MIN_LENGTH = 2;
export const SEARCH_LIMIT = 8;
/** Whether a stored row publishes any sale-sheet page, and so owns hosted objects. */
export function hasCatalogImages(row: { fields_json: string } | null | undefined) {
  if (!row) return false;
  try {
    return ((JSON.parse(row.fields_json) as CircleOverrideFields).catalogImages?.length ?? 0) > 0;
  } catch {
    return false;
  }
}


type CircleDependencies = Pick<PortalDependencies,
  "repository" | "lookupCircle" | "searchCircles" | "fetchEvidence" | "projectCircle" | "thumbnailStore" | "config">;

export function createCircle({ repository, lookupCircle, searchCircles, fetchEvidence, projectCircle, thumbnailStore, config }: CircleDependencies, auth: Auth) {
  const { clientIpHash, currentSession } = auth;
  const { dataUpdatedAt, eventEndsAt, currentPhase, eventScoped } = createEventScope(config);

  async function listClaims(request: Request) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。", code: errorCode("unauthenticated") }, 401);
    const claims = await repository.listClaimsForAccount(current.accountId, config.eventId);
    // The account sees its latest submission per circle. Review history keeps every decision.
    const seen = new Set<string>();
    const latest = claims.filter((claim) => {
      if (seen.has(claim.circle_id)) return false;
      seen.add(claim.circle_id);
      return true;
    });
    return json({
      eventId: config.eventId,
      claims: latest.map((claim) => ({
        id: claim.id,
        circleId: claim.circle_id,
        circleName: claim.circle_name_at_claim,
        status: claim.status,
        method: claim.method,
        targetUrl: claim.target_url,
        evidenceUrl: claim.evidence_url,
        createdAt: claim.created_at,
      })),
    });
  }

  /**
   * Find a circle to claim, without handing out the catalog.
   *
   * The portal used to download `circles.json` and filter it client-side, which
   * only works if the whole catalog is publicly readable. Keeping the search
   * server-side and behind a session means the reader's catalog can stay gated
   * while circles still claim themselves — and saves each of them 1.8 MB.
   */
  async function searchCatalog(request: Request) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。", code: errorCode("unauthenticated") }, 401);

    const parameters = new URL(request.url).searchParams;
    const circleId = parameters.get("circle");
    const query = (parameters.get("q") ?? "").trim();
    if (circleId === null && query.length < SEARCH_MIN_LENGTH) return json({ circles: [] });

    const exact = circleId && circleId.length <= 200 ? await lookupCircle(circleId) : null;
    const matches = circleId === null ? await searchCircles(query, SEARCH_LIMIT) : exact ? [exact] : [];
    // The exact entry lookup says whether the circle already has an owner, so
    // the form can step aside before anyone fills it in. For one circle this is
    // the answer `createClaim`'s 409 gives, without naming the owner; unlike a
    // submission it costs no daily claim and leaves no claim or audit entry.
    const claimed = exact ? await repository.hasVerifiedClaim(config.eventId, exact.id) : null;
    return json({
      circles: matches.map((circle) => ({
        id: circle.id,
        name: circle.name,
        // Only the links a Worker can verify are useful in the claim form.
        links: circle.links.filter((link) => FETCHABLE_EVIDENCE_PROVIDERS.has(link.provider)),
        linkCount: circle.links.length,
        ...(claimed === null ? {} : { claimed }),
      })),
    });
  }

  async function createClaim(request: Request) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。", code: errorCode("unauthenticated") }, 401);

    const body = await readJson(request);
    const circleId = typeof body?.circleId === "string" ? body.circleId : "";
    const targetUrl = typeof body?.targetUrl === "string" ? body.targetUrl : null;
    const evidenceUrl = typeof body?.evidenceUrl === "string" ? body.evidenceUrl : null;
    const evidenceNote = typeof body?.evidenceNote === "string" ? body.evidenceNote.slice(0, 500) : null;

    const circle = await lookupCircle(circleId);
    if (!circle) return json({ error: "找不到這個社團。", code: errorCode("circle_not_found") }, 404);

    const now = config.now();
    const mine = await repository.listClaimsForAccount(current.accountId, config.eventId);
    const existing = mine.find((claim) => claim.circle_id === circleId
      && (claim.status === "pending" || claim.status === "verified"));
    if (existing) {
      // Naming the way out matters more than naming the problem: a claimant who
      // lost their challenge lands here, and "you already submitted this" alone
      // is what turned a lost code into a dead end (#141).
      return json({
        error: existing.status === "verified"
          ? "你已經通過這個社團的認領。"
          : "你已經送出過這個社團的認領。若驗證碼遺失或過期，請先撤回這筆認領，再重新送出取得新的驗證碼。",
        code: errorCode(existing.status === "verified" ? "claim_already_verified" : "claim_already_pending"),
        claimId: existing.id,
        claimStatus: existing.status,
      }, 409);
    }
    if (mine.filter((claim) => claim.created_at >= now - 24 * 60 * 60 * 1000).length >= LIMITS.claimsPerAccountPerDay) {
      return json({ error: "今日認領次數已達上限。", code: errorCode("claim_daily_limit") }, 429);
    }
    // Never name the existing claimant: that would leak who owns a circle.
    if (await repository.hasVerifiedClaim(config.eventId, circleId)) {
      return json({ error: "此社團已有通過的認領。若這是你的社團，請聯絡管理者。", code: errorCode("circle_already_claimed") }, 409);
    }

    // Tier 0: the account's own domain already appears as this circle's site.
    const emailHost = current.email.split("@")[1] ?? "";
    const domainMatch = circle.links.some((link) => {
      if (link.provider !== "官方網站") return false;
      try {
        return new URL(link.url).hostname.replace(/^www\./, "") === emailHost;
      } catch {
        return false;
      }
    });

    // Only a URL already recorded for this circle may be challenged, and only
    // when its host is one a Worker can actually read.
    const recorded = targetUrl ? circle.links.find((link) => link.url === targetUrl) : undefined;
    const challengeable = !!recorded && FETCHABLE_EVIDENCE_PROVIDERS.has(recorded.provider);
    const challenge = challengeable ? randomChallengeCode(config.eventId) : null;

    // A resubmission after a withdrawal reuses the withdrawn row, so the id in
    // force is whatever the repository reports, not necessarily this one.
    const id = crypto.randomUUID();
    const claimId = await repository.createClaim({
      id,
      accountId: current.accountId,
      eventId: config.eventId,
      circleId,
      circleNameKey: circle.nameKey,
      circleNameAtClaim: circle.name,
      sourceRowAtClaim: circle.sourceRow,
      status: domainMatch ? "verified" : "pending",
      method: domainMatch ? "email_domain" : null,
      targetUrl: challengeable ? targetUrl : null,
      challengeTokenHash: challenge ? await sha256Hex(challenge) : null,
      challengeExpiresAt: challenge ? now + CHALLENGE_TTL_MS : null,
      evidenceUrl,
      evidenceNote,
      now,
    });
    if (!claimId) return json({ error: "此帳號正在刪除，無法建立認領。", code: errorCode("account_deleting"), params: { action: "create_claim" } }, 409);
    await repository.writeAudit({
      at: now, actorAccountId: current.accountId, actorRole: "circle",
      action: domainMatch ? "claim.auto_verified" : "claim.created",
      subjectType: "claim", subjectId: claimId,
      detail: { circleId, circleName: circle.name, method: domainMatch ? "email_domain" : null, evidenceUrl },
      ipHash: await clientIpHash(request),
    });

    return json({ id: claimId, status: domainMatch ? "verified" : "pending", challenge, targetUrl: challengeable ? targetUrl : null }, 201);
  }

  /**
   * The claimant's own way out of a lost or expired challenge. Withdrawing then
   * resubmitting issues a new code, which is why no admin has to be involved in
   * the ordinary case and why no plaintext challenge is kept anywhere.
   */
  /**
   * A claim id is global; the request's authority is not. Every claim-addressed
   * route therefore checks the row's own event, not just who owns it: without
   * it an id from event A could be acted on through event B's control plane,
   * which is the isolation ADR-0043 exists for. Another event's claim reads as
   * absent, the same as an id that does not exist.
   */
  function claimInScope<Claim extends { event_id: string }>(claim: Claim | null): claim is Claim {
    return !!claim && claim.event_id === config.eventId;
  }

  async function withdrawClaim(request: Request, claimId: string) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。", code: errorCode("unauthenticated") }, 401);

    const claim = await repository.getClaim(claimId);
    if (!claimInScope(claim) || claim.account_id !== current.accountId) return json({ error: "找不到這筆認領。", code: errorCode("claim_not_found") }, 404);
    if (claim.status !== "pending") {
      return json({ error: "只有審核中的認領可以撤回。", code: errorCode("claim_not_pending") }, 409);
    }
    if (!await repository.withdrawClaim(claimId, current.accountId)) {
      return json({ error: "只有審核中的認領可以撤回。", code: errorCode("claim_not_pending") }, 409);
    }

    const now = config.now();
    await repository.writeAudit({
      at: now, actorAccountId: current.accountId, actorRole: "circle",
      action: "claim.withdrawn", subjectType: "claim", subjectId: claimId,
      detail: { circleId: claim.circle_id }, ipHash: await clientIpHash(request),
    });
    return json({ ok: true });
  }

  async function runChallenge(request: Request, claimId: string) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。", code: errorCode("unauthenticated") }, 401);

    const claim = await repository.getClaim(claimId);
    if (!claimInScope(claim) || claim.account_id !== current.accountId) return json({ error: "找不到這筆認領。", code: errorCode("claim_not_found") }, 404);
    if (claim.status !== "pending") return json({ error: "這筆認領已經處理過了。", code: errorCode("claim_already_decided") }, 409);
    if (!claim.challenge_token_hash || !claim.target_url) return json({ error: "這筆認領需要人工審核。", code: errorCode("claim_requires_manual_review") }, 409);

    const now = config.now();
    if (claim.challenge_expires_at !== null && claim.challenge_expires_at < now) {
      return json({ error: "驗證碼已過期。請撤回這筆認領後重新送出，即可取得新的驗證碼。", code: errorCode("claim_challenge_expired") }, 410);
    }
    if (claim.challenge_attempts >= LIMITS.challengeAttemptsPerClaim) {
      return json({ error: "驗證次數已達上限，請改用人工審核。", code: errorCode("claim_challenge_attempts_exhausted") }, 429);
    }
    if (!await repository.recordChallengeAttempt(claim.id)) {
      return json({ error: "此帳號正在刪除，無法繼續驗證。", code: errorCode("account_deleting"), params: { action: "verify_claim" } }, 409);
    }

    const body = await fetchEvidence(claim.target_url);
    const matched = !!body && await sha256Hex(extractChallenge(body) ?? "") === claim.challenge_token_hash;
    if (!matched) {
      await repository.writeAudit({ at: now, actorAccountId: current.accountId, actorRole: "circle", action: "claim.challenge_failed", subjectType: "claim", subjectId: claim.id, detail: { targetUrl: claim.target_url } });
      return json({ verified: false, error: "在該頁面找不到驗證碼，請確認已公開發布後再試。" }, 200);
    }

    const verified = await repository.markClaimVerified(claim.id, "link_token", now, null);
    await repository.writeAudit({
      at: now, actorAccountId: current.accountId, actorRole: "circle",
      action: verified ? "claim.auto_verified" : "claim.verify_conflict",
      subjectType: "claim", subjectId: claim.id,
      detail: { targetUrl: claim.target_url, evidenceBodyHash: await sha256Hex(body) },
    });
    return json(verified ? { verified: true } : { verified: false, error: "此社團已有通過的認領。", code: errorCode("circle_already_claimed") }, verified ? 200 : 409);
  }

  /** `null` for an event this build does not know: the bounded string rule then applies. */
  function eventCategories() {
    return getEventDefinition(config.eventId)?.circleCategories ?? null;
  }

  function extractChallenge(body: string) {
    const eventPrefix = config.eventId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return body.match(new RegExp(`${eventPrefix}-[23456789BCDFGHJKLMNPQRSTVWXYZ]{10}`))?.[0] ?? null;
  }

  async function putOverride(request: Request, circleId: string) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。", code: errorCode("unauthenticated") }, 401);
    if (!await repository.ownsCircle(current.accountId, config.eventId, circleId)) {
      return json({ error: "你尚未通過這個社團的認領。", code: errorCode("claim_not_verified") }, 403);
    }

    const body = await readJson(request);
    const fields = body?.fields;
    // Validated against the event this request is for, not the build's first
    // published event: the portal serves every published event (ADR-0043), and
    // a category catalog is per-event.
    const fieldsProblem = circleOverrideFieldsProblem(fields, eventCategories());
    if (fieldsProblem) return json({ error: fieldsProblem, code: errorCode("invalid_fields") }, 400);

    // Chosen while writing, in the same submission as the content (ADR-0018).
    // Absent means "did not answer this time", which leaves any earlier choice
    // alone and never becomes a choice to delete.
    const choice = body?.retention;
    if (choice !== undefined && !isRetentionChoice(choice)) {
      return json({ error: "保存期限必須是「保留」或「活動後清除」。", code: errorCode("invalid_retention") }, 400);
    }
    const retention = choice === undefined
      ? undefined
      : { choice, expiresAt: circleRetentionExpiresAt(choice, Date.parse(await eventEndsAt())) };

    const now = config.now();
    const ipHash = await clientIpHash(request);
    const previous = await repository.getOverride(config.eventId, circleId);
    const previousKey = previous?.hosted_thumbnail_key ?? null;
    const uploadedKey = typeof body?.hostedThumbnailKey === "string" ? body.hostedThumbnailKey : null;
    const uploadPrefix = `events/${encodeURIComponent(config.eventId)}/circles/${encodeURIComponent(circleId)}/`;
    const thumbnailUrl = (fields as CircleOverrideFields).thumbnail?.url ?? null;
    const previousHostedUrl = previousKey && thumbnailStore ? thumbnailStore.url(previousKey) : null;
    const pointsAtHostedStore = !!(thumbnailStore && thumbnailUrl?.startsWith(thumbnailStore.url("")));
    if (pointsAtHostedStore && thumbnailUrl !== previousHostedUrl && !uploadedKey) {
      return json({ error: "本站代管代表圖需要有效的上傳憑證，請重新選擇檔案。", code: errorCode("image_reselect_required"), params: { kind: "thumbnail" } }, 400);
    }
    if (uploadedKey && (!thumbnailStore
      || !new RegExp(`^${uploadPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-f0-9]{64}\\.(?:jpg|png|webp)$`).test(uploadedKey)
      || (fields as CircleOverrideFields).thumbnail?.url !== thumbnailStore.url(uploadedKey))) {
      return json({ error: "代表圖上傳憑證無效，請重新選擇檔案。", code: errorCode("image_reselect_required"), params: { kind: "thumbnail" } }, 400);
    }
    if (uploadedKey && !await thumbnailStore!.list(uploadPrefix).then((keys) => keys.includes(uploadedKey))) {
      return json({ error: "代表圖草稿已不存在，請重新選擇檔案。", code: errorCode("image_reselect_required"), params: { kind: "thumbnail" } }, 400);
    }
    const keepsHostedThumbnail = !!(previousKey && thumbnailStore
      && thumbnailUrl === thumbnailStore.url(previousKey));
    const nextHostedKey = uploadedKey ?? (keepsHostedThumbnail ? previousKey : null);
    if (previousKey && previousKey !== nextHostedKey && !thumbnailStore) return json({ error: "暫時無法使用圖片功能，請稍後再試。", code: errorCode("image_service_unavailable") }, 503);
    // Sale-sheet images are hosted only. Each URL must name an object this
    // circle uploaded that is still there — published before or staged since;
    // the key is in the URL, so no separate upload token is needed.
    const catalogImages = (fields as CircleOverrideFields).catalogImages ?? [];
    if ((catalogImages.length > 0 || hasCatalogImages(previous)) && !thumbnailStore) {
      return json({ error: "暫時無法使用圖片功能，請稍後再試。", code: errorCode("image_service_unavailable") }, 503);
    }
    const nextCatalogKeys = thumbnailStore ? catalogKeysOf(thumbnailStore, fields as CircleOverrideFields, config.eventId, circleId) : [];
    if (nextCatalogKeys.some((key) => key === null)) return json({ error: "品書圖片需要在這裡上傳，請重新選擇檔案。", code: errorCode("image_reselect_required"), params: { kind: "catalog" } }, 400);
    if (nextCatalogKeys.length > 0) {
      const stored = new Set(await thumbnailStore!.list(catalogObjectPrefix(config.eventId, circleId)));
      if (nextCatalogKeys.some((key) => !stored.has(key!))) return json({ error: "有品書圖片已不存在，請重新選擇檔案。", code: errorCode("image_reselect_required"), params: { kind: "catalog" } }, 400);
    }
    const saved = await repository.putOverride({
      accountId: current.accountId, eventId: config.eventId, circleId,
      fieldsJson: JSON.stringify(fields), updatedBy: current.accountId, now, retention,
      hostedThumbnailKey: nextHostedKey,
    });
    if (!saved) {
      if (uploadedKey && thumbnailStore) await thumbnailStore.delete(uploadedKey);
      return json({ error: "此帳號正在刪除，無法儲存內容。", code: errorCode("account_deleting"), params: { action: "save_content" } }, 409);
    }
    await repository.rebuildOverridesDoc(config.eventId, await dataUpdatedAt(), now, await currentPhase());
    if (thumbnailStore) {
      // Whatever the saved row no longer names — a replaced picture, a removed
      // sale-sheet page, a draft never confirmed — goes now.
      const kept = new Set([nextHostedKey, ...nextCatalogKeys]);
      const unusedKeys = (await thumbnailStore.list(uploadPrefix)).filter((key) => !kept.has(key));
      await deleteObjectKeys(thumbnailStore, unusedKeys);
    }
    await repository.writeAudit({
      at: now, actorAccountId: current.accountId, actorRole: "circle", action: "override.updated",
      subjectType: "override", subjectId: circleId,
      detail: { changedFields: Object.keys(fields as CircleOverrideFields), previousRevision: previous?.revision ?? 0 },
      ipHash,
    });
    // A second entry, only when the answer actually changed: the purge that
    // eventually deletes this row records that it happened but not what it
    // held, so this is where "the circle asked for it, on this date" survives.
    if (retention && retention.choice !== (previous?.retention_choice ?? null)) {
      await repository.writeAudit({
        at: now, actorAccountId: current.accountId, actorRole: "circle", action: "override.retention",
        subjectType: "override", subjectId: circleId,
        detail: { choice: retention.choice, expiresAt: retention.expiresAt },
        ipHash,
      });
    }
    return json({ ok: true });
  }

  async function readThumbnail(request: Request, circleId: string) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。", code: errorCode("unauthenticated") }, 401);
    if (!await repository.ownsCircle(current.accountId, config.eventId, circleId)) {
      return json({ error: "你尚未通過這個社團的認領。", code: errorCode("claim_not_verified") }, 403);
    }
    const key = (await repository.getOverride(config.eventId, circleId))?.hosted_thumbnail_key;
    if (!key) return new Response(null, { status: 404 });
    if (!thumbnailStore?.get) return json({ error: "暫時無法使用圖片功能，請稍後再試。", code: errorCode("image_service_unavailable") }, 503);
    // Read the saved key only: no caller-provided URL or draft object can be fetched.
    const object = await thumbnailStore.get(key);
    if (!object) return new Response(null, { status: 404 });
    return new Response(object.body, { headers: {
      "content-type": object.contentType ?? "application/octet-stream",
      "cache-control": "private, no-store", "x-content-type-options": "nosniff",
    } });
  }

  async function uploadThumbnail(request: Request, circleId: string) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。", code: errorCode("unauthenticated") }, 401);
    if (!await repository.ownsCircle(current.accountId, config.eventId, circleId)) {
      return json({ error: "你尚未通過這個社團的認領。", code: errorCode("claim_not_verified") }, 403);
    }
    if (!thumbnailStore) return json({ error: "暫時無法使用圖片功能，請稍後再試。", code: errorCode("image_service_unavailable") }, 503);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "上傳格式無效。", code: errorCode("invalid_upload") }, 400);
    }
    const file = form.get("file");
    // Only the bytes are required: the circle that uploads its own artwork is
    // the source, and the two credit fields are optional (ADR-0053).
    const sourceUrl = form.get("sourceUrl");
    const provider = form.get("provider");
    if (!(file instanceof File)) return json({ error: "請選擇圖片。", code: errorCode("image_required") }, 400);

    let prepared: Awaited<ReturnType<typeof prepareHostedThumbnail>>;
    try {
      prepared = await prepareHostedThumbnail({
        eventId: config.eventId, circleId, file,
        sourceUrl: typeof sourceUrl === "string" ? sourceUrl : "",
        provider: typeof provider === "string" ? provider : "",
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "代表圖格式無效。", code: errorCode("invalid_image"), params: { kind: "thumbnail" } }, 400);
    }

    const thumbnail = hostedThumbnailFields(thumbnailStore, prepared);

    const previousKey = (await repository.getOverride(config.eventId, circleId))?.hosted_thumbnail_key ?? null;
    // Only the one-picture slot: sale-sheet pages are a set with rules of their own.
    const catalogPrefix = catalogObjectPrefix(config.eventId, circleId);
    const staleDraftKeys = (await thumbnailStore.list(circleObjectPrefix(config.eventId, circleId)))
      .filter((key) => key !== previousKey && key !== prepared.key && !key.startsWith(catalogPrefix));
    await deleteObjectKeys(thumbnailStore, staleDraftKeys);
    await thumbnailStore.put(prepared.key, prepared.value, prepared.contentType);
    if (!await repository.isAccountWritable(current.accountId)) {
      await thumbnailStore.delete(prepared.key);
      return json({ error: "此帳號正在刪除，無法上傳圖片。", code: errorCode("account_deleting"), params: { action: "upload_image" } }, 409);
    }
    return json({ ok: true, thumbnail, uploadKey: prepared.key });
  }

  /**
   * Stage one sale-sheet page: the readable image and its card preview, both
   * already resized in the browser. Like a thumbnail upload this publishes
   * nothing; the page appears once a save names it.
   *
   * Pages are a set, so an upload cannot simply replace "the" draft. The
   * editor sends the keys its draft still holds (`keep`); besides those, the
   * published pages and this upload, every sale-sheet object is an abandoned
   * draft and is removed here, which bounds what an editor can leave behind.
   */
  async function uploadCatalogImage(request: Request, circleId: string) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。", code: errorCode("unauthenticated") }, 401);
    if (!await repository.ownsCircle(current.accountId, config.eventId, circleId)) {
      return json({ error: "你尚未通過這個社團的認領。", code: errorCode("claim_not_verified") }, 403);
    }
    if (!thumbnailStore) return json({ error: "暫時無法使用圖片功能，請稍後再試。", code: errorCode("image_service_unavailable") }, 503);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "上傳格式無效。", code: errorCode("invalid_upload") }, 400);
    }
    const file = form.get("file");
    const preview = form.get("preview");
    if (!(file instanceof File) || !(preview instanceof File)) return json({ error: "請選擇圖片。", code: errorCode("image_required") }, 400);
    // Addresses, not keys: only an address that is one of this circle's own
    // sale-sheet objects can keep anything.
    const keep = form.getAll("keep").flatMap((url) => typeof url === "string" ? [catalogKeyOf(thumbnailStore, url, config.eventId, circleId)] : []);

    let prepared: Awaited<ReturnType<typeof prepareHostedCatalogImage>>;
    try {
      prepared = await prepareHostedCatalogImage({ eventId: config.eventId, circleId, file, preview });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "品書圖片格式無效。", code: errorCode("invalid_image"), params: { kind: "catalog" } }, 400);
    }

    const previous = await repository.getOverride(config.eventId, circleId);
    const published = catalogKeysOf(thumbnailStore, previous ? JSON.parse(previous.fields_json) as CircleOverrideFields : null, config.eventId, circleId);
    const retained = new Set([...published, ...keep, prepared.full.key, prepared.preview.key]);
    const abandoned = (await thumbnailStore.list(catalogObjectPrefix(config.eventId, circleId))).filter((key) => !retained.has(key));
    await deleteObjectKeys(thumbnailStore, abandoned);
    await thumbnailStore.put(prepared.full.key, prepared.full.value, "image/jpeg");
    await thumbnailStore.put(prepared.preview.key, prepared.preview.value, "image/jpeg");
    if (!await repository.isAccountWritable(current.accountId)) {
      await deleteObjectKeys(thumbnailStore, [prepared.full.key, prepared.preview.key]);
      return json({ error: "此帳號正在刪除，無法上傳圖片。", code: errorCode("account_deleting"), params: { action: "upload_image" } }, 409);
    }
    return json({ ok: true, image: hostedCatalogImage(thumbnailStore, prepared) });
  }

  /**
   * The circle deletes its own contribution.
   *
   * Same chain as every other write here — session, then verified claim — and
   * no bearer link of its own (ADR-0020): a forwardable URL is the weakest
   * credential in the system and this is the only action with no way back.
   *
   * Ownership is checked against the claim, not against who wrote the row, so a
   * circle that changed hands can delete what its predecessor wrote. The
   * account that did it is in `audit_log`, which is what keeps the two apart
   * after a transfer.
   */
  async function deleteMyOverride(request: Request, circleId: string) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。", code: errorCode("unauthenticated") }, 401);
    if (!await repository.ownsCircle(current.accountId, config.eventId, circleId)) {
      return json({ error: "你尚未通過這個社團的認領。", code: errorCode("claim_not_verified") }, 403);
    }

    // The confirmation is the circle's own id, echoed back. A boolean would be
    // one button on the wire whatever the interface looks like, and a session
    // lasts 30 days — long enough for the click to be a stale tab's, not a
    // decision. Re-sending a mail was the alternative, and it would have made
    // an irreversible action depend on deliverability.
    const body = await readJson(request);
    if (body?.confirm !== circleId) return json({ error: "請輸入社團代號以確認刪除。", code: errorCode("circle_delete_confirmation") }, 400);

    const now = config.now();
    const previous = await repository.getOverride(config.eventId, circleId);
    if ((previous?.hosted_thumbnail_key || hasCatalogImages(previous)) && !thumbnailStore) return json({ error: "暫時無法使用圖片功能，請稍後再試。", code: errorCode("image_service_unavailable") }, 503);
    if (thumbnailStore) {
      const keys = await thumbnailStore.list(circleObjectPrefix(config.eventId, circleId));
      await deleteObjectKeys(thumbnailStore, keys);
    }
    if (!await repository.deleteOverride({ accountId: current.accountId, eventId: config.eventId, circleId, now: config.now() })) {
      return json({ error: "沒有可刪除的內容。", code: errorCode("nothing_to_delete") }, 404);
    }
    await repository.rebuildOverridesDoc(config.eventId, await dataUpdatedAt(), now, await currentPhase());
    // What was deleted is deliberately absent; that it was, and by whom, is not.
    await repository.writeAudit({
      at: now, actorAccountId: current.accountId, actorRole: "circle", action: "override.deleted",
      subjectType: "override", subjectId: circleId,
      detail: { previousRevision: previous?.revision ?? 0, retention: previous?.retention_choice ?? null },
      ipHash: await clientIpHash(request),
    });
    return json({ ok: true });
  }

  /**
   * Project a draft through the real read model and return what a visitor would
   * see. Computed server-side against the same `buildCircleCatalog` the reader
   * uses, so the preview cannot drift from the published result — and so the
   * portal still never downloads the catalog.
   */
  async function previewOverride(request: Request, circleId: string) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。", code: errorCode("unauthenticated") }, 401);
    if (!await repository.ownsCircle(current.accountId, config.eventId, circleId)) {
      return json({ error: "你尚未通過這個社團的認領。", code: errorCode("claim_not_verified") }, 403);
    }

    const body = await readJson(request);
    const fields = body?.fields ?? {};
    const fieldsProblem = circleOverrideFieldsProblem(fields, eventCategories());
    if (fieldsProblem) return json({ error: fieldsProblem, code: errorCode("invalid_fields") }, 400);

    const projectedAt = new Date(config.now()).toISOString();
    const [records, baseRecords] = await Promise.all([
      projectCircle(circleId, fields as CircleOverrideFields, projectedAt),
      projectCircle(circleId, null, projectedAt),
    ]);
    if (!records) return json({ error: "找不到這個社團。", code: errorCode("circle_not_found") }, 404);
    return json({ records, baseRecords: baseRecords ?? [], projectedAt });
  }

  async function getMyOverride(request: Request, circleId: string) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。", code: errorCode("unauthenticated") }, 401);
    if (!await repository.ownsCircle(current.accountId, config.eventId, circleId)) {
      return json({ error: "你尚未通過這個社團的認領。", code: errorCode("claim_not_verified") }, 403);
    }
    const row = await repository.getOverride(config.eventId, circleId);
    return json({
      fields: row ? JSON.parse(row.fields_json) as unknown : {},
      status: row?.status ?? "none",
      updatedAt: row?.updated_at ?? null,
      postEventHidden: !!row?.post_event_hidden,
      // `null` reaches the client as `null`: the portal has to be able to tell
      // "has not answered" from "chose to keep" so it can ask.
      retention: row?.retention_choice ?? null,
      retentionExpiresAt: row?.retention_expires_at ?? null,
    });
  }

  /**
   * A circle decides whether its own contributions stay public once the event
   * is over. The organizer's booth data is unaffected — only what the circle
   * wrote here is withdrawn.
   */
  async function setPostEventVisibility(request: Request, circleId: string) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。", code: errorCode("unauthenticated") }, 401);
    if (!await repository.ownsCircle(current.accountId, config.eventId, circleId)) {
      return json({ error: "你尚未通過這個社團的認領。", code: errorCode("claim_not_verified") }, 403);
    }

    const body = await readJson(request);
    if (typeof body?.hidden !== "boolean") return json({ error: "hidden 必須是 true 或 false。", code: errorCode("invalid_visibility") }, 400);

    const now = config.now();
    const applied = await repository.setPostEventHidden(current.accountId, config.eventId, circleId, body.hidden, config.now());
    if (!applied) return json({ error: "請先儲存一次內容再設定。", code: errorCode("save_required_first") }, 409);

    await repository.rebuildOverridesDoc(config.eventId, await dataUpdatedAt(), now, await currentPhase());
    await repository.writeAudit({
      at: now, actorAccountId: current.accountId, actorRole: "circle", action: "override.post_event_visibility",
      subjectType: "override", subjectId: circleId, detail: { hidden: body.hidden }, ipHash: await clientIpHash(request),
    });
    return json({ ok: true, hidden: body.hidden });
  }

  /**
   * The public overlay. The strong ETag is keyed on the stored revision so a
   * reader that already has the current document gets a bodyless 304 — but the
   * saving is bandwidth, not quota. Nothing collapses this at the edge: the
   * 304 is decided here, one D1 read later, and Workers Cache is off. Every
   * revalidation is one Function request against the daily limit, which is why
   * `max-age` is the only lever on the bill. See issue #48.
   */
  async function publicOverrides(request: Request, eventId: string) {
    // Every published event serves its own overlay, and each answers with its
    // own dates: the phase is "has *this* event ended", so borrowing the
    // control plane's event would retire one event's content on another's
    // schedule. An unpublished event is a 404 as before.
    const published = config.publishedEvent
      ? await config.publishedEvent(eventId)
      : (eventId === config.eventId ? { dataUpdatedAt: await dataUpdatedAt(), eventEndsAt: await eventEndsAt() } : null);
    if (!published) return json({ error: "找不到這個活動的社團補充資料。" }, 404, { "cache-control": "no-store" });
    let doc = await repository.getOverridesDoc(eventId);

    // The document is written on edit, but the event ending is not an edit.
    // Rebuilding on a phase change keeps the steady-state read a single row
    // lookup instead of filtering the document on every request.
    const phase: OverridesPhase = config.now() > Date.parse(published.eventEndsAt) ? "after" : "during";
    if (doc && doc.phase !== phase) {
      await repository.rebuildOverridesDoc(eventId, published.dataUpdatedAt, config.now(), phase);
      doc = await repository.getOverridesDoc(eventId);
    }
    const body = doc?.json ?? JSON.stringify({
      schema: "circle-overrides/1", eventId, generatedAt: published.dataUpdatedAt, revision: 0, overrides: [],
    });
    const etag = `"circle-overrides-${eventId}-${phase}-${doc?.revision ?? 0}"`;
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": DYNAMIC_OVERLAY_CACHE_POLICY,
      etag,
    };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(body, { status: 200, headers });
  }

  return {
    routes: {
      listClaims: eventScoped(listClaims, true),
      createClaim: eventScoped(createClaim, true),
      withdrawClaim: eventScoped(withdrawClaim, true),
      runChallenge: eventScoped(runChallenge, true),
      searchCatalog: eventScoped(searchCatalog, true),
      getMyOverride: eventScoped(getMyOverride, true),
      putOverride: eventScoped(putOverride, true),
      uploadThumbnail: eventScoped(uploadThumbnail, true),
      readThumbnail: eventScoped(readThumbnail, true),
      uploadCatalogImage: eventScoped(uploadCatalogImage, true),
      deleteMyOverride: eventScoped(deleteMyOverride, true),
      previewOverride: eventScoped(previewOverride, true),
      setPostEventVisibility: eventScoped(setPostEventVisibility, true),
      // Names its own event and validates it, so it is not scoped by the request.
      publicOverrides,
    },
  };
}
