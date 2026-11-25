import { readFile } from "node:fs/promises";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";
import { readLocalPortalEnvironment } from "../../scripts/local-portal-environment.mjs";
import { applyMigrations } from "./d1-migrations.mjs";

/**
 * The backend as a deployment runs it (#546 phase 6): every call goes through
 * the shared middleware into the single API router, against a migrated D1 and
 * R2 buckets holding the two published fixture events (`sample`, the default,
 * and `sample-two`). Configuration is the local
 * portal's, so mail lands in the D1 sink and only `.test` addresses receive it.
 *
 * Only Turnstile is replaced, since it is a network call: `api.human` decides
 * what siteverify answers.
 */

export const ORIGIN = "https://portal.example.test";
export const ADMIN = "local-admin@example.test";

const FIXTURE_FILES = ["circles.json", "event.json", "map.json", "reference-records.json"];

/** Publish the fixture events the way approvals leave them in R2. */
async function publishFixtures(bucket, eventIds, definition) {
  const events = [];
  for (const eventId of eventIds) {
    const directory = new URL(`../../fixtures/events/${eventId}/`, import.meta.url);
    const files = Object.fromEntries(await Promise.all(FIXTURE_FILES.map(async (name) =>
      [name, JSON.parse(await readFile(new URL(name, directory), "utf8"))])));
    Object.assign(files["event.json"], definition);
    for (const [name, value] of Object.entries(files)) await bucket.put(`events/${eventId}/1/${name}`, JSON.stringify(value));
    events.push({ eventId, version: "1", files: FIXTURE_FILES, definition: files["event.json"], references: files["reference-records.json"] });
  }
  await bucket.put("index.json", JSON.stringify({ schema: "event-index/1", events }));
}

/**
 * Start a backend. `env` overrides the local portal configuration; `event`
 * overrides fields of both published fixture definitions. The fixtures' own
 * dates are in the past, so the events run until 2099 unless a test says
 * otherwise.
 */
export async function startApi(name, { env: overrides = {}, event = {} } = {}) {
  const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom",
    environments: { ssr: {} }, logLevel: "silent" });
  const environment = vite.environments.ssr;
  if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
  const load = (path) => environment.runner.import(path);
  const [{ onRequest: middleware }, { onRequest: router }, { onRequestGet: overlayRoute }] = await Promise.all([
    load("/functions/_middleware.ts"), load("/functions/api/[[path]].ts"), load("/functions/data/events/[eventId]/overrides.json.ts"),
  ]);

  const miniflare = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: name },
    r2Buckets: { EVENT_DATA: `${name}-event-data`, THUMBNAILS: `${name}-thumbnails`, MAP_CONTRIBUTIONS: `${name}-map-contributions` },
  }));
  const DB = await miniflare.getD1Database("DB");
  const EVENT_DATA = await miniflare.getR2Bucket("EVENT_DATA");
  const THUMBNAILS = await miniflare.getR2Bucket("THUMBNAILS");
  const MAP_CONTRIBUTIONS = await miniflare.getR2Bucket("MAP_CONTRIBUTIONS");
  await applyMigrations(DB);
  await publishFixtures(EVENT_DATA, ["sample", "sample-two"], { eventEndsAt: "2099-09-02T23:59:59.999+08:00", ...event });

  const local = await readLocalPortalEnvironment();
  const env = {
    ...local,
    PREVIEW_TEST_RECIPIENTS: [local.PREVIEW_TEST_RECIPIENTS,
      ...["owner", "member", "other", "second", "third"].map((name) => `${name}@example.test`)].join(","),
    // Published pictures must be https, as production's media domain is.
    THUMBNAIL_PUBLIC_ORIGIN: "https://media.example.test",
    DB, EVENT_DATA, THUMBNAILS, MAP_CONTRIBUTIONS,
    ...overrides,
  };

  const realFetch = globalThis.fetch;
  let signIns = 0;
  const api = {
    env, database: DB, eventData: EVENT_DATA, thumbnails: THUMBNAILS, load,
    /** What Turnstile's siteverify answers. */
    human: true,

    /**
     * One request through middleware and router. A JSON `body` is sent as
     * JSON; `FormData` as multipart. Work the middleware queues after the
     * response (notices, publication ticks) is finished before this returns.
     * `route` is another Pages function to send it to instead of the router,
     * with its `params`.
     */
    async call(method, path, { body, cookie, headers = {}, route = router, params = {} } = {}) {
      const init = { method, headers: { "cf-connecting-ip": "192.0.2.10" } };
      if (method !== "GET" && method !== "HEAD") init.headers.origin = ORIGIN;
      if (cookie) init.headers.cookie = cookie;
      if (body instanceof FormData) init.body = body;
      else if (body !== undefined) {
        init.headers["content-type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      Object.assign(init.headers, headers);
      const request = new Request(`${ORIGIN}${path}`, init);
      const pending = [];
      const context = { request, env, params, data: {}, waitUntil: (promise) => pending.push(promise) };
      const response = await middleware({ ...context, next: (forwarded) => route({ ...context, request: forwarded ?? request }) });
      await Promise.all(pending);
      return response;
    },

    /** What readers load for a circle: its published fields, or undefined. */
    async published(circleId, eventId = "sample") {
      const response = await api.call("GET", `/data/events/${eventId}/overrides.json`, { route: overlayRoute, params: { eventId } });
      if (response.status !== 200) throw new Error(`overlay ${response.status}`);
      return (await response.json()).overrides.find((entry) => entry.circleId === circleId)?.fields;
    },

    /** Publish an event again as its next version, with fields of its
     * definition changed — the only way a published event's dates move. */
    async republish(eventId, definition) {
      const index = JSON.parse(await (await EVENT_DATA.get("index.json")).text());
      const entry = index.events.find((candidate) => candidate.eventId === eventId);
      const version = String(Number(entry.version) + 1);
      for (const name of entry.files) {
        const value = JSON.parse(await (await EVENT_DATA.get(`events/${eventId}/${entry.version}/${name}`)).text());
        if (name === "event.json") Object.assign(value, definition);
        await EVENT_DATA.put(`events/${eventId}/${version}/${name}`, JSON.stringify(value));
      }
      Object.assign(entry, { version, definition: { ...entry.definition, ...definition } });
      await EVENT_DATA.put("index.json", JSON.stringify(index));
    },

    /** The newest mail the sink holds for an address, or null. */
    async lastMail(email) {
      return DB.prepare("SELECT subject, text FROM preview_mail_sink WHERE email = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
        .bind(email).first();
    },

    /** Request a link, open it from the mail, and return the session cookie.
     * Each sign-in comes from its own address, so a file's sign-ins never
     * meet the per-IP hourly limit. */
    async signIn(email, { audience = "circle" } = {}) {
      signIns += 1;
      const headers = { "cf-connecting-ip": `198.51.100.${signIns}` };
      const requested = await api.call("POST", "/api/auth/request-link", { headers,
        body: { email, turnstileToken: "token", locale: "zh-Hant", audience } });
      if (requested.status !== 202) throw new Error(`request-link ${requested.status}: ${await requested.text()}`);
      const mail = await api.lastMail(email);
      const token = mail && /[?&]login=([^&\s]+)/.exec(mail.text)?.[1];
      if (!token) throw new Error(`no login link mailed to ${email}`);
      const verified = await api.call("POST", "/api/auth/verify", { body: { token } });
      if (verified.status !== 200) throw new Error(`verify ${verified.status}: ${await verified.text()}`);
      return verified.headers.get("set-cookie").split(";")[0];
    },

    async close() {
      globalThis.fetch = realFetch;
      await miniflare.dispose();
      await vite.close();
    },
  };

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://challenges.cloudflare.com/")) {
      // Only the request production must send gets a verdict: a POST to
      // siteverify carrying our secret and the browser's token.
      const form = new URLSearchParams(init?.body ? String(init.body) : "");
      const wellFormed = url === "https://challenges.cloudflare.com/turnstile/v0/siteverify" && init?.method === "POST"
        && form.get("secret") === env.TURNSTILE_SECRET && Boolean(form.get("response"));
      return new Response(JSON.stringify({ success: wellFormed && api.human }), { headers: { "content-type": "application/json" } });
    }
    return realFetch(input, init);
  };
  return api;
}
