import assert from "node:assert/strict";
import { File } from "node:buffer";
import test, { after } from "node:test";
import { ADMIN, startApi } from "./support/api.mjs";

// Circle module through the router (#546 phase 6): a circle claims itself, is
// approved, and publishes its own content to readers. Only the approved owner
// of a circle in that event may change, read back or delete it. The tests run
// in order and share the circles' state.
const api = await startApi("api-circle");
after(() => api.close());
const { published } = api;

const NORTH = "c-900001"; // 北風畫室, in sample
const SOUTH = "c-900002"; // 南星工房, in sample
const OTHER_EVENT_CIRCLE = "c-900003"; // in sample-two
const admin = await api.signIn(ADMIN);
const owner = await api.signIn("owner@example.test");
const stranger = await api.signIn("other@example.test");

async function claim(cookie, circleId) {
  const response = await api.call("POST", "/api/claims", { cookie, body: { circleId } });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).id;
}

async function approve(claimId) {
  const response = await api.call("POST", "/api/admin/claims", { cookie: admin, body: { claimId, decision: "approve" } });
  assert.equal(response.status, 200, await response.clone().text());
}

const save = (cookie, circleId, fields, extra = {}) =>
  api.call("PUT", `/api/circle/${circleId}/overrides`, { cookie, body: { fields, ...extra } });

let png = 0;
/** Upload a distinct small PNG as a draft picture. */
async function upload(cookie, circleId) {
  png += 1;
  const form = new FormData();
  form.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, png])], "a.png", { type: "image/png" }));
  const response = await api.call("POST", `/api/circle/${circleId}/thumbnail`, { cookie, body: form });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test("a circle claims itself, is approved, and only its saved content reaches readers", async () => {
  assert.equal((await api.call("GET", "/api/circle/search?q=北風")).status, 401, "the catalog search needs a session");
  const search = await api.call("GET", "/api/circle/search?q=北風", { cookie: owner });
  assert.deepEqual((await search.json()).circles.map((circle) => circle.id), [NORTH]);

  const claimId = await claim(owner, NORTH);
  assert.equal((await save(owner, NORTH, { saleInfo: "新刊 300 元" })).status, 403, "a pending claim cannot publish");
  assert.equal(await published(NORTH), undefined);

  await approve(claimId);
  const preview = await api.call("POST", `/api/circle/${NORTH}/preview`, { cookie: owner, body: { fields: { saleInfo: "草稿" } } });
  assert.equal(preview.status, 200);
  assert.equal(await published(NORTH), undefined, "a preview publishes nothing");

  assert.equal((await save(owner, NORTH, { saleInfo: "新刊 300 元" })).status, 200);
  assert.equal((await published(NORTH)).saleInfo, "新刊 300 元");
  const mine = await api.call("GET", `/api/circle/${NORTH}/overrides`, { cookie: owner });
  assert.equal((await mine.json()).fields.saleInfo, "新刊 300 元");
});

test("nobody but the approved owner can change a circle's content", async () => {
  assert.equal((await save(null, NORTH, { saleInfo: "匿名" })).status, 401);
  assert.equal((await save(stranger, NORTH, { saleInfo: "冒名" })).status, 403);
  for (const [method, path, body] of [
    ["POST", `/api/circle/${NORTH}/preview`, { fields: { saleInfo: "冒名" } }],
    ["POST", `/api/circle/${NORTH}/visibility`, { hidden: true }],
    ["DELETE", `/api/circle/${NORTH}/overrides`, { confirm: NORTH }],
  ]) assert.equal((await api.call(method, path, { cookie: stranger, body })).status, 403, path);
  assert.equal((await published(NORTH)).saleInfo, "新刊 300 元");

  const taken = await api.call("POST", "/api/claims", { cookie: stranger, body: { circleId: NORTH } });
  assert.equal(taken.status, 409);
  assert.doesNotMatch(await taken.text(), /owner@example/, "the refusal does not name the owner");
});

test("a claim in one event authorizes nothing in another", async () => {
  for (const circleId of [NORTH, OTHER_EVENT_CIRCLE]) {
    const response = await api.call("PUT", `/api/circle/${circleId}/overrides?event=sample-two`, { cookie: owner, body: { fields: { saleInfo: "越界" } } });
    assert.equal(response.status, 403, circleId);
  }
  for (const circleId of [NORTH, OTHER_EVENT_CIRCLE]) {
    assert.equal(await published(circleId, "sample-two"), undefined, `${circleId} in sample-two`);
  }
  assert.equal((await api.call("GET", "/api/claims?event=not-published", { cookie: owner })).status, 404);
});

test("a hosted picture stays a draft until saved, is read back only by its owner, and is deleted with the content", async () => {
  const { thumbnail, uploadKey } = await upload(owner, NORTH);
  assert.equal((await published(NORTH)).thumbnail, undefined, "an upload alone publishes nothing");
  const path = `/api/circle/${NORTH}/thumbnail`;
  assert.equal((await api.call("GET", path, { cookie: owner })).status, 404, "an unsaved draft is not the saved picture");

  const saved = await save(owner, NORTH, { saleInfo: "有圖", thumbnail }, { hostedThumbnailKey: uploadKey });
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal((await published(NORTH)).thumbnail.url, thumbnail.url);
  const image = await api.call("GET", path, { cookie: owner });
  assert.equal(image.status, 200);
  assert.match(image.headers.get("cache-control"), /no-store/);
  assert.equal((await api.call("GET", path)).status, 401);
  assert.equal((await api.call("GET", path, { cookie: stranger })).status, 403);
  assert.equal((await api.call("GET", `${path}?event=sample-two`, { cookie: owner })).status, 403);

  const unconfirmed = await api.call("DELETE", `/api/circle/${NORTH}/overrides`, { cookie: owner, body: { confirm: "yes" } });
  assert.equal(unconfirmed.status, 400, "deleting needs the circle id typed back");
  const deleted = await api.call("DELETE", `/api/circle/${NORTH}/overrides`, { cookie: owner, body: { confirm: NORTH } });
  assert.equal(deleted.status, 200);
  assert.equal(await published(NORTH), undefined);
  assert.equal(await api.thumbnails.head(uploadKey), null, "the picture is deleted with it");
});

test("deleting the account takes its circle's content and pictures down and frees the circle", async () => {
  const email = "member@example.test";
  const member = await api.signIn(email);
  await approve(await claim(member, SOUTH));
  const kept = await upload(member, SOUTH);
  assert.equal((await save(member, SOUTH, { saleInfo: "即將刪除", thumbnail: kept.thumbnail }, { hostedThumbnailKey: kept.uploadKey })).status, 200);
  const abandoned = await upload(member, SOUTH);
  assert.equal((await published(SOUTH)).saleInfo, "即將刪除");

  assert.equal((await api.call("DELETE", "/api/account", { cookie: member, body: { confirm: email } })).status, 200);
  assert.equal(await published(SOUTH), undefined);
  for (const key of [kept.uploadKey, abandoned.uploadKey]) assert.equal(await api.thumbnails.head(key), null, key);
  await claim(stranger, SOUTH);
});

test("content its circle chose to hide after the event leaves readers when the event ends", async () => {
  assert.equal((await save(owner, NORTH, { saleInfo: "活動限定" })).status, 200);
  const hidden = await api.call("POST", `/api/circle/${NORTH}/visibility`, { cookie: owner, body: { hidden: true } });
  assert.equal(hidden.status, 200);
  assert.equal((await published(NORTH)).saleInfo, "活動限定", "hidden only after the event");

  // The event ending is not a write: the overlay itself must notice.
  await api.republish("sample", { eventEndsAt: "2020-01-01T00:00:00.000+08:00" });
  assert.equal(await published(NORTH), undefined);
});
