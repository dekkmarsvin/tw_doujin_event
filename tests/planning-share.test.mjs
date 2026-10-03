import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const share = await environment.runner.import("/app/planning-share.ts");
const records = await environment.runner.import("/app/circle-records.ts");
const planning = await environment.runner.import("/app/planning-store.ts");
after(() => vite.close());

const timestamp = "2026-10-03T00:00:00.000Z";
const favorite = (eventId, circleId, overrides = {}) => ({ eventId, circleId, groupId: null, memo: "", createdAt: timestamp, updatedAt: timestamp, ...overrides });
const plan = (eventId, day, circleId, overrides = {}) => ({ eventId, day, circleId, status: "planned", routeOrder: 0, purchaseMemo: "", budget: null, updatedAt: timestamp, ...overrides });
const document = (overrides = {}) => ({ ...planning.EMPTY_PLANNING_DOCUMENT, ...overrides });
const list = (items = [{ circleId: "c-000001", day: null }]) => ({ version: 1, eventId: "sample", items });
const hash = (value) => `#share=${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
const compact = { v: 1, e: "sample", c: [["c-000001"]] };
const file = { kind: "circle-share/1", ...list() };
const readUrl = (value) => share.readSharedListFromHash(new URL(share.sharedListUrl("https://example.test", value).url).hash);
const rejected = (result) => {
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
  assert.match(result.error, /[\u3400-\u9fff]/u);
  assert.equal("list" in result, false);
};

test("projection and both serializers exclude every private planning field", () => {
  const source = document({
    favoriteGroups: [{ id: "private-group-id", name: "PRIVATE_GROUP_NAME", color: "coral", sortOrder: 0 }],
    favorites: [favorite("sample", "c-000001", { groupId: "private-group-id", memo: "PRIVATE_FAVORITE_MEMO" })],
    visitPlans: [plan("sample", 1, "c-000001", { status: "next", purchaseMemo: "PRIVATE_PURCHASE_MEMO", budget: 987654321 })],
  });
  const projected = share.projectSharedList(source, "sample", [{ circleId: "c-000001", day: null }, { circleId: "c-000001", day: 1 }]);
  // Serializers also rebuild the whitelist when a caller passes an object with extra runtime fields.
  const contaminated = { ...projected, memo: "PRIVATE_FAVORITE_MEMO", items: projected.items.map((item) => ({ ...item, group: "PRIVATE_GROUP_NAME", budget: 987654321 })) };
  const url = share.sharedListUrl("https://example.test", contaminated).url;
  const decoded = Buffer.from(new URL(url).hash.slice(7), "base64url").toString("utf8");
  for (const text of [JSON.stringify(projected), url, decoded, share.sharedListFile(contaminated)]) {
    for (const secret of ["PRIVATE_GROUP_NAME", "private-group-id", "PRIVATE_FAVORITE_MEMO", "PRIVATE_PURCHASE_MEMO", "987654321", timestamp]) assert.equal(text.includes(secret), false);
    assert.doesNotMatch(text, /memo|budget|group|purchase|status|visited|next|updatedAt|createdAt|account|history/i);
  }
});

test("projection reads only IDs/day, keeps order, deduplicates and isolates event/day", () => {
  const privateField = { get() { throw new Error("Private field read"); } };
  const entry = plan("sample", 2, "c-000002");
  Object.defineProperty(entry, "purchaseMemo", privateField);
  const saved = favorite("sample", "c-000001");
  Object.defineProperty(saved, "memo", privateField);
  const source = document({ favorites: [saved, favorite("other", "c-000003")], visitPlans: [entry, plan("sample", "日期甲", "c-000004")] });
  Object.defineProperty(source, "favoriteGroups", privateField);
  const selected = [
    { circleId: "c-000004", day: "日期甲" }, { circleId: "c-000001", day: null },
    { circleId: "c-000002", day: 2 }, { circleId: "c-000002", day: "2" },
    { circleId: "c-000001", day: 2 }, { circleId: "c-000002", day: 1 },
    { circleId: "c-000002", day: null }, { circleId: "c-000003", day: null }, { circleId: "c-999999", day: null },
  ];
  const projected = share.projectSharedList(source, "sample", selected);
  assert.deepEqual(projected.items, selected.slice(0, 3));
  assert.deepEqual(readUrl(projected), { ok: true, list: projected });
  assert.deepEqual(share.readSharedListFile(share.sharedListFile(projected)), { ok: true, list: projected });
});

test("URL and file round trips preserve zero, numeric and UTF-8 string days and empty lists", () => {
  for (const value of [list([]), list([{ circleId: "c-7", day: 0 }, { circleId: "c-8", day: "星期六" }, { circleId: "c-9", day: 2 }])]) {
    assert.deepEqual(readUrl(value), { ok: true, list: value });
    assert.deepEqual(share.readSharedListFile(share.sharedListFile(value)), { ok: true, list: value });
  }
  const url = share.sharedListUrl("https://example.test", list()).url;
  assert.equal(new URL(url).search, "?event=sample");
  assert.equal(new URL(url).pathname, "/");
});

test("oversized URLs retain all 500 items and the file still round trips them", () => {
  const value = list(Array.from({ length: 500 }, (_, i) => ({ circleId: `c-${String(i).padStart(6, "0")}`, day: "2026-10-03" })));
  const result = share.sharedListUrl("https://example.test", value);
  assert.equal(result.fits, false);
  assert.ok(Buffer.byteLength(result.url) > share.SHARE_URL_MAX_BYTES);
  const payload = JSON.parse(Buffer.from(new URL(result.url).hash.slice(7), "base64url").toString("utf8"));
  assert.equal(payload.c.length, 500);
  assert.deepEqual(share.readSharedListFile(share.sharedListFile(value)), { ok: true, list: value });
});

test("fits uses complete UTF-8 URL bytes at the exact limit", () => {
  const value = list();
  const length = Buffer.byteLength(share.sharedListUrl("https://example.test", value).url);
  const origin = "https://example.test" + "a".repeat(share.SHARE_URL_MAX_BYTES - length);
  assert.equal(share.sharedListUrl(origin, value).fits, true);
  assert.equal(share.sharedListUrl(origin + "a", value).fits, false);
  assert.equal(share.sharedListUrl(origin + "中", value).fits, false);
});

test("hash without share is ignored; unrelated fragment parameters coexist", () => {
  for (const value of ["", "#", "#selectedCircle=c-000001", "#notshare=broken", "#other=" + "a".repeat(9000)]) assert.equal(share.readSharedListFromHash(value), null);
  assert.deepEqual(share.readSharedListFromHash("#other=1&" + hash(compact).slice(1)), { ok: true, list: list() });
});

test("malformed and oversized hashes fail without throwing", () => {
  for (const value of ["#share=", "#share=%", "#share=abc=", "#share=a", "#share=__", "#share=" + "a".repeat(8193), hash("text"), "#share=" + Buffer.from("{bad").toString("base64url"), hash(compact) + "&share=again"]) {
    assert.doesNotThrow(() => rejected(share.readSharedListFromHash(value)));
  }
});

test("URL schema rejects wrong versions, invalid IDs/days, extra fields and over 500 items", () => {
  const invalid = [
    { ...compact, v: 2 }, { ...compact, e: "../sample" }, { ...compact, e: "" }, { ...compact, e: 1 },
    { ...compact, memo: "private" }, { ...compact, c: [["booth-1"]] }, { ...compact, c: [["c-1x"]] },
    { ...compact, c: [["c-1", true]] }, { ...compact, c: [["c-1", " "]] }, { ...compact, c: [["c-1", {}]] },
    { ...compact, c: [["c-1", 1, "private"]] }, { ...compact, c: [[]] }, { ...compact, c: [{ circleId: "c-1", day: 1 }] },
    { ...compact, c: Array.from({ length: 501 }, () => ["c-1"]) },
  ];
  for (const value of invalid) assert.doesNotThrow(() => rejected(share.readSharedListFromHash(hash(value))));
});

test("file schema rejects malformed/oversized input, private fields and invalid items", () => {
  const invalid = [
    "broken", " ".repeat(256 * 1024 + 1), "中".repeat(90000), JSON.stringify(null),
    JSON.stringify({ ...file, kind: "circle-plan-json/1" }), JSON.stringify({ ...file, version: 2 }),
    JSON.stringify({ ...file, eventId: "bad/event" }), JSON.stringify({ ...file, budget: 100 }),
    JSON.stringify({ ...file, items: [{ circleId: "c-1", day: null, memo: "private" }] }),
    JSON.stringify({ ...file, items: [{ circleId: "legacy", day: 1 }] }),
    JSON.stringify({ ...file, items: [{ circleId: "c-1" }] }),
    JSON.stringify({ ...file, items: [{ circleId: "c-1", day: [] }] }),
    JSON.stringify({ ...file, items: [{ circleId: "c-1", day: Infinity }] }).replace('"day":null', '"day":1e999'),
    JSON.stringify({ ...file, items: Array.from({ length: 501 }, () => ({ circleId: "c-1", day: null })) }),
  ];
  for (const value of invalid) assert.doesNotThrow(() => rejected(share.readSharedListFile(value)));
});

test("adding favorites preserves all existing data, appends in selection order and is idempotent", () => {
  const source = document({ favoriteGroups: [{ id: "g", name: "Private", color: "blue", sortOrder: 0 }], favorites: [favorite("sample", "c-1", { groupId: "g", memo: "Keep me" }), favorite("other", "c-2")], visitPlans: [plan("sample", 1, "c-1", { status: "next" })] });
  const before = structuredClone(source);
  const result = share.addSharedFavorites(source, "sample", ["c-1", "c-3", "c-2", "c-3"]);
  assert.equal(result.added, 2);
  assert.deepEqual(result.document.favorites.slice(0, 2), source.favorites);
  assert.deepEqual(result.document.favorites.slice(2).map((item) => [item.circleId, item.memo, item.groupId]), [["c-3", "", null], ["c-2", "", null]]);
  assert.deepEqual(result.document.favoriteGroups, source.favoriteGroups);
  assert.deepEqual(result.document.visitPlans, source.visitPlans);
  assert.deepEqual(source, before);
  assert.deepEqual(share.addSharedFavorites(result.document, "sample", ["c-1", "c-3", "c-2"]), { document: result.document, added: 0 });
});

test("adding plans preserves existing order, notes and next; new planned entries append idempotently", () => {
  const source = document({ favorites: [favorite("sample", "c-3", { memo: "Keep favorite" })], visitPlans: [
    plan("sample", 1, "c-1", { status: "next", routeOrder: 1, purchaseMemo: "Keep purchase", budget: 500 }),
    plan("other", 1, "c-3"), plan("sample", 1, "c-2", { status: "visited", routeOrder: 0 }), plan("sample", 2, "c-4"),
  ] });
  const before = structuredClone(source);
  const result = share.addSharedToPlan(source, "sample", "1", ["c-1", "c-3", "c-4", "c-3"]);
  assert.equal(result.added, 2);
  assert.deepEqual(result.document.visitPlans.slice(0, 4), source.visitPlans);
  assert.deepEqual(result.document.visitPlans.slice(4).map((item) => [item.circleId, item.status, item.routeOrder, item.purchaseMemo, item.budget]), [["c-3", "planned", 2, "", null], ["c-4", "planned", 3, "", null]]);
  assert.deepEqual(result.document.visitPlans.filter((item) => item.status === "next"), [source.visitPlans[0]]);
  assert.deepEqual(result.document.favorites, source.favorites);
  assert.deepEqual(source, before);
  assert.deepEqual(share.addSharedToPlan(result.document, "sample", 1, ["c-1", "c-3", "c-4"]), { document: result.document, added: 0 });
});

test("resolution uses canonical IDs and latest event placements for available/moved/withdrawn/unknown", () => {
  const placement = (circleId, day, code, status = "active") => ({ id: `${circleId}-${day}-${code}`, circleId, day, area: "S", boothCode: code, status, tone: "coral" });
  records.setCircleCatalog({
    schema: records.CIRCLE_CATALOG_SCHEMA, eventId: "sample", generatedAt: timestamp,
    circles: ["c-000001", "c-000002", "c-000003", "c-000004"].map((id) => ({ id, name: "Same name" })),
    placements: [placement("c-000001", 1, "A01"), placement("c-000001", 1, "A02"), placement("c-000002", 1, "Old", "moved"), placement("c-000002", 2, "B01"), placement("c-000002", 3, "C01"), placement("c-000003", 1, "D01", "cancelled"), placement("c-000004", 1, "E01", "moved")],
  });
  const source = list([{ circleId: "c-000001", day: "1" }, { circleId: "c-000002", day: 1 }, { circleId: "c-000003", day: null }, { circleId: "c-999999", day: 1 }, { circleId: "c-000004", day: 1 }, { circleId: "c-000002", day: null }]);
  const result = share.resolveSharedList(source);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.items.map((item) => item.state), ["available", "moved", "withdrawn", "unknown", "moved", "available"]);
  assert.deepEqual(result.items[0].records.map((record) => record.code), ["A01", "A02"]);
  assert.deepEqual(result.items[1].days, [2, 3]);
  assert.deepEqual(result.items[1].records.map((record) => [record.circle.name, record.code, record.day]), [["Same name", "B01", 2], ["Same name", "C01", 3]]);
  assert.equal(result.items[2].records[0].placement.status, "cancelled");
  assert.equal(result.items[3].circle, null);
  assert.deepEqual(result.items[3].records, []);
  assert.deepEqual(share.resolveSharedList({ ...source, eventId: "sample-two" }), { status: "loading", items: [] });
});

test("loading and failed catalog never classify items as unknown or write a planning document", () => {
  records.resetCircleCatalog("sample");
  assert.deepEqual(share.resolveSharedList(list()), { status: "loading", items: [] });
  records.failCircleCatalog("sample", "Cannot load");
  assert.deepEqual(share.resolveSharedList(list()), { status: "error", items: [] });
});
