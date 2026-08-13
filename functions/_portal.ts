import { createCirclePortalHandlers, type CircleLookup, type CirclePortalHandlers } from "../app/circle-portal-handlers";
import { buildCircleCatalog, normalizeCircleTemplateName, type CircleCatalogPayload } from "../app/circle-records";
import { CIRCLE_OVERRIDES_SCHEMA } from "../app/circle-overrides";
import { createIdentityRepository, type IdentityRepository } from "../db/identity-repository";
import { FF47_EVENT } from "../app/event-catalog";

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
const catalogCache = new Map<string, Promise<{ payload: CircleCatalogPayload; index: Map<string, CircleLookup> }>>();

async function catalog(env: PortalEnv, request: Request, eventId: string) {
  const cached = catalogCache.get(eventId);
  if (cached) return cached;

  const pending = (async () => {
    const url = new URL(`/data/events/${encodeURIComponent(eventId)}/circles.json`, request.url);
    const response = await env.ASSETS.fetch(new Request(url.toString()));
    if (!response.ok) throw new Error(`無法讀取活動社團資料（${response.status}）。`);
    const payload = await response.json() as CircleCatalogPayload;
    const index = new Map(payload.templates.map((template) => [template.id, {
      id: template.id,
      name: template.name,
      nameKey: normalizeCircleTemplateName(template.name),
      sourceRow: template.sourceRow ?? null,
      links: template.links.map((link) => ({ provider: link.provider, url: link.url })),
    } satisfies CircleLookup]));
    return { payload, index };
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

function requireSecret(env: PortalEnv, name: "SESSION_SECRET" | "HASH_PEPPER") {
  const value = env[name];
  if (!value) throw new Error(`Missing Pages secret ${name}.`);
  return value;
}

async function sendMailgun(env: PortalEnv, message: { to: string; subject: string; text: string }) {
  const { MAILGUN_API_KEY: key, MAILGUN_DOMAIN: domain } = env;
  if (!key || !domain) throw new Error("Missing Mailgun configuration.");

  const form = new URLSearchParams({
    from: env.MAILGUN_SENDER ?? `FF47 場刊 MAP <noreply@${domain}>`,
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
  // Surface the status only; the body can echo the recipient address.
  if (!response.ok) throw new Error(`Mailgun rejected the message (${response.status}).`);
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

function repositoryFor(env: PortalEnv) {
  const existing = repositories.get(env.DB);
  if (existing) return existing;
  const created = createIdentityRepository(env.DB, { bootstrapAdmins: bootstrapAdmins(env) });
  repositories.set(env.DB, created);
  return created;
}

export function portalHandlers(context: { request: Request; env: PortalEnv }): CirclePortalHandlers {
  const { request, env } = context;
  const eventId = FF47_EVENT.id;
  return createCirclePortalHandlers({
    repository: repositoryFor(env),
    sendMail: (message) => sendMailgun(env, message),
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
    projectCircle: async (circleId, fields) => {
      // Runs the same projection the reader runs, against the same snapshot, so
      // the preview shows the published result rather than an approximation.
      const { payload } = await catalog(env, request, eventId);
      const projected = buildCircleCatalog(payload, {
        schema: CIRCLE_OVERRIDES_SCHEMA,
        eventId,
        generatedAt: FF47_EVENT.dataUpdatedAt,
        revision: 0,
        overrides: [{ circleId, updatedAt: new Date().toISOString(), fields }],
      });
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
      dataUpdatedAt: FF47_EVENT.dataUpdatedAt,
      now: () => Date.now(),
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
