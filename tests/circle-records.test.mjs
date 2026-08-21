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

// The published snapshot is the runtime source of truth, so the read model is
// exercised through exactly the payload the browser downloads.
const payload = JSON.parse(await readFile(new URL("../public/data/events/ff47/circles.json", import.meta.url), "utf8"));
records.setCircleCatalog(payload);
const catalog = records.getCircleCatalog();

test("accepts the published snapshot and rejects payloads the read model cannot project", () => {
  assert.equal(records.isCircleCatalogPayload(payload), true);
  assert.equal(payload.schema, "circle-catalog/2");
  assert.equal(payload.eventId, "ff47");

  assert.equal(records.isCircleCatalogPayload({ ...payload, schema: "circle-catalog/1" }), false);
  assert.equal(records.isCircleCatalogPayload({ ...payload, booths: [] }), false);
  assert.equal(records.isCircleCatalogPayload({ ...payload, booths: [{ ...payload.booths[0], day: 4 }] }), false);
  assert.equal(records.isCircleCatalogPayload({ ...payload, templates: [{ ...payload.templates[0], placements: undefined }] }), false);
  assert.equal(records.isCircleCatalogPayload(null), false);
});

test("projects independent circle and placement catalogs into the map read model", () => {
  // One circle per reviewed workbook row, with no positional fallbacks. The
  // count itself is upstream's to change, so the invariant is the equality:
  // more circles than templates means a booth failed to match and was given a
  // synthetic identity.
  assert.equal(catalog.circles.length, payload.templates.length);
  assert.equal(catalog.placements.length, catalog.records.length);
  assert.ok(catalog.circles.length < catalog.placements.length);

  const first = catalog.records[0];
  assert.equal(first.circle.id, first.placement.circleId);
  assert.equal(first.placement.id, first.recordId);
  assert.notEqual(first.circle.id, first.recordId);
  assert.equal(first.placement.eventId, "ff47");
  assert.equal(first.placement.status, "active");
  assert.equal("boothCode" in first.circle, false);
  assert.equal("name" in first.placement, false);
  assert.equal(catalog.records.every((record) => record.circle.sourceRow === undefined || Number.isInteger(record.circle.sourceRow)), true);
});

test("builds the same catalog from the same payload without touching the store", () => {
  const rebuilt = records.buildCircleCatalog(payload);
  assert.equal(rebuilt.records.length, catalog.records.length);
  assert.equal(rebuilt.circles.length, catalog.circles.length);
  assert.deepEqual(rebuilt.records[0], catalog.records[0]);
});

test("shares one Excel-backed circle template across its reviewed placements", () => {
  const duplicates = catalog.records.filter((record) => record.name === "OriginZero");
  assert.ok(duplicates.length > 1);
  assert.equal(new Set(duplicates.map((record) => record.circle.id)).size, 1);
  assert.equal(new Set(duplicates.map((record) => record.circle.sourceRow)).size, 1);
  assert.equal(new Set(duplicates.map((record) => record.recordId)).size, duplicates.length);
});

test("integrates Excel profile links but no reviewed thumbnail", () => {
  const record = catalog.records.find((item) => item.name === "33号部屋");
  assert.ok(record);
  assert.ok(record.circle.externalLinks.some((link) => link.provider === "X"));
  assert.deepEqual(record.circle.media, []);
});

/**
 * ADR-0012 left the circle as the only producer of a thumbnail. A reviewed one
 * would reach every reader as an automatic request to a third-party host, so
 * the absence is checked on the published payload rather than on the generator:
 * a snapshot committed before the retirement would otherwise still ship them.
 */
test("the published snapshot carries no reviewed thumbnail", () => {
  assert.equal(payload.templates.length > 1000, true);
  assert.deepEqual(payload.templates.filter((template) => template.thumbnail), []);
  assert.deepEqual(catalog.records.filter((record) => record.circle.media.length > 0), []);
  assert.deepEqual(catalog.records.flatMap((record) => record.sources.filter((source) => source.contentType === "media")), []);

  // Anchors a reader chooses to follow are a different question from images the
  // browser fetches unasked; retiring the image host does not delete a circle-
  // supplied 品書 link. Kept explicit so a future sweep does not assume it slipped through.
  const driveLinks = payload.templates.flatMap((template) => template.links.filter((link) => link.url.includes("drive.google.com")));
  assert.equal(driveLinks.every((link) => link.kind === "catalog"), true);
});


test("fills only the organizer-listed booth gaps with their existing circle templates", () => {
  const expected = [
    [1, "J09", "+喵耳園魔法道具屋+"], [1, "J10", "+喵耳園魔法道具屋+"],
    [2, "J09", "+喵耳園魔法道具屋+"], [2, "J10", "+喵耳園魔法道具屋+"],
    [2, "R01", "+Ely Cosplay+"], [2, "R02", "+Ely Cosplay+"],
    [3, "R01", "+Ely Cosplay+"], [3, "R02", "+Ely Cosplay+"],
  ];
  for (const [day, code, name] of expected) {
    const record = catalog.records.find((item) => item.day === day && item.code === code && item.name === name);
    assert.ok(record, `missing organizer supplement ${day}:${code}`);
    assert.equal(Number.isInteger(record.circle.sourceRow), true);
    const organizer = record.sources.find((source) => source.provider === "開拓動漫");
    assert.match(organizer?.url ?? "", new RegExp(`%E7%AC%AC%E${day === 1 ? "4%B8%80" : day === 2 ? "4%BA%8C" : "4%B8%89"}%E5%A4%A9`, "i"));
  }
  const existing = catalog.records.find((item) => item.day === 1 && item.code === "A01");
  const existingOrganizer = existing?.sources.find((source) => source.provider === "開拓動漫");
  assert.doesNotMatch(existingOrganizer?.url ?? "", /%E7%AC%AC%E4%B8%80%E5%A4%A9/i);
});

test("creates unique record IDs and resolves booth-scoped ids from shared links", () => {
  catalog.records.slice(0, 20).forEach((record, index) => {
    assert.equal(record.recordId, `${record.id}-${index}`);
    assert.equal(catalog.recordsById.get(record.recordId), record);
    assert.deepEqual(catalog.circleIdAliases.get(record.recordId), [record.circle.id]);
    assert.equal(catalog.circleIdAliases.get(record.id).includes(record.circle.id), true);
    assert.deepEqual(records.resolveCircleIdAliases(record.recordId), [record.circle.id]);
  });
  assert.equal(new Set(catalog.records.map((record) => record.recordId)).size, catalog.records.length);
  assert.deepEqual(records.resolveCircleIdAliases("unknown-circle"), ["unknown-circle"]);
});

test("every circle identity is an allocated serial and nothing carries the old hash", () => {
  // ADR-0013 removed the `ff47-` compatibility map, so a hash reaching the read
  // model would resolve to nothing rather than to the circle it once named.
  assert.equal(Object.hasOwn(payload, "legacyCircleIds"), false);
  for (const circle of catalog.circles) assert.match(circle.id, /^c-\d{6}$/);
  assert.deepEqual(records.resolveCircleIdAliases("ff47-3f2a1b"), ["ff47-3f2a1b"]);
});

test("recognizes canonical planning identities and uses the event data version for source freshness", () => {
  const record = catalog.records.find((item) => item.name === "蒼銀之星" && item.day === 1);
  assert.ok(record);

  assert.equal(catalog.circlesById.get(record.circle.id), record.circle);
  assert.equal(records.isKnownCircleId(record.circle.id), true);
  assert.equal(new Set(record.sources.map((source) => source.fetchedAt)).size, 1);
  assert.equal(record.sources[0].fetchedAt, events.ACTIVE_EVENT.dataUpdatedAt);
});

test("no circle is named by a pasted url, and D09 stays one circle across days", () => {
  // A URL in the workbook's name column produced a circle displayed as a raw
  // link, while its real booths fell back to positional ids that split the
  // circle across days. The organizer's daily list is the naming authority.
  assert.equal(catalog.circles.some((circle) => /^https?:\/\//.test(circle.name)), false);

  const lychee = catalog.circles.filter((circle) => circle.name === "紅色荔枝樹");
  assert.equal(lychee.length, 1, "the day 1 and day 2 D09 placements must share one circle");
  assert.deepEqual(
    (catalog.recordsByCircleId.get(lychee[0].id) ?? []).map((record) => `${record.day}:${record.code}`).sort(),
    ["1:D09", "2:D09"],
  );
  assert.ok(lychee[0].externalLinks.length > 0, "the workbook row's links must survive the name correction");
});

test("includes every V and W booth slot for all three FF47 days", () => {
  for (const day of [1, 2, 3]) {
    const codes = new Set(catalog.records.filter((record) => record.day === day).map((record) => record.code));
    for (const row of ["V", "W"]) {
      const last = row === "V" ? 44 : 42;
      for (let number = 1; number <= last; number += 1) {
        assert.equal(codes.has(`${row}${String(number).padStart(2, "0")}`), true, `day ${day} is missing ${row}${String(number).padStart(2, "0")}`);
      }
    }
  }
});
