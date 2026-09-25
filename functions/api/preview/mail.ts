import { previewE2eAuthorized, previewSinkRecipientAllowed, repositoryFor } from "../../_portal";
import { deleteObjectKeys } from "../../../app/hosted-thumbnails";
import { localPreviewResetAllowed, previewFixture } from "../../../app/preview-fixture";
import { clearPreviewFixture } from "../../../db/preview-fixtures";
import { emailAuditSubjectId } from "../../../app/circle-portal-handlers";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function clearBucket(bucket: R2Bucket) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ ...(cursor ? { cursor } : {}) });
    keys.push(...page.objects.map(({ key }) => key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  await deleteObjectKeys(bucket, keys);
}

/** Preview-only mail sink reader. Production has neither the flag nor token. */
export const onRequestGet: PagesFunction<PortalEnv> = async ({ request, env }) => {
  if (!previewE2eAuthorized(env, request)) return json({ error: "not found" }, 404);
  const email = new URL(request.url).searchParams.get("email")?.normalize("NFKC").trim().toLowerCase() ?? "";
  if (!previewSinkRecipientAllowed(env, email)) return json({ error: "recipient is not allowlisted" }, 403);
  const message = await repositoryFor(env).latestPreviewMail(email);
  return message ? json({ message }) : json({ error: "message not found" }, 404);
};

async function requestedFixture(request: Request, env: PortalEnv) {
  const body = await request.json().catch(() => null) as { runId?: unknown; eventId?: unknown; circleId?: unknown } | null;
  const fixture = previewFixture(body?.runId);
  if (!fixture || !previewSinkRecipientAllowed(env, fixture.adminEmail) || !previewSinkRecipientAllowed(env, fixture.circleEmail)) return null;
  return { ...fixture, eventId: body?.eventId, circleId: body?.circleId };
}

/** CI verifies the immutable deployment's bindings before using this endpoint. */
export const onRequestPost: PagesFunction<PortalEnv> = async ({ request, env }) => {
  if (!previewE2eAuthorized(env, request)) return json({ error: "not found" }, 404);
  const fixture = await requestedFixture(request, env);
  if (!fixture) return json({ error: "a reserved preview fixture run is required" }, 400);
  const repository = repositoryFor(env);
  if (fixture.eventId !== undefined || fixture.circleId !== undefined) {
    const { eventId, circleId } = fixture;
    if (typeof eventId !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(eventId)
      || typeof circleId !== "string" || !/^[a-z0-9][a-z0-9-]{0,199}$/.test(circleId)) return json({ error: "a valid fixture target is required" }, 400);
    await repository.ensureTables();
    // Public projections hide withdrawn/taken-down content. Check retained
    // source rows and even orphan thumbnail objects before normal product PUT
    // can replace those rows or prune that circle's unreferenced images.
    const existing = await env.DB.prepare(`SELECT 1 FROM circle_claims WHERE event_id = ?1 AND circle_id = ?2
      UNION ALL SELECT 1 FROM circle_overrides WHERE event_id = ?1 AND circle_id = ?2 LIMIT 1`).bind(eventId, circleId).first();
    if (existing) return json({ error: "fixture target has existing preview data" }, 409);
    const objects = await env.THUMBNAILS.list({ prefix: `events/${encodeURIComponent(eventId)}/circles/${encodeURIComponent(circleId)}/`, limit: 1 });
    if (objects.objects.length || objects.truncated) return json({ error: "fixture target has existing preview images" }, 409);
    return json({ ok: true, runId: fixture.runId, eventId, circleId });
  }
  await repository.addAdmin(fixture.adminEmail, `preview-e2e:${fixture.runId}`, Date.now());
  return json({ ok: true, runId: fixture.runId });
};

/** Full disposal is local-only; remote runs delete only their own fixture rows. */
export const onRequestDelete: PagesFunction<PortalEnv> = async ({ request, env }) => {
  if (!previewE2eAuthorized(env, request)) return json({ error: "not found" }, 404);
  if (!localPreviewResetAllowed(env, request)) {
    const fixture = await requestedFixture(request, env);
    if (!fixture || !env.HASH_PEPPER) return json({ error: "a reserved preview fixture run is required" }, 400);
    await clearPreviewFixture(env.DB, { runId: fixture.runId, now: Date.now(), emailDigests: await Promise.all(
      [fixture.adminEmail, fixture.circleEmail].map(email => emailAuditSubjectId(env.HASH_PEPPER!, email)),
    ) });
    return json({ ok: true, runId: fixture.runId });
  }
  if (!env.MAP_CONTRIBUTIONS) return json({ error: "private map storage is not configured" }, 503);
  const repository = repositoryFor(env);
  await clearBucket(env.THUMBNAILS);
  await clearBucket(env.MAP_CONTRIBUTIONS);
  await repository.clearPreviewData();
  return json({ ok: true });
};
