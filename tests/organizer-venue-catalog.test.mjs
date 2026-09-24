import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  environments: { ssr: {} },
  logLevel: "silent",
});
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createIdentityRepository } = await environment.runner.import("/db/identity-repository.ts");
const { INITIAL_ORGANIZER_VENUE_CATALOG } = await environment.runner.import("/app/organizer-venue-catalog.ts");

const miniflare = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  d1Databases: { DB: "organizer-venue-catalog-test" },
}));
const database = await miniflare.getD1Database("DB");
const repository = createIdentityRepository(database);
after(async () => { await miniflare.dispose(); await vite.close(); });

beforeEach(async () => {
  await repository.ensureTables();
  await repository.clearPreviewData();
});

const audit = (subjectId, action = "organizer_venue.created") => ({
  at: 10,
  actorAccountId: null,
  actorRole: "system",
  action,
  subjectType: action === "organizer_venue.created" ? "organizer_venue" : "organizer_venue_space",
  subjectId,
});

test("the shared Organizer catalog starts with four venues and six human-readable spaces", async () => {
  const catalog = await repository.listOrganizerVenueCatalog();
  assert.equal(catalog.venues.length, 4);
  assert.equal(catalog.venues.flatMap((venue) => venue.spaces).length, 6);
  assert.deepEqual(
    catalog.venues.map((venue) => [
      venue.id,
      venue.name,
      venue.spaces.map((space) => [space.id, space.name, space.defaultAreaMode]),
    ]),
    [
      ["taipei-nangang-exhibition-center-hall-1", "台北南港展覽館 1 館", [
        ["taipei-nangang-exhibition-center-hall-1-1f", "1F 展場", "imported"],
        ["taipei-nangang-exhibition-center-hall-1-4f", "4F 展場", "imported"],
      ]],
      ["taipei-nangang-exhibition-center-hall-2", "台北南港展覽館 2 館", [
        ["taipei-nangang-exhibition-center-hall-2-1f", "1F 展場", "imported"],
        ["taipei-nangang-exhibition-center-hall-2-4f", "4F 展場", "imported"],
      ]],
      ["taipei-hakka-cultural-center", "客家文化中心", [
        ["taipei-hakka-cultural-center-5f-exhibition-hall", "5F 展場", "none"],
      ]],
      ["taipei-expo-park-zhengyan-hall", "花博公園爭艷館", [
        ["zhengyan-exhibition-area", "全館", "none"],
      ]],
    ],
  );
  for (const venue of catalog.venues) {
    assert.equal(new URL(venue.sourceUrl).protocol, "https:");
    for (const space of venue.spaces) {
      assert.equal(space.venueId, venue.id);
      assert.equal(new URL(space.sourceUrl).protocol, "https:");
    }
  }
  assert.equal(INITIAL_ORGANIZER_VENUE_CATALOG.length, 4);
});

test("canonical seed adoption preserves pinned public names and bytes across repository restarts", async () => {
  const initial = await repository.listOrganizerReferenceRecords();
  assert.equal(initial.length, 10);
  const space = initial.find((item) => item.id === "zhengyan-exhibition-area");
  assert.equal(space.displayName, "全館");
  assert.equal(JSON.parse(space.publicReferenceJson).name, "爭艷館展區");
  assert.equal(JSON.parse(space.publicReferenceJson).sources[0].retrievedAt, "2026-08-25T03:43:00Z");
  // #395: every seed venue carries the address its official page prints, as a
  // source of its own; FF47's pinned facts keep their original source and time.
  const venues = initial.filter((item) => item.kind === "venue").map((item) => JSON.parse(item.publicReferenceJson));
  assert.deepEqual(venues.map(({ id, address }) => [id, address]), INITIAL_ORGANIZER_VENUE_CATALOG.map(({ id, address }) => [id, address]).sort());
  const zhengyan = venues.find(({ id }) => id === "taipei-expo-park-zhengyan-hall");
  assert.deepEqual(zhengyan.sources.map(({ id, retrievedAt }) => [id, retrievedAt]), [
    ["expo-zhengyan-hall", "2026-08-25T03:43:00Z"], ["address-source", "2026-09-24T15:50:00.000Z"]]);
  assert.deepEqual(zhengyan.provenance, { "/name": ["expo-zhengyan-hall"], "/officialUrl": ["expo-zhengyan-hall"], "/address": ["address-source"] });
  const restarted = createIdentityRepository(database);
  await restarted.ensureTables();
  assert.deepEqual(await restarted.listOrganizerReferenceRecords(), initial);
  // A changed legacy seed is not silently rewritten or assigned unrelated provenance.
  await database.prepare("DELETE FROM organizer_reference_records WHERE path = ?1").bind(space.path).run();
  await database.prepare("UPDATE organizer_venue_spaces SET name = '既有自訂名稱' WHERE id = ?1").bind(space.id).run();
  const incompatible = createIdentityRepository(database);
  await incompatible.ensureTables();
  assert.equal((await incompatible.listOrganizerReferenceRecords()).some((item) => item.path === space.path), false);
  assert.equal((await incompatible.listOrganizerVenueCatalog()).venues.flatMap((venue) => venue.spaces).find((item) => item.id === space.id).name, "既有自訂名稱");
});

test("a new venue and spaces are immediately shared while duplicate human names are refused", async () => {
  assert.deepEqual(await repository.createOrganizerVenue({
    id: "venue-new",
    name: "新展覽館",
    sourceUrl: "https://venue.example/",
    address: "100 臺北市中正區範例路1號",
    createdByAccountId: "account-owner",
    now: 10,
    initialSpace: {
      id: "venue-space-new-1f",
      name: "1F",
      sourceUrl: "https://venue.example/1f",
      defaultAreaMode: "none",
    },
    audit: audit("venue-new"),
  }), { ok: true });
  assert.deepEqual(await repository.createOrganizerVenueSpace({
    id: "venue-space-new-4f",
    venueId: "venue-new",
    name: "4F",
    sourceUrl: "https://venue.example/4f",
    defaultAreaMode: "imported",
    createdByAccountId: "account-owner",
    now: 11,
    audit: audit("venue-space-new-4f", "organizer_venue_space.created"),
  }), { ok: true });

  const venue = (await repository.listOrganizerVenueCatalog()).venues.find(({ id }) => id === "venue-new");
  const record = JSON.parse((await repository.listOrganizerReferenceRecords()).find(({ id }) => id === "venue-new").publicReferenceJson);
  assert.equal(record.address, "100 臺北市中正區範例路1號");
  assert.deepEqual(record.provenance["/address"], ["official-source"]);
  assert.deepEqual(venue.spaces.map(({ id, defaultAreaMode }) => [id, defaultAreaMode]), [
    ["venue-space-new-1f", "none"],
    ["venue-space-new-4f", "imported"],
  ]);

  assert.deepEqual(await repository.createOrganizerVenue({
    id: "venue-duplicate",
    name: "  新展覽館  ",
    sourceUrl: "https://duplicate.example/",
    address: "100 臺北市中正區範例路2號",
    createdByAccountId: "account-owner",
    now: 12,
    initialSpace: {
      id: "venue-space-duplicate",
      name: "全館",
      sourceUrl: "https://duplicate.example/all",
      defaultAreaMode: "imported",
    },
    audit: audit("venue-duplicate"),
  }), { ok: false, reason: "duplicate" });
  assert.deepEqual(await repository.createOrganizerVenueSpace({
    id: "orphan-space",
    venueId: "missing-venue",
    name: "全館",
    sourceUrl: "https://missing.example/",
    defaultAreaMode: "imported",
    createdByAccountId: "account-owner",
    now: 13,
    audit: audit("orphan-space", "organizer_venue_space.created"),
  }), { ok: false, reason: "not_found" });

  await repository.clearPreviewData();
  const reset = await repository.listOrganizerVenueCatalog();
  assert.equal(reset.venues.some(({ id }) => id === "venue-new"), false);
  assert.equal(reset.venues.some(({ id }) => id === "taipei-expo-park-zhengyan-hall"), true);
});

test("catalog rows roll back when their required audit insert fails", async () => {
  await database.prepare(
    `CREATE TRIGGER reject_catalog_audit BEFORE INSERT ON audit_log
     WHEN NEW.action = 'organizer_venue.created'
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`,
  ).run();
  try {
    await assert.rejects(repository.createOrganizerVenue({
      id: "venue-without-audit",
      name: "不可留下的場館",
      sourceUrl: "https://rollback.example/",
      address: "100 臺北市中正區範例路3號",
      createdByAccountId: "account-owner",
      now: 20,
      initialSpace: {
        id: "venue-space-without-audit",
        name: "全館",
        sourceUrl: "https://rollback.example/all",
        defaultAreaMode: "none",
      },
      audit: audit("venue-without-audit"),
    }), /audit unavailable/u);
  } finally {
    await database.prepare("DROP TRIGGER reject_catalog_audit").run();
  }
  assert.equal((await repository.listOrganizerVenueCatalog()).venues.some(({ id }) => id === "venue-without-audit"), false);
});
