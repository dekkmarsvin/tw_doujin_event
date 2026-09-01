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

test("a new venue and spaces are immediately shared while duplicate human names are refused", async () => {
  assert.deepEqual(await repository.createOrganizerVenue({
    id: "venue-new",
    name: "新展覽館",
    sourceUrl: "https://venue.example/",
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
  assert.deepEqual(venue.spaces.map(({ id, defaultAreaMode }) => [id, defaultAreaMode]), [
    ["venue-space-new-1f", "none"],
    ["venue-space-new-4f", "imported"],
  ]);

  assert.deepEqual(await repository.createOrganizerVenue({
    id: "venue-duplicate",
    name: "  新展覽館  ",
    sourceUrl: "https://duplicate.example/",
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
