import type { OrganizerApplicationInput } from "../app/organizer-applications";
import { createEmptyOrganizerEventDraft } from "../app/organizer-event";
import type { OrganizerCandidateInput } from "./identity-repository";

type ApplicationRow = {
  id: string; account_id: string; data_json: string;
  status: "pending" | "approved" | "rejected"; created_at: number;
  reviewed_at: number | null; reason: string; candidate_id: string | null;
  applicant_email: string | null;
  applicant_role: string | null;
};

export function createOrganizerApplicationRepository(
  database: D1Database, ensureTables: () => Promise<void>,
  candidateStatements: (input: OrganizerCandidateInput, token: string) => D1PreparedStatement[],
) {
  const select = `SELECT a.id, a.account_id, a.data_json, a.status, a.created_at,
    a.reviewed_at, a.reason, a.candidate_id, u.email AS applicant_email, g.role AS applicant_role
    FROM organizer_applications a LEFT JOIN accounts u ON u.id = a.account_id
    LEFT JOIN organizer_event_grants g ON g.candidate_id = a.candidate_id AND g.account_id = a.account_id AND g.revoked_at IS NULL`;

  async function getOrganizerApplication(id: string) {
    await ensureTables();
    return database.prepare(`${select} WHERE a.id = ?1`).bind(id).first<ApplicationRow>();
  }

  async function listOrganizerApplications(accountId: string, admin: boolean) {
    await ensureTables();
    return (await database.prepare(`${select} WHERE ?1 = 1 OR a.account_id = ?2
      ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.created_at DESC, a.id`)
      .bind(admin ? 1 : 0, accountId).all<ApplicationRow>()).results;
  }

  async function hasOrganizerApplications(accountId: string) {
    await ensureTables();
    return !!await database.prepare("SELECT 1 FROM organizer_applications WHERE account_id = ?1 LIMIT 1").bind(accountId).first();
  }

  async function submitOrganizerApplication(input: { id: string; accountId: string; data: OrganizerApplicationInput; now: number }) {
    await ensureTables();
    const dataJson = JSON.stringify(input.data);
    await database.prepare(`INSERT INTO organizer_applications (id, account_id, data_json, created_at)
      SELECT ?1, id, ?3, ?4 FROM accounts
      WHERE id = ?2 AND disabled_at IS NULL AND deletion_started_at IS NULL
      ON CONFLICT(id) DO NOTHING`).bind(input.id, input.accountId, dataJson, input.now).run();
    const row = await getOrganizerApplication(input.id);
    return row?.account_id === input.accountId && row.data_json === dataJson ? row : null;
  }

  async function reviewOrganizerApplication(input: {
    id: string; decision: "approved" | "rejected"; reason: string;
    reviewerAccountId: string; sessionId: string; now: number; ipHash: string | null;
  }) {
    const row = await getOrganizerApplication(input.id);
    if (!row) return null;
    // Replaying an accepted decision only returns its outcome. It never grants
    // access again after a collaborator has subsequently been revoked.
    if (row.status !== "pending") return row.status === input.decision ? row : null;
    const token = crypto.randomUUID();
    const candidateId = input.decision === "approved" ? crypto.randomUUID() : null;
    const data = JSON.parse(row.data_json) as OrganizerApplicationInput;
    const draft = createEmptyOrganizerEventDraft(data.name);
    draft.officialSource = { label: "活動官方來源", url: data.officialUrl };
    // Expected dates and location stay on the application. Actual days and
    // spaces are confirmed by the owner in the existing guided workspace.
    const statements = [database.prepare(`UPDATE organizer_applications
      SET status = ?2, reviewed_by = ?3, reviewed_at = ?4, reason = ?5, candidate_id = ?6, review_token = ?7
      WHERE id = ?1 AND status = 'pending'
        AND EXISTS (SELECT 1 FROM accounts u WHERE u.id = organizer_applications.account_id
          AND u.disabled_at IS NULL AND u.deletion_started_at IS NULL)
        AND EXISTS (SELECT 1 FROM accounts u JOIN admins a ON a.email = u.email
          JOIN sessions s ON s.account_id = u.id
          WHERE u.id = ?3 AND u.disabled_at IS NULL AND u.deletion_started_at IS NULL
            AND s.id = ?8 AND s.revoked_at IS NULL AND s.expires_at > ?4)
      `).bind(input.id, input.decision, input.reviewerAccountId, input.now, input.reason, candidateId, token, input.sessionId)];
    if (candidateId) statements.push(...candidateStatements({
      id: candidateId, tentativeName: data.name, ownerEmail: row.applicant_email!,
      createdByAccountId: input.reviewerAccountId, draftJson: JSON.stringify(draft), now: input.now,
      ownerGrant: { accountId: row.account_id, audit: {
        at: input.now, actorAccountId: input.reviewerAccountId, actorRole: "admin",
        action: "organizer_event.owner_granted_on_create", subjectType: "organizer_event", subjectId: candidateId,
        detail: { reason: "application_approved", applicationId: input.id }, ipHash: input.ipHash,
      } },
    }, token));
    statements.push(database.prepare(`INSERT INTO audit_log
      (id, at, actor_account_id, actor_role, action, subject_type, subject_id, detail_json, ip_hash)
      SELECT ?1, ?2, ?3, 'admin', ?4, 'organizer_application', id, NULL, ?5
      FROM organizer_applications WHERE review_token = ?6`)
      .bind(crypto.randomUUID(), input.now, input.reviewerAccountId, `organizer_application.${input.decision}`, input.ipHash, token));
    // D1 batch is the transaction: decision, candidate, initial revision,
    // accepted invitation and owner grant either all commit or all roll back.
    await database.batch(statements);
    const result = await getOrganizerApplication(input.id);
    return result?.status === input.decision ? result : null;
  }

  return { getOrganizerApplication, listOrganizerApplications, hasOrganizerApplications,
    submitOrganizerApplication, reviewOrganizerApplication };
}
