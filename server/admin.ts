import { contactSettingsProblem, parseSiteSettings } from "../app/site-settings";
import type { AdminCircleDetail } from "../app/admin-circle-detail";
import type { AdminAccountCircleSearchResponse, AdminAccountDetailResponse } from "../app/admin-account-detail";
import { normalizeCircleName, type CircleViewRecord } from "../app/circle-records";
import { createAdminReferenceHandlers } from "../app/admin-reference-handlers";
import { type CircleOverrideFields } from "../app/circle-overrides";
import { getEventDefinition } from "../app/event-catalog";
import { isEmailShaped, normalizeEmail } from "../app/portal-crypto";
import type { ClaimMethod } from "../db/identity-repository";
import { emailAuditSubjectId } from "./auth";
import { json, readJson } from "./http";
import { hasCatalogImages, SEARCH_LIMIT } from "./circle";
import { createEventScope } from "./event-scope";
import { circleObjectPrefix, deleteObjectKeys } from "../app/hosted-thumbnails";
import type { Auth } from "./auth";
import type { PortalDependencies } from "../app/circle-portal-handlers";

/**
 * Admin module (#546 phase 5): site settings, the admin roster, accounts, the
 * review queue, claim decisions, takedowns, a circle's moderation detail and
 * the shared reference catalog. Organizer owners reuse the moderation steps
 * for their own event; the organizer candidate review stays with organizer.
 */

const ACCOUNT_SEARCH_LIMIT = 20;

type AdminDependencies = Pick<PortalDependencies,
  "repository" | "lookupCircle" | "searchCircles" | "projectCircle" | "thumbnailStore" | "config">;

export function createAdmin({ repository, lookupCircle, searchCircles, projectCircle, thumbnailStore, config }: AdminDependencies, auth: Auth) {
  const { isAdmin, clientIpHash, currentSession } = auth;
  const { dataUpdatedAt, eventEndsAt, currentPhase, eventScoped } = createEventScope(config);

  type AdminGate =
    | { ok: false; response: Response }
    | { ok: true; session: NonNullable<Awaited<ReturnType<typeof currentSession>>> };

  async function requireAdmin(request: Request): Promise<AdminGate> {
    const current = await currentSession(request);
    if (!current) return { ok: false, response: json({ error: "尚未登入。" }, 401) };
    if (!await isAdmin(current.email)) return { ok: false, response: json({ error: "沒有權限。" }, 403) };
    return { ok: true, session: current };
  }

  async function adminGetSiteSettings(request: Request) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;
    const [settings, services] = await Promise.all([
      repository.getSiteSettings(), repository.getServiceChecks(),
    ]);
    return json({ settings, publicationMode: config.organizerPublicationMode ?? "disabled", services });
  }

  async function adminUpdateSiteSettings(request: Request) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;
    const body = await readJson(request);
    if (!body || Object.keys(body).some(key => !["settings", "expectedUpdatedAt"].includes(key))) return json({ error: "設定格式無效。" }, 400);
    const settings = parseSiteSettings(body.settings);
    if (!settings || !Number.isSafeInteger(body.expectedUpdatedAt)) {
      return json({ error: contactSettingsProblem(body.settings) ?? "請填寫完整設定與有效的邀請 email。" }, 400);
    }
    const current = await repository.getSiteSettings();
    if ((config.organizerPublicationMode ?? "disabled") === "disabled" && settings.publicationEnabled !== current?.publicationEnabled) {
      return json({ error: "此環境尚未設定發布功能，無法變更發布開關。" }, 409);
    }
    const result = await repository.updateSiteSettings({ settings, expectedUpdatedAt: body.expectedUpdatedAt as number,
      actorAccountId: gate.session.accountId, sessionId: gate.session.sessionId, now: config.now() });
    return result ? adminGetSiteSettings(request) : json({ error: "設定或管理權限已變更，請重新載入後再儲存。" }, 409);
  }

  async function adminRequestServiceCheck(request: Request) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;
    const body = await readJson(request);
    if (!body || Object.keys(body).length) return json({ error: "請求格式無效。" }, 400);
    return json({ services: await repository.requestServiceCheck(config.now()) }, 202);
  }

  /** A comment carries a target when it asks for one element to change rather
   * than the draft as a whole. The reference is the booth code or landmark id
   * as the draft spells it, which is what lets the contributor's editor jump
   * straight to it. */

  async function adminListClaims(request: Request) {
    // Reads and decisions share one session deadline; polling cannot renew it.
    const gate = await requireAdmin(request);
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

  /**
   * Every served event's review work in one answer, so the admin page opens on
   * where the work is instead of on a default event. Read-only on purpose: each
   * decision still goes through the event-scoped routes, one claim at a time.
   * An event this deployment does not serve is left out, the same answer every
   * event-scoped route gives for it.
   */
  async function adminReviewQueue(request: Request) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;
    const parameters = new URL(request.url).searchParams;
    const eventId = parameters.get("event");
    const claimId = parameters.get("claim") ?? "";
    if (eventId !== null && !(config.publishedEvent ? await config.publishedEvent(eventId) : eventId === config.eventId)) {
      return json({ error: "找不到此活動。" }, 404);
    }
    const queue = await repository.listAdminReviewSummary();
    const eventIds = [...new Set(queue.claimCounts.map((row) => row.event_id))];
    const served = new Set((await Promise.all(eventIds.map(async (eventId) => (config.publishedEvent
      ? await config.publishedEvent(eventId) : eventId === config.eventId) ? eventId : null)))
      .filter((eventId): eventId is string => eventId !== null));
    const claimCounts = queue.claimCounts.filter((row) => served.has(row.event_id));
    const claims = await repository.listPendingAdminClaims(eventId === null ? [...served] : [eventId], eventId === null ? "" : claimId);
    return json({
      pendingClaimCount: claimCounts.reduce((sum, row) => sum + row.pending, 0),
      claimCounts: claimCounts.map((row) => ({ eventId: row.event_id, pending: row.pending })),
      claims: claims.map((claim) => ({
        id: claim.id, eventId: claim.event_id, circleId: claim.circle_id, circleName: claim.circle_name_at_claim,
        evidenceUrl: claim.evidence_url, evidenceNote: claim.evidence_note, targetUrl: claim.target_url,
        createdAt: claim.created_at, circleClaimed: !!claim.circle_claimed,
      })),
      organizer: { applications: queue.applications, submissions: queue.submissions },
    });
  }

  async function adminDecideClaim(request: Request) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;

    return decideReviewClaim(request, gate.session, "admin", config.eventId);
  }

  async function decideReviewClaim(request: Request, session: { accountId: string; email: string },
    actorRole: "admin" | "organizer_owner", eventId: string,
    authority?: { candidateId: string; accountId: string }) {

    const body = await readJson(request);
    const claimId = typeof body?.claimId === "string" ? body.claimId : "";
    const decision = body?.decision;
    if (decision !== "approve" && decision !== "reject" && decision !== "revoke") {
      return json({ error: authority ? "請選擇核准或婉拒。" : "decision 必須是 approve、reject 或 revoke。" }, 400);
    }

    const claim = await repository.getClaim(claimId);
    // A revoke rebuilds this event's public document. Deciding another event's
    // claim from here would withdraw ownership in that event while leaving its
    // document — and so the revoked content — standing.
    if (!claim || claim.event_id !== eventId) return json({ error: "找不到這筆認領。" }, 404);
    // The rebuild below uses the decided event's own dates, resolved before
    // anything changes. `dataUpdatedAt()` follows the request's `?event=`, which
    // on the organizer route need not be the candidate's event: a mismatch
    // would fail after the write and leave revoked content public.
    const published = config.publishedEvent ? await config.publishedEvent(eventId)
      : { dataUpdatedAt: await dataUpdatedAt(), eventEndsAt: await eventEndsAt() };
    if (!published) return json({ error: "找不到這筆認領。" }, 404);

    const now = config.now();
    const method: ClaimMethod = authority ? "organizer" : "admin";
    // Approving and rejecting decide a pending claim. The queue a reviewer
    // decides from can be seconds old, and a batch can hold many rows: a
    // rejection that landed on a claim approved meanwhile would withdraw the
    // owner's content under the name of a rejection. Withdrawing an owner is
    // what revoke is for.
    // Revoke withdraws an approved owner and nothing else: a claim withdrawn or
    // rejected since the reviewer looked keeps that result.
    const ok = decision === "approve"
      ? await repository.markClaimVerified(claimId, method, now, session.email, authority)
      : await repository.setClaimStatus(claimId, decision === "reject" ? "rejected" : "revoked", now, session.email,
        decision === "reject" ? "pending" : "verified", authority);

    // Revoking ownership withdraws that circle's content in the same step. The
    // phase has to be the current one: rebuilding as "during" after the event
    // would republish every circle that had opted out of the post-event window.
    if (ok && (decision === "revoke" || (decision === "reject" && !authority))) {
      await repository.rebuildOverridesDoc(eventId, published.dataUpdatedAt, now, now > Date.parse(published.eventEndsAt) ? "after" : "during");
    }
    await repository.writeAudit({
      at: now, actorAccountId: session.accountId, actorRole,
      action: `claim.${authority ? "organizer" : "admin"}_${decision}`, subjectType: "claim", subjectId: claimId,
      detail: { eventId, circleId: claim.circle_id, applied: ok, evidenceUrl: claim.evidence_url,
        ...(authority ? { candidateId: authority.candidateId } : {}) },
      ipHash: await clientIpHash(request),
    });
    if (ok) return json({ ok: true });
    return json({ error: decision === "revoke" ? "這筆認領已不是通過狀態。"
      : claim.status !== "pending" ? "這筆認領已不在待審中。" : "此社團已有通過的認領。" }, 409);
  }

  async function adminListAdmins(request: Request) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;
    const admins = await repository.listAdmins();
    return json({
      admins: admins.map((admin) => ({ email: admin.email, addedBy: admin.added_by, addedAt: admin.added_at })),
      self: gate.session.email,
    });
  }

  async function adminManageAdmins(request: Request) {
    const gate = await requireAdmin(request);
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

  async function adminAccountDetail(request: Request) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;
    const email = normalizeEmail(new URL(request.url).searchParams.get("email") ?? "");
    if (!isEmailShaped(email)) return json({ error: "email 格式無效。" }, 400);
    const account = await repository.getAccountForAdmin(email);
    if (!account) return json({ email, account: null } satisfies AdminAccountDetailResponse);

    const [organizerGrants, claims] = await Promise.all([
      repository.listAccountOrganizerGrantsForAdmin(account.id),
      repository.listAccountClaimsForAdmin(account.id),
    ]);
    const eventIds = [...new Set(claims.map(claim => claim.event_id))];
    const served = new Set((await Promise.all(eventIds.map(async eventId =>
      (config.publishedEvent ? await config.publishedEvent(eventId) : eventId === config.eventId) ? eventId : null)))
      .filter((eventId): eventId is string => eventId !== null));
    const claimSummaries = await Promise.all(claims.map(async claim => {
      const circle = served.has(claim.event_id) ? await lookupCircle(claim.circle_id, claim.event_id) : null;
      return {
        id: claim.id, eventId: claim.event_id, eventName: getEventDefinition(claim.event_id)?.name ?? claim.event_id,
        circleId: claim.circle_id, circleName: claim.circle_name_at_claim, status: claim.status, createdAt: claim.created_at,
        detailHref: circle
          ? `/admin?section=circles&view=search&event=${encodeURIComponent(claim.event_id)}&circle=${encodeURIComponent(claim.circle_id)}` : null,
        reviewHref: served.has(claim.event_id) && claim.status === "pending"
          ? `/admin?section=circles&view=claims&event=${encodeURIComponent(claim.event_id)}&claim=${encodeURIComponent(claim.id)}` : null,
      };
    }));
    const result: AdminAccountDetailResponse = {
      email,
      account: {
        email: account.email,
        status: account.deletion_started_at !== null ? "deleting" : account.disabled_at !== null ? "disabled" : "active",
        createdAt: account.created_at, disabledAt: account.disabled_at, deletionStartedAt: account.deletion_started_at,
        isAdmin: !!account.is_admin,
        organizerGrants: organizerGrants.map(candidate => ({
          candidateId: candidate.id, eventId: candidate.event_id, name: candidate.tentative_name,
          edition: candidate.edition, role: candidate.role,
          membersHref: `/organizer?candidate=${encodeURIComponent(candidate.id)}&section=members`,
        })),
        claims: claimSummaries,
      },
    };
    return json(result);
  }

  /** Finds accounts through their claims: a partial match on the normalized circle name, across events. */
  async function adminSearchAccountsByCircle(request: Request) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;
    const query = (new URL(request.url).searchParams.get("circle") ?? "").normalize("NFKC").trim();
    if (!query) return json({ error: "請填寫社團名稱。" }, 400);
    if (query.length > 100) return json({ error: "社團名稱不可超過 100 字。" }, 400);
    const rows = await repository.searchClaimAccountsForAdmin(normalizeCircleName(query), ACCOUNT_SEARCH_LIMIT);
    return json({ query, matches: rows.map(row => ({
      email: row.email, circleName: row.circle_name_at_claim, eventId: row.event_id,
      eventName: getEventDefinition(row.event_id)?.name ?? row.event_id, status: row.status,
    })) } satisfies AdminAccountCircleSearchResponse);
  }

  async function adminDisableAccount(request: Request) {
    const gate = await requireAdmin(request);
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
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;
    return applyTakedown(request, gate.session, "admin", config.eventId);
  }

  async function adminSearchTakedownCircles(request: Request) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;
    return searchTakedownCircles(request, config.eventId);
  }

  async function adminCircleDetail(request: Request, circleId: string) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;
    const eventId = config.eventId;
    const circle = await lookupCircle(circleId, eventId);
    if (!circle) return json({ error: "找不到這個活動的社團。" }, 404);

    const phase = await currentPhase();
    const [override, publicOverride, claims, history, candidate, records] = await Promise.all([
      repository.getOverride(eventId, circleId),
      repository.getPublicOverride(eventId, circleId, phase),
      repository.listCircleClaimsForAdmin(eventId, circleId),
      repository.listCircleModerationHistory(eventId, circleId),
      repository.getOrganizerModerationCandidateForEvent(eventId),
      projectCircle(circleId, null),
    ]);
    if (!records) return json({ error: "找不到這個活動的社團。" }, 404);
    const placements = (records as CircleViewRecord[]).map(({ placement }) => ({
      day: placement.day, area: placement.area, boothCode: placement.boothCode, status: placement.status,
    }));
    let cleanupState: AdminCircleDetail["supplemental"]["cleanupState"] = "not_required";
    if (override?.status === "takendown") {
      cleanupState = "unknown";
      if (thumbnailStore) {
        try {
          cleanupState = (await thumbnailStore.list(circleObjectPrefix(eventId, circleId))).length ? "pending" : "complete";
        } catch { /* Image availability does not turn known content into unknown content. */ }
      }
    }
    const reviewer = (value: string | null) => value === "[shredded]" ? null : value;
    const result: AdminCircleDetail = {
      eventId, circleId: circle.id, name: circle.name, placements,
      publicHref: placements.length ? `/events/${encodeURIComponent(eventId)}/circles/${encodeURIComponent(circle.id)}/` : null,
      organizerHref: candidate ? `/organizer?candidate=${encodeURIComponent(candidate.id)}` : null,
      claims: claims.map(claim => ({
        id: claim.id, status: claim.status, method: claim.method, accountEmail: claim.account_email,
        accountStatus: !claim.account_id ? "deleted" : claim.deletion_started_at !== null ? "deleting"
          : claim.disabled_at !== null ? "disabled" : "active",
        createdAt: claim.created_at, verifiedAt: claim.verified_at, reviewedAt: claim.reviewed_at,
        reviewedBy: reviewer(claim.reviewed_by),
        reviewHref: claim.status === "pending"
          ? `/admin?section=circles&view=claims&event=${encodeURIComponent(eventId)}&claim=${encodeURIComponent(claim.id)}` : null,
      })),
      supplemental: {
        status: (override?.status ?? "none") as AdminCircleDetail["supplemental"]["status"],
        fields: override ? JSON.parse(override.fields_json) as CircleOverrideFields : null,
        updatedAt: override?.updated_at ?? null, postEventHidden: !!override?.post_event_hidden,
        publicState: publicOverride ? "public" : "hidden",
        publicReason: publicOverride ? null : !override ? "no_content" : override.status === "takendown" ? "takendown"
          : !claims.some(claim => claim.status === "verified") ? "no_verified_claim"
            : phase === "after" && !!override.post_event_hidden ? "post_event_hidden" : null,
        phase, cleanupState,
        takedown: override?.status === "takendown" ? {
          reason: override.takedown_reason, at: override.takendown_at, by: reviewer(override.takendown_by),
        } : null,
      },
      history: history.map(entry => ({
        action: entry.subject_type === "override" ? "override.takendown"
          : entry.action.endsWith("_approve") ? "claim.approved" : entry.action.endsWith("_reject") ? "claim.rejected" : "claim.revoked",
        at: entry.at, claimId: entry.subject_type === "claim" ? entry.subject_id : null,
        reason: entry.reason, by: entry.actor_email, retryCleanup: !!entry.retry_cleanup,
      })),
    };
    return json(result);
  }

  async function searchTakedownCircles(request: Request, eventId: string) {
    const query = (new URL(request.url).searchParams.get("q") ?? "").normalize("NFKC").trim();
    if (!query) return json({ circles: [] });
    if (query.length > 100) return json({ error: "社團名稱不可超過 100 字。" }, 400);
    const matches = await searchCircles(query, SEARCH_LIMIT, eventId);
    const circles = await Promise.all(matches.map(async circle => {
      const override = await repository.getOverride(eventId, circle.id);
      const cleanupPending = override?.status === "takendown" && thumbnailStore
        ? (await thumbnailStore.list(circleObjectPrefix(eventId, circle.id))).length > 0 : false;
      const claimId = await repository.verifiedClaimId(eventId, circle.id);
      return { circleId: circle.id, name: circle.name, status: override?.status ?? "none", ...(cleanupPending ? { cleanupPending: true } : {}),
        ...(claimId ? { verifiedClaimId: claimId } : {}) };
    }));
    return json({ circles });
  }

  async function applyTakedown(request: Request, session: { accountId: string; email: string },
    actorRole: "admin" | "organizer_owner", eventId: string,
    authority?: { candidateId: string; accountId: string }) {

    const body = await readJson(request);
    const circleId = typeof body?.circleId === "string" ? body.circleId : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!circleId || !reason) return json({ error: "請選擇社團並填寫撤下原因。" }, 400);
    if (authority && !await lookupCircle(circleId, eventId)) return json({ error: "找不到這個活動的社團。" }, 404);

    const now = config.now();
    const previous = await repository.getOverride(eventId, circleId);
    if (!previous) return json({ error: "這個社團目前沒有上線中的補充資料。" }, 404);
    if ((previous?.hosted_thumbnail_key || hasCatalogImages(previous)) && !thumbnailStore) return json({ error: "暫時無法使用圖片功能，請稍後再試。" }, 503);
    const keys = thumbnailStore ? await thumbnailStore.list(circleObjectPrefix(eventId, circleId)) : [];
    const retryCleanup = previous.status === "takendown";
    if (previous.status !== "live" && !(retryCleanup && keys.length)) return json({ error: "這個社團目前沒有上線中的補充資料。" }, 404);
    // Withdraw and clear media references only after the conditional write
    // confirms current authority and the content we actually inspected.
    const fieldsJson = previous?.hosted_thumbnail_key || hasCatalogImages(previous)
      ? JSON.stringify({
        ...(JSON.parse(previous!.fields_json) as CircleOverrideFields),
        ...(previous!.hosted_thumbnail_key ? { thumbnail: null } : {}),
        ...(hasCatalogImages(previous) ? { catalogImages: [] } : {}),
      })
      : undefined;
    const ok = await repository.takedownOverride({ eventId, circleId, reason, by: session.email, now, fieldsJson,
      authority, expected: { updatedAt: previous.updated_at, fieldsJson: previous.fields_json }, retryCleanup });
    if (ok) {
      const published = config.publishedEvent ? await config.publishedEvent(eventId)
        : { dataUpdatedAt: await dataUpdatedAt(), eventEndsAt: await eventEndsAt() };
      if (published) await repository.rebuildOverridesDoc(eventId, published.dataUpdatedAt, now,
        now > Date.parse(published.eventEndsAt) ? "after" : "during");
    }
    await repository.writeAudit({
      at: now, actorAccountId: session.accountId, actorRole, action: authority ? "override.organizer_takendown" : "override.takendown",
      subjectType: "override", subjectId: circleId, detail: { eventId, reason, applied: ok, retryCleanup,
        ...(authority ? { candidateId: authority.candidateId } : {}) },
      ipHash: await clientIpHash(request),
    });
    if (ok) {
      try { if (thumbnailStore) await deleteObjectKeys(thumbnailStore, keys); }
      catch { return json({ error: "補充資料已撤下，部分圖片尚未刪除。請再次確認撤下以完成清除。" }, 503); }
      return json({ ok: true });
    }
    return json({ error: "補充資料已更新或撤下，請重新搜尋後再操作。" }, 409);
  }

  return {
    requireAdmin,
    moderation: { decideReviewClaim, applyTakedown, searchTakedownCircles },
    routes: {
      ...createAdminReferenceHandlers(repository, requireAdmin, config.now),
      adminGetSiteSettings, adminUpdateSiteSettings, adminRequestServiceCheck,
      adminListAdmins, adminManageAdmins, adminAccountDetail, adminSearchAccountsByCircle, adminDisableAccount,
      // Cross-event and read-only; it filters to served events itself.
      adminReviewQueue,
      // Event-scoped: each answers only for the event the request named.
      adminListClaims: eventScoped(adminListClaims),
      adminDecideClaim: eventScoped(adminDecideClaim),
      adminTakedown: eventScoped(adminTakedown),
      adminSearchTakedownCircles: eventScoped(adminSearchTakedownCircles),
      adminCircleDetail: eventScoped(adminCircleDetail),
    },
  };
}

export type Admin = ReturnType<typeof createAdmin>;
