import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const catalog = await environment.runner.import("/app/circle-records.ts");
after(() => vite.close());

test("projects independent circle and placement catalogs into the map read model", () => {
  assert.equal(catalog.CIRCLE_CATALOG.length, catalog.PLACEMENT_CATALOG.length);
  assert.equal(catalog.CIRCLE_CATALOG.length, catalog.CIRCLE_RECORDS.length);

  const first = catalog.CIRCLE_RECORDS[0];
  assert.equal(first.circle.id, first.placement.circleId);
  assert.equal(first.circle.id, first.recordId);
  assert.equal(first.placement.id, first.id);
  assert.equal(first.placement.eventId, "ff47");
  assert.equal(first.placement.status, "active");
  assert.equal("boothCode" in first.circle, false);
  assert.equal("name" in first.placement, false);
});

test("does not auto-merge duplicate public rows without reviewed identity evidence", () => {
  const duplicates = catalog.CIRCLE_RECORDS.filter((record) => record.name === "OriginZero");
  assert.ok(duplicates.length > 1);
  assert.equal(new Set(duplicates.map((record) => record.circle.id)).size, duplicates.length);
  assert.equal(new Set(duplicates.map((record) => record.recordId)).size, duplicates.length);
});

test("creates unique record IDs and exposes legacy ID migration targets", () => {
  catalog.CIRCLE_RECORDS.slice(0, 20).forEach((record, index) => {
    assert.equal(record.recordId, `${record.id}-${index}`);
    assert.equal(catalog.CIRCLE_RECORDS_BY_ID.get(record.recordId), record);
    assert.equal(catalog.LEGACY_CIRCLE_RECORD_IDS.get(record.id).includes(record.recordId), true);
  });
  assert.equal(new Set(catalog.CIRCLE_RECORDS.map((record) => record.recordId)).size, catalog.CIRCLE_RECORDS.length);
});

test("includes every V and W booth slot for all three FF47 days", () => {
  for (const day of [1, 2, 3]) {
    const codes = new Set(catalog.CIRCLE_RECORDS.filter((record) => record.day === day).map((record) => record.code));
    for (const row of ["V", "W"]) {
      const last = row === "V" ? 44 : 42;
      for (let number = 1; number <= last; number += 1) {
        assert.equal(codes.has(`${row}${String(number).padStart(2, "0")}`), true, `day ${day} is missing ${row}${String(number).padStart(2, "0")}`);
      }
    }
  }
});
