import assert from "node:assert/strict";
import { File } from "node:buffer";
import { crc32, deflateSync } from "node:zlib";
import test, { after } from "node:test";
import { ADMIN, startApi } from "./support/api.mjs";

// Organizer module through the router (#546 phase 6): an admin opens an event
// for its owner, the owner prepares and submits it, and an admin's approval
// publishes it to R2 in the same request. Only the owner and admins reach the
// event; only admins approve. A failed write never moves `index.json`, and a
// rollback is restoring an earlier index. The tests run in order.
const api = await startApi("api-organizer", { env: { ORGANIZER_PUBLICATION_MODE: "r2" } });
after(() => api.close());

const EVENT_ID = "pf45-rf14";
const VENUE_ID = "taipei-expo-park-zhengyan-hall";
const VENUE_SPACE_ID = "zhengyan-exhibition-area";
const admin = await api.signIn(ADMIN);
let owner; // signs in after the invitation, as an owner opening it does
const stranger = await api.signIn("other@example.test", { audience: "organizer" });
const state = {};

const events = (path) => `/api/organizer/events/${state.candidateId}${path}`;
const version = async (candidateId = state.candidateId, cookie = owner) =>
  (await (await api.call("GET", `/api/organizer/events/${candidateId}`, { cookie })).json()).event.version;
async function ok(response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}
const review = (candidateId, expectedVersion, cookie = admin) =>
  api.call("POST", `/api/admin/organizer/events/${candidateId}/review`, { cookie, body: { expectedVersion, decision: "approve" } });
async function updateSettings(patch) {
  const { settings } = await ok(await api.call("GET", "/api/admin/site-settings", { cookie: admin }));
  // The editable settings, as the admin page sends them back.
  const editable = ["organizerApplicationMode", "organizerAllowedEmails", "accountNotificationsEnabled", "adminReviewNotificationsEnabled",
    "publicationEnabled", "contactUrl", "claimReviewNotice"];
  const current = Object.fromEntries(editable.map((key) => [key, settings[key]]));
  await ok(await api.call("PUT", "/api/admin/site-settings", { cookie: admin,
    body: { expectedUpdatedAt: settings.updatedAt, settings: { ...current, ...patch } } }));
}
/** A blank PNG of the given size: event pictures are checked for their dimensions. */
function png(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8;
  return new File([Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((width + 1) * height))), chunk("IEND", Buffer.alloc(0))])], "event.png", { type: "image/png" });
}
const publishedEvent = async (eventId = EVENT_ID) =>
  (await api.readerFile("index.json")).events.find((entry) => entry.id === eventId || entry.eventId === eventId);

test("an admin opens an event for its owner; nobody else reaches it", async () => {
  assert.equal((await api.call("POST", "/api/admin/organizer/events", { cookie: stranger,
    body: { tentativeName: "PF45 x RF14", ownerEmail: "owner@example.test" } })).status, 403, "only admins open events");
  const created = await ok(await api.call("POST", "/api/admin/organizer/events", { cookie: admin,
    body: { tentativeName: "PF45 x RF14", ownerEmail: "owner@example.test" } }), 201);
  state.candidateId = created.candidateId;
  owner = await api.signIn("owner@example.test", { audience: "organizer" });

  assert.equal((await api.call("GET", "/api/organizer/events")).status, 401);
  const mine = await ok(await api.call("GET", "/api/organizer/events", { cookie: owner }));
  assert.ok(mine.events.some((event) => event.id === state.candidateId));
  const theirs = await ok(await api.call("GET", "/api/organizer/events", { cookie: stranger }));
  assert.equal(theirs.events.some((event) => event.id === state.candidateId), false);
  for (const [method, path, body] of [
    ["GET", ""], ["PATCH", "", { expectedVersion: 1, draft: {} }], ["POST", "/submit", { expectedVersion: 1 }],
    ["POST", "/collaborators", { email: "other@example.test", action: "invite" }], ["GET", "/maps"],
  ]) assert.equal((await api.call(method, events(path), { cookie: stranger, body })).status, 404, `${method} ${path}`);
});

test("the owner prepares and submits the event; only an admin approves it", async () => {
  const reference = (body) => api.call("POST", events("/references"), { cookie: owner, body: { expectedVersion: 1, ...body } });
  const organizer = await ok(await reference({ kind: "organizer", name: "測試主辦", sourceUrl: "https://organizer.example/" }), 201);
  const catalog = await ok(await reference({ kind: "category-catalog", organizerId: organizer.created.id, name: "官方分類",
    sourceUrl: "https://organizer.example/categories", categories: [{ label: "原創", description: "原創作品" }] }), 201);
  const form = new FormData();
  form.set("file", png(1200, 630));
  const { image } = await ok(await api.call("PUT", events("/image"), { cookie: owner, body: form }));
  state.image = image;
  const picture = `${events("/image")}?sha256=${image.sha256}&contentType=image/png`;
  assert.equal((await api.call("GET", picture, { cookie: owner })).status, 200);
  assert.equal((await api.call("GET", picture, { cookie: stranger })).status, 404);

  const draft = {
    schema: "organizer-event-draft/1",
    references: { organizerAssignments: [{ organizerId: organizer.created.id, role: "lead" }], categoryCatalog: catalog.created },
    event: { id: EVENT_ID, name: "PF45 x RF14", days: [{ id: "1", label: "第一日", date: "2099-11-07" }], image },
    venue: { assignments: [{ venueId: VENUE_ID, venueSpaceId: VENUE_SPACE_ID, areaIds: ["ALL"], mapTemplate: "TAIWAN_GENERIC_V1", areaMode: "none" }] },
    officialSource: { label: "主辦提供名單", url: "https://organizer.example/pf45" },
  };
  state.draft = draft;
  await ok(await api.call("PATCH", events(""), { cookie: owner, body: { expectedVersion: 1, draft } }));
  await ok(await api.call("PUT", events("/imports"), { cookie: owner, body: {
    expectedVersion: await version(),
    source: { fileName: "official.csv", worksheet: null, sha256: "a".repeat(64), sourceDescription: "主辦提供", mapping: { day: { fixed: "1" } } },
    rows: [{ sourceRow: 2, dayId: "1", venueSpaceId: VENUE_SPACE_ID, areaId: "ALL", codes: ["A01", "A02"], circleName: "甲社", stableKey: null, identityGroup: null }],
  } }));
  await ok(await api.call("POST", events("/maps"), { cookie: owner, body: {
    expectedVersion: await version(), periodKey: "1", venueSpaceId: VENUE_SPACE_ID,
    layout: {
      version: 2, template: "TAIWAN_GENERIC_V1", width: 100, height: 80, floor: { x: 0, y: 0, width: 100, height: 80 },
      rows: [{ label: "A", orientation: "horizontal", confidence: 1, slots: [
        { code: "A01", rect: { x: 5, y: 5, width: 10, height: 8 } }, { code: "A02", rect: { x: 20, y: 5, width: 10, height: 8 } }] }],
      pillars: [], accessPoints: [], landmarks: [],
    },
  } }), 201);
  assert.deepEqual((await ok(await api.call("POST", events("/validate"), { cookie: owner, body: {} }))).issues, []);

  state.submittedVersion = await version();
  await ok(await api.call("POST", events("/submit"), { cookie: owner, body: { expectedVersion: state.submittedVersion } }));
  assert.equal((await review(state.candidateId, state.submittedVersion, owner)).status, 403, "an owner cannot approve");
  assert.equal(await publishedEvent(), undefined);
  assert.equal(await api.thumbnails.head(`event-images/${image.sha256}.png`), null, "the picture is not public before approval");
});

test("a publication that fails before the index is written changes nothing readers see", async () => {
  await updateSettings({ publicationEnabled: true });

  const bucket = api.env.EVENT_DATA;
  const indexBefore = await (await bucket.get("index.json")).text();
  const failing = (prefix) => new Proxy(bucket, { get: (target, key) => key === "put"
    ? async (name, ...rest) => { if (name.startsWith(prefix)) throw new Error("R2 unavailable"); return target.put(name, ...rest); }
    : typeof target[key] === "function" ? target[key].bind(target) : target[key] });
  const retry = (cookie = owner) => api.call("POST", `/api/organizer/publications/${state.jobId}/retry`, { cookie, body: {} });
  // First an event file fails, then, with every file written, the history copy
  // right before the index. Neither may move the pointer.
  for (const [prefix, attempt] of [[`events/${EVENT_ID}/`, () => review(state.candidateId, state.submittedVersion)], ["history/", retry]]) {
    api.env.EVENT_DATA = failing(prefix);
    try {
      const failed = await ok(await attempt());
      assert.equal(failed.status, "failed", prefix);
      state.jobId ??= failed.publicationJobId;
    } finally {
      api.env.EVENT_DATA = bucket;
    }
    assert.equal(await (await bucket.get("index.json")).text(), indexBefore, `the pointer did not move when ${prefix} failed`);
    assert.equal(await publishedEvent(), undefined);
    assert.equal(await api.readerFile(EVENT_ID, "event.json"), null);
  }

  assert.equal((await retry(stranger)).status, 404);
  assert.equal((await ok(await retry())).status, "published");
  assert.equal((await publishedEvent()).definition.name, "PF45 x RF14");
  assert.equal((await api.readerFile(EVENT_ID, "event.json")).name, "PF45 x RF14");
  assert.ok((await api.readerFile("sample", "event.json")), "the other events stay published");
  assert.ok(await api.thumbnails.head(`event-images/${state.image.sha256}.png`), "approval made the picture public");
});

test("the owner moderates its own published event's circles and nobody else's", async () => {
  const [circle] = (await api.readerFile(EVENT_ID, "circles.json")).circles;
  const member = await api.signIn("member@example.test");
  const claimed = await ok(await api.call("POST", `/api/claims?event=${EVENT_ID}`, { cookie: member, body: { circleId: circle.id } }), 201);

  const pending = await ok(await api.call("GET", events("/claims"), { cookie: owner }));
  assert.ok(pending.claims.some((entry) => entry.id === claimed.id));
  assert.equal((await api.call("GET", events("/claims"), { cookie: stranger })).status, 404);
  assert.equal((await api.call("POST", events("/claims"), { cookie: stranger, body: { claimId: claimed.id, decision: "approve" } })).status, 404);
  await ok(await api.call("POST", events("/claims"), { cookie: owner, body: { claimId: claimed.id, decision: "approve" } }));

  await ok(await api.call("PUT", `/api/circle/${circle.id}/overrides?event=${EVENT_ID}`, { cookie: member, body: { fields: { saleInfo: "首賣" } } }));
  assert.equal((await api.published(circle.id, EVENT_ID)).saleInfo, "首賣");

  const takedown = { circleId: circle.id, reason: "主辦撤下" };
  assert.equal((await api.call("POST", events("/overrides"), { cookie: stranger, body: takedown })).status, 404);
  await ok(await api.call("POST", events("/overrides"), { cookie: owner, body: takedown }));
  assert.equal(await api.published(circle.id, EVENT_ID), undefined, "the takedown reaches readers at once");
});

test("an owner's draft that names another published event gives no authority over it", async () => {
  // Live content in the fixture event `sample`, which this owner does not run.
  const NORTH = "c-900001";
  const circleOwner = await api.signIn("member@example.test");
  const claimed = await ok(await api.call("POST", "/api/claims", { cookie: circleOwner, body: { circleId: NORTH } }), 201);
  await ok(await api.call("POST", "/api/admin/claims", { cookie: admin, body: { claimId: claimed.id, decision: "approve" } }));
  await ok(await api.call("PUT", `/api/circle/${NORTH}/overrides`, { cookie: circleOwner, body: { fields: { saleInfo: "別場內容" } } }));

  const created = await ok(await api.call("POST", "/api/admin/organizer/events", { cookie: admin,
    body: { tentativeName: "借名草稿", ownerEmail: "owner@example.test" } }), 201);
  owner = await api.signIn("owner@example.test", { audience: "organizer" }); // opens the new invitation
  const draftPath = (suffix) => `/api/organizer/events/${created.candidateId}${suffix}`;
  const event = { ...state.draft.event, id: "sample" };
  delete event.image; // the picture belongs to the first event's candidate
  await ok(await api.call("PATCH", draftPath(""), { cookie: owner, body: { expectedVersion: 1, draft: { ...state.draft, event } } }));

  assert.equal((await api.call("GET", draftPath("/claims"), { cookie: owner })).status, 404, "no claim queue of another event");
  assert.equal((await api.call("POST", draftPath("/overrides"), { cookie: owner, body: { circleId: NORTH, reason: "越權" } })).status, 404);
  assert.equal((await api.published(NORTH)).saleInfo, "別場內容", "the other event's content stays");
});

test("a correction publishes a new version, and restoring the earlier index rolls readers back", async () => {
  const firstVersion = (await publishedEvent()).version;
  const amendment = await ok(await api.call("POST", events("/amendments"), { cookie: owner, body: { expectedVersion: state.submittedVersion } }), 201);
  const path = (suffix) => `/api/organizer/events/${amendment.candidateId}${suffix}`;
  await ok(await api.call("PUT", path("/amendment"), { cookie: owner,
    body: { expectedVersion: amendment.version, changes: [], settings: { name: "PF45 x RF14 更名" } } }));
  const submitted = await version(amendment.candidateId);
  await ok(await api.call("POST", path("/submit"), { cookie: owner, body: { expectedVersion: submitted } }));
  assert.equal((await ok(await review(amendment.candidateId, submitted))).status, "published");
  assert.equal((await api.readerFile(EVENT_ID, "event.json")).name, "PF45 x RF14 更名");

  // The runbook's rollback: copy the earlier index back whole.
  const earlier = await api.eventData.get(`history/index-${firstVersion}.json`);
  assert.ok(earlier, "every published index is kept");
  await api.eventData.put("index.json", await earlier.text());
  assert.equal((await publishedEvent()).version, firstVersion);
  assert.equal((await api.readerFile(EVENT_ID, "event.json")).name, "PF45 x RF14");
});

test("an applicant's request reaches only admins, and deleting the account erases it", async () => {
  const application = (note) => ({ name: "申請活動", officialUrl: "https://official.example/event", startDate: "2099-12-05", endDate: "2099-12-06",
    location: "", relationship: "curator", note });
  const apply = (cookie, note = "依官方名單整理活動。") =>
    api.call("POST", "/api/organizer/applications", { cookie, body: { id: crypto.randomUUID(), application: application(note) } });
  const applicant = await api.signIn("second@example.test", { audience: "organizer" });
  assert.equal((await apply(applicant)).status, 403, "applications are closed by default");

  await updateSettings({ organizerApplicationMode: "invite_only", organizerAllowedEmails: ["second@example.test", "third@example.test"] });
  assert.equal((await apply(stranger)).status, 403, "only invited addresses may apply");
  const pending = (await ok(await apply(applicant, "第二位的待審說明"), 201)).application;
  const rejected = (await ok(await apply(applicant, "第二位的被拒說明"), 201)).application;
  const listed = async (cookie = admin) => (await ok(await api.call("GET", "/api/organizer/applications", { cookie }))).applications;
  assert.ok((await listed()).some((entry) => entry.id === pending.id));
  assert.equal(JSON.stringify(await listed(stranger)).includes("第二位"), false, "another account sees none of it");
  const decide = (cookie, id, decision = "approved", reason = "") =>
    api.call("POST", `/api/admin/organizer/applications/${id}`, { cookie, body: { decision, reason } });
  assert.equal((await decide(stranger, pending.id)).status, 403);
  await ok(await decide(admin, rejected.id, "rejected", "給申請人的拒絕理由"));

  const approvedApplicant = await api.signIn("third@example.test", { audience: "organizer" });
  const approved = (await ok(await apply(approvedApplicant), 201)).application;
  await ok(await decide(admin, approved.id));
  const opened = await ok(await api.call("GET", "/api/organizer/events", { cookie: approvedApplicant }));
  assert.equal(opened.events.length, 1, "approval opens an event its applicant owns");

  const before = JSON.stringify(await listed());
  assert.ok(before.includes("第二位的被拒說明") && before.includes("給申請人的拒絕理由"));
  await ok(await api.call("DELETE", "/api/account", { cookie: applicant, body: { confirm: "second@example.test" } }));
  const after = await listed();
  assert.equal(after.some((entry) => entry.id === pending.id), false, "a deleted account's pending request is gone");
  assert.doesNotMatch(JSON.stringify(after), /第二位|給申請人的拒絕理由|second@example/, "a reviewed request keeps no personal text");
  assert.equal((await decide(admin, pending.id)).status, 409);
});
