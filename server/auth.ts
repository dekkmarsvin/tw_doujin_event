import { parseAccountNotificationPreferencesUpdate, parseRequestLinkLocale } from "../app/i18n/api-contract";
import type { ApiErrorCode } from "../app/i18n/api-error";
import { canSubmitEventApplication } from "../app/site-settings";
import { notificationParameters } from "../app/notification-navigation";
import { loginLinkLetter } from "../app/mail-letter";
import type { PortalMail } from "../app/portal-mail";
import { hmacSign, hmacVerify, isEmailShaped, normalizeEmail, peppered, randomToken, sha256Hex } from "../app/portal-crypto";
import { deleteObjectKeys, type HostedThumbnailStore } from "../app/hosted-thumbnails";
import type { IdentityRepository } from "../db/identity-repository";
import { json, readCookie, readJson } from "./http";

/**
 * Auth module (#546 phase 5): sign-in by emailed link, the session cookie,
 * sign-out, the caller's own account (deletion, language) and the session
 * check every other module uses.
 */

const errorCode = (code: ApiErrorCode) => code;

export const SESSION_COOKIE = "__Host-ff47_session";
export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LOGIN_LIMITS = { perEmailPerHour: 5, perIpPerHour: 20 };

const EMAIL_AUDIT_DOMAIN = "audit-email-v1";

/** Keyed and domain-separated so a leaked audit table cannot be tested against
 * an email dictionary, and the digest cannot be confused with another HMAC. */
export function emailAuditSubjectId(secret: string, email: string) {
  return hmacSign(secret, `${EMAIL_AUDIT_DOMAIN}\0${normalizeEmail(email)}`);
}

function sessionCookie(value: string, maxAgeSeconds: number) {
  // `__Host-` forces Secure + Path=/ + no Domain, so no sibling host can set it.
  return `${SESSION_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export type AuthDependencies = {
  repository: IdentityRepository;
  sendMail: (message: PortalMail) => Promise<void>;
  /**
   * Whether this environment can deliver to an address at all, asked before
   * anything is written. Only the preview and local portals set it: they keep a
   * fixed recipient list. Production leaves it undefined, so `requestLink`
   * keeps returning the same 202 whatever the address.
   */
  mailRecipientAllowed?: (email: string) => boolean;
  lookupCircle: (circleId: string) => Promise<{ id: string } | null>;
  /** Turnstile siteverify. Fails closed: an unreachable verifier is a `false`. */
  verifyHuman: (token: string, remoteIp: string | null) => Promise<boolean>;
  /** Resolved on call, so an unset sitekey does not take other routes down. */
  turnstileSitekey: () => string;
  thumbnailStore?: HostedThumbnailStore;
  config: {
    eventId: string;
    origin: string;
    sessionSecret: string;
    hashPepper: string;
    now: () => number;
    /** Omitted means "only `eventId` is published". */
    publishedEvent?: (eventId: string) => Promise<unknown>;
  };
};

export function createAuth({
  repository, sendMail, mailRecipientAllowed, lookupCircle, verifyHuman, turnstileSitekey, thumbnailStore, config,
}: AuthDependencies) {
  // The roster lives in the database so it can change without a redeploy.
  // Normalized on both sides, as a stored account email is.
  const isAdmin = (email: string) => repository.isAdminEmail(normalizeEmail(email));

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
    // Older 30-day cookies obey the same deadline as new sessions.
    if (session && config.now() >= session.sessionCreatedAt + SESSION_TTL_MS) return null;
    return session ? { ...session, sessionId } : null;
  }

  const unauthenticated = () => json({ error: "尚未登入。", code: errorCode("unauthenticated") }, 401);

  /** What the portal shows for a signed-in account; one settings read. */
  async function sessionBody(accountId: string, email: string, expiresAt: number) {
    const [admin, settings, organizer, applications] = await Promise.all([
      isAdmin(email), repository.getSiteSettings(), repository.hasOrganizerAccess(accountId), repository.hasOrganizerApplications(accountId),
    ]);
    return {
      email, isAdmin: admin, expiresAt, hasOrganizerAccess: organizer || admin,
      canApplyForEvent: canSubmitEventApplication(settings, email),
      contactUrl: settings?.contactUrl ?? "", claimReviewNotice: settings?.claimReviewNotice ?? "",
      hasEventApplications: applications,
    };
  }

  /** The public half of the Turnstile pair, so the sign-in page can render it. */
  function authConfig() {
    return json({ turnstileSitekey: turnstileSitekey() });
  }

  async function requestLink(request: Request) {
    const body = await readJson(request);

    // Human verification runs first, before the address is even read, so
    // nothing past it — rate-limit counters or the mailer — is reachable by a
    // script that cannot solve it.
    const humanToken = typeof body?.turnstileToken === "string" ? body.turnstileToken : "";
    if (!humanToken || !await verifyHuman(humanToken, request.headers.get("cf-connecting-ip"))) {
      return json({ error: "真人驗證未通過，請重新驗證後再送出。", code: errorCode("turnstile_failed") }, 403);
    }

    const parsedLocale = parseRequestLinkLocale(body?.locale);
    if (!parsedLocale.ok) return json({ error: "請選擇支援的語言。", code: errorCode("invalid_locale") }, 400);
    const { locale } = parsedLocale;

    const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    const audience = body?.audience === "organizer" ? "organizer" : "circle";
    const now = config.now();

    // Always the same answer: an attacker must not learn which inboxes exist.
    const accepted = json({ ok: true }, 202);
    if (!isEmailShaped(email)) return accepted;

    // Preview and local keep a fixed recipient list; saying so tells nothing
    // about who has an account. Production supplies no predicate.
    if (mailRecipientAllowed && !mailRecipientAllowed(email)) {
      return json({ error: "這個測試環境不會寄信到這個地址。", code: errorCode("mail_recipient_not_allowed") }, 400);
    }

    const ipHash = await clientIpHash(request);
    const windowStart = now - 60 * 60 * 1000;
    const [byEmail, byIp] = await Promise.all([
      // Only links this inbox asked for: invitations are capped on their own
      // budget, so an inviter cannot lock the address out of its own sign-in.
      repository.countLoginTokensSince("email", email, windowStart, "self"),
      ipHash ? repository.countLoginTokensSince("request_ip_hash", ipHash, windowStart) : Promise.resolve(0),
    ]);
    if (byEmail >= LOGIN_LIMITS.perEmailPerHour || byIp >= LOGIN_LIMITS.perIpPerHour) {
      return json({ error: "請求過於頻繁，請稍後再試。", code: errorCode("rate_limited") }, 429);
    }

    // These parameters select a form after login; ownership still comes only
    // from the authenticated claim. Never accept an arbitrary redirect URL.
    const destination = new URL(`${config.origin}/${audience === "organizer" ? "organizer" : "circle"}`);
    const continuation = notificationParameters(body?.destination, audience);
    if (audience === "circle" && !continuation.has("admin") && new URL(request.url).searchParams.has("event")) {
      if (!config.publishedEvent || await config.publishedEvent(config.eventId)) {
        destination.searchParams.set("event", config.eventId);
        if (typeof body?.circleId === "string" && body.circleId.length <= 200) {
          const circle = await lookupCircle(body.circleId);
          if (circle) destination.searchParams.set("circle", circle.id);
        }
      }
    }
    for (const [key, value] of continuation) destination.searchParams.set(key, value);
    destination.searchParams.set("lang", locale);
    const token = randomToken();
    destination.searchParams.set("login", token);
    const expiresAt = now + LOGIN_TOKEN_TTL_MS;
    await repository.createLoginToken({ tokenHash: await sha256Hex(token), email, now, expiresAt, ipHash, audience });

    // Root-path query, consumed by POST from the page: mail scanners issue a GET
    // on every link they see, and a GET-consumes design burns the token first.
    try {
      await sendMail({
        purpose: "login_link",
        to: email,
        ...loginLinkLetter({ href: destination.href, origin: config.origin, requestedAt: now, expiresAt, locale }),
      });
    } catch (error) {
      // Nobody can ever hold this link, and it counts against the address's
      // hourly budget: left in place, a mailer outage locks the address out.
      await repository.deleteLoginToken(await sha256Hex(token));
      throw error;
    }
    await repository.writeAudit({
      at: now, actorRole: "system", action: "auth.link_requested", subjectType: "email",
      subjectId: await emailAuditSubjectId(config.hashPepper, email), ipHash,
    });
    return accepted;
  }

  async function verify(request: Request) {
    const body = await readJson(request);
    const token = typeof body?.token === "string" ? body.token : "";
    if (!token) return json({ error: "登入連結無效。", code: errorCode("login_link_invalid") }, 400);

    const now = config.now();
    const login = await repository.consumeLoginTokenDetails(await sha256Hex(token), now);
    if (!login) return json({ error: "登入連結已失效或已使用，請重新索取。", code: errorCode("login_link_expired") }, 400);
    const { email, audience } = login;

    let accountId: string;
    try {
      accountId = await repository.upsertAccount(email, now);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "無法建立帳號。", code: errorCode("account_creation_refused") }, 403);
    }
    if (audience === "organizer") await repository.acceptOrganizerInvitations({ accountId, email, now });

    // A fresh id on every verify, so a leaked earlier value cannot be reused.
    const sessionId = randomToken();
    await repository.createSession(accountId, now, now + SESSION_TTL_MS, sessionId);
    const signature = await hmacSign(config.sessionSecret, sessionId);
    await repository.writeAudit({ at: now, actorAccountId: accountId, actorRole: "circle", action: "auth.session_created", subjectType: "account", subjectId: accountId, ipHash: await clientIpHash(request) });

    return json(await sessionBody(accountId, email, now + SESSION_TTL_MS), 200, {
      "set-cookie": sessionCookie(`${sessionId}.${signature}`, Math.floor(SESSION_TTL_MS / 1000)),
    });
  }

  async function session(request: Request) {
    const current = await currentSession(request);
    if (!current) return unauthenticated();
    return json(await sessionBody(current.accountId, current.email, current.sessionCreatedAt + SESSION_TTL_MS));
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
    if (!current) return unauthenticated();
    if (await isAdmin(current.email)) {
      return json({ error: "管理者帳號需先由另一位管理者移出名單，才能刪除。", code: errorCode("admin_account_delete_blocked") }, 409);
    }
    const body = await readJson(request);
    if (body?.confirm !== current.email) {
      return json({ error: "請輸入目前登入的完整 email 以確認刪除帳號。", code: errorCode("account_delete_confirmation") }, 400);
    }
    const soleOwnerCandidates = await repository.listSoleOwnerOrganizerCandidates(current.accountId);
    if (soleOwnerCandidates.length > 0) {
      return json({
        error: "請先邀請另一位 Owner 接手所有活動，才能刪除帳號。",
        code: errorCode("account_sole_owner"),
        candidates: soleOwnerCandidates.map((candidate) => ({ candidateId: candidate.id, tentativeName: candidate.tentative_name })),
      }, 409);
    }
    const now = config.now();
    let claimScopes = await repository.listClaimScopesForAccount(current.accountId);
    if (!thumbnailStore && claimScopes.length > 0) return json({ error: "暫時無法使用圖片功能，請稍後再試。", code: errorCode("image_service_unavailable") }, 503);
    if (!await repository.beginAccountDeletion({ accountId: current.accountId, email: current.email, now, retrySessionId: current.sessionId })) {
      return json({ error: "找不到可刪除的帳號。", code: errorCode("account_not_found") }, 404);
    }
    // Re-read after the atomic tombstone. An upload that already put R2 bytes
    // can no longer bind metadata and will roll its object back.
    claimScopes = await repository.listClaimScopesForAccount(current.accountId);
    if (thumbnailStore) {
      const allKeys = (await Promise.all(claimScopes.map((claim) => thumbnailStore.list(
        `events/${encodeURIComponent(claim.event_id)}/circles/${encodeURIComponent(claim.circle_id)}/`,
      )))).flat();
      await deleteObjectKeys(thumbnailStore, [...new Set(allKeys)]);
    }
    const deleted = await repository.deleteAccount({
      accountId: current.accountId,
      email: current.email,
      emailAuditDigest: await emailAuditSubjectId(config.hashPepper, current.email),
      legacyEmailAuditDigest: await sha256Hex(current.email),
      now,
    });
    if (!deleted) return json({ error: "找不到可刪除的帳號。", code: errorCode("account_not_found") }, 404);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
  }

  async function getAccountNotificationPreferences(request: Request) {
    const current = await currentSession(request);
    if (!current) return unauthenticated();
    return json(await repository.getAccountNotificationPreferences(current.accountId));
  }

  async function saveAccountNotificationPreferences(request: Request) {
    const current = await currentSession(request);
    if (!current) return unauthenticated();
    const parsed = parseAccountNotificationPreferencesUpdate(await readJson(request));
    if (!parsed.ok) return json({ error: parsed.code === "invalid_locale" ? "請選擇支援的語言。" : "通知設定格式無效。", code: errorCode(parsed.code) }, 400);
    const preferences = await repository.saveAccountNotificationPreferences({ accountId: current.accountId,
      sessionId: current.sessionId, ...parsed.value, now: config.now() });
    return preferences ? json(preferences) : json({ error: "設定已變更，請重新載入後再儲存。", code: errorCode("version_conflict") }, 409);
  }

  return {
    isAdmin, clientIpHash, currentSession,
    routes: {
      authConfig, requestLink, verify, session, signOut, deleteMyAccount,
      getAccountNotificationPreferences, saveAccountNotificationPreferences,
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
