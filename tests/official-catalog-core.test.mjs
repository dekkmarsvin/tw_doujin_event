import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";
import { buildOfficialCatalogPayload } from "../scripts/official-catalog-core.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { isCircleCatalogPayload } = await environment.runner.import("/app/circle-records.ts");
after(() => vite.close());

const eventId = "event-alpha";
const event = {
  id: eventId,
  dataUpdatedAt: "2026-08-14T00:00:00.000+08:00",
  days: [{ id: 1, label: "Day 1", dateLabel: "8/14" }],
  areas: [{ id: "ALL", label: "全部", shortLabel: "全" }],
};
const official = (booths) => ({ schemaVersion: 1, days: [{ day: 1, url: "https://organizer.invalid/day-1", booths }] });
const entry = (circleId, currentName, sources, retiredSources = []) => ({
  circleId,
  currentName,
  aliases: [],
  sources: sources.map((value) => ({ eventId, kind: "organizer-booth", value })),
  ...(retiredSources.length ? { retiredSources } : {}),
});
const retiredSource = (value, retirement) => ({ eventId, kind: "organizer-booth", value, retirement });
const build = (official_, entries) => buildOfficialCatalogPayload({
  eventId, event, official: official_, evidence: { schema: "circle-identity-evidence/2", entries },
});
const placement = (payload, id) => payload.placements.find((candidate) => candidate.id === id);

test("a catalog with no retirements is exactly what the organizer lists", () => {
  const payload = build(official([{ codes: ["A01"], name: "甲社" }]), [entry("c-000001", "甲社", ["1:A01"])]);
  assert.deepEqual(payload.circles, [{ id: "c-000001", name: "甲社" }]);
  assert.equal(payload.placements.length, 1);
  assert.equal(placement(payload, "1-a01").status, "active");
  assert.ok(isCircleCatalogPayload(payload), "the reader must be able to project it");
});

test("a withdrawn circle stays in the catalog as a cancelled placement", () => {
  const payload = build(
    official([{ codes: ["B01"], name: "乙社" }]),
    [
      entry("c-000001", "甲社", [], [retiredSource("1:A01", { kind: "withdrawn", at: "2026-08-29" })]),
      entry("c-000002", "乙社", ["1:B01"]),
    ],
  );

  // Both halves matter: a favourite holding c-000001 has to resolve to a circle,
  // and its booth has to say it is no longer a destination.
  assert.deepEqual(payload.circles.map(({ id }) => id), ["c-000001", "c-000002"]);
  assert.equal(placement(payload, "1-a01").status, "cancelled");
  assert.equal(placement(payload, "1-a01").circleId, "c-000001");
  assert.equal(placement(payload, "1-b01").status, "active");
  assert.ok(isCircleCatalogPayload(payload));
});

test("a moved circle is reachable at the new booth and marked moved at the old one", () => {
  const payload = build(
    official([{ codes: ["C09"], name: "甲社" }]),
    [entry("c-000001", "甲社", ["1:C09"], [retiredSource("1:A01", { kind: "moved", to: "1:C09", at: "2026-08-29" })])],
  );

  // Same circle id at both booths is what lets the reader follow the move
  // without the catalog carrying a second pointer for it.
  assert.equal(placement(payload, "1-a01").status, "moved");
  assert.equal(placement(payload, "1-c09").status, "active");
  assert.equal(placement(payload, "1-a01").circleId, placement(payload, "1-c09").circleId);
  assert.equal(payload.circles.length, 1);
  assert.ok(isCircleCatalogPayload(payload));
});

test("a booth handed over shows the new circle active and the old one cancelled", () => {
  const payload = build(
    official([{ codes: ["A01"], name: "丙社" }]),
    [
      entry("c-000001", "甲社", [], [retiredSource("1:A01", { kind: "released", at: "2026-08-29" })]),
      entry("c-000003", "丙社", ["1:A01"]),
    ],
  );

  // The same booth code appears twice, under two different circles. That is the
  // handover: the reader can see the booth is now someone else's, and a link to
  // the previous occupant still resolves to the previous occupant.
  assert.equal(placement(payload, "1-a01").circleId, "c-000003");
  assert.equal(placement(payload, "1-a01").status, "active");
  assert.deepEqual(payload.circles.map(({ id }) => id), ["c-000001", "c-000003"]);

  // The plain booth id stays with whoever holds the booth now; the departed
  // circle keeps a record of its own so a favourite still resolves to it.
  const departed = placement(payload, "1-a01-c-000001");
  assert.equal(departed.status, "cancelled");
  assert.equal(departed.circleId, "c-000001");
  assert.equal(departed.boothCode, "A01");
  assert.ok(isCircleCatalogPayload(payload));
});

test("a retirement that contradicts the event or the current list is refused", () => {
  assert.throws(() => build(
    official([{ codes: ["B01"], name: "乙社" }]),
    [
      entry("c-000001", "甲社", [], [retiredSource("9:A01", { kind: "withdrawn", at: "2026-08-29" })]),
      entry("c-000002", "乙社", ["1:B01"]),
    ],
  ), /names a day the event does not declare/);
});
