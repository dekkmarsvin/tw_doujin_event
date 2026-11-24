import { sha256Hex } from "../app/portal-crypto";
import { json, readJson } from "./http";
import { parseOrganizerEventDraft } from "../app/organizer-event";
import { PublicationFailure } from "../app/organizer-publication";
import { buildApprovedPublicationArtifacts } from "../app/publication-artifacts";
import { AmendmentBaselineError, planOrganizerAmendmentCandidate, type OrganizerAmendmentBaseline } from "../app/organizer-amendment-baseline";
import {
  AmendmentSettingsError, amendmentSettingsImpact, normalizeAmendmentSettings, approvedEventDraft, type OrganizerAmendmentSettings,
} from "../app/organizer-amendment-settings";
import type { Auth } from "./auth";
import type { PortalDependencies } from "../app/circle-portal-handlers";
import type { Admin } from "./admin";
import type { OrganizerAccess } from "./organizer";
import type { OrganizerContent } from "./organizer-content";

/**
 * Organizer publication (#546 phase 5): submitting a candidate, the admin
 * review that publishes it, retrying a publication, reopening, and amending a
 * published event. Part of the organizer module, split off to keep each file small.
 */

export function createOrganizerPublication(dependencies: PortalDependencies, auth: Auth, admin: Admin,
  { organizerAccess }: OrganizerAccess, { readAmendment, validateOrganizerWorkspace, eventImageChangeProblem, pruneStagedEventImages, publishEventImage }: OrganizerContent) {
  const { loadPublishedAmendmentBaseline, dispatchOrganizerPublication, repository, publicationAuditor, config } = dependencies;
  const { clientIpHash, currentSession } = auth;
  const { requireAdmin } = admin;

  async function createOrganizerAmendment(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    if (!Number.isSafeInteger(body?.expectedVersion) || Object.keys(body!).some((key) => key !== "expectedVersion")) {
      return json({ error: "請從目前已發布版本開始修正，不能自行指定基準內容。" }, 400);
    }
    const candidate = await repository.getOrganizerCandidate(candidateId);
    const job = await repository.getLatestOrganizerPublicationJob(candidateId);
    if (!candidate || candidate.status !== "published" || candidate.current_version !== body!.expectedVersion
      || candidate.published_version !== candidate.current_version || job?.status !== "published"
      || job.candidate_version !== candidate.current_version || !job.data_merge_sha || !job.main_merge_sha) {
      return json({ error: "活動尚未發布或版本已變更，請重新載入。" }, 409);
    }
    const snapshot = await repository.getOrganizerSubmissionSnapshot(candidateId, candidate.current_version);
    if (!snapshot || snapshot.id !== job.snapshot_id || snapshot.sha256 !== job.approval_hash) return json({ error: "已發布核准內容不一致。" }, 409);
    if (!loadPublishedAmendmentBaseline) return json({ error: "目前無法讀取已發布修正基準。" }, 503);
    const now = config.now();
    let baseline: OrganizerAmendmentBaseline;
    try {
      baseline = await loadPublishedAmendmentBaseline({ candidateId, candidateVersion: candidate.current_version,
        jobId: job.id, snapshotId: snapshot.id, approvalHash: snapshot.sha256, snapshotJson: snapshot.snapshot_json,
        dataCommit: job.data_merge_sha, mainCommit: job.main_merge_sha, publishedAt: candidate.published_at! });
    } catch (error) {
      if (error instanceof AmendmentBaselineError) return json({ error: error.message, code: error.code }, error.status);
      return json({ error: "暫時無法核對公開版本，請稍後再試。", code: "amendment_baseline_unavailable" }, 503);
    }
    const baselineJson = JSON.stringify(baseline);
    const baselineSha256 = await sha256Hex(baselineJson);
    const plan = planOrganizerAmendmentCandidate(baseline, [], () => new Date(now).toISOString().slice(0, 10));
    const result = await repository.createOrganizerAmendment({ id: crypto.randomUUID(), sourceCandidateId: candidateId,
      sourceVersion: candidate.current_version, sourceJobId: job.id, sourceSnapshotId: snapshot.id,
      sourceApprovalHash: snapshot.sha256, sourceMainCommit: job.main_merge_sha, eventId: baseline.event.id,
      draftJson: JSON.stringify(baseline.draft), baselineJson, baselineSha256, rows: plan.rows, maps: baseline.maps,
      actor: { accountId: access.current.accountId, role: access.role, admin: access.admin, now } });
    return result.ok ? json(result, 201) : json({ error: "已有修正候選，或版本／權限已變更。請重新載入活動清單。" }, 409);
  }

  async function getOrganizerAmendment(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const amendment = await readAmendment(candidateId);
    if (!amendment) return json({ error: "找不到修正候選。" }, 404);
    const plan = planOrganizerAmendmentCandidate(amendment.baseline, amendment.changes, () => new Date(config.now()).toISOString().slice(0, 10));
    return json({ version: amendment.stored.current_version, changes: amendment.changes, impact: plan.impact,
      settings: amendment.settings, settingsImpact: amendmentSettingsImpact(amendment.baseline.draft, amendment.settings),
      baseline: { event: amendment.baseline.event, sourceCandidateId: amendment.stored.source_candidate_id,
        sourceVersion: amendment.stored.source_version, publishedAt: amendment.baseline.source.publishedAt,
        official: amendment.baseline.official } });
  }

  async function saveOrganizerAmendment(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    if (!Number.isSafeInteger(body?.expectedVersion) || (body!.expectedVersion as number) < 1 || !Array.isArray(body?.changes)
      || body.changes.length > 20_000 || Object.keys(body!).some((key) => !["expectedVersion", "changes", "settings"].includes(key))) {
      return json({ error: "請提供目前版本與明確修正宣告。" }, 400);
    }
    const changesJson = JSON.stringify(body.changes);
    if (new TextEncoder().encode(changesJson).byteLength > 8 * 1024 * 1024) return json({ error: "修正宣告超過 8 MB。" }, 413);
    const candidate = await repository.getOrganizerCandidate(candidateId);
    if (!candidate || candidate.current_version !== body.expectedVersion || !["draft", "changes_requested"].includes(candidate.status)) {
      return json({ error: "版本或狀態已變更，請重新載入。" }, 409);
    }
    const amendment = await readAmendment(candidateId);
    if (!amendment) return json({ error: "找不到修正候選。" }, 404);
    const now = config.now();
    let plan: ReturnType<typeof planOrganizerAmendmentCandidate>;
    try { plan = planOrganizerAmendmentCandidate(amendment.baseline, body.changes, () => new Date(now).toISOString().slice(0, 10)); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "修正宣告無效。" }, 422); }
    // Whole-state like changes[]: an omitted settings key declares none.
    let settings: OrganizerAmendmentSettings | null;
    try { settings = normalizeAmendmentSettings(amendment.baseline.draft, body.settings); }
    catch (error) {
      return error instanceof AmendmentSettingsError ? json({ error: error.message }, error.status) : json({ error: "活動設定宣告無效。" }, 422);
    }
    const previousImage = amendment.settings?.image ?? undefined;
    const nextImage = settings?.image ?? undefined;
    const imageProblem = await eventImageChangeProblem(candidateId, previousImage, nextImage);
    if (imageProblem) return json({ error: imageProblem.error }, imageProblem.status);
    const settingsJson = settings ? JSON.stringify(settings) : null;
    const result = await repository.saveOrganizerAmendment({ candidateId, expectedVersion: candidate.current_version,
      baselineSha256: amendment.stored.baseline_sha256, changesJson, changesSha256: await sha256Hex(changesJson), rows: plan.rows,
      settingsJson, settingsSha256: settingsJson ? await sha256Hex(settingsJson) : null,
      actor: { accountId: access.current.accountId, role: access.role, admin: access.admin, now } });
    return result.ok
      ? json({ ...result, impact: plan.impact, settings, settingsImpact: amendmentSettingsImpact(amendment.baseline.draft, settings) })
      : json({ error: "版本或權限已變更，修正未儲存。請重新載入。" }, 409);
  }

  async function submitOrganizerCandidate(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    const expectedVersion = body?.expectedVersion;
    if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1) return json({ error: "版本資訊無效，請重新載入。" }, 400);
    const candidate = await repository.getOrganizerCandidate(candidateId);
    if (!candidate) return json({ error: "找不到活動。" }, 404);
    const draft = parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown);
    if (!draft) return json({ error: "活動資料格式無效，請聯絡網站管理者。" }, 500);
    // The snapshot is hashed from the same bytes validation just read, so a
    // second load cannot let the two disagree about what was approved.
    if (candidate.current_version !== expectedVersion) return json({ error: "草稿已被其他人更新，請重新載入。" }, 409);
    const { issues, imported, maps, contents, referenceSnapshot } = await validateOrganizerWorkspace(candidateId, draft);
    if (issues.some((issue) => issue.severity === "error")) return json({ error: "請先修正待修正項目。", issues }, 422);
    if (!referenceSnapshot) return json({ error: "缺少完整的主辦、分類與場館來源記錄。" }, 422);
    const contentRevision = (await repository.listOrganizerCandidateRevisions(candidateId)).find((revision) => revision.version === expectedVersion);
    if (!contentRevision) return json({ error: "找不到目前內容版本，請重新載入。" }, 409);
    const amendment = candidate.publication_operation === "AMEND" ? await readAmendment(candidateId) : null;
    if (candidate.publication_operation === "AMEND" && (!amendment || amendment.stored.current_version !== expectedVersion)) {
      return json({ error: "修正內容已變更，請重新載入。" }, 409);
    }
    const mapSnapshots = maps.map((map) => {
      const stored = contents.get(map.id);
      return {
        id: map.id, periodKey: map.period_key, venueSpaceId: map.venue_space_id,
        mapRevision: map.current_revision,
        content: stored ? JSON.parse(stored) as unknown : null,
      };
    });
    const snapshotJson = JSON.stringify({
      schema: amendment ? "organizer-submission-snapshot/4" : "organizer-submission-snapshot/5", candidateId, candidateVersion: expectedVersion,
      ...(amendment ? { operation: "AMEND", amendment: { baselineJson: amendment.stored.baseline_json,
        baselineSha256: amendment.stored.baseline_sha256, changes: amendment.changes,
        ...(amendment.settings ? { settings: amendment.settings } : {}) } } : {}),
      eventId: draft.event.id, draft,
      contentUpdatedAt: new Date(contentRevision.created_at).toISOString(),
      references: referenceSnapshot,
      import: imported ? {
        source: {
          fileName: imported.source.file_name, worksheet: imported.source.worksheet,
          sha256: imported.source.sha256, sourceDescription: imported.source.source_description,
          mapping: JSON.parse(imported.source.mapping_json) as unknown,
        },
        rows: imported.rows.map((row) => ({
          sourceRow: row.source_row, dayId: row.day_id, venueSpaceId: row.venue_space_id,
          areaId: row.area_id, codes: row.codes, circleName: row.circle_name,
          stableKey: row.stable_key, identityGroup: row.identity_group,
        })),
      } : null,
      maps: mapSnapshots.sort((a, b) => a.periodKey.localeCompare(b.periodKey) || a.venueSpaceId.localeCompare(b.venueSpaceId)),
    });
    const revisionHash = await sha256Hex(snapshotJson);
    if (amendment) {
      try { await buildApprovedPublicationArtifacts({ snapshotJson, approvalHash: revisionHash }); }
      catch (error) {
        if (!(error instanceof PublicationFailure)) throw error;
        return json({ error: error.message, code: error.code }, 422);
      }
    }
    const snapshot = await repository.storeOrganizerSubmissionSnapshot({
      candidateId, candidateVersion: expectedVersion as number, actorAccountId: access.current.accountId,
      snapshotJson, sha256: revisionHash, now: config.now(),
    });
    if (!snapshot.ok) return json({ error: "無法建立送審版本，請重新載入。", conflict: snapshot }, 409);
    const result = await repository.submitOrganizerCandidate({
      candidateId, actorAccountId: access.current.accountId,
      expectedVersion: expectedVersion as number, now: config.now(),
    });
    if (!result.ok) return json({ error: result.reason === "forbidden" ? "只有活動成員或網站管理者可以送審。" : "版本或狀態已變更。", conflict: result }, result.reason === "forbidden" ? 403 : 409);
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId, actorRole: access.role === "owner" ? "organizer_owner" : "admin",
      action: "organizer_event.submitted", subjectType: "organizer_event", subjectId: candidateId,
      detail: { version: expectedVersion, revisionHash }, ipHash: await clientIpHash(request),
    });
    await pruneStagedEventImages(candidateId, approvedEventDraft(JSON.parse(snapshotJson) as Parameters<typeof approvedEventDraft>[0])?.event.image);
    return json({ ok: true, status: result.status, revisionHash });
  }

  async function adminReviewOrganizerCandidate(request: Request, candidateId: string) {
    const gate = await requireAdmin(request);
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
      if (!(await repository.getSiteSettings())?.publicationEnabled) return json({ error: "發布作業已暫停，送審內容會保留。", code: "publication_paused" }, 503);
      if (!dispatchOrganizerPublication || !config.organizerPublicationMode || config.organizerPublicationMode === "disabled") {
        return json({ error: "自動發布尚未通過啟用檢查，目前無法核准並發布。送審內容會保留，請聯絡網站管理者。", code: "publication_unavailable" }, 503);
      }
      if (await sha256Hex(snapshot.snapshot_json) !== snapshot.sha256) {
        return json({ error: "送審內容與記錄不一致，無法核准。", code: "snapshot_mismatch" }, 409);
      }
      if (candidate.publication_operation === "AMEND") {
        try {
          const artifacts = await buildApprovedPublicationArtifacts({ snapshotJson: snapshot.snapshot_json, approvalHash: snapshot.sha256 });
          const amendment = await readAmendment(candidateId);
          const approved = artifacts.snapshot.amendment;
          if (artifacts.operation !== "AMEND" || artifacts.snapshot.candidateId !== candidateId
            || artifacts.snapshot.candidateVersion !== expectedVersion || artifacts.event.id !== candidate.event_id
            || !amendment || amendment.stored.current_version !== expectedVersion
            || approved?.baselineJson !== amendment.stored.baseline_json || approved.baselineSha256 !== amendment.stored.baseline_sha256
            || JSON.stringify(approved.changes) !== amendment.stored.changes_json
            || JSON.stringify(approved.settings ?? null) !== JSON.stringify(amendment.settings)) {
            return json({ error: "修正送審內容與固定基準不一致，無法核准。", code: "snapshot_mismatch" }, 409);
          }
        } catch (error) {
          if (!(error instanceof PublicationFailure)) throw error;
          return json({ error: error.message, code: error.code }, 409);
        }
      }
      if (candidate.status === "submitted") {
        const draft = parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown);
        if (!draft) return json({ error: "活動資料格式無效，請聯絡網站管理者。" }, 500);
        const exists = draft.event.id && (config.publishedEvent
          ? await config.publishedEvent(draft.event.id) : draft.event.id === config.eventId);
        if (exists && candidate.publication_operation !== "AMEND") return json({ error: "這個活動代碼已存在，首次發布不能覆寫。請使用已發布活動修正流程。", code: "event_id_collision" }, 409);
        const { issues } = await validateOrganizerWorkspace(candidateId, draft);
        if (issues.some((issue) => issue.severity === "error")) return json({ error: "這個活動仍有待修正項目。", issues }, 422);
      }
      // Public before the publication names it, and before any state moves:
      // a failed copy leaves the submission exactly where it was. Only a live
      // approval of the version under review may publish it; a replayed
      // approval found it public already, and a stale one must not.
      const image = candidate.status === "submitted" && candidate.current_version === expectedVersion
        ? approvedEventDraft(JSON.parse(snapshot.snapshot_json) as Parameters<typeof approvedEventDraft>[0])?.event.image : undefined;
      if (image && !await publishEventImage(candidateId, image)) {
        return json({ error: "活動圖片暫時無法公開，送審內容已保留，請稍後再核准。", code: "event_image_unavailable" }, 503);
      }
    }
    let publicationJobId: string | null = decision === "approve" ? crypto.randomUUID() : null;
    const result = await repository.reviewOrganizerCandidate({
      candidateId, expectedVersion: expectedVersion as number, decision,
      actorAccountId: gate.session.accountId, note, now: config.now(),
      ...(publicationJobId ? { publication: { jobId: publicationJobId, snapshotId: snapshot.id, approvalHash: snapshot.sha256 } } : {}),
    });
    if (!result.ok) return json({ error: result.reason === "approval_mismatch" ? "既有發布工作與核准內容不一致，請聯絡網站管理者。" : "版本或狀態已變更。", conflict: result }, 409);
    if (result.publicationJobId) publicationJobId = result.publicationJobId;
    if (result.alreadyReviewed) return json({ ok: true,
      status: (await repository.getOrganizerPublicationJob(result.publicationJobId))?.status,
      revisionHash: snapshot.sha256, publicationJobId, selfApproval: candidate.submitted_by === gate.session.accountId });
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
    if (publicationJobId) await dispatchPublication(publicationJobId);
    return json({
      ok: true, status: publicationJobId ? (await repository.getOrganizerPublicationJob(publicationJobId))?.status : result.status, revisionHash: snapshot.sha256, publicationJobId,
      selfApproval: candidate.submitted_by === gate.session.accountId,
    });
  }

  async function dispatchPublication(jobId: string) {
    try { await dispatchOrganizerPublication!(jobId); }
    catch {
      const job = await repository.getOrganizerPublicationJob(jobId);
      const lease = await repository.claimOrganizerPublicationLease({ jobId, now: config.now(), ttlMs: 30_000 });
      if (job && lease.ok) {
        await repository.updateOrganizerPublicationJob({ jobId, leaseToken: lease.token,
          expectedStep: job.step, nextStep: job.step, status: "failed", failureCode: "dispatch_failed",
          error: "Publication dispatch failed.", retryable: true, now: config.now() });
        await repository.releaseOrganizerPublicationLease(jobId, lease.token);
      }
    }
  }

  async function adminRetryOrganizerPublication(request: Request, jobId: string) {
    if (!await currentSession(request)) return json({ error: "尚未登入。" }, 401);
    const job = await repository.getOrganizerPublicationJob(jobId);
    if (!job) return json({ error: "找不到發布工作。" }, 404);
    const access = await organizerAccess(request, job.candidate_id);
    if (!access.ok) return access.response;
    if (!(await repository.getSiteSettings())?.publicationEnabled) return json({ error: "發布作業已暫停，請稍後再試。", code: "publication_paused" }, 503);
    if ((config.organizerPublicationMode ?? "disabled") === "disabled" || !dispatchOrganizerPublication) {
      return json({ error: "發布功能尚未啟用。" }, 503);
    }
    const snapshot = await repository.getOrganizerSubmissionSnapshot(job.candidate_id, job.candidate_version);
    if (!snapshot || await sha256Hex(snapshot.snapshot_json) !== job.approval_hash) {
      return json({ error: "已核准內容與發布記錄不一致，請聯絡網站管理者。", code: "snapshot_mismatch" }, 409);
    }
    const result = await repository.retryOrganizerPublicationJob({ jobId, now: config.now() });
    if (!result.ok) {
      if (result.reason === "not_found") return json({ error: "找不到發布工作。" }, 404);
      return json({ error: "這筆發布工作目前不能重試，請聯絡網站管理者。", code: result.reason, status: result.status }, 409);
    }
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId, actorRole: access.admin ? "admin" : "organizer_owner",
      action: "organizer_publication.retried", subjectType: "organizer_publication", subjectId: jobId,
      detail: { step: result.step }, ipHash: await clientIpHash(request),
    });
    await dispatchPublication(jobId);
    return json({ ok: true, jobId, status: (await repository.getOrganizerPublicationJob(jobId))?.status, step: result.step });
  }

  async function reopenOrganizerCandidate(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    const expectedVersion = body?.expectedVersion;
    const reason = typeof body?.reason === "string" ? body.reason.normalize("NFKC").trim() : "";
    if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1
      || !reason || reason.length > 1000) {
      return json({ error: "版本與退回理由為必填，理由不可超過 1000 字。" }, 400);
    }
    if (!publicationAuditor) {
      return json({ error: "目前無法確認發布狀態，請稍後再試。", code: "publication_audit_unavailable" }, 503);
    }
    const now = config.now();
    const lease = await repository.claimFailedOrganizerCandidateReopenLease({
      candidateId, expectedVersion: expectedVersion as number, actorAccountId: access.current.accountId,
      now, ttlMs: 30_000, admin: access.admin,
    });
    if (!lease.ok) {
      if (lease.reason === "not_found") return json({ error: "找不到活動。" }, 404);
      const error = lease.reason === "busy" ? "這筆活動目前正在處理，請稍後重新載入。"
        : lease.reason === "remote_write_started" || lease.reason === "started"
          ? "發布已留下遠端處理紀錄，無法安全退回修改，請聯絡網站管理者。"
          : lease.reason === "status" ? "這筆活動目前不能退回修改，請重新載入。"
            : "版本或發布狀態已變更，請重新載入。";
      return json({ error, code: lease.reason, currentVersion: "currentVersion" in lease ? lease.currentVersion : undefined }, 409);
    }
    let committed = false;
    try {
      if (!await repository.hasOrganizerPublicationLease(lease.jobId, lease.token, config.now())) {
        return json({ error: "退回處理逾時，請重新載入後再試。", code: "lease_lost" }, 409);
      }
      let audited: { clear: unknown } | undefined;
      try { audited = await publicationAuditor(lease.jobId); } catch { audited = undefined; }
      if (audited?.clear === false) return json({ error: "這筆核准已經公開，不能退回修改。", code: "remote_state_exists" }, 409);
      if (audited?.clear !== true) return json({ error: "目前無法確認發布狀態，請稍後再試。", code: "publication_audit_failed" }, 503);
      if (!await repository.hasOrganizerPublicationLease(lease.jobId, lease.token, config.now())) {
        return json({ error: "退回處理逾時，請重新載入後再試。", code: "lease_lost" }, 409);
      }
      const result = await repository.reopenFailedOrganizerCandidate({
        candidateId, expectedVersion: expectedVersion as number, actorAccountId: access.current.accountId,
        reason, jobId: lease.jobId, leaseToken: lease.token, now: config.now(), admin: access.admin,
        audit: {
          at: config.now(), actorAccountId: access.current.accountId,
          actorRole: access.admin ? "admin" : "organizer_owner",
          action: "organizer_event.reopened", subjectType: "organizer_event", subjectId: candidateId,
          detail: { reason, previousVersion: expectedVersion, nextVersion: (expectedVersion as number) + 1, jobId: lease.jobId },
          ipHash: await clientIpHash(request),
        },
      });
      if (!result.ok) return json({ error: "版本或發布狀態已變更，請重新載入。", code: result.reason }, 409);
      committed = true;
      return json({ ok: true, status: result.status, version: result.version, previousPublicationJobId: result.jobId });
    } finally {
      if (!committed) await repository.releaseOrganizerPublicationLease(lease.jobId, lease.token);
    }
  }

  return {
    routes: {
      createOrganizerAmendment, getOrganizerAmendment, saveOrganizerAmendment, submitOrganizerCandidate,
      adminReviewOrganizerCandidate, adminRetryOrganizerPublication, reopenOrganizerCandidate,
    },
  };
}
