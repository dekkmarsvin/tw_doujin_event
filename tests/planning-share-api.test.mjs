import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, beforeEach } from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const load = name => vite.environments.ssr.runner.import(name);
const { createPlanningShareRepository } = await load("/db/planning-share-repository.ts");
const { createIdentityRepository } = await load("/db/identity-repository.ts");
const { createPlanningShareHandlers } = await load("/app/planning-share-handlers.ts");
const { parseShareSnapshot } = await load("/app/planning-share-snapshot.ts");
const { getPublishedEvent, getEventDefinition } = await load("/app/event-catalog.ts");
const { peppered } = await load("/app/portal-crypto.ts");
const { onRequest } = await load("/functions/_middleware.ts");
const { onRequestPost } = await load("/functions/api/shares/index.ts");
const { onRequestGet: apiGet } = await load("/functions/api/shares/[shareId].ts");
const { onRequestGet: pageGet } = await load("/functions/s/[shareId].ts");
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: { DB: "planning-shares" } }));
const database = await mf.getD1Database("DB");
const identity = createIdentityRepository(database);
const repository = createPlanningShareRepository(database);
after(async () => { await mf.dispose(); await vite.close(); });

const ORIGIN = "https://map.example.test";
const NOW = Date.parse("2026-09-01T00:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
let clock = NOW;
const event = getPublishedEvent("sample");
const handlers = createPlanningShareHandlers({ repository, publishedEvent: async id => id === event.id ? event : null, hashPepper: () => "test-pepper", now: () => clock });
const snapshot = { version: 1, eventId: "sample", items: [{ circleId: "c-2", day: 2 }, { circleId: "c-1", day: 1 }, { circleId: "c-2", day: 1 }] };
const request = (value = snapshot, headers = {}) => new Request(`${ORIGIN}/api/shares`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "cf-connecting-ip": "192.0.2.1", ...headers }, body: JSON.stringify(value) });
const create = async (value = snapshot, headers = {}) => {
  const response = await handlers.create(request(value, headers));
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
};
const rows = async () => (await database.prepare("SELECT * FROM planning_shares").all()).results;
beforeEach(async () => { clock = NOW; await identity.clearPreviewData(); });

test("create/read round trip stores only ordered ids/days, expiry and peppered IP", async () => {
  const created = await create();
  assert.match(created.shareId, /^[A-Za-z0-9_-]{21}[AQgw]$/);
  assert.equal(Buffer.from(created.shareId, "base64url").length, 16);
  assert.equal(created.url, `${ORIGIN}/s/${created.shareId}`);
  assert.equal(created.expiresAt, Date.parse(event.eventEndsAt) + 30 * DAY);
  const response = await handlers.get(created.shareId);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, max-age=60");
  assert.deepEqual(await response.json(), { snapshot, expiresAt: created.expiresAt });
  const [stored] = await rows();
  assert.deepEqual(JSON.parse(stored.items_json), snapshot.items);
  assert.deepEqual(Object.keys(stored).sort(), ["share_id", "event_id", "items_json", "created_at", "expires_at", "request_ip_hash"].sort());
  assert.equal(stored.request_ip_hash, await peppered("test-pepper", "192.0.2.1"));
  assert.doesNotMatch(JSON.stringify(stored), /192\.0\.2\.1|社團名稱|秘密/);
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM accounts").first()).n, 0);
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM audit_log").first()).n, 0);
});

test("browser default parser accepts published events and rejects resolvable but unpublished fixtures", () => {
  assert.deepEqual(parseShareSnapshot(snapshot), { ok: true, snapshot });
  assert.equal(parseShareSnapshot({ ...snapshot, eventId: "sample-two" }).ok, false);
  assert.ok(getEventDefinition("sample-two"), "fixture exists but is not published in this build");
});

test("private fields and unknown keys are rejected, never stored or echoed", async () => {
  const privateFields = { name: "社團名稱", boothCode: "A01", memos: "秘密備註", groups: ["秘密群組"], purchaseNotes: "秘密購買", budget: 100, status: "visited", timestamp: NOW, account: "秘密帳號", email: "private@example.test" };
  for (const value of [
    { ...snapshot, ...privateFields },
    { ...snapshot, items: [{ ...snapshot.items[0], ...privateFields }] },
  ]) {
    const response = await handlers.create(request(value));
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /秘密|private@example/);
  }
  assert.deepEqual(await rows(), []);
});

test("invalid event, circle, day, duplicates, shape and item bounds return 400", async () => {
  const values = [null, [], {}, { ...snapshot, version: 2 }, { items: snapshot.items, eventId: "sample" },
    { ...snapshot, eventId: "not-published" }, { ...snapshot, eventId: "../sample" },
    ...["1", "c-x", "c-1\n", "c-1\u2028", "c-1<script>"].map(circleId => ({ ...snapshot, items: [{ circleId, day: 1 }] })),
    ...["1", 3, "thu", null, true].map(day => ({ ...snapshot, items: [{ circleId: "c-1", day }] })),
    { ...snapshot, items: [{ day: 1 }] }, { ...snapshot, items: [null] }, { ...snapshot, items: "invalid" },
    { ...snapshot, items: [snapshot.items[0], snapshot.items[0]] }, { ...snapshot, items: [] },
    { ...snapshot, items: Array.from({ length: 501 }, (_, i) => ({ circleId: `c-${i}`, day: 1 })) },
  ];
  for (const value of values) {
    const response = await handlers.create(request(value));
    assert.equal(response.status, 400, JSON.stringify(value));
    assert.equal(typeof (await response.json()).error, "string");
  }
  assert.deepEqual(await rows(), []);
  await create({ ...snapshot, items: Array.from({ length: 500 }, (_, i) => ({ circleId: `c-${i}`, day: 1 })) });
});

test("body byte limit is enforced before JSON parsing with and without Content-Length", async () => {
  const body = JSON.stringify({ ...snapshot, private: "秘".repeat(23000) });
  for (const headers of [{}, { "content-length": String(Buffer.byteLength(body)) }, { "content-length": "1" }]) {
    const response = await handlers.create(new Request(`${ORIGIN}/api/shares`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, body }));
    assert.equal(response.status, 400);
  }
  const malformed = await handlers.create(new Request(`${ORIGIN}/api/shares`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{" }));
  assert.equal(malformed.status, 400);
  assert.deepEqual(await rows(), []);
});

test("cross-origin, missing Origin and non-JSON POST are rejected before storage", async () => {
  for (const origin of ["https://other.example.test", "null", ""]) assert.equal((await handlers.create(request(snapshot, { origin }))).status, 403);
  const missingOrigin = request();
  missingOrigin.headers.delete("origin");
  assert.equal((await handlers.create(missingOrigin)).status, 403);
  assert.equal((await handlers.create(request(snapshot, { "content-type": "text/plain" }))).status, 415);
  assert.deepEqual(await rows(), []);
});

test("30 per IP per hour: 31st rejected, IDs unique, other IP and old rows do not consume quota", async () => {
  const ids = new Set();
  for (let i = 0; i < 30; i++) ids.add((await create()).shareId);
  assert.equal(ids.size, 30);
  assert.ok([...ids].every(id => /^[A-Za-z0-9_-]{21}[AQgw]$/.test(id)));
  const denied = await handlers.create(request());
  assert.equal(denied.status, 429);
  assert.match((await denied.json()).error, /太頻繁/);
  await create(snapshot, { "cf-connecting-ip": "192.0.2.2" });
  clock += HOUR;
  assert.equal((await handlers.create(request())).status, 429, "inclusive hour boundary");
  clock++;
  await create();
});

test("simultaneous requests cannot overspend the final rate-limit slot", async () => {
  for (let i = 0; i < 29; i++) await create();
  const results = await Promise.all(Array.from({ length: 4 }, () => handlers.create(request())));
  assert.deepEqual(results.map(response => response.status).sort(), [201, 429, 429, 429]);
  assert.equal((await rows()).length, 30);
});

test("expired API/page returns 410 and event link; cache never outlives expiry", async () => {
  const created = await create();
  clock = created.expiresAt - 500;
  const live = await handlers.get(created.shareId);
  assert.equal(live.headers.get("cache-control"), "private, max-age=0");
  for (const time of [created.expiresAt, created.expiresAt + 1]) {
    clock = time;
    const api = await handlers.get(created.shareId);
    assert.equal(api.status, 410);
    assert.deepEqual(await api.json(), { error: "這份清單已過期。", code: "share_expired", eventId: event.id });
    const page = await handlers.page(new Request(created.url), created.shareId);
    assert.equal(page.status, 410);
    const text = await page.text();
    assert.match(text, /清單已過期/);
    assert.match(text, /href="\/\?event=sample"/);
    assert.doesNotMatch(text, /http-equiv="refresh"/);
  }
  assert.equal((await handlers.create(request())).status, 400, "do not create already expired shares");
});

test("share page language follows only URL lang through valid, expired, missing and event-missing states", async () => {
  const created = await create();
  const originalRows = await rows();
  for (const [locale, og, open, expired, missing, eventMissing] of [
    ["en", "en_US", "Open plan", "This plan has expired.", "This share link does not exist or has expired.", "Event not found."],
    ["ja", "ja_JP", "巡回プランを開く", "この巡回プランは有効期限が切れています。", "この共有リンクは存在しないか、有効期限が切れています。", "イベントが見つかりません。"],
  ]) {
    const req = new Request(`${created.url}?lang=${locale.toUpperCase()}`, { headers: { "accept-language": "zh-TW" } });
    const page = await handlers.page(req, created.shareId);
    assert.equal(page.status, 200); assert.equal(page.headers.get("cache-control"), "private, no-store");
    assert.equal(page.headers.get("x-robots-tag"), "noindex");
    const body = await page.text();
    assert.ok(body.includes(`<html lang="${locale}">`));
    assert.ok(body.includes(`<meta property="og:locale" content="${og}">`));
    assert.ok(body.includes(`0;url=/?event=sample&amp;share=${created.shareId}&amp;lang=${locale}`));
    assert.ok(body.includes(open)); assert.ok(body.includes(event.name));
    clock = created.expiresAt;
    const old = await handlers.page(req, created.shareId); assert.equal(old.status, 410);
    const oldBody = await old.text(); assert.ok(oldBody.includes(expired)); assert.ok(oldBody.includes(`event=sample&amp;lang=${locale}`));
    assert.ok(oldBody.includes(`content="${og}"`)); assert.ok(!oldBody.includes('http-equiv="refresh"'));
    clock = NOW;
    const absent = await handlers.page(new Request(`${ORIGIN}/s/missing?lang=${locale}`), "missing"); assert.equal(absent.status, 404);
    assert.ok((await absent.text()).includes(missing));
    const missingEvent = createPlanningShareHandlers({ repository, publishedEvent: async () => null, hashPepper: () => "unused", now: () => clock });
    const response = await missingEvent.page(req, created.shareId); assert.equal(response.status, 404);
    const eventBody = await response.text(); assert.ok(eventBody.includes(eventMissing)); assert.ok(eventBody.includes(`<html lang="${locale}">`));
    assert.deepEqual((await (await handlers.get(created.shareId)).json()).snapshot, snapshot);
  }
  for (const query of ["", "?lang=invalid"]) {
    const page = await handlers.page(new Request(created.url + query, { headers: { "accept-language": "ja" } }), created.shareId);
    const body = await page.text(); assert.ok(body.includes('<html lang="zh-Hant">')); assert.ok(!body.includes("&amp;lang="));
  }
  assert.deepEqual(await rows(), originalRows, "language never changes the stored snapshot");
});

test("invalid IDs never touch D1; unknown valid IDs give 404 for API/page", async () => {
  const noReads = createPlanningShareHandlers({ repository: { get: () => { throw new Error("D1 touched"); } }, publishedEvent: async () => null, hashPepper: () => "unused" });
  for (const id of ["", "1", "../secret", "A".repeat(21), "A".repeat(23), `${"A".repeat(22)}\n`, "!".repeat(22), `${"A".repeat(21)}B`]) {
    assert.equal((await noReads.get(id)).status, 404);
    assert.equal((await noReads.page(new Request(`${ORIGIN}/s/invalid`), id)).status, 404);
  }
  assert.equal((await handlers.get("A".repeat(22))).status, 404);
  assert.equal((await handlers.page(new Request(`${ORIGIN}/s/${"A".repeat(22)}`), "A".repeat(22))).status, 404);
});

test("/s serves escaped dynamic metadata, brand image and refresh through nonce middleware", async () => {
  const created = await create();
  const specialName = `活動 <script>alert("x")</script> & '名稱'`;
  const pageHandlers = createPlanningShareHandlers({ repository, publishedEvent: async () => ({ ...event, name: specialName, image: { url: "https://event.example.test/event.png", width: 100, height: 100 } }), hashPepper: () => "unused", now: () => clock });
  const pageRequest = new Request(created.url);
  const response = await onRequest({ request: pageRequest, next: forwarded => pageHandlers.page(forwarded, created.shareId) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /'nonce-[^']+'/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const text = await response.text();
  const title = "活動 &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;名稱&#39; 逛攤清單｜場刊 Map";
  assert.ok(text.includes(`<title>${title}</title>`));
  assert.ok(text.includes(`<meta property="og:title" content="${title}">`));
  assert.ok(text.includes('<meta property="og:description" content="分享了 3 個想逛的社團，開啟清單查看並加入自己的行程。">'));
  assert.ok(text.includes('<meta property="og:image" content="https://map.kotoban.top/share-card.png">'));
  assert.ok(text.includes(`<meta property="og:url" content="${created.url}">`));
  assert.ok(text.includes('<meta name="twitter:card" content="summary_large_image">'));
  assert.ok(text.includes('<meta name="robots" content="noindex">'));
  const target = `/?event=sample&amp;share=${created.shareId}`;
  assert.ok(text.includes(`<meta http-equiv="refresh" content="0;url=${target}">`));
  assert.ok(text.includes(`<a href="${target}">開啟清單</a>`));
  assert.ok(!text.toLowerCase().includes("<script"), "the share page needs no script for its metadata");
  assert.ok(!text.includes("event.png"), "the fixed brand image is used, never the event image");
});

test("Pages route wiring uses deployed events rather than the browser fixture fallback", async () => {
  const files = {};
  for (const name of ["event.json", "reference-records.json"]) files[name] = JSON.parse(await readFile(new URL(`../fixtures/events/sample-two/${name}`, import.meta.url), "utf8"));
  files["event.json"].eventEndsAt = "2099-10-04T00:00:00Z";
  const env = { DB: database, HASH_PEPPER: "test-pepper", ASSETS: { fetch: async assetRequest => {
    const path = new URL(assetRequest.url).pathname;
    const name = path.split("/").at(-1);
    return path.startsWith("/data/events/sample-two/") && files[name]
      ? Response.json(files[name]) : new Response("not found", { status: 404 });
  } } };
  const value = { version: 1, eventId: "sample-two", items: [{ circleId: "c-8", day: "thu" }] };
  const invoke = (req, route, id) => onRequest({ request: req, env, next: forwarded => route({ request: forwarded ?? req, env, params: { shareId: id } }) });
  const response = await invoke(request(value), onRequestPost);
  assert.equal(response.status, 201, await response.clone().text());
  const created = await response.json();
  const api = await invoke(new Request(`${ORIGIN}/api/shares/${created.shareId}`), apiGet, created.shareId);
  assert.equal(api.status, 200);
  assert.equal(api.headers.get("cache-control"), "private, max-age=60");
  assert.deepEqual((await api.json()).snapshot, value);
  const page = await invoke(new Request(created.url), pageGet, created.shareId);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /nonce-/);
  assert.match(await page.text(), /第二範例活動 逛攤清單｜場刊 Map/);
  await database.prepare("UPDATE planning_shares SET expires_at = 0").run();
  for (const route of [apiGet, pageGet]) {
    const expired = await invoke(new Request(route === apiGet ? `${ORIGIN}/api/shares/${created.shareId}` : created.url), route, created.shareId);
    assert.equal(expired.status, 410);
  }
  const unknown = "A".repeat(22);
  for (const route of [apiGet, pageGet]) assert.equal((await invoke(new Request(route === apiGet ? `${ORIGIN}/api/shares/${unknown}` : `${ORIGIN}/s/${unknown}`), route, unknown)).status, 404);
  assert.equal((await invoke(request(value, { origin: "https://foreign.example.test" }), onRequestPost)).status, 403);
  await identity.clearPreviewData();
  assert.deepEqual(await rows(), []);
});
