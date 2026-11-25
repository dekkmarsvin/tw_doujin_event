import assert from "node:assert/strict";
import test, { after } from "node:test";
import { ADMIN, startApi } from "./support/api.mjs";

// Admin module through the router (#546 phase 6): only listed admins reach it;
// claim decisions, revocations and takedowns change what readers see at once;
// roster and account changes take effect on the next request.
const api = await startApi("api-admin");
after(() => api.close());
const { published } = api;

const NORTH = "c-900001"; // in sample
const SOUTH = "c-900002"; // in sample
const OTHER_EVENT_CIRCLE = "c-900003"; // in sample-two
const admin = await api.signIn(ADMIN);
const owner = await api.signIn("owner@example.test");
const member = await api.signIn("member@example.test");

async function claim(cookie, circleId, event = "sample") {
  const response = await api.call("POST", `/api/claims?event=${event}`, { cookie, body: { circleId } });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).id;
}
const decide = (claimId, decision, event = "sample") =>
  api.call("POST", `/api/admin/claims?event=${event}`, { cookie: admin, body: { claimId, decision } });
const save = (cookie, circleId, saleInfo) =>
  api.call("PUT", `/api/circle/${circleId}/overrides`, { cookie, body: { fields: { saleInfo } } });

test("only a listed admin reaches the admin routes", async () => {
  const routes = [
    ["GET", "/api/admin/site-settings"], ["PUT", "/api/admin/site-settings", {}], ["POST", "/api/admin/service-check", {}],
    ["GET", "/api/admin/review-queue"], ["GET", "/api/admin/claims"], ["POST", "/api/admin/claims", {}],
    ["GET", "/api/admin/overrides?q=北風"], ["POST", "/api/admin/overrides", {}], ["GET", `/api/admin/circles/${NORTH}`],
    ["GET", "/api/admin/admins"], ["POST", "/api/admin/admins", {}],
    ["GET", "/api/admin/accounts?email=owner@example.test"], ["GET", "/api/admin/accounts?circle=北風"], ["POST", "/api/admin/accounts", {}],
    ["GET", "/api/admin/references"], ["POST", "/api/admin/references", {}],
  ];
  for (const [method, path, body] of routes) {
    assert.equal((await api.call(method, path, { body })).status, 401, `anonymous ${method} ${path}`);
    assert.equal((await api.call(method, path, { body, cookie: owner })).status, 403, `non-admin ${method} ${path}`);
  }
  assert.equal((await api.call("GET", "/api/admin/review-queue", { cookie: admin })).status, 200);
});

test("approving publishes the owner's edits; revoking withdraws them at once", async () => {
  const claimId = await claim(owner, NORTH);
  const queue = await (await api.call("GET", "/api/admin/review-queue", { cookie: admin })).json();
  assert.ok(queue.claims.some((entry) => entry.id === claimId), "the pending claim reaches the review queue");

  assert.equal((await decide(claimId, "approve")).status, 200);
  assert.equal((await save(owner, NORTH, "已核准")).status, 200);
  assert.equal((await published(NORTH)).saleInfo, "已核准");

  assert.equal((await decide(claimId, "revoke")).status, 200);
  assert.equal(await published(NORTH), undefined, "revoked content leaves the public overlay in the same step");
  assert.equal((await save(owner, NORTH, "撤銷後")).status, 403);
});

test("a rejected claim grants nothing", async () => {
  const claimId = await claim(member, SOUTH);
  assert.equal((await decide(claimId, "reject")).status, 200);
  assert.equal((await save(member, SOUTH, "被婉拒")).status, 403);
  const mine = await (await api.call("GET", "/api/claims", { cookie: member })).json();
  assert.equal(mine.claims.find((entry) => entry.id === claimId).status, "rejected");
});

test("a takedown removes a circle's content from readers at once", async () => {
  await decide(await claim(owner, SOUTH), "approve");
  assert.equal((await save(owner, SOUTH, "待撤下")).status, 200);
  assert.equal((await published(SOUTH)).saleInfo, "待撤下");

  const unexplained = await api.call("POST", "/api/admin/overrides", { cookie: admin, body: { circleId: SOUTH } });
  assert.equal(unexplained.status, 400, "a takedown needs a reason");
  const takedown = await api.call("POST", "/api/admin/overrides", { cookie: admin, body: { circleId: SOUTH, reason: "檢舉成立" } });
  assert.equal(takedown.status, 200);
  assert.equal(await published(SOUTH), undefined);
  const again = await api.call("POST", "/api/admin/overrides", { cookie: admin, body: { circleId: SOUTH, reason: "檢舉成立" } });
  assert.equal(again.status, 404, "nothing live is left to take down");
});

test("a claim is decided only through its own event", async () => {
  const claimId = await claim(member, OTHER_EVENT_CIRCLE, "sample-two");
  assert.equal((await decide(claimId, "approve", "sample")).status, 404);
  assert.equal((await decide(claimId, "approve", "sample-two")).status, 200);
});

test("roster changes take effect on the next request", async () => {
  const email = "second@example.test";
  const second = await api.signIn(email);
  assert.equal((await api.call("GET", "/api/admin/admins", { cookie: second })).status, 403);

  const manage = (action, target) => api.call("POST", "/api/admin/admins", { cookie: admin, body: { action, email: target } });
  assert.equal((await manage("add", email)).status, 200);
  assert.equal((await api.call("GET", "/api/admin/admins", { cookie: second })).status, 200, "a new admin gains access at once");
  assert.equal((await manage("remove", email)).status, 200);
  assert.equal((await api.call("GET", "/api/admin/admins", { cookie: second })).status, 403, "a removed admin loses access at once");
  assert.equal((await manage("remove", ADMIN)).status, 409, "an admin cannot remove themself");
});

test("disabling an account ends its live session", async () => {
  const email = "third@example.test";
  const third = await api.signIn(email);
  const disabled = await api.call("POST", "/api/admin/accounts", { cookie: admin, body: { email } });
  assert.equal(disabled.status, 200, await disabled.clone().text());
  assert.equal((await api.call("GET", "/api/auth/session", { cookie: third })).status, 401);
  const adminTarget = await api.call("POST", "/api/admin/accounts", { cookie: admin, body: { email: ADMIN } });
  assert.equal(adminTarget.status, 409, "an admin is removed from the roster before being disabled");
});
