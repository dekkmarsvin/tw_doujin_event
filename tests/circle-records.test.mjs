import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const records = await environment.runner.import("/app/circle-records.ts");
const events = await environment.runner.import("/app/event-catalog.ts");
after(() => vite.close());

const payload = JSON.parse(await readFile(new URL("../fixtures/events/sample/circles.json", import.meta.url), "utf8"));
records.setCircleCatalog(payload);
const catalog = records.getCircleCatalog();

test("accepts only the official-only circle catalog v3 shape", () => {
  assert.equal(records.isCircleCatalogPayload(payload), true);
  assert.equal(payload.schema, "circle-catalog/3");
  assert.equal(payload.eventId, "sample");
  for (const retired of ["booths", "templates", "officialSupplementKeys"]) assert.equal(Object.hasOwn(payload, retired), false);
  assert.equal(records.isCircleCatalogPayload({ ...payload, schema: "circle-catalog/2" }), false);
  assert.equal(records.isCircleCatalogPayload({ ...payload, circles: [] }), false);
  assert.equal(records.isCircleCatalogPayload({ ...payload, circles: [payload.circles[0], payload.circles[0]] }), false);
  assert.equal(records.isCircleCatalogPayload({ ...payload, placements: [{ ...payload.placements[0], circleId: "c-999999" }] }), false);
  assert.equal(records.isCircleCatalogPayload(null), false);
});

test("projects independent circle identities and event placements into the map read model", () => {
  assert.equal(catalog.circles.length, payload.circles.length);
  assert.equal(catalog.placements.length, payload.placements.length);
  assert.equal(catalog.records.length, payload.placements.length);
  assert.ok(catalog.circles.length < catalog.placements.length);
  const first = catalog.records[0];
  assert.equal(first.circle.id, first.placement.circleId);
  assert.equal(first.placement.id, first.recordId);
  assert.notEqual(first.circle.id, first.recordId);
  assert.equal(first.placement.eventId, "sample");
  assert.equal(first.placement.status, "active");
  assert.equal("boothCode" in first.circle, false);
  assert.equal("name" in first.placement, false);
});

test("the same official identity may have multiple event placements", () => {
  const placements = catalog.recordsByCircleId.get("c-900001");
  assert.deepEqual(placements.map(({ day, code }) => `${day}:${code}`), ["1:S01", "2:S01"]);
  assert.equal(new Set(placements.map(({ circle }) => circle.id)).size, 1);
  assert.equal(new Set(placements.map(({ recordId }) => recordId)).size, 2);
});

test("the thin base contains no fabricated profile, media, links or facets", () => {
  for (const circle of catalog.circles) {
    assert.equal(circle.pen, "");
    assert.equal(circle.saleInfo, "");
    assert.deepEqual(circle.creatorTypes, []);
    assert.deepEqual(circle.workTypes, []);
    assert.deepEqual(circle.referencedWorks, []);
    assert.deepEqual(circle.media, []);
    assert.deepEqual(circle.externalLinks, []);
    assert.deepEqual(circle.sources.map(({ contentType }) => contentType), ["official"]);
  }
});

test("circle-authored fields arrive only through the overlay", () => {
  const overlay = {
    schema: "circle-overrides/1", eventId: "sample", generatedAt: "2026-01-02T00:00:00.000Z", revision: 1,
    overrides: [{
      circleId: "c-900001", updatedAt: "2026-01-02T00:00:00.000Z",
      fields: { pen: "範例筆名", saleInfo: "新刊", referencedWorks: ["原創"], links: [{ provider: "網站", kind: "website", url: "https://example.com/circle" }] },
    }],
  };
  const edited = records.buildCircleCatalog(payload, overlay);
  const circle = edited.circlesById.get("c-900001");
  assert.equal(circle.pen, "範例筆名");
  assert.equal(circle.saleInfo, "新刊");
  assert.deepEqual(circle.referencedWorks, ["原創"]);
  assert.equal(circle.externalLinks.length, 1);
  assert.deepEqual(circle.sources.map(({ contentType }) => contentType), ["official", "circle"]);
  assert.deepEqual(edited.recordsByCircleId.get(circle.id).map(({ placement }) => placement), catalog.recordsByCircleId.get(circle.id).map(({ placement }) => placement));
});

test("build is pure and booth-scoped aliases resolve to canonical identities", () => {
  const rebuilt = records.buildCircleCatalog(payload);
  assert.deepEqual(rebuilt.records[0], catalog.records[0]);
  for (const record of catalog.records) {
    assert.equal(catalog.recordsById.get(record.recordId), record);
    assert.deepEqual(catalog.circleIdAliases.get(record.recordId), [record.circle.id]);
    assert.deepEqual(records.resolveCircleIdAliases(record.recordId), [record.circle.id]);
  }
  assert.deepEqual(records.resolveCircleIdAliases("unknown-circle"), ["unknown-circle"]);
});

test("official provenance uses the active event definition and allocated serials", () => {
  for (const circle of catalog.circles) assert.match(circle.id, /^c-\d{6}$/);
  const record = catalog.records[0];
  assert.equal(record.sources[0].provider, "活動主辦單位");
  assert.equal(record.sources[0].fetchedAt, events.ACTIVE_EVENT.dataUpdatedAt);
  assert.equal(records.isKnownCircleId(record.circle.id), true);
  assert.deepEqual(records.resolveCircleIdAliases("ff47-3f2a1b"), ["ff47-3f2a1b"]);
});
