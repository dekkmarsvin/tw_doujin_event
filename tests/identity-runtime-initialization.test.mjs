import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const load = name => vite.environments.ssr.runner.import(name);
const { createIdentityRepository } = await load("/db/identity-repository.ts");
const { createCirclePortalHandlers } = await load("/app/circle-portal-handlers.ts");
const { IDENTITY_TABLES, IDENTITY_INDEXES, IDENTITY_COLUMN_MIGRATIONS } = await load("/db/identity-runtime-schema.ts");
const { initialVenueReferences } = await load("/app/organizer-reference-catalog.ts");
const { INITIAL_ORGANIZER_VENUE_CATALOG, organizerVenueNameKey } = await load("/app/organizer-venue-catalog.ts");
const version = JSON.parse(await readFile(new URL("../db/identity-runtime-version.json", import.meta.url), "utf8"));
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`DB${i}`, `runtime-init-${i}`])) }));
after(async () => { await mf.dispose(); await vite.close(); });
let nextDb = 0;
const freshDatabase = () => mf.getD1Database(`DB${nextDb++}`);

function observe(database, before = async () => {}) {
  const calls = [];
  const statements = new WeakMap();
  async function call(kind, sql, perform) {
    const entry = { kind, sql };
    calls.push(entry);
    await before(entry);
    return perform();
  }
  function wrap(statement, sql) {
    const wrapped = {
      bind: (...args) => wrap(statement.bind(...args), sql),
      ...Object.fromEntries(["first", "all", "run", "raw"].map(kind => [kind, (...args) => call(kind, [sql], () => statement[kind](...args))])),
    };
    statements.set(wrapped, { statement, sql });
    return wrapped;
  }
  return { calls, database: {
    prepare: sql => wrap(database.prepare(sql), sql),
    batch: values => call("batch", values.map(value => statements.get(value).sql), () => database.batch(values.map(value => statements.get(value).statement))),
  } };
}
const marker = database => database.prepare("SELECT version FROM identity_runtime_state WHERE id = 1").first();
const count = async (database, table) => (await database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
async function preparedDatabase() {
  const database = await freshDatabase();
  await createIdentityRepository(database).getOverridesDoc("ff47");
  return database;
}

// Pin the complete initialization recipe, not only table declarations. A change
// needs a new monotonic version AND an updated fingerprint before it can ship.
test("runtime version covers schema, migration algorithm and generated seed bytes", async () => {
  const fingerprint = createHash("sha256").update(JSON.stringify({
    initializer: (await readFile(new URL("../db/identity-runtime-initializer.ts", import.meta.url), "utf8")).replaceAll("\r\n", "\n"),
    tables: IDENTITY_TABLES, indexes: IDENTITY_INDEXES, migrations: IDENTITY_COLUMN_MIGRATIONS,
    venues: INITIAL_ORGANIZER_VENUE_CATALOG.map(venue => ({ ...venue, nameKey: organizerVenueNameKey(venue.name), spaces: venue.spaces.map(space => ({ ...space, nameKey: organizerVenueNameKey(space.name) })) })),
    references: initialVenueReferences(),
  })).digest("hex");
  assert.ok(Number.isSafeInteger(version.version) && version.version > 0);
  assert.equal(version.fingerprint, fingerprint, "Initialization changed: increment identity-runtime-version.json version and update its fingerprint; never reuse a shipped version.");
});

test("new repository reads a prepared DB in two calls, then one, without admin or seed writes", async () => {
  const database = await preparedDatabase();
  const json = JSON.stringify({ schema: "circle-overrides/1", eventId: "ff47", generatedAt: "2026-09-28T00:00:00Z", revision: 10, overrides: [] });
  await database.prepare("INSERT INTO overrides_doc (event_id, revision, json, updated_at, phase) VALUES ('ff47', 10, ?1, 100, 'after')").bind(json).run();
  const observed = observe(database);
  const repo = createIdentityRepository(observed.database, { bootstrapAdmins: ["admin@example.test"] });
  const expected = { revision: 10, json, updated_at: 100, phase: "after" };
  assert.deepEqual(await repo.getOverridesDoc("ff47"), expected);
  assert.equal(observed.calls.length, 2);
  assert.ok(observed.calls.every(call => call.kind === "first" && call.sql.every(sql => sql.startsWith("SELECT "))));
  observed.calls.length = 0;
  assert.deepEqual(await repo.getOverridesDoc("ff47"), expected);
  assert.equal(observed.calls.length, 1);
  assert.equal(await repo.getOverridesDoc("other-event"), null);
  assert.equal(await count(database, "admins"), 0);
  assert.equal(await count(database, "admin_notification_preferences"), 0);
});

test("parallel reads share readiness inside an instance", async () => {
  const observed = observe(await preparedDatabase());
  const repo = createIdentityRepository(observed.database);
  assert.deepEqual(await Promise.all([repo.getOverridesDoc("ff47"), repo.getOverridesDoc("another")]), [null, null]);
  assert.equal(observed.calls.length, 3, "one version lookup and two document lookups");
});

test("fresh database initializes safely across repository instances", async () => {
  const database = await freshDatabase();
  const a = createIdentityRepository(database), b = createIdentityRepository(database);
  assert.deepEqual(await Promise.all([a.getOverridesDoc("ff47"), b.getOverridesDoc("ff47")]), [null, null]);
  assert.equal((await marker(database)).version, version.version);
  assert.equal(await count(database, "organizer_reference_records"), initialVenueReferences().length);
});

test("missing or stale marker reruns initialization without overwriting canonical references", async () => {
  const database = await preparedDatabase();
  const reference = initialVenueReferences()[0];
  await database.prepare("UPDATE organizer_reference_records SET public_reference_json = ?1 WHERE path = ?2").bind('{"manual":"preserve me"}', reference.path).run();
  for (const change of ["DELETE FROM identity_runtime_state", "UPDATE identity_runtime_state SET version = 0"]) {
    await database.prepare(change).run();
    await createIdentityRepository(database).getOverridesDoc("ff47");
    assert.equal((await marker(database)).version, version.version);
    assert.equal((await database.prepare("SELECT public_reference_json FROM organizer_reference_records WHERE path = ?1").bind(reference.path).first()).public_reference_json, '{"manual":"preserve me"}');
  }
});

test("failed initialization does not publish readiness and can retry on the same instance", async () => {
  const database = await freshDatabase();
  let fail = true;
  const observed = observe(database, ({ sql }) => {
    if (fail && sql.some(text => text.startsWith("INSERT INTO organizer_venues"))) { fail = false; throw new Error("temporary D1 failure"); }
  });
  const repo = createIdentityRepository(observed.database);
  await assert.rejects(repo.getOverridesDoc("ff47"), /temporary D1 failure/);
  assert.equal(await marker(database), null);
  assert.equal(await repo.getOverridesDoc("ff47"), null);
  assert.equal((await marker(database)).version, version.version);
});

test("only the exact missing marker table is treated as an uninitialized DB", async () => {
  const database = await preparedDatabase();
  for (const message of ["D1 unavailable", "not authorized", "no such table: unrelated", "no such table: identity_runtime_state_backup"]) {
    let fail = true;
    const observed = observe(database, () => { if (fail) throw new Error(message); });
    const repo = createIdentityRepository(observed.database);
    await assert.rejects(repo.getOverridesDoc("ff47"), { message });
    assert.equal(observed.calls.length, 1, "must not start DDL after a failed readiness read");
    fail = false;
    assert.equal(await repo.getOverridesDoc("ff47"), null);
  }
});

test("older code accepts a newer additive runtime and never downgrades it", async () => {
  const database = await preparedDatabase();
  await database.prepare("UPDATE identity_runtime_state SET version = ?1").bind(version.version + 1).run();
  const observed = observe(database);
  await createIdentityRepository(observed.database).getOverridesDoc("ff47");
  assert.equal(observed.calls.length, 2);
  assert.ok(observed.calls.every(call => call.kind === "first"));
  assert.equal((await marker(database)).version, version.version + 1);
});

test("a concurrent newer completion cannot be overwritten by an older initializer", async () => {
  const database = await freshDatabase();
  const observed = observe(database, async ({ sql }) => {
    if (sql.some(text => text.startsWith("INSERT INTO identity_runtime_state"))) {
      await database.prepare("INSERT INTO identity_runtime_state (id, version) VALUES (1, ?1)").bind(version.version + 1).run();
    }
  });
  await createIdentityRepository(observed.database).getOverridesDoc("ff47");
  assert.equal((await marker(database)).version, version.version + 1);
});

test("public reads do not bootstrap admins; control-plane startup still recovers and seeds preferences", async () => {
  const database = await preparedDatabase();
  const options = { bootstrapAdmins: ["first@example.test", "second@example.test"] };
  const repo = createIdentityRepository(database, options);
  await repo.getOverridesDoc("ff47");
  assert.equal(await count(database, "admins"), 0);
  assert.equal(await repo.isAdminEmail("first@example.test"), true);
  assert.equal(await count(database, "admin_notification_preferences"), 2);
  await database.prepare("UPDATE admin_notification_preferences SET enabled = 0, cadence = 'daily', enabled_since = 7 WHERE recipient = 'second@example.test'").run();
  assert.equal(await repo.removeAdmin("first@example.test"), "removed");
  const restarted = createIdentityRepository(database, options);
  assert.equal(await restarted.isAdminEmail("first@example.test"), false, "deleted admins cannot reappear while another admin exists");
  assert.deepEqual(await database.prepare("SELECT enabled, cadence, enabled_since FROM admin_notification_preferences WHERE recipient = 'second@example.test'").first(), { enabled: 0, cadence: "daily", enabled_since: 7 });
  await database.batch([database.prepare("DELETE FROM admins"), database.prepare("DELETE FROM admin_notification_preferences")]);
  assert.equal(await createIdentityRepository(database, options).isAdminEmail("first@example.test"), true);
  assert.equal(await count(database, "admin_notification_preferences"), 2);
  assert.equal(await count(database, "review_notification_items"), 0, "recovery does not enqueue old reviews");
});

test("fresh public handler preserves revisions, 304 and phase rebuild without control-plane initialization", async () => {
  const database = await preparedDatabase();
  const observed = observe(database);
  const repository = createIdentityRepository(observed.database, { bootstrapAdmins: ["admin@example.test"] });
  await database.prepare("INSERT INTO overrides_doc (event_id, revision, json, updated_at, phase) VALUES ('ff47', 10, ?1, 100, 'during')")
    .bind(JSON.stringify({ schema: "circle-overrides/1", eventId: "ff47", generatedAt: "2026-09-28T00:00:00Z", revision: 10, overrides: [] })).run();
  const end = Date.parse("2026-09-28T12:00:00Z");
  let now = end - 1;
  const portal = createCirclePortalHandlers({ repository, config: {
    eventId: "ff47", origin: "https://example.test", sessionSecret: "unused", hashPepper: "unused", adminEmails: [],
    now: () => now, dataUpdatedAt: "2026-09-28T00:00:00Z", eventEndsAt: "2026-09-28T12:00:00Z",
    publishedEvent: async id => id === "ff47" ? { dataUpdatedAt: "2026-09-28T00:00:00Z", eventEndsAt: "2026-09-28T12:00:00Z" } : null,
  } });
  const request = headers => new Request("https://example.test/data/events/ff47/overrides.json", { headers });
  const first = await portal.publicOverrides(request(), "ff47");
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-identity-runtime-version"), String(version.version));
  assert.equal(observed.calls.length, 2);
  const second = await portal.publicOverrides(request({ "if-none-match": first.headers.get("etag") }), "ff47");
  assert.equal(second.status, 304);
  assert.equal(await second.text(), "");
  now = end + 1;
  const afterEvent = await portal.publicOverrides(request({ "if-none-match": first.headers.get("etag") }), "ff47");
  assert.equal(afterEvent.status, 200);
  assert.notEqual(afterEvent.headers.get("etag"), first.headers.get("etag"));
  assert.equal((await afterEvent.json()).revision, 11);
  assert.deepEqual(observed.calls.filter(call => call.kind !== "first" && call.kind !== "all").map(call => call.sql[0].split(" (")[0].trim()), ["INSERT INTO overrides_doc"]);
  assert.equal(await count(database, "admins"), 0);
  assert.equal(await count(database, "admin_notification_preferences"), 0);
  observed.calls.length = 0;
  assert.equal((await portal.publicOverrides(request(), "unpublished")).status, 404);
  assert.equal(observed.calls.length, 0);
});
