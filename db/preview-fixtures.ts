import { previewFixture } from "../app/preview-fixture";

/** Only data created by the remote circle journey. Full resets stay local.
 * Overlay edits and deletes share a transaction, retaining unrelated edits. */
export async function clearPreviewFixture(database: D1Database, input: { runId: string; emailDigests: string[]; now: number }) {
  const fixture = previewFixture(input.runId);
  if (!fixture || input.emailDigests.length !== 2) throw new Error("Invalid preview fixture.");
  const emails = [fixture.adminEmail, fixture.circleEmail];
  const accounts = "SELECT id FROM accounts WHERE email IN (?1, ?2)";
  const claims = `SELECT id FROM circle_claims WHERE account_id IN (${accounts})`;
  const own = `SELECT circle_id FROM circle_overrides WHERE updated_by IN (${accounts}) AND event_id = overrides_doc.event_id`;
  const statement = (sql: string, ...extra: unknown[]) => database.prepare(sql).bind(...emails, ...extra);
  await database.batch([
    statement(`UPDATE overrides_doc SET revision = revision + 1, updated_at = ?3,
      json = json_set(json, '$.revision', revision + 1, '$.generatedAt', ?4, '$.overrides',
        json(COALESCE((SELECT json_group_array(json(value)) FROM json_each(overrides_doc.json, '$.overrides')
          WHERE json_extract(value, '$.circleId') NOT IN (${own})), '[]')))
      WHERE EXISTS (SELECT 1 FROM circle_overrides WHERE updated_by IN (${accounts}) AND event_id = overrides_doc.event_id)`,
    input.now, new Date(input.now).toISOString()),
    statement(`DELETE FROM circle_overrides WHERE updated_by IN (${accounts})`),
    statement(`DELETE FROM review_notification_items WHERE recipient IN (?1, ?2) OR (kind = 'claim' AND subject_id IN (${claims}))`),
    ...["review_notification_batches", "admin_notification_preferences"].map(table => statement(`DELETE FROM ${table} WHERE recipient IN (?1, ?2)`)),
    statement(`DELETE FROM audit_log WHERE actor_account_id IN (${accounts})
      OR (subject_type = 'claim' AND subject_id IN (${claims}))
      OR (subject_type = 'email' AND subject_id IN (?3, ?4))`, ...input.emailDigests),
    statement(`DELETE FROM circle_claims WHERE account_id IN (${accounts})`),
    statement(`DELETE FROM sessions WHERE account_id IN (${accounts})`),
    statement("DELETE FROM login_tokens WHERE email IN (?1, ?2)"),
    statement("DELETE FROM preview_mail_sink WHERE email IN (?1, ?2)"),
    statement("DELETE FROM admins WHERE email IN (?1, ?2) AND added_by = ?3", `preview-e2e:${fixture.runId}`),
    statement("DELETE FROM accounts WHERE email IN (?1, ?2)"),
  ]);
}
