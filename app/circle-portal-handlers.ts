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
  type MapContributionScope, type MapDraftActorRole, type MapDraftConflict,
} from "./map-contribution-draft";
import { validateEventMapLayout, type EventMapLayout, type PublishedEventMap } from "./event-map";
import {
  createEmptyOrganizerEventDraft, parseOrganizerEventDraft, serializeOrganizerEventDraft,
  type OrganizerValidationIssue,
} from "./organizer-event";
import {
  evaluateOrganizerWorkspaceReadiness,
  getOrganizerWorkspacePrerequisiteIssues,
  isOrganizerGuidedTask,
  isOrganizerWorkspaceSection,
  organizerOnboardingIssues,
} from "./organizer-workspace";
import { resolveCandidateAuthoringScope } from "./event-authoring-scope";
import {
  isOrganizerVenueSpaceAreaMode,
  normalizeOrganizerVenueName,
  normalizeOrganizerVenueSourceUrl,
} from "./organizer-venue-catalog";

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
  organizerInvitesPerActorPerHour: 10,
  organizerInvitesPerEmailPerHour: 3,
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
  /**
   * Resolves any published event, not just `eventId`.
   *
   * The public overlay is read per event id from the URL, so it cannot use the
   * control plane's single-event configuration: a second published event would
   * otherwise get a 404 and silently lose every circle's own content. Returns
   * null for an event this deployment does not serve. Omitted means "only
   * `eventId` is published", which is what a single-event deployment is.
   */
  publishedEvent?: (eventId: string) => Promise<{ dataUpdatedAt: string; eventEndsAt: string } | null>;
  /** Merge remains off until the GitHub App and both repository rulesets are verified. */
  organizerPublicationMode?: "disabled" | "fake" | "github";
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

function isMapDraftActorRole(value: string): value is MapDraftActorRole {
  return value === "map_contributor" || value === "admin" || value === "system";
}

function mapDraftConflictMessage(conflict: MapDraftConflict) {
  if (conflict.cause === "permission") return "沒有有效的地圖貢獻者權限。";
  if (conflict.cause === "status") return "草稿狀態已變更。";
  return `草稿已更新至版本 ${conflict.revision}。`;
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

  /**
   * Whether this deployment serves the event the request named.
   *
   * `publishedEvent` is the same lookup the public overlay uses — "this
   * deployment actually has the event's data" — so the control plane and the
   * reader agree on which events exist without a second registry. Omitted means
   * a single-event deployment, where the configured event is the only one.
   */
  async function servesRequestedEvent() {
    return config.publishedEvent ? !!(await config.publishedEvent(config.eventId)) : true;
  }

  /**
   * Every event-scoped route answers 404 for an event this deployment does not
   * serve, rather than reaching a catalog read that throws. It runs before the
   * session check on purpose: which events exist is not a secret, and a claim
   * for one event must never be answered with another event's data.
   */
  function eventScoped<Rest extends unknown[]>(handler: (request: Request, ...rest: Rest) => Promise<Response>) {
    return async (request: Request, ...rest: Rest) => (await servesRequestedEvent())
      ? handler(request, ...rest)
      : json({ error: "找不到這個活動。" }, 404);
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
    const audience = body?.audience === "organizer" ? "organizer" : "circle";
    const now = config.now();

    // Always the same answer: an attacker must not learn which inboxes exist.
    const accepted = json({ ok: true }, 202);
    if (!isEmailShaped(email)) return accepted;

    const ipHash = await clientIpHash(request);
    const windowStart = now - 60 * 60 * 1000;
    const [byEmail, byIp] = await Promise.all([
      // Only links this inbox asked for. Invitations another account minted for
      // it are capped on their own budget, so an inviter cannot exhaust this
      // one and lock the address out of its own sign-in.
      repository.countLoginTokensSince("email", email, windowStart, "self"),
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
      audience,
    });

    // Root-path query, consumed by POST from the page: mail scanners issue a GET
    // on every link they see, and a GET-consumes design burns the token first.
    await sendMail({
      to: email,
      subject: "場刊 Map 登入連結",
      text: `請開啟以下連結登入（15 分鐘內有效，僅能使用一次）：\n\n${config.origin}/${audience === "organizer" ? "organizer" : "circle"}?login=${encodeURIComponent(token)}\n\n若您沒有申請登入，請忽略這封信，不會有任何變更。`,
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
    const login = await repository.consumeLoginTokenDetails(await sha256Hex(token), now);
    if (!login) return json({ error: "登入連結已失效或已使用，請重新索取。" }, 400);
    const { email, audience } = login;

    let accountId: string;
    try {
      accountId = await repository.upsertAccount(email, now);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "無法建立帳號。" }, 403);
    }
    if (audience === "organizer") {
      await repository.acceptOrganizerInvitations({ accountId, email, now });
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
      hasOrganizerAccess: await repository.hasOrganizerAccess(accountId) || await isAdmin(email),
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
      hasOrganizerAccess: await repository.hasOrganizerAccess(current.accountId) || await isAdmin(current.email),
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
    const soleOwnerCandidates = await repository.listSoleOwnerOrganizerCandidates(current.accountId);
    if (soleOwnerCandidates.length > 0) {
      return json({
        error: "請先邀請另一位 Owner 接手所有活動，才能刪除帳號。",
        candidates: soleOwnerCandidates.map((candidate) => ({
          candidateId: candidate.id,
          tentativeName: candidate.tentative_name,
        })),
      }, 409);
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
      eventId: config.eventId,
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
        claimId: existing.id,
        claimStatus: existing.status,
      }, 409);
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
    if (!claimId) return json({ error: "此帳號正在刪除，無法建立認領。" }, 409);
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
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);

    const claim = await repository.getClaim(claimId);
    if (!claimInScope(claim) || claim.account_id !== current.accountId) return json({ error: "找不到這筆認領。" }, 404);
    if (claim.status !== "pending") {
      return json({ error: "只有審核中的認領可以撤回。" }, 409);
    }
    if (!await repository.withdrawClaim(claimId, current.accountId)) {
      return json({ error: "只有審核中的認領可以撤回。" }, 409);
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
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);

    const claim = await repository.getClaim(claimId);
    if (!claimInScope(claim) || claim.account_id !== current.accountId) return json({ error: "找不到這筆認領。" }, 404);
    if (claim.status !== "pending") return json({ error: "這筆認領已經處理過了。" }, 409);
    if (!claim.challenge_token_hash || !claim.target_url) return json({ error: "這筆認領需要人工審核。" }, 409);

    const now = config.now();
    if (claim.challenge_expires_at !== null && claim.challenge_expires_at < now) {
      return json({ error: "驗證碼已過期。請撤回這筆認領後重新送出，即可取得新的驗證碼。" }, 410);
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
    await repository.rebuildOverridesDoc(config.eventId, await dataUpdatedAt(), now, await currentPhase());
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
    const [files, reviews, comments] = await Promise.all([
      repository.listMapDraftFiles(draftId),
      repository.listMapDraftReviews(draftId),
      repository.listMapDraftComments(draftId),
    ]);
    return json({
      draft: { ...draft, content: draft.content_json ? JSON.parse(draft.content_json) as unknown : null, content_json: undefined },
      files,
      reviews,
      comments,
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

  /** A refused optimistic-lock write has three causes that used to share one
   * message. Re-reading the row after the refusal separates them, and reports
   * the revision that now exists, when it changed and the role that changed
   * it. Nothing here relaxes the lock: the write stays refused.
   *
   * The role is read off the draft's own rows rather than a timestamp compare,
   * which two changes in the same millisecond would tie. Every status change
   * writes a review row carrying the acting role; a plain revision write leaves
   * none, and the owning contributor is the only account SQL lets write one. So
   * a review row matching the current revision and status names the last actor,
   * and its absence means the contributor moved the draft last. */
  async function mapDraftConflict(input: {
    draftId: string;
    expectedRevision: number;
    /** Set only when the caller's authority is the map contributor grant. */
    contributorAccountId: string | null;
  }): Promise<MapDraftConflict> {
    const draft = await repository.getMapDraft(input.draftId, config.eventId);
    const reviews = draft ? await repository.listMapDraftReviews(input.draftId) : [];
    const last = draft
      ? reviews.findLast((review) => review.revision === draft.current_revision && review.to_status === draft.status)
      : undefined;
    const updatedByRole: MapDraftActorRole = last && isMapDraftActorRole(last.actor_role)
      ? last.actor_role
      : "map_contributor";
    const revoked = input.contributorAccountId !== null
      && !await repository.hasActiveMapContributor(input.contributorAccountId);
    // A revoked grant outranks a stale revision: reloading recovers a stale tab,
    // but nothing the contributor does restores write access, so saying "version"
    // first would send them round the same failed save again.
    const cause = revoked ? "permission"
      : !draft || draft.current_revision !== input.expectedRevision ? "version"
        : "status";
    return {
      cause,
      revision: draft?.current_revision ?? input.expectedRevision,
      updatedAt: draft?.updated_at ?? config.now(),
      updatedByRole,
    };
  }

  async function mapDraftConflictResponse(input: {
    draftId: string;
    expectedRevision: number;
    contributorAccountId: string | null;
  }) {
    const conflict = await mapDraftConflict(input);
    return json({ error: mapDraftConflictMessage(conflict), conflict }, 409);
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
    if (revision === null) {
      return mapDraftConflictResponse({
        draftId, expectedRevision: expectedRevision as number, contributorAccountId: current.accountId,
      });
    }
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
    if (draft.current_revision !== expectedRevision || !await repository.hasActiveMapContributor(current.accountId)) {
      return mapDraftConflictResponse({
        draftId, expectedRevision: expectedRevision as number, contributorAccountId: current.accountId,
      });
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
    if (!submitted) {
      return mapDraftConflictResponse({
        draftId, expectedRevision: expectedRevision as number, contributorAccountId: current.accountId,
      });
    }
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
    if (draft.current_revision !== revision) {
      return mapDraftConflictResponse({ draftId, expectedRevision: revision, contributorAccountId: current.accountId });
    }
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
      return mapDraftConflictResponse({ draftId, expectedRevision: revision, contributorAccountId: current.accountId });
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

  /** A comment carries a target when it asks for one element to change rather
   * than the draft as a whole. The reference is the booth code or landmark id
   * as the draft spells it, which is what lets the contributor's editor jump
   * straight to it. */
  type MapDraftCommentTarget = { kind: "slot" | "landmark" | null; ref: string | null };

  function mapDraftCommentTarget(body: Record<string, unknown> | null): { ok: boolean } & MapDraftCommentTarget {
    const kind = body?.targetKind;
    if (kind === undefined || kind === null || kind === "") return { ok: true, kind: null, ref: null };
    if (kind !== "slot" && kind !== "landmark") return { ok: false, kind: null, ref: null };
    const ref = typeof body?.targetRef === "string" ? body.targetRef.trim().slice(0, 120) : "";
    if (!ref) return { ok: false, kind: null, ref: null };
    return { ok: true, kind, ref };
  }

  /** True when the draft actually contains the element a request names. A
   * reference that is not there renders as a link the contributor can press
   * and that then does nothing, so it is refused rather than stored. */
  function mapDraftHasTarget(contentJson: string | null, kind: "slot" | "landmark", ref: string) {
    const layout = mapDraftLayout(contentJson);
    if (!layout) return false;
    return kind === "slot"
      ? layout.rows.some((row) => row.slots.some((slot) => slot.code === ref))
      : layout.landmarks.some((landmark) => landmark.id === ref);
  }

  function mapDraftLayout(contentJson: string | null): EventMapLayout | null {
    if (!contentJson) return null;
    try {
      const content = JSON.parse(contentJson) as { layout?: unknown };
      return validateEventMapLayout(content?.layout).ok ? content.layout as EventMapLayout : null;
    } catch {
      return null;
    }
  }

  async function postMapDraftComment(request: Request, draftId: string) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    const admin = await isAdmin(current.email);
    const draft = await repository.getMapDraft(draftId, config.eventId);
    // A stranger is told the draft is not there rather than that it is theirs
    // to be refused, which is why the admin check comes before the gate.
    if (!draft || (!admin && draft.owner_account_id !== current.accountId)) return json({ error: "找不到草稿。" }, 404);
    // Writing under the admin role puts words in front of the contributor that
    // they read as coming from a reviewer, so it is held to the same
    // reauthentication boundary as every other administrative write. An admin
    // commenting on a draft they own is a contributor here, grant and all.
    const asAdmin = admin && draft.owner_account_id !== current.accountId;
    if (asAdmin) {
      const gate = await requireFreshAdmin(request);
      if (!gate.ok) return gate.response;
    } else if (!await repository.hasActiveMapContributor(current.accountId)) {
      return json({ error: "沒有有效的地圖貢獻者權限。" }, 403);
    }
    const body = await readJson(request);
    const text = typeof body?.body === "string" ? body.body.trim().slice(0, 2_000) : "";
    if (!text) return json({ error: "留言內容不可留空。" }, 400);
    const target = mapDraftCommentTarget(body);
    if (!target.ok) return json({ error: "指定的對象無效。" }, 400);
    if (target.kind && target.ref && !mapDraftHasTarget(draft.content_json, target.kind, target.ref)) {
      return json({ error: "草稿中沒有這個元素。" }, 400);
    }
    const role = asAdmin ? "admin" : "map_contributor";
    const id = await repository.addMapDraftComment({
      draftId, eventId: config.eventId, authorAccountId: current.accountId, authorRole: role,
      // Pinned rather than left to the insert's own read, so the comment row
      // and the audit entry below cannot name different revisions when the
      // owner saves between the two.
      revision: draft.current_revision,
      targetKind: target.kind, targetRef: target.ref, body: text, now: config.now(),
    });
    if (!id) return json({ error: "找不到草稿。" }, 404);
    await repository.writeAudit({
      at: config.now(), actorAccountId: current.accountId, actorRole: role,
      action: "map_draft.commented", subjectType: "map_draft", subjectId: draftId,
      detail: { revision: draft.current_revision, targetKind: target.kind }, ipHash: await clientIpHash(request),
    });
    return json({ ok: true, draftId, commentId: id }, 201);
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
    const requested: unknown[] = Array.isArray(body?.targets) ? body.targets : [];
    // Only a change request can carry them: an approval or a rejection ends the
    // draft, and a request pointing at one of its booths could never be acted
    // on because the editor is closed to the contributor from then on.
    if (requested.length && decision !== "changes_requested") {
      return json({ error: "只有要求修改可以附帶局部修改請求。" }, 400);
    }
    const targets: { targetKind: "slot" | "landmark"; targetRef: string; body: string }[] = [];
    for (const entry of requested) {
      const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
      const target = mapDraftCommentTarget(item);
      const text = typeof item?.body === "string" ? item.body.trim().slice(0, 2_000) : "";
      if (!target.ok || !target.kind || !target.ref || !text) return json({ error: "局部修改請求必須指定對象與內容。" }, 400);
      targets.push({ targetKind: target.kind, targetRef: target.ref, body: text });
    }

    if (decision === "approve" && !confirmOfficialSource) {
      return json({ error: "核准前必須確認目前版本的檔案來自活動官方說明頁面。" }, 400);
    }
    const draft = await repository.getMapDraft(draftId, config.eventId);
    if (!draft) return json({ error: "找不到草稿。" }, 404);
    if (targets.length && !targets.every(({ targetKind, targetRef }) => mapDraftHasTarget(draft.content_json, targetKind, targetRef))) {
      return json({ error: "草稿中沒有這個元素。" }, 400);
    }

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
        if (result.reason === "conflict") {
          return mapDraftConflictResponse({
            draftId, expectedRevision: Number(expectedRevision), contributorAccountId: null,
          });
        }
        return json({
          error: result.reason === "replacement_required" ? "此範圍已有核准稿，必須明確指定要取代的 draftId。"
            : result.reason === "replacement_mismatch" ? "指定的取代稿不是此範圍目前的核准稿。"
              : "目前版本沒有可供審查的來源檔案。",
          ...(result.reason === "replacement_required" ? { activeDraftId: result.activeDraftId } : {}),
        }, result.reason === "missing_evidence" ? 422 : 409);
      }
    } else {
      const ok = await repository.transitionMapDraft({
        draftId, expectedRevision: Number(expectedRevision),
        toStatus: decision === "reject" ? "rejected" : "changes_requested",
        actorAccountId: gate.session.accountId, actorRole: "admin", note, targets, now: config.now(),
      });
      if (!ok) {
        return mapDraftConflictResponse({
          draftId, expectedRevision: Number(expectedRevision), contributorAccountId: null,
        });
      }
    }
    await repository.writeAudit({
      at: config.now(), actorAccountId: gate.session.accountId, actorRole: "admin",
      action: `map_draft.${decision}`, subjectType: "map_draft", subjectId: draftId,
      detail: { revision: expectedRevision, replacementDraftId, confirmOfficialSource, targets: targets.length }, ipHash: await clientIpHash(request),
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
    if (draft.current_revision !== expectedRevision) {
      return mapDraftConflictResponse({
        draftId, expectedRevision: Number(expectedRevision), contributorAccountId: null,
      });
    }

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
    if (!stored) {
      return mapDraftConflictResponse({
        draftId, expectedRevision: Number(expectedRevision), contributorAccountId: null,
      });
    }
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
    // The reviewer is looking at one event's queue; two events can list the same
    // circle name, so the answer says which one it came from.
    return json({
      eventId: config.eventId,
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
    // A revoke rebuilds this event's public document. Deciding another event's
    // claim from here would withdraw ownership in that event while leaving its
    // document — and so the revoked content — standing.
    if (!claimInScope(claim)) return json({ error: "找不到這筆認領。" }, 404);

    const now = config.now();
    const method: ClaimMethod = "admin";
    const ok = decision === "approve"
      ? await repository.markClaimVerified(claimId, method, now, gate.session.email)
      : await repository.setClaimStatus(claimId, decision === "reject" ? "rejected" : "revoked", now, gate.session.email);

    // Revoking ownership withdraws that circle's content in the same step. The
    // phase has to be the current one: rebuilding as "during" after the event
    // would republish every circle that had opted out of the post-event window.
    if (decision !== "approve" && ok) {
      await repository.rebuildOverridesDoc(config.eventId, await dataUpdatedAt(), now, await currentPhase());
    }
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
    if (ok) await repository.rebuildOverridesDoc(config.eventId, await dataUpdatedAt(), now, await currentPhase());
    await repository.writeAudit({
      at: now, actorAccountId: gate.session.accountId, actorRole: "admin", action: "override.takendown",
      subjectType: "override", subjectId: circleId, detail: { reason, applied: ok },
      ipHash: await clientIpHash(request),
    });
    return ok ? json({ ok: true }) : json({ error: "這個社團目前沒有上線中的補充資料。" }, 404);
  }

  /**
   * An invitation mints a real login token, so it has to be metered like one —
   * otherwise an Owner, who is an invited third party rather than staff, is an
   * unmetered sender of sign-in links to any address. Three budgets, because
   * the abuse has three shapes: flooding one inbox, spraying many inboxes, and
   * denying a specific person their own sign-in.
   *
   * The inbox budget deliberately counts only invitations, not the address's
   * own requests. Sharing one counter would cap the spam but hand the inviter
   * a way to spend the target's quota, which is the denial it is meant to stop.
   *
   * Checked before the grant is written, so a refused invitation leaves no row
   * claiming someone was invited when no link was ever sent.
   */
  async function organizerInvitationAllowed(email: string, actorAccountId: string, ipHash: string | null, now: number) {
    const windowStart = now - 60 * 60 * 1000;
    const [byEmail, byIp, byActor] = await Promise.all([
      repository.countLoginTokensSince("email", email, windowStart, "invited"),
      ipHash ? repository.countLoginTokensSince("request_ip_hash", ipHash, windowStart) : Promise.resolve(0),
      repository.countOrganizerInvitationsSince(actorAccountId, windowStart),
    ]);
    return byEmail < LIMITS.organizerInvitesPerEmailPerHour
      && byIp < LIMITS.loginPerIpPerHour
      && byActor < LIMITS.organizerInvitesPerActorPerHour;
  }

  async function sendOrganizerInvitation(email: string, now: number, ipHash: string | null, mintedBy: string) {
    const token = randomToken();
    await repository.createLoginToken({
      tokenHash: await sha256Hex(token), email, now,
      expiresAt: now + LOGIN_TOKEN_TTL_MS, ipHash, audience: "organizer", mintedBy,
    });
    await sendMail({
      to: email,
      subject: "場刊 Map Organizer 邀請",
      text: `你已受邀管理一場活動。請開啟以下連結登入（15 分鐘內有效，僅能使用一次）：\n\n${config.origin}/organizer?login=${encodeURIComponent(token)}\n\n若你不認識這項邀請，請忽略此信。`,
    });
  }

  async function organizerAccess(request: Request, candidateId: string) {
    const current = await requireSession(request);
    if (!current) return { ok: false as const, response: json({ error: "尚未登入。" }, 401) };
    const admin = await isAdmin(current.email);
    const grantRole = await repository.organizerRole(candidateId, current.accountId);
    // An admin may also be this event's Owner. Preserve that event role so the
    // submit and approve actions can remain distinct and self-approval can be
    // audited, while an unassigned admin still gets global inspection access.
    const role = grantRole ?? (admin ? "admin" as const : null);
    if (!role) return { ok: false as const, response: json({ error: "找不到活動。" }, 404) };
    return { ok: true as const, current, admin, role };
  }

  const organizerAuditRole = (access: {
    admin: boolean;
    role: "owner" | "editor" | "admin";
  }) => access.admin ? "admin" as const
    : access.role === "owner" ? "organizer_owner" as const
      : "organizer_editor" as const;

  async function listOrganizerVenues(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    return json(await repository.listOrganizerVenueCatalog());
  }

  async function createOrganizerVenue(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    const initialSpace = body?.initialSpace && typeof body.initialSpace === "object" && !Array.isArray(body.initialSpace)
      ? body.initialSpace as Record<string, unknown> : null;
    const name = normalizeOrganizerVenueName(body?.name);
    const sourceUrl = normalizeOrganizerVenueSourceUrl(body?.sourceUrl);
    const spaceName = normalizeOrganizerVenueName(initialSpace?.name);
    const spaceSourceUrl = normalizeOrganizerVenueSourceUrl(initialSpace?.sourceUrl);
    const defaultAreaMode = initialSpace?.defaultAreaMode ?? "imported";
    if (!name || !spaceName || sourceUrl === undefined || spaceSourceUrl === undefined
      || !isOrganizerVenueSpaceAreaMode(defaultAreaMode)) {
      return json({ error: "請填寫場館名稱、使用空間名稱與有效的 HTTPS 來源網址。" }, 400);
    }
    const venueId = `venue-${crypto.randomUUID()}`;
    const venueSpaceId = `venue-space-${crypto.randomUUID()}`;
    const created = await repository.createOrganizerVenue({
      id: venueId,
      name,
      sourceUrl,
      createdByAccountId: access.current.accountId,
      now: config.now(),
      initialSpace: { id: venueSpaceId, name: spaceName, sourceUrl: spaceSourceUrl, defaultAreaMode },
    });
    if (!created.ok) {
      return json({ error: created.reason === "duplicate" ? "這個場館或使用空間已經存在。" : "無法建立場館，請重新整理後再試。" }, 409);
    }
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId,
      actorRole: organizerAuditRole(access),
      action: "organizer_venue.created", subjectType: "organizer_venue", subjectId: venueId,
      detail: { candidateId, venueSpaceId, defaultAreaMode }, ipHash: await clientIpHash(request),
    });
    return json({
      venue: { id: venueId, name, sourceUrl },
      space: { id: venueSpaceId, venueId, name: spaceName, sourceUrl: spaceSourceUrl, defaultAreaMode },
    }, 201);
  }

  async function createOrganizerVenueSpace(request: Request, candidateId: string, venueId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    const name = normalizeOrganizerVenueName(body?.name);
    const sourceUrl = normalizeOrganizerVenueSourceUrl(body?.sourceUrl);
    const defaultAreaMode = body?.defaultAreaMode ?? "imported";
    if (!name || sourceUrl === undefined || !isOrganizerVenueSpaceAreaMode(defaultAreaMode)) {
      return json({ error: "請填寫使用空間名稱與有效的 HTTPS 來源網址。" }, 400);
    }
    const venueSpaceId = `venue-space-${crypto.randomUUID()}`;
    const created = await repository.createOrganizerVenueSpace({
      id: venueSpaceId,
      venueId,
      name,
      sourceUrl,
      defaultAreaMode,
      createdByAccountId: access.current.accountId,
      now: config.now(),
    });
    if (!created.ok) {
      const error = created.reason === "not_found" ? "找不到這個場館。" : "這個使用空間已經存在。";
      return json({ error }, created.reason === "not_found" ? 404 : 409);
    }
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId,
      actorRole: organizerAuditRole(access),
      action: "organizer_venue_space.created", subjectType: "organizer_venue_space", subjectId: venueSpaceId,
      detail: { candidateId, venueId, defaultAreaMode }, ipHash: await clientIpHash(request),
    });
    return json({ space: { id: venueSpaceId, venueId, name, sourceUrl, defaultAreaMode } }, 201);
  }

  async function adminCreateOrganizerCandidate(request: Request) {
    const gate = await requireFreshAdmin(request);
    if (!gate.ok) return gate.response;
    const body = await readJson(request);
    const tentativeName = typeof body?.tentativeName === "string" ? body.tentativeName.normalize("NFKC").trim() : "";
    const ownerEmail = typeof body?.ownerEmail === "string" ? normalizeEmail(body.ownerEmail) : "";
    if (!tentativeName || tentativeName.length > 120 || !isEmailShaped(ownerEmail)) {
      return json({ error: "暫定活動名稱與有效的負責人 Email 為必填。" }, 400);
    }
    const ipHash = await clientIpHash(request);
    if (!await organizerInvitationAllowed(ownerEmail, gate.session.accountId, ipHash, config.now())) {
      return json({ error: "邀請寄送過於頻繁，請稍後再試。" }, 429);
    }
    const candidateId = crypto.randomUUID();
    const draft = createEmptyOrganizerEventDraft(tentativeName);
    const created = await repository.createOrganizerCandidate({
      id: candidateId, tentativeName, ownerEmail,
      createdByAccountId: gate.session.accountId,
      draftJson: JSON.stringify(draft), now: config.now(),
    });
    if (!created.ok) return json({ error: "無法建立活動，請重新整理後再試。" }, 409);
    await sendOrganizerInvitation(ownerEmail, config.now(), ipHash, gate.session.accountId);
    await repository.writeAudit({
      at: config.now(), actorAccountId: gate.session.accountId, actorRole: "admin",
      action: "organizer_event.created", subjectType: "organizer_event", subjectId: candidateId,
      detail: { tentativeName }, ipHash,
    });
    return json({ ok: true, candidateId, version: 1 }, 201);
  }

  async function listOrganizerCandidates(request: Request) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    const events = await repository.listOrganizerCandidatesForAccount(current.accountId, await isAdmin(current.email));
    return json({ events: events.map((event) => ({
      id: event.id,
      tentativeName: event.tentative_name,
      eventId: event.event_id,
      status: event.status,
      version: event.current_version,
      updatedAt: event.updated_at,
      updatedByRole: event.last_updated_role,
      role: event.role,
      workspaceMode: event.workspace_mode,
    })) });
  }

  async function getOrganizerCandidate(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const candidate = await repository.getOrganizerCandidate(candidateId);
    if (!candidate) return json({ error: "找不到活動。" }, 404);
    const draft = parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown);
    if (!draft) return json({ error: "活動資料格式無效，請聯絡網站管理者。" }, 500);
    const [revisions, publication, workspace, workspaceValidation] = await Promise.all([
      repository.listOrganizerCandidateRevisions(candidateId),
      repository.getLatestOrganizerPublicationJob(candidateId),
      repository.getOrganizerWorkspace(candidateId, access.current.accountId),
      validateOrganizerWorkspace(candidateId, draft),
    ]);
    if (!workspace) return json({ error: "找不到活動工作區。" }, 404);
    const { imported, maps, issues: validationIssues } = workspaceValidation;
    const guidedTask = isOrganizerGuidedTask(workspace.preference?.guided_task)
      ? workspace.preference.guided_task : "identity_source";
    const section = isOrganizerWorkspaceSection(workspace.preference?.last_section)
      ? workspace.preference.last_section : "event";
    const readiness = evaluateOrganizerWorkspaceReadiness({
      draft,
      importedRows: imported?.rows.length ?? 0,
      maps: maps.map((map) => ({ periodKey: map.period_key, venueSpaceId: map.venue_space_id })),
      validationIssues,
      currentVersion: candidate.current_version,
      lastValidatedVersion: workspace.state.last_validated_version,
      status: candidate.status,
    });
    return json({
      event: {
        id: candidate.id,
        tentativeName: candidate.tentative_name,
        eventId: candidate.event_id,
        eventIdLocked: candidate.event_id_locked_at !== null,
        status: candidate.status,
        version: candidate.current_version,
        updatedAt: candidate.updated_at,
        updatedByRole: candidate.last_updated_role,
        role: access.role,
      },
      draft,
      revisions: revisions.map((revision) => ({
        version: revision.version,
        eventId: revision.event_id,
        createdByRole: revision.created_by_role,
        createdAt: revision.created_at,
      })),
      import: imported ? {
        source: {
          fileName: imported.source.file_name,
          worksheet: imported.source.worksheet,
          sha256: imported.source.sha256,
          sourceDescription: imported.source.source_description,
          mapping: JSON.parse(imported.source.mapping_json) as unknown,
          createdByRole: imported.source.created_by_role,
          createdAt: imported.source.created_at,
        },
        rows: imported.rows.map((row) => ({
          sourceRow: row.source_row, dayId: row.day_id, venueSpaceId: row.venue_space_id,
          areaId: row.area_id, boothCode: row.booth_code, circleName: row.circle_name,
          stableKey: row.stable_key, identityGroup: row.identity_group,
        })),
      } : null,
      publication: publication ? {
        id: publication.id,
        status: publication.status,
        step: publication.step,
        error: publication.error,
        updatedAt: publication.updated_at,
      } : null,
      workspace: {
        mode: workspace.state.onboarding_completed_at === null ? "guided" : "binder",
        onboardingCompletedAt: workspace.state.onboarding_completed_at,
        resume: { guidedTask, section },
        readiness,
      },
    });
  }

  async function updateOrganizerCandidate(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    const expectedVersion = body?.expectedVersion;
    const serialized = serializeOrganizerEventDraft(body?.draft);
    if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1 || !serialized) {
      return json({ error: "活動資料格式無效，請重新載入後再試。" }, 400);
    }
    const result = await repository.saveOrganizerCandidate({
      candidateId, actorAccountId: access.current.accountId,
      expectedVersion: expectedVersion as number,
      eventId: serialized.draft.event.id,
      draftJson: serialized.json,
      now: config.now(), admin: access.admin,
    });
    if (!result.ok) {
      if (result.reason === "not_found" || result.reason === "forbidden") return json({ error: "找不到活動。" }, 404);
      const message = result.reason === "event_id_locked" ? `eventId 已鎖定為 ${result.eventId}。`
        : result.reason === "event_id_taken" ? "eventId 已被其他活動使用。"
          : result.reason === "status" ? "目前狀態不可編輯。"
            : "草稿已被其他人更新，請重新載入。";
      return json({ error: message, conflict: result }, 409);
    }
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId,
      actorRole: access.admin ? "admin" : access.role === "owner" ? "organizer_owner" : "organizer_editor",
      action: "organizer_event.updated", subjectType: "organizer_event", subjectId: candidateId,
      detail: { version: result.version }, ipHash: await clientIpHash(request),
    });
    return json({ ok: true, candidateId, version: result.version });
  }

  async function updateOrganizerWorkspacePreference(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    if (!isOrganizerGuidedTask(body?.guidedTask) || !isOrganizerWorkspaceSection(body?.lastSection)) {
      return json({ error: "無法記住目前位置，請重新載入。" }, 400);
    }
    const saved = await repository.saveOrganizerWorkspacePreference({
      candidateId,
      accountId: access.current.accountId,
      guidedTask: body.guidedTask,
      lastSection: body.lastSection,
      now: config.now(),
      admin: access.admin,
    });
    return saved ? json({ ok: true, guidedTask: body.guidedTask, lastSection: body.lastSection })
      : json({ error: "找不到活動。" }, 404);
  }

  async function completeOrganizerWorkspaceOnboarding(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    const expectedVersion = body?.expectedVersion;
    if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1) {
      return json({ error: "版本資訊無效，請重新載入。" }, 400);
    }
    const existingWorkspace = await repository.getOrganizerWorkspace(candidateId, access.current.accountId);
    if (!existingWorkspace) return json({ error: "找不到活動。" }, 404);
    if (existingWorkspace.state.onboarding_completed_at !== null) {
      return json({
        ok: true,
        mode: "binder",
        onboardingCompletedAt: existingWorkspace.state.onboarding_completed_at,
      });
    }
    const candidate = await repository.getOrganizerCandidate(candidateId);
    if (!candidate) return json({ error: "找不到活動。" }, 404);
    if (candidate.current_version !== expectedVersion) {
      return json({ error: "草稿已被其他人更新，請重新載入。", conflict: { currentVersion: candidate.current_version } }, 409);
    }
    const draft = parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown);
    if (!draft) return json({ error: "活動資料格式無效，請聯絡網站管理者。" }, 500);
    const issues = organizerOnboardingIssues(draft);
    if (issues.length > 0) return json({ error: "請先完成活動與場館基本設定。", issues }, 422);
    const result = await repository.completeOrganizerOnboarding({
      candidateId,
      actorAccountId: access.current.accountId,
      expectedVersion: expectedVersion as number,
      now: config.now(),
      admin: access.admin,
    });
    if (!result.ok) {
      if (result.reason === "not_found" || result.reason === "forbidden") return json({ error: "找不到活動。" }, 404);
      return json({ error: "草稿已被其他人更新，請重新載入。", conflict: result }, 409);
    }
    if (!result.alreadyCompleted) {
      await repository.writeAudit({
        at: config.now(), actorAccountId: access.current.accountId,
        actorRole: access.admin ? "admin" : access.role === "owner" ? "organizer_owner" : "organizer_editor",
        action: "organizer_event.onboarding_completed", subjectType: "organizer_event", subjectId: candidateId,
        detail: { version: expectedVersion }, ipHash: await clientIpHash(request),
      });
    }
    return json({ ok: true, mode: "binder", onboardingCompletedAt: result.completedAt });
  }

  async function validateOrganizerWorkspace(candidateId: string, draft: ReturnType<typeof parseOrganizerEventDraft>) {
    if (!draft) return { issues: [{
      severity: "error", step: "event", code: "invalid_draft", message: "活動資料格式無效，請聯絡網站管理者。",
    }] satisfies OrganizerValidationIssue[], imported: null, maps: [], contents: new Map<string, string>() };
    const [imported, maps] = await Promise.all([
      repository.getOrganizerImport(candidateId), repository.listOrganizerMapDrafts(candidateId),
    ]);
    const issues = getOrganizerWorkspacePrerequisiteIssues({
      draft,
      importedRows: imported?.rows.length ?? 0,
      maps: maps.map((map) => ({ periodKey: map.period_key, venueSpaceId: map.venue_space_id })),
    });
    // The candidate, its import and every map body are read exactly once here.
    // Resolving scope per day × venue-space used to reload the candidate and
    // the whole import inside the loop, so a multi-day multi-hall event — the
    // case this workspace exists for — paid for the full booth list once per
    // scope on validate, on preview and again on submit.
    const importedRows = (imported?.rows ?? []).map((row) => ({
      dayId: row.day_id, venueSpaceId: row.venue_space_id, boothCode: row.booth_code,
    }));
    const contents = new Map<string, string>();
    for (const [index, detail] of (await Promise.all(
      maps.map((map) => repository.getOrganizerMapDraft(candidateId, map.id)),
    )).entries()) {
      if (detail?.content_json) contents.set(maps[index].id, detail.content_json);
    }
    for (const day of draft.event.days) {
      for (const assignment of draft.venue.assignments) {
        const map = maps.find((item) => item.period_key === day.id && item.venue_space_id === assignment.venueSpaceId);
        if (!map) continue;
        const scope = resolveCandidateAuthoringScope({ candidateId, draft, importedRows }, day.id, assignment.venueSpaceId);
        const content = contents.get(map.id);
        const validation = scope && content ? validateMapContributionDraft(
          JSON.parse(content) as unknown,
          {
            eventId: draft.event.id ?? candidateId, periodKey: scope.periodKey, periodAliases: [scope.periodKey],
            venueSpaceId: scope.venueSpaceId, mapTemplate: scope.mapTemplate,
            allowedBoothCodes: scope.allowedBoothCodes, requiredBoothCodes: scope.requiredBoothCodes,
            targetPath: `candidate://${candidateId}/${scope.periodKey}/${scope.venueSpaceId}`,
          },
        ) : null;
        if (!validation?.ok) {
          for (const problem of validation?.problems ?? [{ code: "invalid_content", message: "地圖草稿無效。" }]) {
            issues.push({
              severity: "error", step: "map", code: problem.code,
              target: `${day.id}/${assignment.venueSpaceId}`, message: problem.message,
            });
          }
        }
      }
    }
    return { issues, imported, maps, contents };
  }

  async function putOrganizerImport(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    const expectedVersion = body?.expectedVersion;
    const source = body?.source && typeof body.source === "object" && !Array.isArray(body.source)
      ? body.source as Record<string, unknown> : null;
    const rows = Array.isArray(body?.rows) ? body.rows : null;
    if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1 || !source || !rows) {
      return json({ error: "匯入資料不完整，請重新整理後再試一次。" }, 400);
    }
    // A well-formed import that is merely too long deserves its own message:
    // the organizer can act on the row cap, but not on a sentence that also
    // covers a missing expectedVersion.
    if (rows.length > 20_000) return json({ error: "匯入資料最多 20,000 列。" }, 400);
    const fileName = typeof source.fileName === "string" ? source.fileName.normalize("NFKC").trim() : "";
    const worksheet = source.worksheet === null ? null
      : typeof source.worksheet === "string" ? source.worksheet.normalize("NFKC").trim() : undefined;
    const sha256 = typeof source.sha256 === "string" ? source.sha256.toLowerCase() : "";
    const sourceDescription = typeof source.sourceDescription === "string" ? source.sourceDescription.normalize("NFKC").trim() : "";
    let mappingJson = "";
    try { mappingJson = JSON.stringify(source.mapping); } catch { mappingJson = ""; }
    if (!fileName || fileName.length > 255 || worksheet === undefined || (worksheet?.length ?? 0) > 120
      || !/^[0-9a-f]{64}$/u.test(sha256) || !sourceDescription || sourceDescription.length > 500
      || !mappingJson || new TextEncoder().encode(mappingJson).byteLength > 100_000) {
      return json({ error: "匯入來源資訊格式無效。" }, 400);
    }

    const candidate = await repository.getOrganizerCandidate(candidateId);
    if (!candidate) return json({ error: "找不到活動。" }, 404);
    const draft = parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown);
    if (!draft) return json({ error: "活動資料格式無效，請聯絡網站管理者。" }, 500);
    const days = new Set(draft.event.days.map((day) => day.id));
    const spaces = new Map(draft.venue.assignments.map((assignment) => [assignment.venueSpaceId, new Set(assignment.areaIds)]));
    const normalized: Array<{
      sourceRow: number; dayId: string; venueSpaceId: string; areaId: string; boothCode: string;
      circleName: string; stableKey: string | null; identityGroup: string | null;
    }> = [];
    const placements = new Set<string>();
    for (const value of rows) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return json({ error: "匯入資料格式無效。" }, 400);
      const row = value as Record<string, unknown>;
      const sourceRow = row.sourceRow;
      const dayId = typeof row.dayId === "string" ? row.dayId.normalize("NFKC").trim() : "";
      const venueSpaceId = typeof row.venueSpaceId === "string" ? row.venueSpaceId.normalize("NFKC").trim() : "";
      const areaId = typeof row.areaId === "string" ? row.areaId.normalize("NFKC").trim() : "";
      const boothCode = typeof row.boothCode === "string" ? row.boothCode.normalize("NFKC").trim() : "";
      const circleName = typeof row.circleName === "string" ? row.circleName.normalize("NFKC").trim().replace(/\s+/gu, " ") : "";
      const stableKey = row.stableKey === null ? null : typeof row.stableKey === "string" ? row.stableKey.normalize("NFKC").trim() : undefined;
      const identityGroup = row.identityGroup === null ? null : typeof row.identityGroup === "string" ? row.identityGroup.normalize("NFKC").trim() : undefined;
      if (!Number.isSafeInteger(sourceRow) || (sourceRow as number) < 1 || !days.has(dayId)
        || !spaces.get(venueSpaceId)?.has(areaId) || !boothCode || boothCode.length > 80
        || !circleName || circleName.length > 200 || stableKey === undefined || identityGroup === undefined
        || identityGroup !== (stableKey ? `stable:${stableKey}` : null)) {
        return json({ error: `來源列 ${String(sourceRow)} 與活動日、venue-space、area 或 identity mapping 不一致。` }, 422);
      }
      const placement = `${dayId}\u0000${venueSpaceId}\u0000${boothCode.toLocaleLowerCase("en-US")}`;
      if (placements.has(placement)) return json({ error: `來源列 ${sourceRow} 的攤位重複。` }, 422);
      placements.add(placement);
      normalized.push({ sourceRow: sourceRow as number, dayId, venueSpaceId, areaId, boothCode, circleName, stableKey, identityGroup });
    }
    // The row count and per-field caps bound a normal import, but 20,000 rows
    // of maximum-length names escape to far more bytes than a Worker should
    // hold. Refuse that before it reaches the database rather than failing on
    // an opaque storage error partway through the organizer's main task.
    if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > 8 * 1024 * 1024) {
      return json({ error: "匯入資料超過 8 MB，請縮短欄位內容或確認匯入範圍是同一場活動。" }, 413);
    }
    const result = await repository.replaceOrganizerImport({
      candidateId, actorAccountId: access.current.accountId, expectedVersion: expectedVersion as number,
      source: { fileName, worksheet, sha256, sourceDescription, mappingJson }, rows: normalized,
      now: config.now(), admin: access.admin,
    });
    if (!result.ok) {
      if (result.reason === "not_found" || result.reason === "forbidden") return json({ error: "找不到活動。" }, 404);
      return json({ error: result.reason === "status" ? "目前狀態不可匯入。" : "草稿已被其他人更新，請重新載入。", conflict: result }, 409);
    }
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId,
      actorRole: access.admin ? "admin" : access.role === "owner" ? "organizer_owner" : "organizer_editor",
      action: "organizer_event.import_replaced", subjectType: "organizer_event", subjectId: candidateId,
      // The source hash is what provenance needs. A private workbook's file and
      // sheet names are the organizer's own data and would outlive the import
      // row they describe, so they stay out of the durable audit trail.
      detail: { version: result.version, rows: normalized.length, sha256 },
      ipHash: await clientIpHash(request),
    });
    return json({ ok: true, candidateId, version: result.version, importedRows: normalized.length });
  }

  async function candidateMapScope(candidateId: string, periodKey: string, venueSpaceId: string) {
    const [candidate, imported] = await Promise.all([
      repository.getOrganizerCandidate(candidateId), repository.getOrganizerImport(candidateId),
    ]);
    if (!candidate) return null;
    const draft = parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown);
    if (!draft) return null;
    return resolveCandidateAuthoringScope({
      candidateId, draft,
      importedRows: (imported?.rows ?? []).map((row) => ({
        dayId: row.day_id, venueSpaceId: row.venue_space_id, boothCode: row.booth_code,
      })),
    }, periodKey, venueSpaceId);
  }

  async function listOrganizerMaps(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const maps = await repository.listOrganizerMapDrafts(candidateId);
    return json({ maps: maps.map((map) => ({
      id: map.id, periodKey: map.period_key, venueSpaceId: map.venue_space_id,
      status: map.status, mapRevision: map.current_revision, updatedAt: map.updated_at,
    })) });
  }

  async function getOrganizerMap(request: Request, candidateId: string, draftId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const map = await repository.getOrganizerMapDraft(candidateId, draftId);
    if (!map?.content_json) return json({ error: "找不到地圖草稿。" }, 404);
    const content = parseMapContributionDraftContent(JSON.parse(map.content_json) as unknown);
    if (!content) return json({ error: "地圖草稿格式無效。" }, 500);
    return json({ map: {
      id: map.id, periodKey: map.period_key, venueSpaceId: map.venue_space_id,
      status: map.status, mapRevision: map.current_revision, updatedAt: map.updated_at,
      layout: content.layout,
    } });
  }

  async function createOrganizerMap(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    const expectedVersion = body?.expectedVersion;
    const periodKey = typeof body?.periodKey === "string" ? body.periodKey.normalize("NFKC").trim() : "";
    const venueSpaceId = typeof body?.venueSpaceId === "string" ? body.venueSpaceId.normalize("NFKC").trim() : "";
    const content = parseMapContributionDraftContent({ schema: "map-contribution-draft/1", layout: body?.layout });
    if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1 || !content) {
      return json({ error: "活動日、場館空間與地圖內容為必填。" }, 400);
    }
    const scope = await candidateMapScope(candidateId, periodKey, venueSpaceId);
    if (!scope || content.layout.template !== scope.mapTemplate) return json({ error: "這張地圖的活動日、場館空間或地圖模板不屬於此活動。" }, 422);
    const draftId = crypto.randomUUID();
    const result = await repository.createOrganizerMapDraft({
      id: draftId, candidateId, periodKey: scope.periodKey, venueSpaceId: scope.venueSpaceId,
      actorAccountId: access.current.accountId, expectedVersion: expectedVersion as number,
      contentJson: JSON.stringify(content), now: config.now(), admin: access.admin,
    });
    if (!result.ok) {
      const status = result.reason === "not_found" || result.reason === "forbidden" ? 404
        : result.reason === "scope_exists" ? 409 : 409;
      return json({ error: result.reason === "scope_exists" ? "此 day × venue-space 已有地圖草稿。" : "版本或狀態已變更。", conflict: result }, status);
    }
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId,
      actorRole: access.admin ? "admin" : access.role === "owner" ? "organizer_owner" : "organizer_editor",
      action: "organizer_event.map_created", subjectType: "organizer_event", subjectId: candidateId,
      detail: { version: result.version, draftId, periodKey, venueSpaceId }, ipHash: await clientIpHash(request),
    });
    return json({ ok: true, draftId, version: result.version, mapRevision: result.mapRevision }, 201);
  }

  async function updateOrganizerMap(request: Request, candidateId: string, draftId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    const expectedVersion = body?.expectedVersion;
    const expectedMapRevision = body?.expectedMapRevision;
    const content = parseMapContributionDraftContent({ schema: "map-contribution-draft/1", layout: body?.layout });
    if (!Number.isSafeInteger(expectedVersion) || !Number.isSafeInteger(expectedMapRevision) || !content) {
      return json({ error: "地圖版本或內容無效，請重新載入。" }, 400);
    }
    const current = await repository.getOrganizerMapDraft(candidateId, draftId);
    if (!current) return json({ error: "找不到地圖草稿。" }, 404);
    const scope = await candidateMapScope(candidateId, current.period_key, current.venue_space_id);
    if (!scope || content.layout.template !== scope.mapTemplate) return json({ error: "這張地圖的活動日、場館空間或地圖模板不屬於此活動。" }, 422);
    const result = await repository.saveOrganizerMapDraft({
      candidateId, draftId, actorAccountId: access.current.accountId,
      expectedVersion: expectedVersion as number, expectedMapRevision: expectedMapRevision as number,
      contentJson: JSON.stringify(content), now: config.now(), admin: access.admin,
    });
    if (!result.ok) return json({ error: result.reason === "not_found" ? "找不到地圖草稿。" : "版本或狀態已變更。", conflict: result }, result.reason === "not_found" ? 404 : 409);
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId,
      actorRole: access.admin ? "admin" : access.role === "owner" ? "organizer_owner" : "organizer_editor",
      action: "organizer_event.map_updated", subjectType: "organizer_event", subjectId: candidateId,
      detail: { version: result.version, draftId, mapRevision: result.mapRevision }, ipHash: await clientIpHash(request),
    });
    return json({ ok: true, version: result.version, mapRevision: result.mapRevision });
  }

  async function validateOrganizerCandidate(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const candidate = await repository.getOrganizerCandidate(candidateId);
    if (!candidate) return json({ error: "找不到活動。" }, 404);
    const draft = parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown);
    if (!draft) return json({ error: "活動資料格式無效，請聯絡網站管理者。" }, 500);
    const { issues } = await validateOrganizerWorkspace(candidateId, draft);
    const ok = issues.every((issue) => issue.severity !== "error");
    if (ok && !await repository.markOrganizerValidated(candidateId, candidate.current_version, config.now())) {
      const current = await repository.getOrganizerCandidate(candidateId);
      if (!current) return json({ error: "找不到活動。" }, 404);
      return json({
        error: "草稿已被其他人更新，請重新驗證。",
        conflict: { currentVersion: current.current_version },
      }, 409);
    }
    return json({ ok, version: candidate.current_version, issues });
  }

  async function previewOrganizerCandidate(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const candidate = await repository.getOrganizerCandidate(candidateId);
    if (!candidate) return json({ error: "找不到活動。" }, 404);
    const draft = parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown);
    if (!draft) return json({ error: "活動資料格式無效，請聯絡網站管理者。" }, 500);
    const { issues, imported, maps, contents } = await validateOrganizerWorkspace(candidateId, draft);
    const mapArtifacts = maps.map((map) => {
      const stored = contents.get(map.id);
      const content = stored ? parseMapContributionDraftContent(JSON.parse(stored) as unknown) : null;
      return content ? {
        periodKey: map.period_key, venueSpaceId: map.venue_space_id,
        revision: map.current_revision, layout: content.layout,
      } : null;
    });
    return json({
      version: candidate.current_version,
      issues,
      preview: {
        schema: "organizer-reader-preview/1",
        event: draft.event, venueAssignments: draft.venue.assignments, officialSource: draft.officialSource,
        placements: (imported?.rows ?? []).map((row) => ({
          sourceRow: row.source_row, dayId: row.day_id, venueSpaceId: row.venue_space_id,
          areaId: row.area_id, boothCode: row.booth_code, circleName: row.circle_name,
          identityGroup: row.identity_group,
        })),
        maps: mapArtifacts.filter(Boolean),
      },
    });
  }

  async function manageOrganizerCollaborators(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    const action = body?.action;
    const role = body?.role === "owner" ? "owner" : "editor";
    if (!isEmailShaped(email) || (action !== "invite" && action !== "revoke")) {
      return json({ error: "Email 與動作（邀請／移除）為必填。" }, 400);
    }
    if (role === "owner" && !access.admin) return json({ error: "只有網站管理者可以增減負責人。" }, 403);
    if (role === "editor" && access.role !== "owner") return json({ error: "只有負責人可以管理協作者。" }, 403);
    if (role === "owner" && config.now() - access.current.sessionCreatedAt > ADMIN_FRESH_SESSION_MS) {
      return json({ error: "變更負責人需要重新登入。" }, 401);
    }
    const ipHash = await clientIpHash(request);
    if (action === "invite" && !await organizerInvitationAllowed(email, access.current.accountId, ipHash, config.now())) {
      return json({ error: "邀請寄送過於頻繁，請稍後再試。" }, 429);
    }
    const result = role === "owner"
      ? await repository.manageOrganizerOwner({
        candidateId, actorAccountId: access.current.accountId, email, action, now: config.now(),
      })
      : await repository.manageOrganizerCollaborator({
        candidateId, actorAccountId: access.current.accountId, email,
        role: "editor", action, now: config.now(),
      });
    if (!result.ok) {
      const error = result.reason === "forbidden" ? "只有負責人可以管理協作者。"
        : result.reason === "last_owner" ? "每個活動至少需要一位 Owner。" : "協作者狀態沒有變更。";
      return json({ error }, result.reason === "forbidden" ? 403 : 409);
    }
    if (action === "invite") await sendOrganizerInvitation(email, config.now(), ipHash, access.current.accountId);
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId,
      actorRole: access.admin ? "admin" : "organizer_owner",
      action: `organizer_event.${role}_${action}`, subjectType: "organizer_event", subjectId: candidateId,
      detail: { role, emailHash: await emailAuditSubjectId(config.hashPepper, email) }, ipHash,
    });
    return json({ ok: true, result: result.result });
  }

  async function submitOrganizerCandidate(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    if (access.role !== "owner") return json({ error: "只有負責人可以送審。" }, 403);
    if (config.now() - access.current.sessionCreatedAt > ADMIN_FRESH_SESSION_MS) {
      return json({ error: "送審需要重新登入。" }, 401);
    }
    const body = await readJson(request);
    const expectedVersion = body?.expectedVersion;
    if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1) return json({ error: "版本資訊無效，請重新載入。" }, 400);
    const candidate = await repository.getOrganizerCandidate(candidateId);
    if (!candidate) return json({ error: "找不到活動。" }, 404);
    const draft = parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown);
    if (!draft) return json({ error: "活動資料格式無效，請聯絡網站管理者。" }, 500);
    // The snapshot is hashed from the same bytes validation just read, so a
    // second load cannot let the two disagree about what was approved.
    const { issues, imported, maps, contents } = await validateOrganizerWorkspace(candidateId, draft);
    if (issues.some((issue) => issue.severity === "error")) return json({ error: "請先修正待修正項目。", issues }, 422);
    const mapSnapshots = maps.map((map) => {
      const stored = contents.get(map.id);
      return {
        id: map.id, periodKey: map.period_key, venueSpaceId: map.venue_space_id,
        mapRevision: map.current_revision,
        content: stored ? JSON.parse(stored) as unknown : null,
      };
    });
    const snapshotJson = JSON.stringify({
      schema: "organizer-submission-snapshot/1", candidateId, candidateVersion: expectedVersion,
      eventId: draft.event.id, draft,
      import: imported ? {
        source: {
          fileName: imported.source.file_name, worksheet: imported.source.worksheet,
          sha256: imported.source.sha256, sourceDescription: imported.source.source_description,
          mapping: JSON.parse(imported.source.mapping_json) as unknown,
        },
        rows: imported.rows.map((row) => ({
          sourceRow: row.source_row, dayId: row.day_id, venueSpaceId: row.venue_space_id,
          areaId: row.area_id, boothCode: row.booth_code, circleName: row.circle_name,
          stableKey: row.stable_key, identityGroup: row.identity_group,
        })),
      } : null,
      maps: mapSnapshots.sort((a, b) => a.periodKey.localeCompare(b.periodKey) || a.venueSpaceId.localeCompare(b.venueSpaceId)),
    });
    const revisionHash = await sha256Hex(snapshotJson);
    const snapshot = await repository.storeOrganizerSubmissionSnapshot({
      candidateId, candidateVersion: expectedVersion as number, actorAccountId: access.current.accountId,
      snapshotJson, sha256: revisionHash, now: config.now(),
    });
    if (!snapshot.ok) return json({ error: "無法建立送審版本，請重新載入。", conflict: snapshot }, 409);
    const result = await repository.submitOrganizerCandidate({
      candidateId, actorAccountId: access.current.accountId,
      expectedVersion: expectedVersion as number, now: config.now(),
    });
    if (!result.ok) return json({ error: result.reason === "forbidden" ? "只有負責人可以送審。" : "版本或狀態已變更。", conflict: result }, result.reason === "forbidden" ? 403 : 409);
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId, actorRole: "organizer_owner",
      action: "organizer_event.submitted", subjectType: "organizer_event", subjectId: candidateId,
      detail: { version: expectedVersion, revisionHash }, ipHash: await clientIpHash(request),
    });
    return json({ ok: true, status: result.status, revisionHash });
  }

  async function adminReviewOrganizerCandidate(request: Request, candidateId: string) {
    const gate = await requireFreshAdmin(request);
    if (!gate.ok) return gate.response;
    const body = await readJson(request);
    const expectedVersion = body?.expectedVersion;
    const decision = body?.decision;
    const note = typeof body?.note === "string" ? body.note.normalize("NFKC").trim().slice(0, 1000) : "";
    if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1
      || (decision !== "approve" && decision !== "changes_requested")) {
      return json({ error: "版本與審閱結果（核准／要求修改）為必填。" }, 400);
    }
    const candidate = await repository.getOrganizerCandidate(candidateId);
    if (!candidate) return json({ error: "找不到活動。" }, 404);
    const snapshot = await repository.getOrganizerSubmissionSnapshot(candidateId, expectedVersion as number);
    if (!snapshot) return json({ error: "找不到這一版的送審內容。" }, 409);
    if (decision === "approve") {
      const draft = parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown);
      const { issues } = await validateOrganizerWorkspace(candidateId, draft);
      if (issues.some((issue) => issue.severity === "error")) return json({ error: "這個活動仍有待修正項目。", issues }, 422);
    }
    const result = await repository.reviewOrganizerCandidate({
      candidateId, expectedVersion: expectedVersion as number, decision,
      actorAccountId: gate.session.accountId, note, now: config.now(),
    });
    if (!result.ok) return json({ error: "版本或狀態已變更。", conflict: result }, 409);
    let publicationJobId: string | null = null;
    if (decision === "approve") {
      const publication = await repository.createOrganizerPublicationJob({
        candidateId, candidateVersion: expectedVersion as number, snapshotId: snapshot.id,
        approvalHash: snapshot.sha256, now: config.now(),
      });
      if (!publication.ok) return json({ error: "核准已記錄，但無法建立發布工作；請由管理者重試。" }, 500);
      publicationJobId = publication.jobId;
    }
    await repository.writeAudit({
      at: config.now(), actorAccountId: gate.session.accountId, actorRole: "admin",
      action: decision === "approve" ? "organizer_event.approved" : "organizer_event.changes_requested",
      subjectType: "organizer_event", subjectId: candidateId,
      detail: {
        version: expectedVersion, revisionHash: snapshot.sha256, publicationJobId,
        selfApproval: candidate.submitted_by === gate.session.accountId,
      },
      ipHash: await clientIpHash(request),
    });
    return json({
      ok: true, status: result.status, revisionHash: snapshot.sha256, publicationJobId,
      selfApproval: candidate.submitted_by === gate.session.accountId,
    });
  }

  async function adminRetryOrganizerPublication(request: Request, jobId: string) {
    const gate = await requireFreshAdmin(request);
    if (!gate.ok) return gate.response;
    if ((config.organizerPublicationMode ?? "disabled") === "disabled") {
      return json({ error: "發布功能尚未啟用。" }, 503);
    }
    const result = await repository.retryOrganizerPublicationJob({ jobId, now: config.now() });
    if (!result.ok) {
      if (result.reason === "not_found") return json({ error: "找不到發布工作。" }, 404);
      return json({ error: "只有失敗的發布工作可以重試。", status: result.status }, 409);
    }
    await repository.writeAudit({
      at: config.now(), actorAccountId: gate.session.accountId, actorRole: "admin",
      action: "organizer_publication.retried", subjectType: "organizer_publication", subjectId: jobId,
      detail: { step: result.step }, ipHash: await clientIpHash(request),
    });
    return json({ ok: true, jobId, status: "queued", step: result.step });
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
    // Account-scoped: the identity is the same in every event, so these answer
    // before an event is chosen.
    authConfig, requestLink, verify, session, signOut, deleteMyAccount,
    adminListAdmins, adminManageAdmins, adminDisableAccount, adminManageMapContributor,
    // Candidate-scoped: an organizer candidate is addressed by candidateId and
    // exists before any event is published, so `eventScoped` — which demands a
    // published event this deployment serves — would refuse every one of them.
    // Authority comes from the candidate's own grant, checked in each handler.
    adminCreateOrganizerCandidate, listOrganizerCandidates, getOrganizerCandidate, updateOrganizerCandidate,
    listOrganizerVenues, createOrganizerVenue, createOrganizerVenueSpace,
    updateOrganizerWorkspacePreference, completeOrganizerWorkspaceOnboarding, putOrganizerImport,
    listOrganizerMaps, getOrganizerMap, createOrganizerMap, updateOrganizerMap,
    validateOrganizerCandidate, previewOrganizerCandidate, manageOrganizerCollaborators,
    submitOrganizerCandidate, adminReviewOrganizerCandidate, adminRetryOrganizerPublication,
    // Event-scoped: each answers only for the event the request named.
    listClaims: eventScoped(listClaims),
    createClaim: eventScoped(createClaim),
    withdrawClaim: eventScoped(withdrawClaim),
    runChallenge: eventScoped(runChallenge),
    searchCatalog: eventScoped(searchCatalog),
    getMyOverride: eventScoped(getMyOverride),
    putOverride: eventScoped(putOverride),
    uploadThumbnail: eventScoped(uploadThumbnail),
    deleteMyOverride: eventScoped(deleteMyOverride),
    previewOverride: eventScoped(previewOverride),
    setPostEventVisibility: eventScoped(setPostEventVisibility),
    adminListClaims: eventScoped(adminListClaims),
    adminDecideClaim: eventScoped(adminDecideClaim),
    adminTakedown: eventScoped(adminTakedown),
    adminListStaleMapDrafts: eventScoped(adminListStaleMapDrafts),
    listMyMapDrafts: eventScoped(listMyMapDrafts),
    getMapDraft: eventScoped(getMapDraft),
    createMapDraft: eventScoped(createMapDraft),
    updateMapDraft: eventScoped(updateMapDraft),
    submitMapDraft: eventScoped(submitMapDraft),
    uploadMapDraftFile: eventScoped(uploadMapDraftFile),
    readMapDraftFile: eventScoped(readMapDraftFile),
    adminListMapDrafts: eventScoped(adminListMapDrafts),
    adminReviewMapDraft: eventScoped(adminReviewMapDraft),
    adminExportMapDraft: eventScoped(adminExportMapDraft),
    postMapDraftComment: eventScoped(postMapDraftComment),
    // Names its own event and validates it, so it is not scoped by the request.
    publicOverrides,
  };
}

export type CirclePortalHandlers = ReturnType<typeof createCirclePortalHandlers>;
