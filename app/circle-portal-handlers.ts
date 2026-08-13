import { isCircleOverrideFields, type CircleOverrideFields } from "./circle-overrides";
import { hmacSign, hmacVerify, isEmailShaped, normalizeEmail, peppered, randomChallengeCode, randomToken, sha256Hex } from "./portal-crypto";
import type { ClaimMethod, IdentityRepository } from "../db/identity-repository";

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
  dataUpdatedAt: string;
  now: () => number;
};

export type PortalDependencies = {
  repository: IdentityRepository;
  sendMail: (message: { to: string; subject: string; text: string }) => Promise<void>;
  lookupCircle: (circleId: string) => Promise<CircleLookup | null>;
  searchCircles: (query: string, limit: number) => Promise<CircleLookup[]>;
  /** Returns page text, or null when the host cannot be read from a Worker. */
  fetchEvidence: (url: string) => Promise<string | null>;
  /** Runs the reader's own projection so a preview cannot drift from reality. */
  projectCircle: (circleId: string, fields: CircleOverrideFields) => Promise<unknown[] | null>;
  config: PortalConfig;
};

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

export function createCirclePortalHandlers({ repository, sendMail, lookupCircle, searchCircles, fetchEvidence, projectCircle, config }: PortalDependencies) {
  // The roster lives in the database so it can change without a redeploy.
  // Normalized on both sides, as a stored account email is: comparing a raw
  // string against a normalized one silently denies an admin whose address
  // differs only in case or Unicode width.
  const isAdmin = (email: string) => repository.isAdminEmail(normalizeEmail(email));

  async function clientIpHash(request: Request) {
    const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "";
    return address ? peppered(config.hashPepper, address) : null;
  }

  /** Resolve the caller. Signature is a cheap gate; the session row is the authority. */
  async function currentSession(request: Request) {
    const raw = readCookie(request, SESSION_COOKIE);
    if (!raw) return null;
    const separator = raw.lastIndexOf(".");
    if (separator <= 0) return null;
    const sessionId = raw.slice(0, separator);
    const signature = raw.slice(separator + 1);
    if (!await hmacVerify(config.sessionSecret, sessionId, signature)) return null;
    const session = await repository.getSession(sessionId, config.now());
    return session ? { ...session, sessionId } : null;
  }

  async function requireSession(request: Request) {
    const session = await currentSession(request);
    return session ?? null;
  }

  async function requestLink(request: Request) {
    const body = await readJson(request);
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
      subject: "FF47 場刊 MAP 登入連結",
      text: `請開啟以下連結登入（15 分鐘內有效，僅能使用一次）：\n\n${config.origin}/circle?login=${encodeURIComponent(token)}\n\n若您沒有申請登入，請忽略這封信，不會有任何變更。`,
    });
    await repository.writeAudit({ at: now, actorRole: "system", action: "auth.link_requested", subjectType: "email", subjectId: await sha256Hex(email), ipHash });
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

    return json({ email, isAdmin: await isAdmin(email) }, 200, {
      "set-cookie": sessionCookie(`${sessionId}.${signature}`, Math.floor(SESSION_TTL_MS / 1000)),
    });
  }

  async function session(request: Request) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    return json({ email: current.email, isAdmin: await isAdmin(current.email) });
  }

  async function signOut(request: Request) {
    const current = await currentSession(request);
    if (current) {
      await repository.revokeSession(current.sessionId, config.now());
      await repository.writeAudit({ at: config.now(), actorAccountId: current.accountId, actorRole: "circle", action: "auth.signed_out", subjectType: "account", subjectId: current.accountId });
    }
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
    const challenge = challengeable ? randomChallengeCode() : null;

    const id = crypto.randomUUID();
    await repository.createClaim({
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
    await repository.recordChallengeAttempt(claim.id);

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
    return body.match(/ff47-[23456789BCDFGHJKLMNPQRSTVWXYZ]{10}/)?.[0] ?? null;
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

    const now = config.now();
    const previous = await repository.getOverride(config.eventId, circleId);
    await repository.putOverride({ eventId: config.eventId, circleId, fieldsJson: JSON.stringify(fields), updatedBy: current.accountId, now });
    await repository.rebuildOverridesDoc(config.eventId, config.dataUpdatedAt, now);
    await repository.writeAudit({
      at: now, actorAccountId: current.accountId, actorRole: "circle", action: "override.updated",
      subjectType: "override", subjectId: circleId,
      detail: { changedFields: Object.keys(fields as CircleOverrideFields), previousRevision: previous?.revision ?? 0 },
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

    const records = await projectCircle(circleId, fields as CircleOverrideFields);
    if (!records) return json({ error: "找不到這個社團。" }, 404);
    return json({ records });
  }

  async function getMyOverride(request: Request, circleId: string) {
    const current = await requireSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    if (!await repository.ownsCircle(current.accountId, config.eventId, circleId)) {
      return json({ error: "你尚未通過這個社團的認領。" }, 403);
    }
    const row = await repository.getOverride(config.eventId, circleId);
    return json({ fields: row ? JSON.parse(row.fields_json) as unknown : {}, status: row?.status ?? "none" });
  }

  type AdminGate =
    | { ok: false; response: Response }
    | { ok: true; session: NonNullable<Awaited<ReturnType<typeof currentSession>>> };

  async function requireFreshAdmin(request: Request): Promise<AdminGate> {
    const current = await requireSession(request);
    if (!current) return { ok: false, response: json({ error: "尚未登入。" }, 401) };
    if (!await isAdmin(current.email)) return { ok: false, response: json({ error: "沒有權限。" }, 403) };
    if (config.now() - current.sessionCreatedAt > ADMIN_FRESH_SESSION_MS) {
      return { ok: false, response: json({ error: "管理操作需要重新登入。" }, 401) };
    }
    return { ok: true, session: current };
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

    if (decision !== "approve" && ok) await repository.rebuildOverridesDoc(config.eventId, config.dataUpdatedAt, now);
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

  async function adminTakedown(request: Request) {
    const gate = await requireFreshAdmin(request);
    if (!gate.ok) return gate.response;

    const body = await readJson(request);
    const circleId = typeof body?.circleId === "string" ? body.circleId : "";
    const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : "";
    if (!circleId || !reason) return json({ error: "circleId 與 reason 是必填欄位。" }, 400);

    const now = config.now();
    const ok = await repository.takedownOverride({ eventId: config.eventId, circleId, reason, by: gate.session.email, now });
    if (ok) await repository.rebuildOverridesDoc(config.eventId, config.dataUpdatedAt, now);
    await repository.writeAudit({
      at: now, actorAccountId: gate.session.accountId, actorRole: "admin", action: "override.takendown",
      subjectType: "override", subjectId: circleId, detail: { reason, applied: ok },
      ipHash: await clientIpHash(request),
    });
    return ok ? json({ ok: true }) : json({ error: "這個社團目前沒有上線中的補充資料。" }, 404);
  }

  /**
   * The public overlay. A strong ETag keyed on the stored revision lets the
   * Pages edge collapse venue traffic to roughly one row read per PoP per
   * minute, which is what keeps this inside the D1 free tier.
   */
  async function publicOverrides(request: Request, eventId: string) {
    const doc = await repository.getOverridesDoc(eventId);
    const body = doc?.json ?? JSON.stringify({
      schema: "circle-overrides/1", eventId, generatedAt: config.dataUpdatedAt, revision: 0, overrides: [],
    });
    const etag = `"circle-overrides-${eventId}-${doc?.revision ?? 0}"`;
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, must-revalidate",
      etag,
    };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(body, { status: 200, headers });
  }

  return {
    requestLink, verify, session, signOut,
    listClaims, createClaim, runChallenge, searchCatalog,
    getMyOverride, putOverride, previewOverride,
    adminListClaims, adminDecideClaim, adminTakedown,
    adminListAdmins, adminManageAdmins,
    publicOverrides,
  };
}

export type CirclePortalHandlers = ReturnType<typeof createCirclePortalHandlers>;
