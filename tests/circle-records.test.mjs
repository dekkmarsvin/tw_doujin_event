import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const catalog = await environment.runner.import("/app/circle-records.ts");
after(() => vite.close());

test("projects independent circle and placement catalogs into the map read model", () => {
  assert.equal(catalog.CIRCLE_CATALOG.length, 1336);
  assert.equal(catalog.PLACEMENT_CATALOG.length, catalog.CIRCLE_RECORDS.length);
  assert.ok(catalog.CIRCLE_CATALOG.length < catalog.PLACEMENT_CATALOG.length);

  const first = catalog.CIRCLE_RECORDS[0];
  assert.equal(first.circle.id, first.placement.circleId);
  assert.equal(first.placement.id, first.recordId);
  assert.notEqual(first.circle.id, first.recordId);
  assert.equal(first.placement.eventId, "ff47");
  assert.equal(first.placement.status, "active");
  assert.equal("boothCode" in first.circle, false);
  assert.equal("name" in first.placement, false);
  assert.equal(catalog.CIRCLE_RECORDS.every((record) => Number.isInteger(record.circle.sourceRow)), true);
});

test("shares one Excel-backed circle template across its reviewed placements", () => {
  const duplicates = catalog.CIRCLE_RECORDS.filter((record) => record.name === "OriginZero");
  assert.ok(duplicates.length > 1);
  assert.equal(new Set(duplicates.map((record) => record.circle.id)).size, 1);
  assert.equal(new Set(duplicates.map((record) => record.circle.sourceRow)).size, 1);
  assert.equal(new Set(duplicates.map((record) => record.recordId)).size, duplicates.length);
});

test("integrates Excel profile links and the sourced thumbnail index", () => {
  const record = catalog.CIRCLE_RECORDS.find((item) => item.name === "33号部屋");
  assert.ok(record);
  assert.ok(record.circle.externalLinks.some((link) => link.provider === "X"));
  assert.equal(record.circle.media.length, 1);
  assert.match(record.circle.media[0].url, /^https:\/\/drive\.google\.com\/thumbnail\?/);
  assert.match(record.circle.media[0].sourceUrl, /^https:\/\/drive\.google\.com\/file\/d\//);
});

test("retains known circles that currently have no numbered placement", () => {
  const circle = catalog.CIRCLE_CATALOG.find((item) => item.name === "+Ely Cosplay+");
  assert.ok(circle);
  assert.equal(catalog.PLACEMENT_CATALOG.some((placement) => placement.circleId === circle.id), false);
});

test("creates unique record IDs and maps legacy placement IDs to canonical circles", () => {
  catalog.CIRCLE_RECORDS.slice(0, 20).forEach((record, index) => {
    assert.equal(record.recordId, `${record.id}-${index}`);
    assert.equal(catalog.CIRCLE_RECORDS_BY_ID.get(record.recordId), record);
    assert.deepEqual(catalog.CIRCLE_ID_MIGRATION_TARGETS.get(record.recordId), [record.circle.id]);
    assert.equal(catalog.CIRCLE_ID_MIGRATION_TARGETS.get(record.id).includes(record.circle.id), true);
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
