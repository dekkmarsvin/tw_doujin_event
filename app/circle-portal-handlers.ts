import { circleRetentionExpiresAt, isCircleOverrideFields, isRetentionChoice, type CircleOverrideFields } from "./circle-overrides";
import { hmacSign, hmacVerify, isEmailShaped, normalizeEmail, peppered, randomChallengeCode, randomToken, sha256Hex } from "./portal-crypto";
import type { ClaimMethod, IdentityRepository, OverridesPhase } from "../db/identity-repository";
import { DYNAMIC_OVERLAY_CACHE_POLICY } from "./catalog-publication";
import { deleteObjectKeys, hostedThumbnailFields, prepareHostedThumbnail, type HostedThumbnailStore } from "./hosted-thumbnails";
import {
  mapContributionObjectKey, prepareMapContributionFile, type MapContributionFileStore,
} from "./map-contribution-files";
import {
  buildMapCandidate, parseMapContributionDraftContent, validateMapContributionDraft,
  type MapContributionScope,
} from "./map-contribution-draft";
import type { PublishedEventMap } from "./event-map";

/**
 * Circle portal routes as plain Request → Response, with the repository, mailer
 * and catalog lookup injected. Same shape as `event-map-route-handlers.ts`, so
 * the whole surface is testable against Miniflare without a Pages runtime.
 */

export const SESSION_COOKIE = "__Host-ff47_session";

const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;
/** Approving or taking down requires a session created recently: cheap step-up. */
const ADMIN_FRESH_SESSION_MS = 24 * 60 * 60 * 1000;

const LIMITS = {
  loginPerEmailPerHour: 5,
  loginPerIpPerHour: 20,
  claimsPerAccountPerDay: 3,
  challengeAttemptsPerClaim: 10,
};

/** Hosts a Worker can actually fetch. The rest are bot-walled, so they go to review. */
const FETCHABLE_EVIDENCE_PROVIDERS = new Set(["官方網站", "連結整合頁", "其他連結", "pixivFANBOX", "Fantia"]);

export type CircleLookup = {
  id: string;
  name: string;
  nameKey: string;
  sourceRow: number | null;
  links: { provider: string; url: string }[];
};

export type PortalConfig = {
  eventId: string;
  origin: string;
  sessionSecret: string;
  hashPepper: string;
  adminEmails: string[];
  dataUpdatedAt: string | (() => Promise<string>);
  /** ISO instant after which an opted-out circle's content is withdrawn. */
  eventEndsAt: string | (() => Promise<string>);
  now: () => number;
};

export type PortalDependencies = {
  repository: IdentityRepository;
  sendMail: (message: { to: string; subject: string; text: string }) => Promise<void>;
  lookupCircle: (circleId: string) => Promise<CircleLookup | null>;
  searchCircles: (query: string, limit: number) => Promise<CircleLookup[]>;
  /** Returns page text, or null when the host cannot be read from a Worker. */
  fetchEvidence: (url: string) => Promise<string | null>;
  /**
   * Turnstile siteverify. Fails closed: an unreachable verifier is a `false`,
   * not a pass, so an outage stops sign-ins instead of opening the mailer.
   */
  verifyHuman: (token: string, remoteIp: string | null) => Promise<boolean>;
  /**
   * The public half of the Turnstile pair. Resolved on call, not on
   * construction: the reader's public overlay is built from this same wiring,
   * and a sitekey nobody has configured yet must not take that down too.
   */
  turnstileSitekey: () => string;
  /** Runs the reader's own projection so a preview cannot drift from reality. */
  projectCircle: (circleId: string, fields: CircleOverrideFields | null, updatedAt?: string) => Promise<unknown[] | null>;
  thumbnailStore?: HostedThumbnailStore;
  /** Separate private R2 bucket. It must never share the public thumbnail origin. */
  mapContributionStore?: MapContributionFileStore;
  /** Resolves official event scope and booth coverage from the pinned catalog. */
  resolveMapContributionScope?: (input: { periodKey: string; venueSpaceId: string }) => Promise<MapContributionScope | null>;
  /** Reads only the reviewed public repository snapshot used as diff base. */
  readPublishedEventMap?: (targetPath: string) => Promise<PublishedEventMap | null>;
  config: PortalConfig;
};

const EMAIL_AUDIT_DOMAIN = "audit-email-v1";

/** Keyed and domain-separated so a leaked audit table cannot be tested against
 * an email dictionary, and the digest cannot be confused with another HMAC. */
export function emailAuditSubjectId(secret: string, email: string) {
  return hmacSign(secret, `${EMAIL_AUDIT_DOMAIN}\0${normalizeEmail(email)}`);
}

const SEARCH_MIN_LENGTH = 2;
const SEARCH_LIMIT = 8;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function sessionCookie(value: string, maxAgeSeconds: number) {
  // `__Host-` forces Secure + Path=/ + no Domain, so no sibling host can set it.
  return `${SESSION_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function createCirclePortalHandlers({
  repository, sendMail, lookupCircle, searchCircles, fetchEvidence, verifyHuman, turnstileSitekey,
  projectCircle, thumbnailStore, mapContributionStore, resolveMapContributionScope, readPublishedEventMap, config,
}: PortalDependencies) {
  // The roster lives in the database so it can change without a redeploy.
  // Normalized on both sides, as a stored account email is: comparing a raw
  // string against a normalized one silently denies an admin whose address
  // differs only in case or Unicode width.
  const isAdmin = (email: string) => repository.isAdminEmail(normalizeEmail(email));

  /** Publication phase. Only the circle's own content is withdrawn afterwards. */
  const configValue = async (value: string | (() => Promise<string>)) => typeof value === "string" ? value : value();
  const dataUpdatedAt = () => configValue(config.dataUpdatedAt);
  const eventEndsAt = () => configValue(config.eventEndsAt);
  const currentPhase = async (): Promise<OverridesPhase> => (config.now() > Date.parse(await eventEndsAt()) ? "after" : "during");

  async function clientIpHash(request: Request) {
    const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "";
    return address ? peppered(config.hashPepper, address) : null;
  }

  /** Resolve the caller. Signature is a cheap gate; the session row is the authority. */
  async function currentSession(request: Request, allowDeleting = false) {
    const raw = readCookie(request, SESSION_COOKIE);
    if (!raw) return null;
    const separator = raw.lastIndexOf(".");
    if (separator <= 0) return null;
    const sessionId = raw.slice(0, separator);
    const signature = raw.slice(separator + 1);
    if (!await hmacVerify(config.sessionSecret, sessionId, signature)) return null;
    const session = await repository.getSession(sessionId, config.now(), allowDeleting);
    return session ? { ...session, sessionId } : null;
  }

  async function requireSession(request: Request) {
    const session = await currentSession(request);
    return session ?? null;
  }

  /** The public half of the Turnstile pair, so the sign-in page can render it. */
  function authConfig() {
    return json({ turnstileSitekey: turnstileSitekey() });
  }

  async function requestLink(request: Request) {
    const body = await readJson(request);

    // Human verification runs first, before the address is even read. It is the
    // only check here whose outcome does not depend on the mailbox, so it can
    // answer honestly without telling an attacker which inboxes exist — and
    // nothing past it, neither the rate-limit counters nor the mailer, is
    // reachable by a script that cannot solve it.
    const humanToken = typeof body?.turnstileToken === "string" ? body.turnstileToken : "";
    if (!humanToken || !await verifyHuman(humanToken, request.headers.get("cf-connecting-ip"))) {
      return json({ error: "真人驗證未通過，請重新驗證後再送出。" }, 403);
    }

    const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    const now = config.now();

    // Always the same answer: an attacker must not learn which inboxes exist.
    const accepted = json({ ok: true }, 202);
    if (!isEmailShaped(email)) return accepted;

    const ipHash = await clientIpHash(request);
    const windowStart = now - 60 * 60 * 1000;
    const [byEmail, byIp] = await Promise.all([
      repository.countLoginTokensSince("email", email, windowStart),
      ipHash ? repository.countLoginTokensSince("request_ip_hash", ipHash, windowStart) : Promise.resolve(0),
    ]);
    if (byEmail >= LIMITS.loginPerEmailPerHour || byIp >= LIMITS.loginPerIpPerHour) {
      return json({ error: "請求過於頻繁，請稍後再試。" }, 429);
    }

    const token = randomToken();
    await repository.createLoginToken({
      tokenHash: await sha256Hex(token),
      email,
      now,
      expiresAt: now + LOGIN_TOKEN_TTL_MS,
      ipHash,
    });

    // Root-path query, consumed by POST from the page: mail scanners issue a GET
    // on every link they see, and a GET-consumes design burns the token first.
    await sendMail({
      to: email,
      subject: "場刊 Map 登入連結",
      text: `請開啟以下連結登入（15 分鐘內有效，僅能使用一次）：\n\n${config.origin}/circle?login=${encodeURIComponent(token)}\n\n若您沒有申請登入，請忽略這封信，不會有任何變更。`,
    });
    await repository.writeAudit({
      at: now, actorRole: "system", action: "auth.link_requested", subjectType: "email",
      subjectId: await emailAuditSubjectId(config.hashPepper, email), ipHash,
    });
    return accepted;
  }

  async function verify(request: Request) {
    const body = await readJson(request);
    const token = typeof body?.token === "string" ? body.token : "";
    if (!token) return json({ error: "登入連結無效。" }, 400);

    const now = config.now();
    const email = await repository.consumeLoginToken(await sha256Hex(token), now);
    if (!email) return json({ error: "登入連結已失效或已使用，請重新索取。" }, 400);

    let accountId: string;
    try {
      accountId = await repository.upsertAccount(email, now);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "無法建立帳號。" }, 403);
    }

    // A fresh id on every verify, so a leaked earlier value cannot be reused.
    const sessionId = randomToken();
    await repository.createSession(accountId, now, now + SESSION_TTL_MS, sessionId);
    const signature = await hmacSign(config.sessionSecret, sessionId);
    await repository.writeAudit({ at: now, actorAccountId: accountId, actorRole: "circle", action: "auth.session_created", subjectType: "account", subjectId: accountId, ipHash: await clientIpHash(request) });

    return json({
      email,
      isAdmin: await isAdmin(email),
      isMapContributor: await repository.hasActiveMapContributor(accountId),
    }, 200, {
      "set-cookie": sessionCookie(`${sessionId}.${signature}`, Math.floor(SESSION_TTL_MS / 1000)),
    });
  }

  async function session(request: Request) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    return json({
      email: current.email,
      isAdmin: await isAdmin(current.email),
      isMapContributor: await repository.hasActiveMapContributor(current.accountId),
    });
  }

  async function signOut(request: Request) {
    const current = await currentSession(request);
    if (current) {
      await repository.revokeSession(current.sessionId, config.now());
      await repository.writeAudit({ at: config.now(), actorAccountId: current.accountId, actorRole: "circle", action: "auth.signed_out", subjectType: "account", subjectId: current.accountId });
    }
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
  }

  async function deleteMyAccount(request: Request) {
    // The session that initiated deletion remains usable only on this route so
    // an R2 outage can be retried; every normal route rejects the tombstone.
    const current = await currentSession(request, true);
    if (!current) return json({ error: "尚未登入。" }, 401);
    if (await isAdmin(current.email)) {
      return json({ error: "管理者帳號需先由另一位管理者移出名單，才能刪除。" }, 409);
    }
    const body = await readJson(request);
    if (body?.confirm !== current.email) {
      return json({ error: "請輸入目前登入的完整 email 以確認刪除帳號。" }, 400);
    }
    const now = config.now();
    let claimScopes = await repository.listClaimScopesForAccount(current.accountId);
    let mapDraftKeys = await repository.listUnsubmittedMapDraftObjectKeysForAccount(current.accountId);
    if (!thumbnailStore && claimScopes.length > 0) return json({ error: "暫時無法使用圖片功能，請稍後再試。" }, 503);
    if (!mapContributionStore && mapDraftKeys.length > 0) return json({ error: "暫時無法使用地圖草稿檔案，請稍後再試。" }, 503);
    if (!await repository.beginAccountDeletion({
      accountId: current.accountId, email: current.email, now, retrySessionId: current.sessionId,
    })) {
      return json({ error: "找不到可刪除的帳號。" }, 404);
    }
    // Re-read after the atomic contributor tombstone. An upload that already
    // put R2 bytes can no longer bind metadata and will roll its object back.
    claimScopes = await repository.listClaimScopesForAccount(current.accountId);
    mapDraftKeys = await repository.listUnsubmittedMapDraftObjectKeysForAccount(current.accountId);
    if (thumbnailStore) {
      const allKeys = (await Promise.all(claimScopes.map((claim) => thumbnailStore.list(
        `events/${encodeURIComponent(claim.event_id)}/circles/${encodeURIComponent(claim.circle_id)}/`,
      )))).flat();
      await deleteObjectKeys(thumbnailStore, [...new Set(allKeys)]);
    }
    if (mapContributionStore) await deleteObjectKeys(mapContributionStore, [...new Set(mapDraftKeys)]);
    const deleted = await repository.deleteAccount({
      accountId: current.accountId,
      email: current.email,
      emailAuditDigest: await emailAuditSubjectId(config.hashPepper, current.email),
      legacyEmailAuditDigest: await sha256Hex(current.email),
      now,
    });
    if (!deleted) return json({ error: "找不到可刪除的帳號。" }, 404);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
  }

  async function listClaims(request: Request) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    const claims = await repository.listClaimsForAccount(current.accountId, config.eventId);
    return json({
      claims: claims.map((claim) => ({
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
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);

    const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
    if (query.length < SEARCH_MIN_LENGTH) return json({ circles: [] });

    const matches = await searchCircles(query, SEARCH_LIMIT);
    return json({
      circles: matches.map((circle) => ({
        id: circle.id,
        name: circle.name,
        // Only the links a Worker can verify are useful in the claim form.
        links: circle.links.filter((link) => FETCHABLE_EVIDENCE_PROVIDERS.has(link.provider)),
        linkCount: circle.links.length,
      })),
    });
  }

  async function createClaim(request: Request) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);

    const body = await readJson(request);
    const circleId = typeof body?.circleId === "string" ? body.circleId : "";
    const targetUrl = typeof body?.targetUrl === "string" ? body.targetUrl : null;
    const evidenceUrl = typeof body?.evidenceUrl === "string" ? body.evidenceUrl : null;
    const evidenceNote = typeof body?.evidenceNote === "string" ? body.evidenceNote.slice(0, 500) : null;

    const circle = await lookupCircle(circleId);
    if (!circle) return json({ error: "找不到這個社團。" }, 404);

    const now = config.now();
    const mine = await repository.listClaimsForAccount(current.accountId, config.eventId);
    if (mine.some((claim) => claim.circle_id === circleId && (claim.status === "pending" || claim.status === "verified"))) {
      return json({ error: "你已經送出過這個社團的認領。" }, 409);
    }
    if (mine.filter((claim) => claim.created_at >= now - 24 * 60 * 60 * 1000).length >= LIMITS.claimsPerAccountPerDay) {
      return json({ error: "今日認領次數已達上限。" }, 429);
    }
    // Never name the existing claimant: that would leak who owns a circle.
    if (await repository.hasVerifiedClaim(config.eventId, circleId)) {
      return json({ error: "此社團已有通過的認領。若這是你的社團，請聯絡管理者。" }, 409);
    }

    // Tier 0: the account's own domain already appears as this circle's site.
    const emailHost = current.email.split("@")[1] ?? "";
    const domainMatch = circle.links.some((link) => {
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

    const id = crypto.randomUUID();
    const created = await repository.createClaim({
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
    if (!created) return json({ error: "此帳號正在刪除，無法建立認領。" }, 409);
    await repository.writeAudit({
      at: now, actorAccountId: current.accountId, actorRole: "circle",
      action: domainMatch ? "claim.auto_verified" : "claim.created",
      subjectType: "claim", subjectId: id,
      detail: { circleId, circleName: circle.name, method: domainMatch ? "email_domain" : null, evidenceUrl },
      ipHash: await clientIpHash(request),
    });

    return json({ id, status: domainMatch ? "verified" : "pending", challenge, targetUrl: challengeable ? targetUrl : null }, 201);
  }

  async function runChallenge(request: Request, claimId: string) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);

    const claim = await repository.getClaim(claimId);
    if (!claim || claim.account_id !== current.accountId) return json({ error: "找不到這筆認領。" }, 404);
    if (claim.status !== "pending") return json({ error: "這筆認領已經處理過了。" }, 409);
    if (!claim.challenge_token_hash || !claim.target_url) return json({ error: "這筆認領需要人工審核。" }, 409);

    const now = config.now();
    if (claim.challenge_expires_at !== null && claim.challenge_expires_at < now) {
      return json({ error: "驗證碼已過期，請重新送出認領。" }, 410);
    }
    if (claim.challenge_attempts >= LIMITS.challengeAttemptsPerClaim) {
      return json({ error: "驗證次數已達上限，請改用人工審核。" }, 429);
    }
    if (!await repository.recordChallengeAttempt(claim.id)) {
      return json({ error: "此帳號正在刪除，無法繼續驗證。" }, 409);
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
    return json(verified ? { verified: true } : { verified: false, error: "此社團已有通過的認領。" }, verified ? 200 : 409);
  }

  function extractChallenge(body: string) {
    const eventPrefix = config.eventId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return body.match(new RegExp(`${eventPrefix}-[23456789BCDFGHJKLMNPQRSTVWXYZ]{10}`))?.[0] ?? null;
  }

  async function putOverride(request: Request, circleId: string) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    if (!await repository.ownsCircle(current.accountId, config.eventId, circleId)) {
      return json({ error: "你尚未通過這個社團的認領。" }, 403);
    }

    const body = await readJson(request);
    const fields = body?.fields;
    if (!isCircleOverrideFields(fields)) return json({ error: "資料格式不符或超出長度限制。" }, 400);

    // Chosen while writing, in the same submission as the content (ADR-0018).
    // Absent means "did not answer this time", which leaves any earlier choice
    // alone and never becomes a choice to delete.
    const choice = body?.retention;
    if (choice !== undefined && !isRetentionChoice(choice)) {
      return json({ error: "保存期限必須是「保留」或「活動後清除」。" }, 400);
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
      return json({ error: "本站代管代表圖需要有效的上傳憑證，請重新選擇檔案。" }, 400);
    }
    if (uploadedKey && (!thumbnailStore
      || !new RegExp(`^${uploadPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-f0-9]{64}\\.(?:jpg|png|webp)$`).test(uploadedKey)
      || (fields as CircleOverrideFields).thumbnail?.url !== thumbnailStore.url(uploadedKey))) {
      return json({ error: "代表圖上傳憑證無效，請重新選擇檔案。" }, 400);
    }
    if (uploadedKey && !await thumbnailStore!.list(uploadPrefix).then((keys) => keys.includes(uploadedKey))) {
      return json({ error: "代表圖草稿已不存在，請重新選擇檔案。" }, 400);
    }
    const keepsHostedThumbnail = !!(previousKey && thumbnailStore
      && thumbnailUrl === thumbnailStore.url(previousKey));
    const nextHostedKey = uploadedKey ?? (keepsHostedThumbnail ? previousKey : null);
    if (previousKey && previousKey !== nextHostedKey && !thumbnailStore) return json({ error: "暫時無法使用圖片功能，請稍後再試。" }, 503);
    const saved = await repository.putOverride({
      accountId: current.accountId, eventId: config.eventId, circleId,
      fieldsJson: JSON.stringify(fields), updatedBy: current.accountId, now, retention,
      hostedThumbnailKey: nextHostedKey,
    });
    if (!saved) {
      if (uploadedKey && thumbnailStore) await thumbnailStore.delete(uploadedKey);
      return json({ error: "此帳號正在刪除，無法儲存內容。" }, 409);
    }
    await repository.rebuildOverridesDoc(config.eventId, await dataUpdatedAt(), now);
    if (thumbnailStore) {
      const unusedKeys = (await thumbnailStore.list(uploadPrefix)).filter((key) => key !== nextHostedKey);
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

  async function uploadThumbnail(request: Request, circleId: string) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    if (!await repository.ownsCircle(current.accountId, config.eventId, circleId)) {
      return json({ error: "你尚未通過這個社團的認領。" }, 403);
    }
    if (!thumbnailStore) return json({ error: "暫時無法使用圖片功能，請稍後再試。" }, 503);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "上傳格式無效。" }, 400);
    }
    const file = form.get("file");
    const sourceUrl = form.get("sourceUrl");
    const provider = form.get("provider");
    if (!(file instanceof File) || typeof sourceUrl !== "string" || typeof provider !== "string") {
      return json({ error: "請選擇圖片，並填寫出處頁面與來源標示。" }, 400);
    }

    let prepared: Awaited<ReturnType<typeof prepareHostedThumbnail>>;
    try {
      prepared = await prepareHostedThumbnail({ eventId: config.eventId, circleId, file, sourceUrl, provider });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "代表圖格式無效。" }, 400);
    }

    const thumbnail = hostedThumbnailFields(thumbnailStore, prepared);

    const previousKey = (await repository.getOverride(config.eventId, circleId))?.hosted_thumbnail_key ?? null;
    const staleDraftKeys = (await thumbnailStore.list(`events/${encodeURIComponent(config.eventId)}/circles/${encodeURIComponent(circleId)}/`))
      .filter((key) => key !== previousKey && key !== prepared.key);
    await deleteObjectKeys(thumbnailStore, staleDraftKeys);
    await thumbnailStore.put(prepared.key, prepared.value, prepared.contentType);
    if (!await repository.isAccountWritable(current.accountId)) {
      await thumbnailStore.delete(prepared.key);
      return json({ error: "此帳號正在刪除，無法上傳圖片。" }, 409);
    }
    return json({ ok: true, thumbnail, uploadKey: prepared.key });
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
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    if (!await repository.ownsCircle(current.accountId, config.eventId, circleId)) {
      return json({ error: "你尚未通過這個社團的認領。" }, 403);
    }

    // The confirmation is the circle's own id, echoed back. A boolean would be
    // one button on the wire whatever the interface looks like, and a session
    // lasts 30 days — long enough for the click to be a stale tab's, not a
    // decision. Re-sending a mail was the alternative, and it would have made
    // an irreversible action depend on deliverability.
    const body = await readJson(request);
    if (body?.confirm !== circleId) return json({ error: "請輸入社團代號以確認刪除。" }, 400);

    const now = config.now();
    const previous = await repository.getOverride(config.eventId, circleId);
    if (previous?.hosted_thumbnail_key && !thumbnailStore) return json({ error: "暫時無法使用圖片功能，請稍後再試。" }, 503);
    if (thumbnailStore) {
      const keys = await thumbnailStore.list(`events/${encodeURIComponent(config.eventId)}/circles/${encodeURIComponent(circleId)}/`);
      await deleteObjectKeys(thumbnailStore, keys);
    }
    if (!await repository.deleteOverride({ accountId: current.accountId, eventId: config.eventId, circleId })) {
      return json({ error: "沒有可刪除的內容。" }, 404);
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
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    if (!await repository.ownsCircle(current.accountId, config.eventId, circleId)) {
      return json({ error: "你尚未通過這個社團的認領。" }, 403);
    }

    const body = await readJson(request);
    const fields = body?.fields ?? {};
    if (!isCircleOverrideFields(fields)) return json({ error: "資料格式不符或超出長度限制。" }, 400);

    const projectedAt = new Date(config.now()).toISOString();
    const [records, baseRecords] = await Promise.all([
      projectCircle(circleId, fields as CircleOverrideFields, projectedAt),
      projectCircle(circleId, null, projectedAt),
    ]);
    if (!records) return json({ error: "找不到這個社團。" }, 404);
    return json({ records, baseRecords: baseRecords ?? [], projectedAt });
  }

  async function getMyOverride(request: Request, circleId: string) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    if (!await repository.ownsCircle(current.accountId, config.eventId, circleId)) {
      return json({ error: "你尚未通過這個社團的認領。" }, 403);
    }
    const row = await repository.getOverride(config.eventId, circleId);
    return json({
      fields: row ? JSON.parse(row.fields_json) as unknown : {},
      status: row?.status ?? "none",
      postEventHidden: !!row?.post_event_hidden,
      // `null` reaches the client as `null`: the portal has to be able to tell
      // "has not answered" from "chose to keep" so it can ask.
      retention: row?.retention_choice ?? null,
      retentionExpiresAt: row?.retention_expires_at ?? null,
    });
  }

  type AdminGate =
    | { ok: false; response: Response }
    | { ok: true; session: NonNullable<Awaited<ReturnType<typeof currentSession>>> };

  /**
   * A circle decides whether its own contributions stay public once the event
   * is over. The organizer's booth data is unaffected — only what the circle
   * wrote here is withdrawn.
   */
  async function setPostEventVisibility(request: Request, circleId: string) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    if (!await repository.ownsCircle(current.accountId, config.eventId, circleId)) {
      return json({ error: "你尚未通過這個社團的認領。" }, 403);
    }

    const body = await readJson(request);
    if (typeof body?.hidden !== "boolean") return json({ error: "hidden 必須是 true 或 false。" }, 400);

    const now = config.now();
    const applied = await repository.setPostEventHidden(current.accountId, config.eventId, circleId, body.hidden);
    if (!applied) return json({ error: "請先儲存一次內容再設定。" }, 409);

    await repository.rebuildOverridesDoc(config.eventId, await dataUpdatedAt(), now, await currentPhase());
    await repository.writeAudit({
      at: now, actorAccountId: current.accountId, actorRole: "circle", action: "override.post_event_visibility",
      subjectType: "override", subjectId: circleId, detail: { hidden: body.hidden }, ipHash: await clientIpHash(request),
    });
    return json({ ok: true, hidden: body.hidden });
  }

  async function requireFreshAdmin(request: Request): Promise<AdminGate> {
    const current = await requireSession(request);
    if (!current) return { ok: false, response: json({ error: "尚未登入。" }, 401) };
    if (!await isAdmin(current.email)) return { ok: false, response: json({ error: "沒有權限。" }, 403) };
    if (config.now() - current.sessionCreatedAt > ADMIN_FRESH_SESSION_MS) {
      return { ok: false, response: json({ error: "管理操作需要重新登入。" }, 401) };
    }
    return { ok: true, session: current };
  }

  async function adminManageMapContributor(request: Request) {
    const gate = await requireFreshAdmin(request);
    if (!gate.ok) return gate.response;
    const body = await readJson(request);
    const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    const action = body?.action;
    if (!isEmailShaped(email) || (action !== "grant" && action !== "revoke" && action !== "suspend")) {
      return json({ error: "email 與 action（grant／revoke／suspend）是必填欄位。" }, 400);
    }
    const now = config.now();
    const result = await repository.manageMapContributor({ email, action, by: gate.session.email, now });
    await repository.writeAudit({
      at: now, actorAccountId: gate.session.accountId, actorRole: "admin",
      action: `map_contributor.${action}`, subjectType: "map_contributor",
      subjectId: await emailAuditSubjectId(config.hashPepper, email), detail: { result }, ipHash: await clientIpHash(request),
    });
    if (result === "missing") return json({ error: "找不到可授權的有效帳號。" }, 404);
    if (result === "unchanged") return json({ error: "角色狀態沒有變更。" }, 409);
    return json({ ok: true, result });
  }

  async function adminListStaleMapDrafts(request: Request) {
    const gate = await requireFreshAdmin(request);
    if (!gate.ok) return gate.response;
    const daysValue = Number(new URL(request.url).searchParams.get("days") ?? "30");
    if (!Number.isSafeInteger(daysValue) || daysValue < 1 || daysValue > 365) return json({ error: "days 必須介於 1 與 365。" }, 400);
    const before = config.now() - daysValue * 24 * 60 * 60 * 1000;
    const drafts = await repository.listStaleSubmittedMapDrafts(before, config.eventId);
    return json({ before, drafts });
  }

  function validMapScope(value: unknown): value is string {
    return typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value);
  }

  function privateDraftContent(value: unknown) {
    const content = parseMapContributionDraftContent(value);
    if (!content) return null;
    const serialized = JSON.stringify(content);
    return new TextEncoder().encode(serialized).byteLength <= 1024 * 1024 ? serialized : null;
  }

  async function mapScope(periodKey: string, venueSpaceId: string) {
    const scope = await resolveMapContributionScope?.({ periodKey, venueSpaceId }) ?? null;
    if (!scope) return { ok: false as const, reason: "not_found" as const };
    const normalized = await repository.normalizeMapDraftPeriodAliases({
      eventId: config.eventId, venueSpaceId: scope.venueSpaceId,
      periodKey: scope.periodKey, periodAliases: scope.periodAliases,
    });
    return normalized
      ? { ok: true as const, scope }
      : { ok: false as const, reason: "scope_conflict" as const };
  }

  async function listMyMapDrafts(request: Request) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    if (!await repository.hasActiveMapContributor(current.accountId)) return json({ error: "沒有有效的地圖貢獻者權限。" }, 403);
    return json({ drafts: await repository.listMapDraftsForOwner(current.accountId, config.eventId) });
  }

  async function getMapDraft(request: Request, draftId: string, admin = false) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    if (admin && !await isAdmin(current.email)) return json({ error: "沒有權限。" }, 403);
    const draft = await repository.getMapDraft(draftId, config.eventId);
    if (!draft || (!admin && draft.owner_account_id !== current.accountId)) return json({ error: "找不到草稿。" }, 404);
    const [files, reviews] = await Promise.all([
      repository.listMapDraftFiles(draftId),
      repository.listMapDraftReviews(draftId),
    ]);
    return json({
      draft: { ...draft, content: draft.content_json ? JSON.parse(draft.content_json) as unknown : null, content_json: undefined },
      files,
      reviews,
    });
  }

  async function createMapDraft(request: Request) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    if (!await repository.hasActiveMapContributor(current.accountId)) {
      return json({ error: "沒有有效的地圖貢獻者權限。" }, 403);
    }
    const body = await readJson(request);
    const periodKey = body?.periodKey;
    const venueSpaceId = body?.venueSpaceId;
    const contentJson = privateDraftContent(body?.content);
    if (!validMapScope(periodKey) || !validMapScope(venueSpaceId) || !contentJson) {
      return json({ error: "periodKey、venueSpaceId 或草稿內容無效。" }, 400);
    }
    const resolvedScope = await mapScope(periodKey, venueSpaceId);
    if (!resolvedScope.ok) return json({
      error: resolvedScope.reason === "scope_conflict"
        ? "同一活動範圍已有互相衝突的核准稿，請由管理者先處理。"
        : "活動 period 或場地空間不存在。",
    }, resolvedScope.reason === "scope_conflict" ? 409 : 400);
    const scope = resolvedScope.scope;
    const draftId = crypto.randomUUID();
    const created = await repository.createMapDraft({
      id: draftId, eventId: config.eventId, periodKey: scope.periodKey, venueSpaceId: scope.venueSpaceId,
      ownerAccountId: current.accountId, contentJson, now: config.now(),
    });
    if (!created) return json({ error: "沒有有效的地圖貢獻者權限。" }, 403);
    await repository.writeAudit({
      at: config.now(), actorAccountId: current.accountId, actorRole: "map_contributor",
      action: "map_draft.created", subjectType: "map_draft", subjectId: draftId,
      detail: { eventId: config.eventId, periodKey: scope.periodKey, venueSpaceId: scope.venueSpaceId }, ipHash: await clientIpHash(request),
    });
    return json({ ok: true, draftId, revision: 1 }, 201);
  }

  async function updateMapDraft(request: Request, draftId: string) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    const body = await readJson(request);
    const expectedRevision = body?.expectedRevision;
    const contentJson = privateDraftContent(body?.content);
    if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1 || !contentJson) {
      return json({ error: "expectedRevision 或草稿內容無效。" }, 400);
    }
    const draft = await repository.getMapDraft(draftId, config.eventId);
    if (!draft || draft.owner_account_id !== current.accountId) return json({ error: "找不到草稿。" }, 404);
    const revision = await repository.writeMapDraftRevision({
      draftId, eventId: config.eventId, ownerAccountId: current.accountId, expectedRevision: expectedRevision as number,
      contentJson, now: config.now(),
    });
    if (revision === null) return json({ error: "草稿版本已變更、狀態不可編輯，或權限已撤銷。" }, 409);
    return json({ ok: true, draftId, revision });
  }

  async function submitMapDraft(request: Request, draftId: string) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    const body = await readJson(request);
    const expectedRevision = body?.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1) return json({ error: "expectedRevision 無效。" }, 400);
    const draft = await repository.getMapDraft(draftId, config.eventId);
    if (!draft || draft.owner_account_id !== current.accountId) return json({ error: "找不到草稿。" }, 404);
    if (draft.current_revision !== expectedRevision) return json({ error: "草稿版本已變更、狀態不可提交，或權限已撤銷。" }, 409);
    if (!await repository.hasActiveMapContributor(current.accountId)) {
      return json({ error: "草稿版本已變更、狀態不可提交，或權限已撤銷。" }, 409);
    }
    const resolvedScope = await mapScope(draft.period_key, draft.venue_space_id);
    if (!resolvedScope.ok) return json({ error: resolvedScope.reason === "scope_conflict"
      ? "同一活動範圍有互相衝突的核准稿，請由管理者先處理。"
      : "活動 period 或場地空間已不存在。" }, 409);
    const scope = resolvedScope.scope;
    const validation = validateMapContributionDraft(
      draft.content_json ? JSON.parse(draft.content_json) as unknown : null,
      scope,
    );
    if (!validation.ok) return json({ error: "請修正地圖草稿後再提交。", problems: validation.problems }, 422);
    const evidence = await repository.listMapDraftFiles(draftId, expectedRevision as number);
    if (evidence.length === 0) {
      return json({
        error: "目前版本至少需要一份活動官方說明頁面的來源檔案。",
        problems: [{ code: "missing_evidence", message: "請上傳目前版本的官方來源檔與來源資訊。" }],
      }, 422);
    }
    const submitted = await repository.submitMapDraft({
      draftId, eventId: config.eventId, ownerAccountId: current.accountId,
      expectedRevision: expectedRevision as number, now: config.now(),
    });
    if (!submitted) return json({ error: "草稿版本已變更、狀態不可提交，或權限已撤銷。" }, 409);
    await repository.writeAudit({
      at: config.now(), actorAccountId: current.accountId, actorRole: "map_contributor",
      action: "map_draft.submitted", subjectType: "map_draft", subjectId: draftId,
      detail: { revision: expectedRevision }, ipHash: await clientIpHash(request),
    });
    return json({ ok: true, draftId, revision: expectedRevision });
  }

  async function uploadMapDraftFile(request: Request) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    if (!mapContributionStore) return json({ error: "暫時無法使用地圖草稿檔案，請稍後再試。" }, 503);
    let form: FormData;
    try { form = await request.formData(); } catch { return json({ error: "上傳格式無效。" }, 400); }
    const file = form.get("file");
    const draftId = form.get("draftId");
    const revision = Number(form.get("revision"));
    const sourceUrl = form.get("sourceUrl");
    const documentDate = form.get("documentDate");
    const pageValue = form.get("pageNumber");
    const pageNumber = typeof pageValue === "string" && pageValue !== "" ? Number(pageValue) : null;
    if (!(file instanceof File) || typeof draftId !== "string" || !validMapScope(draftId)
      || !Number.isSafeInteger(revision) || revision < 1 || typeof sourceUrl !== "string" || typeof documentDate !== "string") {
      return json({ error: "請選擇檔案並填寫官方來源與文件日期。" }, 400);
    }
    const draft = await repository.getMapDraft(draftId, config.eventId);
    if (!draft || draft.owner_account_id !== current.accountId) return json({ error: "找不到草稿。" }, 404);
    if (draft.current_revision !== revision) return json({ error: "草稿版本已變更。" }, 409);
    let prepared: Awaited<ReturnType<typeof prepareMapContributionFile>>;
    try { prepared = await prepareMapContributionFile({ file, sourceUrl, documentDate, pageNumber }); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "檔案格式無效。" }, 400); }
    const fileId = crypto.randomUUID();
    const objectKey = mapContributionObjectKey({ eventId: config.eventId, draftId, fileId, extension: prepared.extension });
    await mapContributionStore.put(objectKey, prepared.bytes, prepared.contentType);
    let recorded: boolean;
    try {
      recorded = await repository.addMapDraftFile({
        id: fileId, draftId, eventId: config.eventId, revision, objectKey,
        sourceUrl: prepared.sourceUrl, documentDate: prepared.documentDate,
        pageNumber: prepared.pageNumber, sha256: prepared.sha256, mime: prepared.contentType,
        sizeBytes: prepared.sizeBytes, width: prepared.width, height: prepared.height, pageCount: prepared.pageCount,
        uploadedBy: current.accountId, now: config.now(),
      });
    } catch (error) {
      await mapContributionStore.delete(objectKey);
      throw error;
    }
    if (!recorded) {
      await mapContributionStore.delete(objectKey);
      return json({ error: "草稿版本已變更、狀態不可上傳，或權限已撤銷。" }, 409);
    }
    return json({ ok: true, fileId, revision, sha256: prepared.sha256, mime: prepared.contentType, sizeBytes: prepared.sizeBytes }, 201);
  }

  async function readMapDraftFile(request: Request, fileId: string, preview = false) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    if (!mapContributionStore) return json({ error: "暫時無法使用地圖草稿檔案，請稍後再試。" }, 503);
    const metadata = await repository.getMapDraftFile(fileId, config.eventId);
    if (!metadata?.object_key) return json({ error: "找不到檔案。" }, 404);
    if (metadata.owner_account_id !== current.accountId && !await isAdmin(current.email)) return json({ error: "沒有權限。" }, 403);
    if (preview && metadata.mime === "application/pdf") return json({ error: "PDF 無法直接預覽，請下載查看。" }, 415);
    const object = await mapContributionStore.get(metadata.object_key);
    if (!object) return json({ error: "找不到檔案。" }, 404);
    const extension = metadata.mime === "image/jpeg" ? "jpg" : metadata.mime === "image/png" ? "png" : metadata.mime === "image/webp" ? "webp" : "pdf";
    return new Response(object.body, {
      headers: {
        "content-type": metadata.mime,
        "content-disposition": `${preview ? "inline" : "attachment"}; filename="map-source.${extension}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        ...(preview ? { "content-security-policy": "default-src 'none'; sandbox" } : {}),
      },
    });
  }

  async function adminListMapDrafts(request: Request) {
    const gate = await requireFreshAdmin(request);
    if (!gate.ok) return gate.response;
    return json({ drafts: await repository.listMapDraftsForAdmin(config.eventId) });
  }

  async function adminReviewMapDraft(request: Request, draftId: string) {
    const gate = await requireFreshAdmin(request);
    if (!gate.ok) return gate.response;
    const body = await readJson(request);
    const expectedRevision = body?.expectedRevision;
    const decision = body?.decision;
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 2_000) : "";
    const confirmOfficialSource = body?.confirmOfficialSource === true;
    const replacementDraftId = typeof body?.replacementDraftId === "string" && validMapScope(body.replacementDraftId)
      ? body.replacementDraftId : null;
    if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1
      || !["changes_requested", "approve", "reject"].includes(String(decision))) {
      return json({ error: "expectedRevision 與 decision 無效。" }, 400);
    }
    if ((decision === "changes_requested" || decision === "reject") && !note) {
      return json({ error: "要求修改或拒絕時必須填寫說明。" }, 400);
    }
    if (decision === "approve" && !confirmOfficialSource) {
      return json({ error: "核准前必須確認目前版本的檔案來自活動官方說明頁面。" }, 400);
    }
    const draft = await repository.getMapDraft(draftId, config.eventId);
    if (!draft) return json({ error: "找不到草稿。" }, 404);

    if (decision === "approve") {
      const evidence = await repository.listMapDraftFiles(draftId, Number(expectedRevision));
      if (evidence.length === 0) {
        return json({
          error: "目前版本缺少活動官方來源檔，無法核准。",
          problems: [{ code: "missing_evidence", message: "請要求貢獻者補上來源檔後重新提交。" }],
        }, 422);
      }
      const resolvedScope = await mapScope(draft.period_key, draft.venue_space_id);
      if (!resolvedScope.ok) return json({ error: resolvedScope.reason === "scope_conflict"
        ? "同一活動範圍有互相衝突的核准稿，請先人工處理。"
        : "活動 period 或場地空間已不存在。" }, 409);
      const scope = resolvedScope.scope;
      const validation = validateMapContributionDraft(
        draft.content_json ? JSON.parse(draft.content_json) as unknown : null,
        scope,
      );
      if (!validation.ok) return json({ error: "請修正草稿後再核准。", problems: validation.problems }, 422);
      const result = await repository.approveMapDraft({
        draftId, expectedRevision: Number(expectedRevision), replacementDraftId,
        actorAccountId: gate.session.accountId, note: note || null, now: config.now(),
      });
      if (!result.ok) {
        return json({
          error: result.reason === "replacement_required" ? "此範圍已有核准稿，必須明確指定要取代的 draftId。"
            : result.reason === "replacement_mismatch" ? "指定的取代稿不是此範圍目前的核准稿。"
              : result.reason === "missing_evidence" ? "目前版本沒有可供審查的來源檔案。"
              : "草稿版本或狀態已變更。",
          ...(result.reason === "replacement_required" ? { activeDraftId: result.activeDraftId } : {}),
        }, result.reason === "missing_evidence" ? 422 : 409);
      }
    } else {
      const ok = await repository.transitionMapDraft({
        draftId, expectedRevision: Number(expectedRevision),
        toStatus: decision === "reject" ? "rejected" : "changes_requested",
        actorAccountId: gate.session.accountId, actorRole: "admin", note, now: config.now(),
      });
      if (!ok) return json({ error: "草稿版本或狀態已變更。" }, 409);
    }
    await repository.writeAudit({
      at: config.now(), actorAccountId: gate.session.accountId, actorRole: "admin",
      action: `map_draft.${decision}`, subjectType: "map_draft", subjectId: draftId,
      detail: { revision: expectedRevision, replacementDraftId, confirmOfficialSource }, ipHash: await clientIpHash(request),
    });
    return json({ ok: true, draftId, revision: expectedRevision });
  }

  async function adminExportMapDraft(request: Request, draftId: string) {
    const gate = await requireFreshAdmin(request);
    if (!gate.ok) return gate.response;
    const body = await readJson(request);
    const expectedRevision = body?.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1) return json({ error: "expectedRevision 無效。" }, 400);
    const draft = await repository.getMapDraft(draftId, config.eventId);
    if (!draft) return json({ error: "找不到草稿。" }, 404);
    if (draft.current_revision !== expectedRevision) return json({ error: "草稿版本已變更。" }, 409);

    const existing = await repository.getMapDraftExport(draftId, Number(expectedRevision));
    const resolvedScope = await mapScope(draft.period_key, draft.venue_space_id);
    if (!resolvedScope.ok) {
      if (existing && resolvedScope.reason === "not_found") {
        return json({
          ok: true, draftId, revision: existing.revision, targetPath: existing.target_path,
          candidate: JSON.parse(existing.candidate_json), diff: JSON.parse(existing.diff_json),
          candidateSha256: existing.candidate_sha256, createdAt: existing.created_at,
        });
      }
      return json({ error: resolvedScope.reason === "scope_conflict"
        ? "同一活動範圍有互相衝突的核准稿，請先人工處理。"
        : "活動 period 或場地空間已不存在。" }, 409);
    }
    const scope = resolvedScope.scope;

    if (existing) {
      if (existing.target_path !== scope.targetPath) {
        return json({ error: "既有候選使用非正規 targetPath，為保留 immutable export，必須先人工處理。" }, 409);
      }
      return json({
        ok: true, draftId, revision: existing.revision, targetPath: existing.target_path,
        candidate: JSON.parse(existing.candidate_json), diff: JSON.parse(existing.diff_json),
        candidateSha256: existing.candidate_sha256, createdAt: existing.created_at,
      });
    }
    if (draft.status !== "approved") return json({ error: "只有已核准草稿可以匯出候選檔。" }, 409);
    const validation = validateMapContributionDraft(
      draft.content_json ? JSON.parse(draft.content_json) as unknown : null,
      scope,
    );
    if (!validation.ok) return json({ error: "請修正草稿後再匯出。", problems: validation.problems }, 422);
    const previous = await readPublishedEventMap?.(scope.targetPath) ?? null;
    const candidate = buildMapCandidate({
      scope, draftId, draftRevision: draft.current_revision, layout: validation.content.layout,
      previous, now: config.now(),
    });
    const candidateJson = JSON.stringify(candidate.candidate, null, 2) + "\n";
    const candidateSha256 = await sha256Hex(candidateJson);
    const stored = await repository.exportMapDraft({
      draftId, expectedRevision: Number(expectedRevision), targetPath: candidate.targetPath,
      candidateJson, diffJson: JSON.stringify(candidate.diff), candidateSha256,
      actorAccountId: gate.session.accountId, now: config.now(),
    });
    if (!stored) return json({ error: "草稿版本或狀態已變更。" }, 409);
    await repository.writeAudit({
      at: config.now(), actorAccountId: gate.session.accountId, actorRole: "admin",
      action: "map_draft.exported", subjectType: "map_draft", subjectId: draftId,
      detail: { revision: expectedRevision, targetPath: candidate.targetPath, candidateSha256 },
      ipHash: await clientIpHash(request),
    });
    return json({
      ok: true, draftId, revision: stored.revision, targetPath: stored.target_path,
      candidate: JSON.parse(stored.candidate_json), diff: JSON.parse(stored.diff_json),
      candidateSha256: stored.candidate_sha256, createdAt: stored.created_at,
    }, 201);
  }

  async function adminListClaims(request: Request) {
    const gate = await requireFreshAdmin(request);
    if (!gate.ok) return gate.response;
    const claims = await repository.listClaimsByStatus(config.eventId, "pending");
    return json({
      claims: claims.map((claim) => ({
        id: claim.id, circleId: claim.circle_id, circleName: claim.circle_name_at_claim,
        evidenceUrl: claim.evidence_url, evidenceNote: claim.evidence_note,
        targetUrl: claim.target_url, createdAt: claim.created_at,
      })),
    });
  }

  async function adminDecideClaim(request: Request) {
    const gate = await requireFreshAdmin(request);
    if (!gate.ok) return gate.response;

    const body = await readJson(request);
    const claimId = typeof body?.claimId === "string" ? body.claimId : "";
    const decision = body?.decision;
    if (decision !== "approve" && decision !== "reject" && decision !== "revoke") {
      return json({ error: "decision 必須是 approve、reject 或 revoke。" }, 400);
    }

    const claim = await repository.getClaim(claimId);
    if (!claim) return json({ error: "找不到這筆認領。" }, 404);

    const now = config.now();
    const method: ClaimMethod = "admin";
    const ok = decision === "approve"
      ? await repository.markClaimVerified(claimId, method, now, gate.session.email)
      : await repository.setClaimStatus(claimId, decision === "reject" ? "rejected" : "revoked", now, gate.session.email);

    if (decision !== "approve" && ok) await repository.rebuildOverridesDoc(config.eventId, await dataUpdatedAt(), now);
    await repository.writeAudit({
      at: now, actorAccountId: gate.session.accountId, actorRole: "admin",
      action: `claim.admin_${decision}`, subjectType: "claim", subjectId: claimId,
      detail: { circleId: claim.circle_id, applied: ok, evidenceUrl: claim.evidence_url },
      ipHash: await clientIpHash(request),
    });
    return ok ? json({ ok: true }) : json({ error: "此社團已有通過的認領。" }, 409);
  }

  async function adminListAdmins(request: Request) {
    const gate = await requireFreshAdmin(request);
    if (!gate.ok) return gate.response;
    const admins = await repository.listAdmins();
    return json({
      admins: admins.map((admin) => ({ email: admin.email, addedBy: admin.added_by, addedAt: admin.added_at })),
      self: gate.session.email,
    });
  }

  async function adminManageAdmins(request: Request) {
    const gate = await requireFreshAdmin(request);
    if (!gate.ok) return gate.response;

    const body = await readJson(request);
    const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    const action = body?.action;
    if (action !== "add" && action !== "remove") return json({ error: "action 必須是 add 或 remove。" }, 400);
    if (!isEmailShaped(email)) return json({ error: "email 格式無效。" }, 400);

    const now = config.now();
    if (action === "add") {
      const added = await repository.addAdmin(email, gate.session.email, now);
      await repository.writeAudit({
        at: now, actorAccountId: gate.session.accountId, actorRole: "admin", action: "admin.added",
        subjectType: "admin", subjectId: email, detail: { applied: added }, ipHash: await clientIpHash(request),
      });
      return added ? json({ ok: true }) : json({ error: "這個 email 已經是管理者。" }, 409);
    }

    // Removing yourself is the easiest way to lose the console by accident, and
    // the roster must never be emptied. Another admin can always remove you.
    if (email === normalizeEmail(gate.session.email)) {
      return json({ error: "不能移除自己，請由其他管理者操作。" }, 409);
    }
    const result = await repository.removeAdmin(email);
    await repository.writeAudit({
      at: now, actorAccountId: gate.session.accountId, actorRole: "admin", action: "admin.removed",
      subjectType: "admin", subjectId: email, detail: { result }, ipHash: await clientIpHash(request),
    });
    if (result === "removed") return json({ ok: true });
    return json({ error: result === "last" ? "這是最後一位管理者，無法移除。" : "找不到這位管理者。" }, 409);
  }

  async function adminDisableAccount(request: Request) {
    const gate = await requireFreshAdmin(request);
    if (!gate.ok) return gate.response;
    const body = await readJson(request);
    const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    if (!isEmailShaped(email)) return json({ error: "email 格式無效。" }, 400);
    if (await isAdmin(email)) return json({ error: "請先將此帳號移出管理者名單。" }, 409);

    const now = config.now();
    const result = await repository.disableAccount(email, now);
    await repository.writeAudit({
      at: now, actorAccountId: gate.session.accountId, actorRole: "admin", action: "account.disabled",
      subjectType: "email", subjectId: await emailAuditSubjectId(config.hashPepper, email),
      detail: { result }, ipHash: await clientIpHash(request),
    });
    if (result === "disabled") return json({ ok: true });
    return json({ error: result === "missing" ? "找不到這個帳號。"
      : result === "deleting" ? "這個帳號正在刪除，不能再停用。" : "這個帳號已停用。" }, 409);
  }

  async function adminTakedown(request: Request) {
    const gate = await requireFreshAdmin(request);
    if (!gate.ok) return gate.response;

    const body = await readJson(request);
    const circleId = typeof body?.circleId === "string" ? body.circleId : "";
    const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : "";
    if (!circleId || !reason) return json({ error: "circleId 與 reason 是必填欄位。" }, 400);

    const now = config.now();
    const previous = await repository.getOverride(config.eventId, circleId);
    if (previous?.hosted_thumbnail_key && !thumbnailStore) return json({ error: "暫時無法使用圖片功能，請稍後再試。" }, 503);
    if (thumbnailStore) {
      const keys = await thumbnailStore.list(`events/${encodeURIComponent(config.eventId)}/circles/${encodeURIComponent(circleId)}/`);
      await deleteObjectKeys(thumbnailStore, keys);
    }
    const fieldsJson = previous?.hosted_thumbnail_key
      ? JSON.stringify({ ...(JSON.parse(previous.fields_json) as CircleOverrideFields), thumbnail: null })
      : undefined;
    const ok = await repository.takedownOverride({ eventId: config.eventId, circleId, reason, by: gate.session.email, now, fieldsJson });
    if (ok) await repository.rebuildOverridesDoc(config.eventId, await dataUpdatedAt(), now);
    await repository.writeAudit({
      at: now, actorAccountId: gate.session.accountId, actorRole: "admin", action: "override.takendown",
      subjectType: "override", subjectId: circleId, detail: { reason, applied: ok },
      ipHash: await clientIpHash(request),
    });
    return ok ? json({ ok: true }) : json({ error: "這個社團目前沒有上線中的補充資料。" }, 404);
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
    if (eventId !== config.eventId) return json({ error: "找不到這個活動的社團補充資料。" }, 404, { "cache-control": "no-store" });
    let doc = await repository.getOverridesDoc(eventId);

    // The document is written on edit, but the event ending is not an edit.
    // Rebuilding on a phase change keeps the steady-state read a single row
    // lookup instead of filtering the document on every request.
    const phase = await currentPhase();
    if (doc && doc.phase !== phase) {
      await repository.rebuildOverridesDoc(eventId, await dataUpdatedAt(), config.now(), phase);
      doc = await repository.getOverridesDoc(eventId);
    }
    const body = doc?.json ?? JSON.stringify({
      schema: "circle-overrides/1", eventId, generatedAt: await dataUpdatedAt(), revision: 0, overrides: [],
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
    authConfig, requestLink, verify, session, signOut, deleteMyAccount,
    listClaims, createClaim, runChallenge, searchCatalog,
    getMyOverride, putOverride, uploadThumbnail, deleteMyOverride, previewOverride, setPostEventVisibility,
    adminListClaims, adminDecideClaim, adminTakedown,
    adminListAdmins, adminManageAdmins, adminDisableAccount,
    adminManageMapContributor, adminListStaleMapDrafts,
    listMyMapDrafts, getMapDraft, createMapDraft, updateMapDraft, submitMapDraft,
    uploadMapDraftFile, readMapDraftFile,
    adminListMapDrafts, adminReviewMapDraft, adminExportMapDraft,
    publicOverrides,
  };
}

export type CirclePortalHandlers = ReturnType<typeof createCirclePortalHandlers>;
