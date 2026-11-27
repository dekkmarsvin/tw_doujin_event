import { eventNoticeInputProblem, parseEventNoticeInput, type EventNotice } from "../app/event-notice";
import { canSubmitEventApplication } from "../app/site-settings";
import { eventDayDate } from "../app/event-calendar";
import { parseOrganizerApplication, type OrganizerApplication, type OrganizerApplicationInput } from "../app/organizer-applications";
import { organizerInvitationLetter } from "../app/mail-letter";
import { mailFailure } from "../app/portal-mail";
import { isEmailShaped, normalizeEmail, randomToken, sha256Hex } from "../app/portal-crypto";
import type { IdentityRepository } from "../db/identity-repository";
import { emailAuditSubjectId, LOGIN_LIMITS, LOGIN_TOKEN_TTL_MS } from "./auth";
import { json, readJson } from "./http";
import { createEventScope } from "./event-scope";
import {
  createEmptyOrganizerEventDraft, organizerPendingVenueSelections, parseOrganizerEventDraft, serializeOrganizerEventDraft,
} from "../app/organizer-event";
import {
  evaluateOrganizerWorkspaceReadiness, isOrganizerGuidedTask, isOrganizerWorkspaceSection, organizerWorkspaceSectionOrDefault, organizerOnboardingIssues,
} from "../app/organizer-workspace";
import { projectReferenceCatalog, validateOrganizerReferences } from "../app/organizer-reference-catalog";
import { validateOrganizerVenueCatalogAssignments } from "../app/organizer-venue-catalog";
import type { Auth } from "./auth";
import type { PortalDependencies } from "../app/circle-portal-handlers";
import type { Admin } from "./admin";
import { createOrganizerContent } from "./organizer-content";
import { createOrganizerPublication } from "./organizer-publication";

/**
 * Organizer module (#546 phase 5): event applications, organizer candidates
 * and their workspace, collaborators and invitations, and an Owner's
 * moderation of their own published event. Draft content and publication live
 * in organizer-content.ts and organizer-publication.ts.
 */

const LIMITS = {
  organizerInvitesPerActorPerHour: 10,
  organizerInvitesPerEmailPerHour: 3,
};

/** Who may act on a candidate: its own grant, or any admin for inspection. */
export function createOrganizerAccess(dependencies: Pick<PortalDependencies, "repository">, auth: Auth) {
  const { repository } = dependencies;
  const { isAdmin, currentSession } = auth;

  async function organizerAccess(request: Request, candidateId: string) {
    const current = await currentSession(request);
    if (!current) return { ok: false as const, response: json({ error: "尚未登入。" }, 401) };
    // Neither lookup needs the other's answer, and this runs ahead of every
    // organizer request, so serialising them charged one avoidable round trip
    // to each of the three calls a single save makes.
    const [admin, grantRole] = await Promise.all([
      isAdmin(current.email),
      repository.organizerRole(candidateId, current.accountId),
    ]);
    // An admin may also be this event's Owner. Preserve that event role so the
    // submit and approve actions can remain distinct and self-approval can be
    // audited, while an unassigned admin still gets global inspection access.
    const role = grantRole ?? (admin ? "admin" as const : null);
    if (!role) return { ok: false as const, response: json({ error: "找不到活動。" }, 404) };
    return { ok: true as const, current, admin, role };
  }

  const organizerAuditRole = (access: { admin: boolean }) => access.admin ? "admin" as const : "organizer_owner" as const;

  return { organizerAccess, organizerAuditRole };
}

export type OrganizerAccess = ReturnType<typeof createOrganizerAccess>;

export function createOrganizer(dependencies: PortalDependencies, auth: Auth, admin: Admin) {
  const { publishApprovedEvent, repository, sendMail, mailRecipientAllowed, config } = dependencies;
  const { isAdmin, clientIpHash, currentSession } = auth;
  const { requireAdmin, moderation: { decideReviewClaim, applyTakedown, searchTakedownCircles } } = admin;
  const { dataUpdatedAt, eventEndsAt } = createEventScope(config);
  const access = createOrganizerAccess(dependencies, auth);
  const { organizerAccess, organizerAuditRole } = access;
  const content = createOrganizerContent(dependencies, auth, access);
  const { validateOrganizerWorkspace, eventImageChangeProblem } = content;
  const publication = createOrganizerPublication(dependencies, auth, admin, access, content);

  async function canApplyForEvent(email: string) {
    return canSubmitEventApplication(await repository.getSiteSettings(), email);
  }

  function applicationResponse(row: NonNullable<Awaited<ReturnType<IdentityRepository["getOrganizerApplication"]>>>, admin: boolean): OrganizerApplication {
    const data = JSON.parse(row.data_json) as Partial<OrganizerApplicationInput>;
    return {
      name: "已刪除帳號的申請", officialUrl: "", startDate: "", endDate: "", location: "", relationship: "curator", note: "",
      ...data, id: row.id, status: row.status, createdAt: row.created_at, reviewedAt: row.reviewed_at,
      reason: row.reason, candidateId: admin || row.applicant_role ? row.candidate_id : null,
      ...(admin ? { applicantEmail: row.applicant_email } : {}),
    };
  }

  async function listEventApplications(request: Request) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    const admin = await isAdmin(current.email);
    const applications = await repository.listOrganizerApplications(current.accountId, admin);
    return json({ applications: applications.map((row) => applicationResponse(row, admin)), canApply: await canApplyForEvent(current.email) });
  }

  async function submitEventApplication(request: Request) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    if (!await canApplyForEvent(current.email)) return json({ error: "活動申請尚未開放。" }, 403);
    const body = await readJson(request);
    const data = parseOrganizerApplication(body?.application);
    if (!data || typeof body?.id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.id)
      || Object.keys(body).some((key) => !["id", "application"].includes(key))) {
      return json({ error: "請填寫活動名稱、有效的官方 HTTPS 網址、日期與申請身分；資料整理者請補充整理理由。" }, 400);
    }
    const result = await repository.submitOrganizerApplication({ id: body.id, accountId: current.accountId, data, now: config.now() });
    return result ? json({ application: applicationResponse(result, await isAdmin(current.email)) }, 201)
      : json({ error: "申請內容或帳號狀態已變更，請重新整理後確認送件結果。" }, 409);
  }

  async function reviewEventApplication(request: Request, applicationId: string) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;
    const body = await readJson(request);
    if (!body || !["approved", "rejected"].includes(String(body.decision)) || typeof body.reason !== "string"
      || body.reason.length > 1000 || (body.decision === "rejected" && !body.reason.trim())
      || Object.keys(body).some((key) => !["decision", "reason"].includes(key))) return json({ error: "請選擇核准或拒絕；拒絕時須填寫理由。" }, 400);
    const result = await repository.reviewOrganizerApplication({ id: applicationId, decision: body.decision as "approved" | "rejected",
      reason: body.reason.trim(), reviewerAccountId: gate.session.accountId, sessionId: gate.session.sessionId,
      now: config.now(), ipHash: await clientIpHash(request) });
    return result ? json({ application: applicationResponse(result, true) })
      : json({ error: "申請、帳號或審核權限已變更，請重新讀取申請。" }, 409);
  }

  async function organizerClaimAccess(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access;
    const eventId = await repository.getOrganizerModerationEventId(candidateId);
    if (!eventId || !(config.publishedEvent ? await config.publishedEvent(eventId) : eventId === config.eventId)) {
      return { ok: false as const, response: json({ error: "此活動尚未公開社團認領。" }, 404) };
    }
    return { ...access, eventId };
  }

  async function organizerListClaims(request: Request, candidateId: string) {
    const access = await organizerClaimAccess(request, candidateId);
    if (!access.ok) return access.response;
    const claims = await repository.listPendingEventClaims(access.eventId);
    return json({ pendingClaimCount: claims[0]?.pending_count ?? 0, claims: claims.map(claim => ({
      id: claim.id, eventId: claim.event_id, circleId: claim.circle_id, circleName: claim.circle_name_at_claim,
      evidenceUrl: claim.evidence_url, evidenceNote: claim.evidence_note, targetUrl: claim.target_url,
      createdAt: claim.created_at, circleClaimed: !!claim.circle_claimed,
    })), organizer: { applications: 0, submissions: 0 } });
  }

  async function readOrganizerNotice(request: Request, candidateId: string) {
    const access = await organizerClaimAccess(request, candidateId);
    if (!access.ok) return access.response;
    return json({ notice: await repository.getEventNotice(access.eventId) });
  }

  async function saveOrganizerNotice(request: Request, candidateId: string) {
    return changeOrganizerNotice(request, candidateId, false);
  }

  async function clearOrganizerNotice(request: Request, candidateId: string) {
    return changeOrganizerNotice(request, candidateId, true);
  }

  async function changeOrganizerNotice(request: Request, candidateId: string, clear: boolean) {
    const access = await organizerClaimAccess(request, candidateId);
    if (!access.ok) return access.response;
    const now = config.now();
    let notice: EventNotice | null = null;
    if (!clear) {
      const body = await readJson(request);
      const problem = eventNoticeInputProblem(body);
      if (problem) return json({ error: problem }, 400);
      const input = parseEventNoticeInput(body)!;
      notice = { kind: input.kind, text: input.text, ...(input.url ? { url: input.url } : {}), updatedAt: new Date(now).toISOString() };
    }
    const applied = await repository.writeEventNotice(access.eventId, notice, { candidateId, accountId: access.current.accountId });
    if (!applied) return json({ error: "找不到活動。" }, 404);
    await repository.writeAudit({
      at: now, actorAccountId: access.current.accountId, actorRole: organizerAuditRole(access),
      action: clear ? "event_notice.cleared" : "event_notice.published", subjectType: "event_notice", subjectId: access.eventId,
      detail: { candidateId, eventId: access.eventId }, ipHash: await clientIpHash(request),
    });
    const published = config.publishedEvent ? await config.publishedEvent(access.eventId)
      : { dataUpdatedAt: await dataUpdatedAt(), eventEndsAt: await eventEndsAt() };
    if (published) await repository.rebuildOverridesDoc(access.eventId, published.dataUpdatedAt, now,
      now > Date.parse(published.eventEndsAt) ? "after" : "during");
    return json({ notice });
  }

  async function organizerDecideClaim(request: Request, candidateId: string) {
    const access = await organizerClaimAccess(request, candidateId);
    if (!access.ok) return access.response;
    const response = await decideReviewClaim(request, access.current, organizerAuditRole(access), access.eventId,
      { candidateId, accountId: access.current.accountId });
    return response.status === 409 ? organizerRaceResponse(request, candidateId, access.eventId, response, "找不到這筆認領。") : response;
  }

  /** A conditional write lost: the grant may have gone meanwhile, which outranks the conflict. */
  async function organizerRaceResponse(request: Request, candidateId: string, eventId: string, conflict: Response, missing: string) {
    const access = await organizerClaimAccess(request, candidateId);
    if (!access.ok) return access.response;
    if (access.eventId !== eventId) return json({ error: missing }, 404);
    return conflict;
  }

  async function organizerSearchTakedownCircles(request: Request, candidateId: string) {
    const access = await organizerClaimAccess(request, candidateId);
    if (!access.ok) return access.response;
    return searchTakedownCircles(request, access.eventId);
  }

  async function organizerTakedown(request: Request, candidateId: string) {
    const access = await organizerClaimAccess(request, candidateId);
    if (!access.ok) return access.response;
    const response = await applyTakedown(request, access.current, organizerAuditRole(access), access.eventId,
      { candidateId, accountId: access.current.accountId });
    return response.status === 409 ? organizerRaceResponse(request, candidateId, access.eventId, response, "找不到這個活動的社團。") : response;
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
      && byIp < LOGIN_LIMITS.perIpPerHour
      && byActor < LIMITS.organizerInvitesPerActorPerHour;
  }

  async function sendOrganizerInvitation(email: string, now: number, ipHash: string | null, mintedBy: string,
    context: { eventName: string; inviterRole: "admin" | "owner" }) {
    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = now + LOGIN_TOKEN_TTL_MS;
    await repository.createLoginToken({
      tokenHash, email, now,
      expiresAt, ipHash, audience: "organizer", mintedBy,
    });
    try {
      await sendMail({
        purpose: "organizer_invitation",
        to: email,
        ...organizerInvitationLetter({
          ...context,
          href: `${config.origin}/organizer?login=${encodeURIComponent(token)}`,
          origin: config.origin, requestedAt: now, expiresAt,
        }),
      });
    } catch (error) {
      await repository.deleteLoginToken(tokenHash);
      throw error;
    }
  }

  async function adminCreateOrganizerCandidate(request: Request) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;
    const body = await readJson(request);
    const tentativeName = typeof body?.tentativeName === "string" ? body.tentativeName.normalize("NFKC").trim() : "";
    const ownerEmail = typeof body?.ownerEmail === "string" ? normalizeEmail(body.ownerEmail) : "";
    if (!tentativeName || tentativeName.length > 120 || !isEmailShaped(ownerEmail)) {
      return json({ error: "暫定活動名稱與有效的成員 Email 為必填。" }, 400);
    }
    // Asked before the candidate exists. The invitation is the only way the
    // owner reaches this workspace, so an address this environment cannot write
    // to produces a candidate nobody can open.
    if (mailRecipientAllowed && !mailRecipientAllowed(ownerEmail)) {
      return json({ error: "這個測試環境不會寄信到這個地址。" }, 400);
    }
    const ipHash = await clientIpHash(request);
    if (!await organizerInvitationAllowed(ownerEmail, gate.session.accountId, ipHash, config.now())) {
      return json({ error: "邀請寄送過於頻繁，請稍後再試。" }, 429);
    }
    const candidateId = crypto.randomUUID();
    const draft = createEmptyOrganizerEventDraft(tentativeName);
    const createdAt = config.now();
    // An admin who names themselves the owner is granted it here, in the same
    // transaction as the candidate. Only admins may add Owners, so the round
    // trip through the mailbox added no guarantee — it only left the creator on
    // the `admin` event role, which renders no submit control at all.
    const selfOwned = ownerEmail === normalizeEmail(gate.session.email);
    const created = await repository.createOrganizerCandidate({
      id: candidateId, tentativeName, ownerEmail,
      createdByAccountId: gate.session.accountId,
      draftJson: JSON.stringify(draft), now: createdAt,
      ownerGrant: selfOwned ? { accountId: gate.session.accountId, audit: {
        at: createdAt, actorAccountId: gate.session.accountId, actorRole: "admin",
        action: "organizer_event.owner_granted_on_create", subjectType: "organizer_event",
        subjectId: candidateId, detail: { tentativeName, reason: "creator_is_owner" }, ipHash,
      } } : null,
    });
    if (!created.ok) return json({ error: "無法建立活動，請重新整理後再試。" }, 409);
    // The candidate exists from here on, so its audit row is written before
    // anything that can still fail. Recording creation only after the mail went
    // out left a candidate nobody could trace back to whoever made it.
    await repository.writeAudit({
      at: config.now(), actorAccountId: gate.session.accountId, actorRole: "admin",
      action: "organizer_event.created", subjectType: "organizer_event", subjectId: candidateId,
      detail: { tentativeName }, ipHash,
    });
    // A failed invitation does not undo the activity. Reporting the whole call
    // as failed made the admin retry and create a second candidate under the
    // same name, because nothing stops two candidates sharing one.
    let invitationDelivery: "sent" | "failed" | "unknown" = "sent";
    try {
      await sendOrganizerInvitation(ownerEmail, config.now(), ipHash, gate.session.accountId,
        { eventName: tentativeName, inviterRole: "admin" });
    } catch (error) {
      const failure = mailFailure(error);
      invitationDelivery = failure.delivery;
      await repository.writeAudit({
        at: config.now(), actorAccountId: gate.session.accountId, actorRole: "admin",
        action: "organizer_event.invitation_failed", subjectType: "organizer_event", subjectId: candidateId,
        detail: { role: "owner", emailHash: await emailAuditSubjectId(config.hashPepper, ownerEmail), errorCode: failure.code }, ipHash,
      });
    }
    return json({ ok: true, candidateId, version: 1, invitationSent: invitationDelivery === "sent", invitationDelivery }, 201);
  }

  async function listOrganizerCandidates(request: Request) {
    const current = await currentSession(request);
    if (!current) return json({ error: "尚未登入。" }, 401);
    const admin = await isAdmin(current.email);
    const events = await repository.listOrganizerCandidatesForAccount(current.accountId, admin);
    const dateRange = (daysJson: string | null, amendmentsJson: string | null) => {
      const days = JSON.parse(daysJson ?? "[]") as { id: string; date: string }[];
      const amendments = new Map((JSON.parse(amendmentsJson ?? "[]") as { id: string; date: string }[])
        .map(day => [day.id, day.date]));
      const dates = days.map(day => amendments.get(day.id) ?? day.date)
        .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && eventDayDate(date, "") !== null).sort();
      return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null;
    };
    return json({ events: events.map((event) => ({
      id: event.id,
      tentativeName: event.tentative_name,
      eventId: event.event_id,
      status: event.status,
      version: event.current_version,
      updatedAt: event.updated_at,
      createdAt: event.created_at,
      edition: event.edition,
      updatedByRole: event.last_updated_role,
      role: event.role,
      isMember: "is_member" in event ? Boolean(event.is_member) : true,
      operation: event.publication_operation,
      workspaceMode: event.workspace_mode,
      ...(admin && "event_days_json" in event ? { dateRange: dateRange(event.event_days_json, event.amendment_days_json) } : {}),
    })) });
  }

  async function getOrganizerCandidate(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const candidate = await repository.getOrganizerCandidate(candidateId);
    if (!candidate) return json({ error: "找不到活動。" }, 404);
    const draft = parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown);
    if (!draft) return json({ error: "活動資料格式無效，請聯絡網站管理者。" }, 500);
    const [revisions, workspace, workspaceValidation] = await Promise.all([
      repository.listOrganizerCandidateRevisions(candidateId),
      repository.getOrganizerWorkspace(candidateId, access.current.accountId),
      validateOrganizerWorkspace(candidateId, draft),
    ]);
    if (!workspace) return json({ error: "找不到活動工作區。" }, 404);
    // The validation pass already loaded the venue catalogue to check the
    // assignments against it. Reading it a second time here billed the same
    // two queries to every detail read the workspace makes, which is one per
    // save on top of the save's own.
    const venueCatalog = workspaceValidation.venueCatalog;
    const { imported, maps, issues: validationIssues } = workspaceValidation;
    const guidedTask = isOrganizerGuidedTask(workspace.preference?.guided_task)
      ? workspace.preference.guided_task : "identity_source";
    const section = organizerWorkspaceSectionOrDefault(workspace.preference?.last_section);
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
        operation: candidate.publication_operation,
        status: candidate.status,
        version: candidate.current_version,
        updatedAt: candidate.updated_at,
        updatedByRole: candidate.last_updated_role,
        role: access.role,
      },
      draft,
      venueCatalog,
      referenceCatalog: workspaceValidation.referenceCatalog,
      missingVenueReferences: workspaceValidation.missingVenueReferences,
      missingVenueAddresses: workspaceValidation.missingVenueAddresses,
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
          areaId: row.area_id, codes: row.codes, circleName: row.circle_name,
          stableKey: row.stable_key, identityGroup: row.identity_group,
        })),
      } : null,
      publicationAvailable: Boolean(publishApprovedEvent),
      claimReviewAvailable: Boolean(candidate.event_id && (config.publishedEvent
        ? await config.publishedEvent(candidate.event_id) : candidate.event_id === config.eventId)),
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
    // Three independent reads the checks below consume in turn. Loading them
    // together keeps the order the refusals are decided in — the amendment
    // guard still answers before a malformed body does — while costing one
    // round trip instead of three on the path a save always takes.
    const [candidate, venueCatalog, referenceRecords] = await Promise.all([
      repository.getOrganizerCandidate(candidateId),
      repository.listOrganizerVenueCatalog(),
      repository.listOrganizerReferenceRecords(),
    ]);
    if (candidate?.publication_operation === "AMEND") {
      return json({ error: "已發布修正保留基準活動設定，請使用明確修正宣告。", code: "amendment_declaration_required" }, 409);
    }
    const body = await readJson(request);
    const expectedVersion = body?.expectedVersion;
    const serialized = serializeOrganizerEventDraft(body?.draft);
    if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1 || !serialized) {
      return json({ error: "活動資料格式無效，請重新載入後再試。" }, 400);
    }
    // Two refusals in one list, and they are not the same refusal: a row still
    // waiting on a choice, and a row whose choice no longer resolves (#222).
    const venueIssues = [
      ...organizerPendingVenueSelections(serialized.draft),
      ...validateOrganizerVenueCatalogAssignments(serialized.draft.venue.assignments, venueCatalog),
    ];
    if (venueIssues.length > 0) {
      return json({ error: venueIssues[0].message, issues: venueIssues }, 422);
    }
    const referenceIssues = validateOrganizerReferences(serialized.draft,
      projectReferenceCatalog(referenceRecords), false);
    if (referenceIssues.length) return json({ error: referenceIssues[0].message, issues: referenceIssues }, 422);
    const previousImage = candidate ? parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown)?.event.image : undefined;
    const imageProblem = await eventImageChangeProblem(candidateId, previousImage, serialized.draft.event.image);
    if (imageProblem) return json({ error: imageProblem.error }, imageProblem.status);
    const result = await repository.saveOrganizerCandidate({
      candidateId, actorAccountId: access.current.accountId,
      expectedVersion: expectedVersion as number,
      eventId: serialized.draft.event.id,
      draftJson: serialized.json,
      now: config.now(), admin: access.admin,
    });
    if (!result.ok) {
      if (result.reason === "not_found" || result.reason === "forbidden") return json({ error: "找不到活動。" }, 404);
      const message = result.reason === "event_id_locked" ? `活動代碼已鎖定為 ${result.eventId}。`
        : result.reason === "event_id_taken" ? "活動代碼已被其他活動使用。"
          : result.reason === "status" ? "目前狀態不可編輯。"
            : "草稿已被其他人更新，請重新載入。";
      return json({ error: message, conflict: result }, 409);
    }
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId,
      actorRole: organizerAuditRole(access),
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
    const issues = [
      ...organizerOnboardingIssues(draft),
      ...validateOrganizerVenueCatalogAssignments(draft.venue.assignments, await repository.listOrganizerVenueCatalog()),
    ];
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
        actorRole: organizerAuditRole(access),
        action: "organizer_event.onboarding_completed", subjectType: "organizer_event", subjectId: candidateId,
        detail: { version: expectedVersion }, ipHash: await clientIpHash(request),
      });
    }
    return json({ ok: true, mode: "binder", onboardingCompletedAt: result.completedAt });
  }

  async function manageOrganizerCollaborators(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    const action = body?.action;
    if (!isEmailShaped(email) || (action !== "invite" && action !== "resend" && action !== "revoke")) {
      return json({ error: "Email 與動作（邀請／重寄／移除）為必填。" }, 400);
    }
    const candidate = await repository.getOrganizerCandidate(candidateId);
    if (!candidate) return json({ error: "找不到活動。" }, 404);
    const ipHash = await clientIpHash(request);
    if (action !== "revoke" && mailRecipientAllowed && !mailRecipientAllowed(email)) {
      return json({ error: "這個測試環境不會寄信到這個地址。" }, 400);
    }
    if (action !== "revoke" && !await organizerInvitationAllowed(email, access.current.accountId, ipHash, config.now())) {
      return json({ error: "邀請寄送過於頻繁，請稍後再試。" }, 429);
    }
    const result = await repository.manageOrganizerOwner({
      candidateId, actorAccountId: access.current.accountId, email, action, now: config.now(),
    });
    if (!result.ok) {
      const error = result.reason === "forbidden" ? "只有這個活動的成員或網站管理者可以管理成員。"
        : result.reason === "last_owner" ? "每個活動至少需要一位成員。"
        : result.reason === "pending" ? "這個信箱已有待接受的邀請，請按「重寄邀請信」。"
        : result.reason === "active" ? "這個信箱已是活動成員，不需要再邀請。"
        : result.reason === "not_pending" ? "找不到這個信箱的待接受邀請，無法重寄。" : "成員狀態沒有變更。";
      return json({ error }, result.reason === "forbidden" ? 403 : 409);
    }
    const audit = {
      at: config.now(), actorAccountId: access.current.accountId,
      actorRole: access.admin ? "admin" as const : "organizer_owner" as const,
      action: `organizer_event.owner_${action}`, subjectType: "organizer_event", subjectId: candidateId,
      detail: { role: "owner", emailHash: await emailAuditSubjectId(config.hashPepper, email) }, ipHash,
    };
    if (action !== "resend") await repository.writeAudit(audit);
    if (action === "revoke") return json({ ok: true, result: result.result });
    let invitationDelivery: "sent" | "failed" | "unknown" = "sent";
    try {
      await sendOrganizerInvitation(email, config.now(), ipHash, access.current.accountId,
        // The letter names who is inviting: an admin acting without this
        // event's member grant is the site, not one of the event's members.
        { eventName: candidate.tentative_name, inviterRole: access.role === "admin" ? "admin" : "owner" });
    } catch (error) {
      const failure = mailFailure(error);
      invitationDelivery = failure.delivery;
      await repository.writeAudit({ ...audit, action: "organizer_event.invitation_failed",
        detail: { ...audit.detail, action, errorCode: failure.code } });
    }
    if (action === "resend" && invitationDelivery === "sent") await repository.writeAudit(audit);
    return json({ ok: true, result: result.result, invitationSent: invitationDelivery === "sent", invitationDelivery });
  }

  return {
    // Candidate-scoped: an organizer candidate is addressed by candidateId and
    // exists before any event is published, so `eventScoped` — which demands a
    // published event this deployment serves — would refuse every one of them.
    // Authority comes from the candidate's own grant, checked in each handler.
    routes: {
      listEventApplications, submitEventApplication, reviewEventApplication, adminCreateOrganizerCandidate,
      listOrganizerCandidates, getOrganizerCandidate, updateOrganizerCandidate, organizerListClaims,
      organizerDecideClaim, organizerSearchTakedownCircles, organizerTakedown, readOrganizerNotice,
      saveOrganizerNotice, clearOrganizerNotice, updateOrganizerWorkspacePreference, completeOrganizerWorkspaceOnboarding,
      manageOrganizerCollaborators,
      ...content.routes,
      ...publication.routes,
    },
  };
}
