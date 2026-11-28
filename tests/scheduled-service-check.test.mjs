import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createServer } from "vite";
import { applyMigrations } from "./support/d1-migrations.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const load = name => vite.environments.ssr.runner.import(name);
const { createIdentityRepository } = await load("/db/identity-repository.ts");
const { runScheduledServiceCheck, alertMime } = await load("/db/scheduled-service-check.ts");
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}",
  d1Databases: { DB: "scheduled-service-check", UNTOUCHED: "scheduled-service-check-untouched" } }));
const db = await mf.getD1Database("DB");
await applyMigrations(db);
const repo = createIdentityRepository(db);
after(async () => { await mf.dispose(); await vite.close(); });

const HOUR = 3_600_000, NOW = Date.UTC(2027, 0, 1);
const env = { MAILGUN_API_KEY: "never-mail-this-key", MAILGUN_DOMAIN: "mail.example.test", SITE_ORIGIN: "https://map.example.test", ENVIRONMENT_NAME: "正式站" };
// Each run reads the current "world": what Mailgun and the public index answer.
let world;
const fetch = async url => {
  if (new URL(url).hostname === "api.mailgun.net") return world.mail === "ok"
    ? Response.json({ domain: { name: "mail.example.test", state: "active" } })
    : new Response("provider-secret-body", { status: world.mail === "unknown" ? 403 : 401 });
  if (world.index === "slow") throw new DOMException("The operation timed out.", "TimeoutError");
  return world.index === "ok" ? Response.json({ events: [] }) : world.index === "html" ? new Response("<html>") : new Response("", { status: 503 });
};
let letters;
const run = (at, options = {}) => runScheduledServiceCheck({ db, env, now: at, fetch, sendAlert: async letter => { letters.push(letter); }, ...options });

beforeEach(async () => {
  await repo.ensureTables(); await repo.clearPreviewData();
  await db.prepare("DELETE FROM site_service_check").run();
  await db.prepare("DELETE FROM account_notification_items").run();
  world = { mail: "ok", index: "ok" }; letters = [];
});

test("an hourly run updates the record /admin reads and a manual check keeps its items", async () => {
  await run(NOW);
  let services = await repo.getServiceChecks();
  assert.equal(services.checkedAt, NOW);
  assert.deepEqual([services.mail.status, services.reader.status, services.notifications.status], ["available", "available", "available"]);
  assert.equal(services.publication, null);
  assert.equal("alert" in services, false, "alert state is not part of the admin API");

  await repo.requestServiceCheck(NOW + 1);
  const waiting = await repo.getServiceChecks();
  assert.equal(waiting.mail, null, "a waiting request does not show the old mail result as its answer");
  assert.equal(waiting.reader.status, "available", "hourly items stay visible while a manual check waits");
  const { requestedAt } = waiting;
  await repo.completeServiceCheck(requestedAt, NOW + 2, { mail: services.mail, publication: { status: "available", source: "發布", reason: "ok" } });
  services = await repo.getServiceChecks();
  assert.equal(services.publication.status, "available");
  assert.equal(services.reader.status, "available", "a manual check does not drop the hourly items");

  world.mail = "bad";
  await run(NOW + HOUR);
  services = await repo.getServiceChecks();
  assert.equal(services.publication.status, "available", "the hourly run keeps the last publication result");
  assert.equal(letters.length, 1, "the alert state survived the manual check, so this is a real transition");
});

test("alerts once when a service breaks, once when it recovers, and not in between", async () => {
  await run(NOW);
  assert.equal(letters.length, 0);
  world.mail = "bad";
  await run(NOW + HOUR);
  assert.equal(letters.length, 1);
  assert.match(letters[0].subject, /【正式站】服務異常：寄信服務/);
  assert.match(letters[0].text, /寄信服務：不可用（Mailgun：金鑰驗證失敗。）/);
  assert.doesNotMatch(JSON.stringify(letters), /never-mail-this-key|provider-secret-body/);
  await run(NOW + 2 * HOUR);
  world.mail = "unknown";
  await run(NOW + 3 * HOUR);
  assert.equal(letters.length, 1, "still down, then unknown: no repeat and no false recovery");
  world.mail = "ok";
  await run(NOW + 4 * HOUR);
  assert.equal(letters.length, 2);
  assert.match(letters[1].subject, /服務已恢復：寄信服務/);
});

test("an unknown result alone never alerts", async () => {
  world.mail = "unknown";
  await run(NOW);
  assert.equal(letters.length, 0);
  assert.equal((await repo.getServiceChecks()).mail.status, "unknown");
});

test("an unreadable or invalid event index is an outage", async () => {
  world.index = "down";
  await run(NOW);
  assert.equal((await repo.getServiceChecks()).reader.status, "unavailable");
  assert.match(letters[0].subject, /讀取服務/);
  world.index = "html";
  await run(NOW + HOUR);
  assert.equal((await repo.getServiceChecks()).reader.status, "unavailable");
  assert.equal(letters.length, 1);
});

test("a slow event index is recorded as unknown and does not alert", async () => {
  world.index = "slow";
  await run(NOW);
  assert.equal((await repo.getServiceChecks()).reader.status, "unknown");
  assert.equal(letters.length, 0);
});

test("an hourly run leaves a waiting manual request for the Pages check to answer", async () => {
  await run(NOW);
  await repo.requestServiceCheck(NOW + 1);
  const { requestedAt } = await repo.getServiceChecks();
  await run(NOW + 2);
  assert.equal((await repo.getServiceChecks()).checkedAt, null);
  await repo.completeServiceCheck(requestedAt, NOW + 3, { mail: { status: "available", source: "Mailgun", reason: "ok" },
    publication: { status: "available", source: "發布", reason: "ok" } });
  const services = await repo.getServiceChecks();
  assert.equal(services.checkedAt, NOW + 3);
  assert.equal(services.publication.status, "available");
});

test("notifications waiting over an hour or newly failing are an outage", async () => {
  const account = await repo.upsertAccount("reader@example.test", NOW);
  const insert = (id, state, dueAt) => db.prepare(`INSERT INTO account_notification_items
    (id, account_id, kind, occurrence, source_id, audience, name, occurred_at, due_at, state)
    VALUES (?1, ?2, 'claim.approved', ?1, 's', 'circle', 'n', ?3, ?3, ?4)`).bind(id, account, dueAt, state).run();
  await insert("failed-before", "failed", NOW - 5 * HOUR);
  await insert("due-soon", "pending", NOW - HOUR / 2);
  await run(NOW);
  assert.equal((await repo.getServiceChecks()).notifications.status, "available", "existing failures are the baseline, not news");
  await insert("failed-now", "failed", NOW);
  await run(NOW + HOUR / 4);
  assert.match((await repo.getServiceChecks()).notifications.reason, /1 則通知無法寄出/);
  await run(NOW + HOUR);
  assert.match((await repo.getServiceChecks()).notifications.reason, /超過 1 小時/, "due-soon is now overdue");
  assert.equal(letters.length, 1, "still abnormal, so no second alert");
});

test("a failed send is tried again next hour; no recipient only records", async () => {
  world.mail = "bad";
  await run(NOW, { sendAlert: async () => { throw new Error("routing refused"); } });
  await run(NOW + HOUR);
  assert.equal(letters.length, 1, "the earlier send failed, so the transition is still pending");

  const account = await repo.upsertAccount("reader@example.test", NOW);
  await run(NOW + 2 * HOUR);
  await db.prepare(`INSERT INTO account_notification_items (id, account_id, kind, occurrence, source_id, audience, name, occurred_at, due_at, state)
    VALUES ('lost', ?1, 'claim.approved', 'lost', 's', 'circle', 'n', ?2, ?2, 'failed')`).bind(account, NOW).run();
  await run(NOW + 3 * HOUR, { sendAlert: async () => { throw new Error("routing refused"); } });
  await run(NOW + 4 * HOUR);
  assert.match(letters.at(-1).subject, /服務異常：通知寄送/, "a new notification failure is alerted after a failed send too");

  await db.prepare("DELETE FROM site_service_check").run();
  const summary = await run(NOW + 5 * HOUR, { sendAlert: undefined });
  assert.equal(summary.alert, "not_configured");
  assert.equal((await repo.getServiceChecks()).mail.status, "unavailable");
});

test("never creates schema in a database no Function has reached", async () => {
  const untouched = await mf.getD1Database("UNTOUCHED");
  assert.deepEqual(await runScheduledServiceCheck({ db: untouched, env, now: NOW, fetch }), { skipped: true });
  assert.equal((await untouched.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('site_service_check', 'account_notification_items')").first()).n, 0);
});

test("the alert mail is UTF-8 MIME addressed only to the configured recipient", () => {
  const subject = "【正式站】服務異常：寄信服務、讀取服務、通知寄送";
  const raw = alertMime({ subject, text: "寄信服務：不可用" }, "ops@example.test", NOW);
  assert.match(raw, /^From: alerts@kotoban\.top\r\nTo: ops@example\.test\r\n/);
  const words = raw.match(/=\?UTF-8\?B\?[^?]+\?=/g);
  assert.ok(words.length > 1 && words.every(word => word.length <= 75), "each encoded word stays within RFC 2047's limit");
  const decode = text => new TextDecoder().decode(Uint8Array.from(atob(text), c => c.charCodeAt(0)));
  assert.equal(words.map(word => decode(word.slice(10, -2))).join(""), subject);
  const body = raw.split("\r\n\r\n")[1].replace(/\r\n/g, "");
  assert.equal(new TextDecoder().decode(Uint8Array.from(atob(body), c => c.charCodeAt(0))), "寄信服務：不可用");
});
