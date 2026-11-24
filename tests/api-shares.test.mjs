import assert from "node:assert/strict";
import test, { after } from "node:test";
import { ORIGIN, startApi } from "./support/api.mjs";

// Shares module through the router (#546 phase 6): an anonymous itinerary
// snapshot holds only circle ids and days, lasts until 30 days after its
// event, and stops opening when it expires or its event is withdrawn.
const api = await startApi("api-shares");
after(() => api.close());
const { onRequestGet: sharePage } = await api.load("/functions/s/[shareId].ts");
const { peppered } = await api.load("/app/portal-crypto.ts");

const EVENT_ENDS_AT = Date.parse("2099-09-02T23:59:59.999+08:00");
const DAY = 24 * 60 * 60 * 1000;
const snapshot = { version: 1, eventId: "sample", items: [{ circleId: "c-2", day: 2 }, { circleId: "c-1", day: 1 }] };
const rows = async () => (await api.database.prepare("SELECT * FROM planning_shares").all()).results;
const page = (shareId) => api.call("GET", `/s/${shareId}`, { route: sharePage, params: { shareId } });
const expireAt = (shareId, at) => api.database.prepare("UPDATE planning_shares SET expires_at = ? WHERE share_id = ?").bind(at, shareId).run();

async function share(value = snapshot) {
  const response = await api.call("POST", "/api/shares", { body: value });
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}

test("a shared itinerary opens from its link, in the API and as a page", async () => {
  const created = await share();
  assert.equal(created.url, `${ORIGIN}/s/${created.shareId}`);
  assert.equal(created.expiresAt, EVENT_ENDS_AT + 30 * DAY, "a share lasts 30 days past its event");

  const read = await api.call("GET", `/api/shares/${created.shareId}`);
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), { snapshot, expiresAt: created.expiresAt }, "the public answer carries nothing else");

  const opened = await page(created.shareId);
  assert.equal(opened.status, 200);
  const html = await opened.text();
  assert.match(html, /範例創作市集 逛攤清單/);
  assert.ok(html.includes(`url=/?event=sample&amp;share=${created.shareId}`), "the page sends the reader to the itinerary");
});

test("only circle ids and days are stored; anything private is refused", async () => {
  const before = (await rows()).length;
  for (const value of [
    { ...snapshot, memo: "秘密備註" },
    { ...snapshot, items: [{ ...snapshot.items[0], email: "private@example.test" }] },
    { ...snapshot, eventId: "not-published" },
  ]) {
    const response = await api.call("POST", "/api/shares", { body: value });
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /秘密|private@example/);
  }
  assert.equal((await rows()).length, before);

  const created = await share();
  const stored = (await rows()).find((row) => row.share_id === created.shareId);
  assert.deepEqual(JSON.parse(stored.items_json), snapshot.items);
  assert.equal(stored.request_ip_hash, await peppered(api.env.HASH_PEPPER, "192.0.2.10"), "the address is kept only as a peppered hash");
});

test("an expired share no longer opens, and is never cached past its expiry", async () => {
  const created = await share();
  await expireAt(created.shareId, Date.now() + 500);
  const closing = await api.call("GET", `/api/shares/${created.shareId}`);
  assert.equal(closing.status, 200);
  assert.equal(closing.headers.get("cache-control"), "private, max-age=0");

  await expireAt(created.shareId, 0);
  assert.equal((await api.call("GET", `/api/shares/${created.shareId}`)).status, 410);
  assert.equal((await page(created.shareId)).status, 410);
  assert.equal((await api.call("GET", `/api/shares/${"A".repeat(22)}`)).status, 404);
});

test("a share of a withdrawn event no longer opens", async () => {
  const created = await share();
  const published = await (await api.eventData.get("index.json")).text();
  await api.eventData.put("index.json", JSON.stringify({ ...JSON.parse(published), events: [] }));
  try {
    const opened = await page(created.shareId);
    assert.equal(opened.status, 404);
    assert.doesNotMatch(await opened.text(), /範例創作市集/);
  } finally {
    await api.eventData.put("index.json", published);
  }
});
