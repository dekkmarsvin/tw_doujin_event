import assert from "node:assert/strict";
import test, { after } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer } from "vite";
import { previewResources, previewOrigin } from "../scripts/preview-e2e-resources.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const load = file => vite.environments.ssr.runner.import(file);
const { createIdentityRepository } = await load("/db/identity-repository.ts");
const { previewFixture } = await load("/app/preview-fixture.ts");
const { previewMailRouteFor } = await load("/app/portal-mail.ts");
const { onRequestPost, onRequestDelete } = await load("/functions/api/preview/mail.ts");
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: { DB: "fixture-preview" } }));
const db = await mf.getD1Database("DB");
const repository = createIdentityRepository(db);
await repository.ensureTables();
after(async () => { await mf.dispose(); await vite.close(); });
const a = previewFixture("run-111111-1"), b = previewFixture("run-222222-1");
const objects = new Map([["human/map.png", "keep"]]);
const bucket = { get: async key => objects.has(key) ? { body: new Response(objects.get(key)).body } : null,
  list: () => assert.fail("remote fixture must not list a bucket"), delete: () => assert.fail("remote fixture must not delete bucket objects") };
const env = { DB: db, THUMBNAILS: bucket, MAP_CONTRIBUTIONS: bucket, PREVIEW_MAIL_SINK: "d1", PREVIEW_E2E_TOKEN: "fixture-token",
  PREVIEW_TEST_RECIPIENTS: "preview-admin@example.test,preview-circle@example.test", HASH_PEPPER: "fixture-pepper" };
const request = (method, body) => new Request("https://1234abcd.tw-catalog.pages.dev/api/preview/mail", { method,
  headers: { "x-preview-e2e-token": env.PREVIEW_E2E_TOKEN, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

async function seed() {
  await repository.clearPreviewData();
  for (const f of [a, b]) {
    for (const email of [f.circleEmail, f.adminEmail]) await repository.upsertAccount(email, 1);
  }
  await repository.upsertAccount("human@example.com", 1);
  for (const [email, circleId] of [[a.circleEmail, "c-000001"], [b.circleEmail, "c-000002"], ["human@example.com", "c-000003"]]) {
    const account = await db.prepare("SELECT id FROM accounts WHERE email=?1").bind(email).first();
    await db.prepare("INSERT INTO circle_claims (id,account_id,event_id,circle_id,circle_name_key,circle_name_at_claim,status,created_at) VALUES (?1,?2,'ff47',?1,'fixture','fixture','verified',1)").bind(circleId, account.id).run();
    await db.prepare("INSERT INTO circle_overrides (id,event_id,circle_id,fields_json,updated_by,created_at,updated_at) VALUES (?1,'ff47',?1,?2,?3,1,1)").bind(circleId, JSON.stringify({ saleInfo: email }), account.id).run();
    await repository.createSession(account.id, 1, 99999999, `session-${circleId}`);
    await repository.storePreviewMail({ email, subject: "login", text: "keep scoped", now: 2 });
    await repository.writeAudit({ at: 1, actorAccountId: account.id, actorRole: "circle", action: "fixture", subjectType: "claim", subjectId: circleId });
  }
  await repository.rebuildOverridesDoc("ff47", new Date(1).toISOString(), 1, "during");
}

test("only reserved per-run aliases inherit the explicit sink allowlist", () => {
  assert.equal(previewMailRouteFor(env, a.circleEmail), "sink");
  for (const email of ["preview-circle+someone@example.test", "preview-circle+e2e-12345678@example.com", "human+e2e-12345678@example.test"]) assert.equal(previewMailRouteFor(env, email), null);
  assert.equal(previewMailRouteFor({ ...env, PREVIEW_TEST_RECIPIENTS: "" }, a.circleEmail), null);
  assert.equal(previewMailRouteFor({ ...env, PREVIEW_MAIL_SINK: undefined }, a.circleEmail), null);
});

test("a remote caller cannot invoke full reset, choose arbitrary accounts or bypass the preview token", async () => {
  await seed();
  for (const body of [undefined, {}, { runId: "../human" }, { email: "human@example.com" }]) {
    assert.equal((await onRequestDelete({ request: request("DELETE", body), env })).status, 400);
  }
  assert.equal((await onRequestDelete({ request: request("DELETE"), env: { ...env, LOCAL_PORTAL_DISPOSABLE: "true" } })).status, 400, "a local flag never permits a remote full reset");
  assert.equal((await onRequestDelete({ request: request("DELETE", { runId: a.runId }), env: { ...env, PREVIEW_E2E_TOKEN: "different" } })).status, 404);
  assert.equal((await onRequestPost({ request: request("POST", { runId: a.runId }), env: { ...env, PREVIEW_MAIL_SINK: undefined } })).status, 404);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM accounts").first()).n, 5);
});

test("remote cleanup preserves another run, manual preview data and all R2 objects, including on retry", async () => {
  await seed();
  const body = { runId: a.runId };
  assert.equal((await onRequestPost({ request: request("POST", body), env })).status, 200);
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await onRequestDelete({ request: request("DELETE", body), env })).status, 200);
  assert.deepEqual((await db.prepare("SELECT email FROM accounts ORDER BY email").all()).results.map(row => row.email), ["human@example.com", b.adminEmail, b.circleEmail].sort());
  assert.deepEqual((await db.prepare("SELECT circle_id FROM circle_claims ORDER BY circle_id").all()).results.map(row => row.circle_id), ["c-000002", "c-000003"]);
  const overlay = JSON.parse((await repository.getOverridesDoc("ff47")).json);
  assert.deepEqual(overlay.overrides.map(row => row.circleId), ["c-000002", "c-000003"]);
  assert.equal(overlay.overrides[1].fields.saleInfo, "human@example.com");
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM audit_log").first()).n, 2);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sessions").first()).n, 2);
  assert.equal((await repository.latestPreviewMail("human@example.com")).text, "keep scoped");
  assert.equal(await repository.isAdminEmail(a.adminEmail), false);
  assert.equal(objects.get("human/map.png"), "keep");
  assert.equal(objects.size, 1);
});

test("a new run clears reserved fixtures left by finished runs, never manual or lookalike data", async () => {
  await seed();
  const current = previewFixture("run-333333-1"), orphan = previewFixture("run-444444-1");
  // Only readiness may list its circle's image prefix; the sweep never lists R2.
  const readiness = () => onRequestPost({ request: request("POST", { runId: current.runId, eventId: "ff47", circleId: "c-000001" }),
    env: { ...env, THUMBNAILS: { ...bucket, list: async () => ({ objects: [], truncated: false }) } } });
  // A finished run whose cleanup never landed blocks its circle for every later run.
  assert.equal((await readiness()).status, 409);
  // A run that ended before any account existed still left a link and captured mail.
  await repository.createLoginToken({ tokenHash: "orphan-hash", email: orphan.circleEmail, now: 3, expiresAt: 4, ipHash: null });
  await repository.storePreviewMail({ email: orphan.adminEmail, subject: "login", text: "orphan", now: 3 });
  const lookalikes = ["preview-circle+someone@example.test", "human+e2e-12345678@example.test", "preview-circle+e2e-12345678@example.com"];
  for (const email of lookalikes) await repository.upsertAccount(email, 1);
  const sweep = () => onRequestDelete({ request: request("DELETE", { runId: current.runId, finishedRuns: true }), env });
  const response = await sweep();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).cleared, [a.runId, b.runId, orphan.runId]);
  assert.deepEqual((await db.prepare("SELECT email FROM accounts ORDER BY email").all()).results.map(row => row.email), ["human@example.com", ...lookalikes].sort());
  assert.deepEqual((await db.prepare("SELECT circle_id FROM circle_claims").all()).results.map(row => row.circle_id), ["c-000003"]);
  assert.deepEqual(JSON.parse((await repository.getOverridesDoc("ff47")).json).overrides.map(row => row.circleId), ["c-000003"]);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM login_tokens").first()).n, 0);
  assert.equal((await repository.latestPreviewMail(orphan.adminEmail)), null);
  assert.equal((await repository.latestPreviewMail("human@example.com")).text, "keep scoped");
  assert.equal(objects.get("human/map.png"), "keep");
  assert.equal((await readiness()).status, 200, "the finished run no longer blocks its circle");
  assert.deepEqual((await (await sweep()).json()).cleared, []);
  for (const finishedRuns of [false, "yes"]) {
    assert.equal((await onRequestDelete({ request: request("DELETE", { runId: current.runId, finishedRuns }), env })).status, 400);
  }
});

test("fixture readiness refuses hidden source data, historical claims and orphan images before product mutations", async () => {
  await seed();
  await db.prepare("UPDATE circle_claims SET status='revoked' WHERE circle_id='c-000003'").run();
  await db.prepare("UPDATE circle_overrides SET status='takendown' WHERE circle_id='c-000003'").run();
  assert.equal((await repository.listLiveOverrides("ff47", "during")).some(row => row.circle_id === "c-000003"), false);
  const target = { runId: a.runId, eventId: "ff47", circleId: "c-000003" };
  assert.equal((await onRequestPost({ request: request("POST", target), env })).status, 409);
  assert.equal((await repository.getOverride("ff47", "c-000003")).fields_json, JSON.stringify({ saleInfo: "human@example.com" }));
  await db.prepare("DELETE FROM circle_overrides WHERE circle_id='c-000003'").run();
  assert.equal((await onRequestPost({ request: request("POST", target), env })).status, 409, "even a revoked claim reserves this human fixture");
  const prefix = "events/ff47/circles/c-000009/";
  const key = prefix+"orphan.png";
  objects.set(key, "manual image");
  const readinessEnv = { ...env, THUMBNAILS: { ...bucket, list: async options => {
    assert.deepEqual(options, { prefix, limit: 1 });
    return { objects: [...objects.keys()].filter(k => k.startsWith(options.prefix)).map(key => ({ key })), truncated: false };
  } } };
  const emptyTarget = { ...target, circleId: "c-000009" };
  assert.equal((await onRequestPost({ request: request("POST", emptyTarget), env: readinessEnv })).status, 409);
  assert.equal(objects.get(key), "manual image");
  objects.delete(key);
  assert.equal((await onRequestPost({ request: request("POST", emptyTarget), env: readinessEnv })).status, 200);
  assert.equal((await onRequestPost({ request: request("POST", { ...emptyTarget, eventId: "../ff47" }), env: readinessEnv })).status, 400);
});

test("resource selection rejects overlap and deployed metadata drift; origin must be immutable preview", () => {
  const envConfig = (id, suffix) => ({ d1_databases: [{ binding: "DB", database_id: id.repeat(8)+"-"+id.repeat(4)+"-"+id.repeat(4)+"-"+id.repeat(4)+"-"+id.repeat(12) }],
    r2_buckets: ["THUMBNAILS", "MAP_CONTRIBUTIONS"].map(binding => ({ binding, bucket_name: binding.toLowerCase().replaceAll("_", "-")+suffix })) });
  const production = envConfig("a", ""), preview = envConfig("b", "-preview");
  const config = { ...production, env: { preview } };
  const deployed = c => ({ d1_databases: { DB: { id: c.d1_databases[0].database_id } }, r2_buckets: Object.fromEntries(c.r2_buckets.map(b => [b.binding, { name: b.bucket_name }])) });
  const expected = { deploymentId: "a".repeat(8)+"-"+"a".repeat(4)+"-"+"a".repeat(4)+"-"+"a".repeat(4)+"-"+"a".repeat(12), baseUrl: "https://abcd1234.tw-catalog.pages.dev", sha: "f".repeat(40) };
  expected.productionDeployment = { ...deployed(production), id: expected.deploymentId, project_name: "tw-catalog", environment: "production",
    latest_stage: { name: "deploy", status: "success" } };
  const deployment = { ...deployed(preview), id: expected.deploymentId, project_name: "tw-catalog", environment: "preview", url: expected.baseUrl,
    deployment_trigger: { metadata: { commit_hash: expected.sha } }, latest_stage: { name: "deploy", status: "success" } };
  assert.equal(previewResources(config, deployment, expected).databaseId, preview.d1_databases[0].database_id);
  assert.throws(() => previewResources({ ...config, env: { preview: production } }, deployment, expected));
  assert.throws(() => previewResources(config, deployment, { ...expected, productionDeployment: null }));
  for (const field of ["d1_databases", "r2_buckets"]) {
    const active = { ...expected.productionDeployment, [field]: deployed(preview)[field] };
    assert.throws(() => previewResources(config, deployment, { ...expected, productionDeployment: active }), "repo declarations cannot hide overlap with actual production");
  }
  for (const mutate of [d => { d.d1_databases.DB.id = production.d1_databases[0].database_id; },
    d => { d.r2_buckets.THUMBNAILS.name = "wrong"; }, d => { delete d.r2_buckets.MAP_CONTRIBUTIONS; },
    d => { d.environment = "production"; }, d => { d.url = "https://tw-catalog.pages.dev"; },
    d => { d.deployment_trigger.metadata.commit_hash = "a".repeat(40); }, d => { d.latest_stage.status = "failure"; },
    d => { d.id = "other"; }, d => { d.project_name = "other"; }]) {
    const wrong = structuredClone(deployment); mutate(wrong);
    assert.throws(() => previewResources(config, wrong, expected));
  }
  assert.equal(previewOrigin("https://abcd1234.tw-catalog.pages.dev/"), "https://abcd1234.tw-catalog.pages.dev");
  for (const url of ["https://tw-catalog.pages.dev", "https://pr-1.tw-catalog.pages.dev", "https://abcd1234.tw-catalog.pages.dev.evil.test", "http://abcd1234.tw-catalog.pages.dev", "https://abcd1234.tw-catalog.pages.dev/path"]) assert.throws(() => previewOrigin(url));
});
