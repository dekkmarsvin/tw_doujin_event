import { createCirclePortalHandlers, type CircleLookup, type CirclePortalHandlers } from "../app/circle-portal-handlers";
import { buildCircleCatalog, isCircleCatalogPayload, normalizeCircleName, type CircleCatalogPayload } from "../app/circle-records";
import { CIRCLE_OVERRIDES_SCHEMA } from "../app/circle-overrides";
import { createIdentityRepository, type IdentityRepository } from "../db/identity-repository";
import { parseEventDefinition, type EventDefinition } from "../app/event-catalog";
import type { HostedThumbnailStore } from "../app/hosted-thumbnails";
import type { MapContributionFileStore } from "../app/map-contribution-files";
import { isPublishedEventMap } from "../app/event-map";
import { resolveCanonicalMapPeriod } from "../app/map-contribution-draft";
import { resolvePublishedAuthoringScope } from "../app/event-authoring-scope";

/**
 * Wires the framework-agnostic portal handlers to the Pages runtime: D1, the
 * static catalog asset, Mailgun, and the secrets set with
 * `wrangler pages secret put`.
 */

/**
 * The reviewed snapshot, parsed once per isolate. Preview needs the whole
 * payload to run the reader's projection; search and claims only need a compact
 * index, which is derived from the same parse rather than a second fetch.
 */
const catalogCache = new Map<string, Promise<{ payload: CircleCatalogPayload; event: EventDefinition; index: Map<string, CircleLookup> }>>();

async function catalog(env: PortalEnv, request: Request, eventId: string) {
  const cached = catalogCache.get(eventId);
  if (cached) return cached;

  const pending = (async () => {
    const base = `/data/events/${encodeURIComponent(eventId)}`;
    const [response, eventResponse, referencesResponse] = await Promise.all([
      env.ASSETS.fetch(new Request(new URL(`${base}/circles.json`, request.url).toString())),
      env.ASSETS.fetch(new Request(new URL(`${base}/event.json`, request.url).toString())),
      env.ASSETS.fetch(new Request(new URL(`${base}/reference-records.json`, request.url).toString())),
    ]);
    if (!response.ok || !eventResponse.ok || !referencesResponse.ok) {
      throw new Error(`無法讀取活動資料（catalog=${response.status}, event=${eventResponse.status}, references=${referencesResponse.status}）。`);
    }
    const [value, eventValue, referencesValue]: [unknown, unknown, unknown] = await Promise.all([
      response.json(),
      eventResponse.json(),
      referencesResponse.json(),
    ]);
    if (!isCircleCatalogPayload(value) || value.eventId !== eventId) throw new Error(`活動 ${eventId} 的靜態社團資料格式或 identity 無效。`);
    const event = parseEventDefinition(eventValue, referencesValue);
    if (event.id !== eventId) throw new Error(`活動 ${eventId} 的定義 identity 無效。`);
    const payload: CircleCatalogPayload = value;
    const index = new Map(payload.circles.map((circle) => [circle.id, {
      id: circle.id,
      name: circle.name,
      nameKey: normalizeCircleName(circle.name),
      sourceRow: null,
      links: [],
    } satisfies CircleLookup]));
    return { payload, event, index };
  })().catch((error: unknown) => {
    catalogCache.delete(eventId);
    throw error;
  });

  catalogCache.set(eventId, pending);
  return pending;
}

async function catalogIndex(env: PortalEnv, request: Request, eventId: string) {
  return (await catalog(env, request, eventId)).index;
}

function requireSecret(env: PortalEnv, name: "SESSION_SECRET" | "HASH_PEPPER" | "TURNSTILE_SECRET" | "TURNSTILE_SITEKEY") {
  const value = env[name];
  // `TURNSTILE_SITEKEY` is a plain variable, not a secret — it ships to the
  // browser. It is required the same way because a portal that cannot render
  // the widget cannot produce a token the server will accept, and an unset
  // sitekey must surface as "not configured yet" rather than as a sign-in that
  // silently never works.
  if (!value) throw new Error(`Missing Pages secret or variable ${name}.`);
  return value;
}

/**
 * Cloudflare Turnstile siteverify.
 *
 * Fails closed on every uncertainty — non-2xx, unparseable body, timeout — so a
 * verifier outage stops sign-ins rather than waving them through. That is the
 * safe direction here: the site has no anonymous write path other than this one,
 * and a login link the user can request again in a minute is a cheaper failure
 * than a mailer anyone can drive.
 */
async function verifyTurnstile(env: PortalEnv, token: string, remoteIp: string | null) {
  const form = new URLSearchParams({ secret: requireSecret(env, "TURNSTILE_SECRET"), response: token });
  if (remoteIp) form.set("remoteip", remoteIp);

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return false;
    const result: unknown = await response.json();
    return typeof result === "object" && result !== null && (result as { success?: unknown }).success === true;
  } catch {
    return false;
  }
}

async function sendMailgun(
  env: PortalEnv,
  message: { to: string; subject: string; text: string },
  options: { logRejectionBody?: boolean } = {},
) {
  const { MAILGUN_API_KEY: key, MAILGUN_DOMAIN: domain } = env;
  if (!key || !domain) throw new Error("Missing Mailgun configuration.");

  const form = new URLSearchParams({
    from: env.MAILGUN_SENDER ?? `場刊 Map <noreply@${domain}>`,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
  const response = await fetch(`https://api.mailgun.net/v3/${encodeURIComponent(domain)}/messages`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`api:${key}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  if (!response.ok) {
    // The status alone rarely identifies the mistake — a key from the wrong
    // region, a domain typo, an address the sandbox has not authorized all
    // arrive as one number — and nothing else in this Worker records the
    // attempt. The body names it, but it can echo the recipient address, so it
    // is only read back for preview sandbox mail, whose recipients this
    // environment put on its own allowlist. What is thrown stays status-only.
    const detail = options.logRejectionBody ? ` ${(await response.text()).slice(0, 300)}` : "";
    console.error(`Mailgun rejected the message (${response.status}).${detail}`);
    throw new Error(`Mailgun rejected the message (${response.status}).`);
  }
}

/**
 * Read a claim-evidence page. Only ever called with a URL already recorded in
 * the catalog for that circle, and the caps here bound what a hostile host can
 * do to the Worker.
 */
async function fetchEvidence(url: string): Promise<string | null> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== "https:") return null;

  try {
    const response = await fetch(target.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok || !response.body) return null;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (text.length < 512 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => undefined);
    return text;
  } catch {
    return null;
  }
}

/** Configured roster, used only to seed an empty table. */
function bootstrapAdmins(env: PortalEnv) {
  // Split on whatever a human pasted — comma, semicolon or newline — and drop
  // quotes carried in from a shell or a prompt. The handler normalizes each
  // entry, so this only has to separate and unwrap them.
  return (env.ADMIN_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((entry) => entry.replace(/^["']+|["']+$/g, "").normalize("NFKC").trim().toLowerCase())
    .filter(Boolean);
}

/**
 * One repository per isolate, not per request. `ensureTables` memoizes its DDL
 * batch on the instance, so building a fresh one each time re-ran twenty
 * `CREATE TABLE IF NOT EXISTS` statements — and the admin seed check — on every
 * single request.
 */
const repositories = new WeakMap<D1Database, IdentityRepository>();

export function repositoryFor(env: PortalEnv) {
  const existing = repositories.get(env.DB);
  if (existing) return existing;
  const created = createIdentityRepository(env.DB, { bootstrapAdmins: bootstrapAdmins(env) });
  repositories.set(env.DB, created);
  return created;
}

function addressList(value: string | undefined) {
  return new Set((value ?? "").split(/[,;\s]+/).map((entry) => entry.normalize("NFKC").trim().toLowerCase()).filter(Boolean));
}

/**
 * Which mailbox a preview login link for this address goes to, or `null` for
 * "none of them".
 *
 * Preview has two and chooses by recipient rather than by branch. Pages knows
 * only `production` and `preview`, so a branch-scoped choice would in fact be
 * one setting shared by every preview deployment — and CI needs the D1 sink on
 * the same deployments a human needs a readable inbox on.
 *
 * - `sink`: the reserved `.test` addresses the E2E driver signs in as. Captured
 *   in preview D1 and read back through `/api/preview/mail`.
 * - `sandbox`: addresses a person actually reads, delivered through the Mailgun
 *   sandbox domain bound to this environment. Mailgun accepts only its own
 *   authorized recipients, so an address has to be on both lists to arrive.
 *
 * Anything else is refused before either mailbox is touched, and preview never
 * falls back to the production mailer: the `MAILGUN_*` secrets it reads are the
 * sandbox pair, because secrets are not inherited between environments.
 */
export function previewMailRouteFor(env: PortalEnv, email: string): "sink" | "sandbox" | null {
  if (env.PREVIEW_MAIL_SINK !== "d1") return null;
  const address = email.normalize("NFKC").trim().toLowerCase();
  if (addressList(env.PREVIEW_TEST_RECIPIENTS).has(address)) return "sink";
  if (addressList(env.PREVIEW_SANDBOX_RECIPIENTS).has(address)) return "sandbox";
  return null;
}

/** Only captured mail is readable back; sandbox mail lives in a real inbox. */
export function previewSinkRecipientAllowed(env: PortalEnv, email: string) {
  return previewMailRouteFor(env, email) === "sink";
}

export function previewE2eAuthorized(env: PortalEnv, request: Request) {
  const expected = env.PREVIEW_E2E_TOKEN ?? "";
  const actual = request.headers.get("x-preview-e2e-token") ?? "";
  if (env.PREVIEW_MAIL_SINK !== "d1" || !expected || actual.length !== expected.length) return false;
  let different = 0;
  for (let index = 0; index < expected.length; index += 1) different |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  return different === 0;
}

/**
 * Which event this request operates on.
 *
 * The account is global; the authorization is not. A request that names an
 * event is answered for that event and no other — an ill-formed or unserved id
 * falls through to the handlers' 404 rather than back to the configured
 * default, because a silent fallback would run a write meant for one event
 * against another (ADR-0043 安全邊界). Naming none is the migration path: an
 * older client, and a single-event deployment, still get `EVENT_ID`.
 */
export function requestedEventId(request: Request, env: PortalEnv) {
  const requested = new URL(request.url).searchParams.get("event");
  return requested === null ? env.EVENT_ID : requested.trim();
}

export function portalHandlers(context: { request: Request; env: PortalEnv }): CirclePortalHandlers {
  const { request, env } = context;
  const eventId = requestedEventId(request, env);
  const repository = repositoryFor(env);
  const thumbnailOrigin = env.THUMBNAIL_PUBLIC_ORIGIN;
  const thumbnailStore: HostedThumbnailStore | undefined = thumbnailOrigin ? {
    url: (key) => `${thumbnailOrigin.replace(/\/$/, "")}/${key}`,
    list: async (prefix) => {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await env.THUMBNAILS.list({ prefix, cursor });
        keys.push(...page.objects.map(({ key }) => key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return keys;
    },
    put: async (key, value, contentType) => {
      await env.THUMBNAILS.put(key, value, {
        httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
        customMetadata: { event: eventId },
      });
    },
    delete: (keys) => env.THUMBNAILS.delete(keys),
  } : undefined;
  const mapContributionStore: MapContributionFileStore | undefined = env.MAP_CONTRIBUTIONS ? {
    put: async (key, value, contentType) => {
      await env.MAP_CONTRIBUTIONS!.put(key, value, {
        httpMetadata: { contentType, cacheControl: "private, no-store" },
        customMetadata: { event: eventId, classification: "private-map-evidence" },
      });
    },
    get: async (key) => {
      const object = await env.MAP_CONTRIBUTIONS!.get(key);
      return object ? { body: object.body, contentType: object.httpMetadata?.contentType } : null;
    },
    delete: (keys) => env.MAP_CONTRIBUTIONS!.delete(keys),
  } : undefined;
  const readPublishedEventMap = async (targetPath: string) => {
    const response = await env.ASSETS.fetch(new Request(new URL(
      `/data/events/${encodeURIComponent(eventId)}/${targetPath}`,
      request.url,
    ).toString()));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Published map read failed (${response.status}).`);
    const value: unknown = await response.json();
    return isPublishedEventMap(value) && value.eventId === eventId ? value : null;
  };
  return createCirclePortalHandlers({
    repository,
    sendMail: async (message) => {
      if (env.PREVIEW_MAIL_SINK === "d1") {
        switch (previewMailRouteFor(env, message.to)) {
          case "sink":
            await repository.storePreviewMail({ email: message.to, subject: message.subject, text: message.text, now: Date.now() });
            return;
          case "sandbox":
            await sendMailgun(env, message, { logRejectionBody: true });
            return;
          default:
            throw new Error("Preview mail recipient is not allowlisted.");
        }
      }
      await sendMailgun(env, message);
    },
    lookupCircle: async (circleId) => (await catalogIndex(env, request, eventId)).get(circleId) ?? null,
    searchCircles: async (query, limit) => {
      const needle = query.normalize("NFKC").toLocaleLowerCase("zh-Hant");
      const matches: CircleLookup[] = [];
      for (const circle of (await catalogIndex(env, request, eventId)).values()) {
        if (!circle.nameKey.includes(needle)) continue;
        matches.push(circle);
        if (matches.length >= limit) break;
      }
      return matches;
    },
    fetchEvidence,
    verifyHuman: (token, remoteIp) => verifyTurnstile(env, token, remoteIp),
    turnstileSitekey: () => requireSecret(env, "TURNSTILE_SITEKEY"),
    thumbnailStore,
    mapContributionStore,
    resolveMapContributionScope: async ({ periodKey, venueSpaceId }) => {
      const { payload, event } = await catalog(env, request, eventId);
      const resolvedPeriod = resolveCanonicalMapPeriod(event.days, periodKey);
      const venue = event.venueAssignments.find((assignment) => assignment.venueSpaceId === venueSpaceId);
      if (!resolvedPeriod || !venue) return null;
      const { periodKey: canonicalPeriodKey, periodAliases } = resolvedPeriod;
      const targetPath = event.venueAssignments.length === 1
        ? "map.json"
        : `maps/${encodeURIComponent(canonicalPeriodKey)}/${encodeURIComponent(venueSpaceId)}.json`;
      const published = await readPublishedEventMap(targetPath);
      // Empty official booth slots have no placement row but are still valid
      // geometry. The reviewed public snapshot is authoritative for those
      // codes; placements add newly announced occupied/moved booths.
      const resolved = resolvePublishedAuthoringScope({
        event,
        placements: payload.placements,
        existingBoothCodes: published?.layout.rows.flatMap((row) => row.slots.map(({ code }) => code)) ?? [],
      }, canonicalPeriodKey, venueSpaceId);
      return resolved ? { ...resolved, periodAliases } : null;
    },
    readPublishedEventMap,
    projectCircle: async (circleId, fields, updatedAt = new Date().toISOString()) => {
      // Runs the same projection the reader runs, against the same snapshot, so
      // the preview shows the published result rather than an approximation.
      const { payload, event } = await catalog(env, request, eventId);
      const projected = buildCircleCatalog(payload, fields ? {
        schema: CIRCLE_OVERRIDES_SCHEMA,
        eventId,
        generatedAt: event.dataUpdatedAt,
        revision: 0,
        overrides: [{ circleId, updatedAt, fields }],
      } : undefined, event);
      const records = projected.recordsByCircleId.get(circleId);
      if (records?.length) return records;
      // A circle with no numbered booth still has an identity to preview.
      const circle = projected.circlesById.get(circleId);
      return circle ? [] : null;
    },
    config: {
      eventId,
      origin: new URL(request.url).origin,
      sessionSecret: requireSecret(env, "SESSION_SECRET"),
      hashPepper: requireSecret(env, "HASH_PEPPER"),
      adminEmails: bootstrapAdmins(env),
      dataUpdatedAt: async () => (await catalog(env, request, eventId)).event.dataUpdatedAt,
      eventEndsAt: async () => (await catalog(env, request, eventId)).event.eventEndsAt,
      now: () => Date.now(),
      organizerPublicationMode: env.ORGANIZER_PUBLICATION_MODE ?? "disabled",
      // Published means "this deployment actually serves the event's data", so
      // the set is read from what was deployed rather than from a second list
      // that could drift away from it. Ill-formed ids are rejected without a
      // lookup; anything else resolves through the same cached read the rest of
      // the portal uses.
      publishedEvent: async (id) => {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return null;
        try {
          const { event } = await catalog(env, request, id);
          return { dataUpdatedAt: event.dataUpdatedAt, eventEndsAt: event.eventEndsAt };
        } catch {
          return null;
        }
      },
    },
  });
}

/** Map an unexpected failure onto the same envelope the client already parses. */
export async function guard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const unavailable = message.includes("Missing Pages secret") || message.includes("Missing Mailgun") || message.includes("D1");
    return new Response(JSON.stringify({ error: unavailable ? "服務尚未設定完成，請稍後再試。" : "伺服器發生錯誤。" }), {
      status: unavailable ? 503 : 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}

export function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
