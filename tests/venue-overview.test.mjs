import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";
import { amendmentFixture, hash } from "./support/organizer-amendment-fixture.mjs";
import { parseVenueOverviewRecord } from "../app/venue-overview.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const runner = vite.environments.ssr.runner;

const { parseEventDefinition } = await runner.import("/app/event-catalog.ts");
const { resolveOrganizerReferences } = await runner.import("/app/organizer-reference-catalog.ts");
const { buildApprovedPublicationArtifacts } = await runner.import("/app/publication-artifacts.ts");
const { createAdminReferenceHandlers } = await runner.import("/app/admin-reference-handlers.ts");
const { editSharedReference } = await runner.import("/app/admin-reference-edit.ts");
const { EVENT_MAP_MESSAGES } = await runner.import("/app/event-map-app.messages.ts");
const { missingMessageKeys } = await runner.import("/app/i18n/messages.ts");
const { sha256Hex } = await runner.import("/app/portal-crypto.ts");
after(() => vite.close());

const multiEvent = JSON.parse(await readFile(new URL("../fixtures/events/sample-multi/event.json", import.meta.url), "utf8"));
const multiRefs = JSON.parse(await readFile(new URL("../fixtures/events/sample-multi/reference-records.json", import.meta.url), "utf8"));

test("single-venue overview eligibility requires multi-space, single venueId, and full assignment coverage", () => {
  const parsed = parseEventDefinition(multiEvent, multiRefs);
  assert.equal(parsed.venueOverview?.venueId, "sample-campus");

  // Single-space event does not enable venueOverview even if overview record is omitted or would only match 1 space.
  const singleSpaceEvent = {
    ...multiEvent,
    areas: [multiEvent.areas[0]],
    venueAssignments: [multiEvent.venueAssignments[0]],
  };
  const singleParsed = parseEventDefinition(singleSpaceEvent, multiRefs);
  assert.equal(singleParsed.venueOverview, undefined);

  // Cross-venue event does not enable single-venue overview even when one venue has 2 spaces.
  const crossEvent = {
    ...multiEvent,
    venueAssignments: [
      multiEvent.venueAssignments[0],
      multiEvent.venueAssignments[1],
      { venueId: "other-venue", venueSpaceId: "other-hall", areaIds: ["area-c"] },
    ],
  };
  const crossRefs = [
    ...multiRefs,
    {
      schema: "venue/1",
      id: "other-venue",
      name: "其他場館",
      officialUrl: "https://venue.example.invalid/other",
      sources: [{ id: "venue-page", kind: "venue-official", url: "https://venue.example.invalid/other", retrievedAt: "2026-01-01T00:00:00.000+08:00" }],
      provenance: { "/name": ["venue-page"], "/officialUrl": ["venue-page"] },
    },
    {
      schema: "venue-space/1",
      id: "other-hall",
      venueId: "other-venue",
      name: "其他展廳",
      sources: [{ id: "venue-page", kind: "venue-official", url: "https://venue.example.invalid/other", retrievedAt: "2026-01-01T00:00:00.000+08:00" }],
      provenance: { "/name": ["venue-page"] },
    },
  ];
  assert.equal(parseEventDefinition(crossEvent, crossRefs).venueOverview, undefined);

  // Duplicate venueSpaceId inside venue-overview/1 is rejected on direct fixture/staged path too.
  const dupRefs = structuredClone(multiRefs);
  const overview = dupRefs.find((r) => r.schema === "venue-overview/1");
  overview.buildings[3].venueSpaceId = "hall-a";
  assert.throws(() => parseEventDefinition(multiEvent, dupRefs), /duplicate venueSpaceId/);

  // Staged/fixture path enforces official sources and required provenance pointers equally with publication path.
  const nullSourceRefs = structuredClone(multiRefs);
  nullSourceRefs.find((r) => r.schema === "venue-overview/1").sources = [null];
  assert.throws(() => parseEventDefinition(multiEvent, nullSourceRefs), /must be an object/);

  const unknownSourceRefs = structuredClone(multiRefs);
  unknownSourceRefs.find((r) => r.schema === "venue-overview/1").provenance = {
    "/viewBox": ["unknown-source"],
    "/buildings": ["venue-page"],
  };
  assert.throws(() => parseEventDefinition(multiEvent, unknownSourceRefs), /unknown source/);

  const missingProvenanceRefs = structuredClone(multiRefs);
  missingProvenanceRefs.find((r) => r.schema === "venue-overview/1").provenance = {};
  assert.throws(() => parseEventDefinition(multiEvent, missingProvenanceRefs), /missing provenance/);

  // Authored layers cannot place roads or rectangles outside viewBox bounds.
  const baseOverview = multiRefs.find((r) => r.schema === "venue-overview/1");
  const offCanvasRoad = structuredClone(baseOverview);
  offCanvasRoad.layers.roads[0].points = [{ x: 1500, y: 100 }, { x: 1600, y: 100 }];
  assert.throws(() => parseVenueOverviewRecord(offCanvasRoad, "off-canvas-road"), /finite number/);

  const overflowAreaRect = structuredClone(baseOverview);
  overflowAreaRect.layers.areas[0].rect = { x: 1100, y: 140, width: 200, height: 100 };
  assert.throws(() => parseVenueOverviewRecord(overflowAreaRect, "overflow-area-rect"), /within viewBox/);

  const overflowBridgeCircle = structuredClone(baseOverview);
  overflowBridgeCircle.layers.water[0].bridge = {
    rect: { x: 0, y: 510, width: 20, height: 130 },
    circle: { cx: 1, cy: 510, r: 100 },
  };
  assert.throws(() => parseVenueOverviewRecord(overflowBridgeCircle, "overflow-bridge-circle"), /within viewBox/);

  const edgeBridgeCircle = structuredClone(baseOverview);
  edgeBridgeCircle.layers.water[0].bridge = {
    rect: { x: 90, y: 510, width: 20, height: 130 },
    circle: { cx: 100, cy: 540, r: 100 },
  };
  assert.equal(parseVenueOverviewRecord(edgeBridgeCircle, "edge-bridge-circle").venueId, "sample-campus");
});

test("resolveOrganizerReferences attaches venue-overview for single-venue multi-space drafts and amendment baseline accepts newly attached overview", async () => {
  const fixture = await amendmentFixture(runner);
  const venueId = "taipei-expo-park-zhengyan-hall";
  const secondSpaceId = "zhengyan-south";
  const secondSpace = {
    schema: "venue-space/1",
    id: secondSpaceId,
    venueId,
    name: "南館",
    sources: [{ id: "official-source", kind: "venue-official", url: "https://venue.example.invalid/south", retrievedAt: "2026-09-01T00:00:00.000Z" }],
    provenance: { "/name": ["official-source"] },
  };
  const overview = {
    schema: "venue-overview/1",
    venueId,
    viewBox: { width: 800, height: 500 },
    buildings: [
      { id: "main", venueSpaceId: "zhengyan-exhibition-area", label: "全館", rect: { x: 100, y: 150, width: 120, height: 60 }, orientation: "horizontal", roof: "gable", kind: "warehouse" },
      { id: "south", venueSpaceId: secondSpaceId, label: "南館", rect: { x: 400, y: 150, width: 120, height: 60 }, orientation: "horizontal", roof: "gable", kind: "warehouse" },
    ],
    sources: [{ id: "official-source", kind: "venue-official", url: "https://venue.example.invalid/campus", retrievedAt: "2026-09-01T00:00:00.000Z" }],
    provenance: { "/viewBox": ["official-source"], "/buildings": ["official-source"] },
  };
  parseVenueOverviewRecord(overview, "test");

  const draft = structuredClone(fixture.baseline.draft);
  draft.venue.assignments = [
    { venueId, venueSpaceId: "zhengyan-exhibition-area", areaIds: ["A"], mapTemplate: "SAMPLE", areaMode: "imported", areaLabels: { A: "A區" } },
    { venueId, venueSpaceId: secondSpaceId, areaIds: ["B"], mapTemplate: "SAMPLE", areaMode: "imported", areaLabels: { B: "B區" } },
  ];
  const baseRecords = [
    ...fixture.referenceRecords,
    {
      path: `references/venue-spaces/${secondSpaceId}.json`,
      kind: "venue-space",
      id: secondSpaceId,
      organizerId: null,
      revision: null,
      displayName: "南館",
      publicReferenceJson: `${JSON.stringify(secondSpace, null, 2)}\n`,
      sourceCapturedAt: 1,
    },
  ];
  const overviewRecord = {
    path: `references/venue-overviews/${venueId}.json`,
    kind: "venue-overview",
    id: venueId,
    organizerId: null,
    revision: null,
    displayName: "花博公園爭艷館 總覽",
    publicReferenceJson: `${JSON.stringify(overview, null, 2)}\n`,
    sourceCapturedAt: 1,
  };

  const withoutOverview = await resolveOrganizerReferences(draft, baseRecords);
  assert.equal(withoutOverview.issues.length, 0);
  assert.equal(withoutOverview.snapshot.selection.venues[0].overview, undefined);

  const withOverview = await resolveOrganizerReferences(draft, [...baseRecords, overviewRecord]);
  assert.equal(withOverview.issues.length, 0);
  assert.deepEqual(withOverview.snapshot.selection.venues[0].overview, {
    id: venueId,
    path: `references/venue-overviews/${venueId}.json`,
  });

  // Amending a baseline published before overview existed can attach a matching overview without failing baseline check.
  const rows = [
    { sourceRow: 1, dayId: "1", venueSpaceId: "zhengyan-exhibition-area", areaId: "A", codes: ["S01"], circleName: "甲社", stableKey: null, identityGroup: null },
    { sourceRow: 2, dayId: "1", venueSpaceId: secondSpaceId, areaId: "B", codes: ["S02"], circleName: "乙社", stableKey: null, identityGroup: null },
  ];
  const layoutFor = (code) => ({
    schema: "map-contribution-draft/1",
    layout: {
      version: 2, template: "SAMPLE", width: 200, height: 100, floor: { x: 0, y: 0, width: 200, height: 100 },
      rows: [{ label: "S", orientation: "horizontal", confidence: 1, slots: [{ code, rect: { x: 20, y: 35, width: 50, height: 30 } }] }],
      pillars: [], accessPoints: [], landmarks: [],
    },
  });
  const maps = [
    { id: "m1a", periodKey: "1", venueSpaceId: "zhengyan-exhibition-area", mapRevision: 1, content: layoutFor("S01") },
    { id: "m1b", periodKey: "1", venueSpaceId: secondSpaceId, mapRevision: 1, content: layoutFor("S02") },
  ];
  const createSnapshotJson = JSON.stringify({
    schema: "organizer-submission-snapshot/5",
    operation: "CREATE",
    candidateId: fixture.baseline.source.candidateId,
    candidateVersion: fixture.baseline.source.candidateVersion,
    eventId: fixture.baseline.event.id,
    draft,
    contentUpdatedAt: fixture.baseline.event.dataUpdatedAt,
    references: withoutOverview.snapshot,
    import: { source: { sourceDescription: "初版" }, rows },
    maps,
  });
  const created = await buildApprovedPublicationArtifacts({ snapshotJson: createSnapshotJson, approvalHash: hash(createSnapshotJson) });
  const baseline = structuredClone(fixture.baseline);
  baseline.draft = draft;
  baseline.event = created.event;
  baseline.references = withoutOverview.snapshot;
  const baselineJson = JSON.stringify(baseline);
  const snapshotJson = JSON.stringify({
    schema: "organizer-submission-snapshot/4",
    operation: "AMEND",
    candidateId: "amend-overview",
    candidateVersion: 2,
    eventId: baseline.event.id,
    draft,
    contentUpdatedAt: "2026-09-16T00:00:00.000Z",
    references: withOverview.snapshot,
    amendment: { baselineJson, baselineSha256: hash(baselineJson), changes: [] },
    import: { source: { sourceDescription: "更正" }, rows },
    maps,
  });
  const artifacts = await buildApprovedPublicationArtifacts({ snapshotJson, approvalHash: hash(snapshotJson) });
  assert.ok(artifacts.files.some((file) => file.path === "events/event-alpha/reference-selection.json"));
});

test("AMEND rejects newly attached venue-overview for single-space and cross-venue baselines", async () => {
  const fixture = await amendmentFixture(runner);
  const venueId = "taipei-expo-park-zhengyan-hall";
  const singleSpaceOverview = {
    schema: "venue-overview/1",
    venueId,
    viewBox: { width: 800, height: 500 },
    buildings: [
      { id: "main", venueSpaceId: "zhengyan-exhibition-area", label: "全館", rect: { x: 100, y: 150, width: 120, height: 60 }, orientation: "horizontal", roof: "gable", kind: "warehouse" },
    ],
    sources: [{ id: "official-source", kind: "venue-official", url: "https://venue.example.invalid/campus", retrievedAt: "2026-09-01T00:00:00.000Z" }],
    provenance: { "/viewBox": ["official-source"], "/buildings": ["official-source"] },
  };
  const singleOverviewPath = `references/venue-overviews/${venueId}.json`;
  const singleOverviewContent = `${JSON.stringify(singleSpaceOverview, null, 2)}\n`;
  const singleAmendedRefs = {
    selection: {
      ...structuredClone(fixture.baseline.references.selection),
      venues: fixture.baseline.references.selection.venues.map((v, i) => i === 0 ? { ...v, overview: { id: venueId, path: singleOverviewPath } } : v),
    },
    files: [
      ...fixture.baseline.references.files,
      { path: singleOverviewPath, sha256: await sha256Hex(singleOverviewContent), content: singleOverviewContent },
    ].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  };
  const singleBaselineJson = JSON.stringify(fixture.baseline);
  const singleLayout = {
    schema: "map-contribution-draft/1",
    layout: {
      version: 2, template: "SAMPLE", width: 200, height: 100, floor: { x: 0, y: 0, width: 200, height: 100 },
      rows: [{ label: "A", orientation: "horizontal", confidence: 1, slots: [{ code: "A01", rect: { x: 20, y: 35, width: 50, height: 30 } }, { code: "B01", rect: { x: 90, y: 35, width: 50, height: 30 } }] }],
      pillars: [], accessPoints: [], landmarks: [],
    },
  };
  const singleAmendSnapshotJson = JSON.stringify({
    schema: "organizer-submission-snapshot/4",
    operation: "AMEND",
    candidateId: "amend-single-overview",
    candidateVersion: 2,
    eventId: fixture.baseline.event.id,
    draft: fixture.baseline.draft,
    contentUpdatedAt: "2026-09-16T00:00:00.000Z",
    references: singleAmendedRefs,
    amendment: { baselineJson: singleBaselineJson, baselineSha256: hash(singleBaselineJson), changes: [] },
    import: {
      source: { sourceDescription: "更正" },
      rows: [
        { sourceRow: 1, dayId: "1", venueSpaceId: "zhengyan-exhibition-area", areaId: "A", codes: ["A01"], circleName: "甲社", stableKey: null, identityGroup: null },
        { sourceRow: 2, dayId: "1", venueSpaceId: "zhengyan-exhibition-area", areaId: "B", codes: ["B01"], circleName: "乙社", stableKey: null, identityGroup: null },
      ],
    },
    maps: [{ id: "m1", periodKey: "1", venueSpaceId: "zhengyan-exhibition-area", mapRevision: 1, content: singleLayout }],
  });
  await assert.rejects(
    buildApprovedPublicationArtifacts({ snapshotJson: singleAmendSnapshotJson, approvalHash: hash(singleAmendSnapshotJson) }),
    (error) => error?.code === "snapshot_mismatch",
  );

  // Cross-venue baseline: adding an overview to venues[0] (even with 2 spaces) must also fail snapshot_mismatch.
  const secondSpaceId = "zhengyan-south";
  const otherVenueId = "other-venue";
  const otherSpaceId = "other-hall";
  const crossRecords = [
    ...fixture.referenceRecords,
    {
      path: `references/venue-spaces/${secondSpaceId}.json`, kind: "venue-space", id: secondSpaceId, organizerId: null, revision: null, displayName: "南館",
      publicReferenceJson: `${JSON.stringify({ schema: "venue-space/1", id: secondSpaceId, venueId, name: "南館", sources: [{ id: "official-source", kind: "venue-official", url: "https://venue.example.invalid/south", retrievedAt: "2026-09-01T00:00:00.000Z" }], provenance: { "/name": ["official-source"] } }, null, 2)}\n`,
      sourceCapturedAt: 1,
    },
    {
      path: `references/venues/${otherVenueId}.json`, kind: "venue", id: otherVenueId, organizerId: null, revision: null, displayName: "其他場館",
      publicReferenceJson: `${JSON.stringify({ schema: "venue/1", id: otherVenueId, name: "其他場館", address: "台北市其他路 1 號", officialUrl: "https://venue.example.invalid/other", sources: [{ id: "official-source", kind: "venue-official", url: "https://venue.example.invalid/other", retrievedAt: "2026-09-01T00:00:00.000Z" }], provenance: { "/name": ["official-source"], "/address": ["official-source"], "/officialUrl": ["official-source"] } }, null, 2)}\n`,
      sourceCapturedAt: 1,
    },
    {
      path: `references/venue-spaces/${otherSpaceId}.json`, kind: "venue-space", id: otherSpaceId, organizerId: null, revision: null, displayName: "其他展廳",
      publicReferenceJson: `${JSON.stringify({ schema: "venue-space/1", id: otherSpaceId, venueId: otherVenueId, name: "其他展廳", sources: [{ id: "official-source", kind: "venue-official", url: "https://venue.example.invalid/other", retrievedAt: "2026-09-01T00:00:00.000Z" }], provenance: { "/name": ["official-source"] } }, null, 2)}\n`,
      sourceCapturedAt: 1,
    },
  ];
  const crossDraft = structuredClone(fixture.baseline.draft);
  crossDraft.venue.assignments = [
    { venueId, venueSpaceId: "zhengyan-exhibition-area", areaIds: ["A"], mapTemplate: "SAMPLE", areaMode: "imported", areaLabels: { A: "A區" } },
    { venueId, venueSpaceId: secondSpaceId, areaIds: ["B"], mapTemplate: "SAMPLE", areaMode: "imported", areaLabels: { B: "B區" } },
    { venueId: otherVenueId, venueSpaceId: otherSpaceId, areaIds: ["C"], mapTemplate: "SAMPLE", areaMode: "imported", areaLabels: { C: "C區" } },
  ];
  const crossRefs = await resolveOrganizerReferences(crossDraft, crossRecords);
  assert.equal(crossRefs.issues.length, 0);
  const crossRows = [
    { sourceRow: 1, dayId: "1", venueSpaceId: "zhengyan-exhibition-area", areaId: "A", codes: ["S01"], circleName: "甲社", stableKey: null, identityGroup: null },
    { sourceRow: 2, dayId: "1", venueSpaceId: secondSpaceId, areaId: "B", codes: ["S02"], circleName: "乙社", stableKey: null, identityGroup: null },
    { sourceRow: 3, dayId: "1", venueSpaceId: otherSpaceId, areaId: "C", codes: ["S03"], circleName: "丙社", stableKey: null, identityGroup: null },
  ];
  const mapFor = (code) => ({
    schema: "map-contribution-draft/1",
    layout: {
      version: 2, template: "SAMPLE", width: 200, height: 100, floor: { x: 0, y: 0, width: 200, height: 100 },
      rows: [{ label: "S", orientation: "horizontal", confidence: 1, slots: [{ code, rect: { x: 20, y: 35, width: 50, height: 30 } }] }],
      pillars: [], accessPoints: [], landmarks: [],
    },
  });
  const crossMaps = [
    { id: "m1a", periodKey: "1", venueSpaceId: "zhengyan-exhibition-area", mapRevision: 1, content: mapFor("S01") },
    { id: "m1b", periodKey: "1", venueSpaceId: secondSpaceId, mapRevision: 1, content: mapFor("S02") },
    { id: "m1c", periodKey: "1", venueSpaceId: otherSpaceId, mapRevision: 1, content: mapFor("S03") },
  ];
  const crossCreateJson = JSON.stringify({
    schema: "organizer-submission-snapshot/5",
    operation: "CREATE",
    candidateId: fixture.baseline.source.candidateId,
    candidateVersion: fixture.baseline.source.candidateVersion,
    eventId: fixture.baseline.event.id,
    draft: crossDraft,
    contentUpdatedAt: fixture.baseline.event.dataUpdatedAt,
    references: crossRefs.snapshot,
    import: { source: { sourceDescription: "初版" }, rows: crossRows },
    maps: crossMaps,
  });
  const createdCross = await buildApprovedPublicationArtifacts({ snapshotJson: crossCreateJson, approvalHash: hash(crossCreateJson) });
  const crossBaseline = structuredClone(fixture.baseline);
  crossBaseline.draft = crossDraft;
  crossBaseline.event = createdCross.event;
  crossBaseline.references = crossRefs.snapshot;
  const crossBaselineJson = JSON.stringify(crossBaseline);

  const multiSpaceOverview = {
    schema: "venue-overview/1",
    venueId,
    viewBox: { width: 800, height: 500 },
    buildings: [
      { id: "main", venueSpaceId: "zhengyan-exhibition-area", label: "全館", rect: { x: 100, y: 150, width: 120, height: 60 }, orientation: "horizontal", roof: "gable", kind: "warehouse" },
      { id: "south", venueSpaceId: secondSpaceId, label: "南館", rect: { x: 400, y: 150, width: 120, height: 60 }, orientation: "horizontal", roof: "gable", kind: "warehouse" },
    ],
    sources: [{ id: "official-source", kind: "venue-official", url: "https://venue.example.invalid/campus", retrievedAt: "2026-09-01T00:00:00.000Z" }],
    provenance: { "/viewBox": ["official-source"], "/buildings": ["official-source"] },
  };
  const crossOverviewContent = `${JSON.stringify(multiSpaceOverview, null, 2)}\n`;
  const crossAmendedRefs = {
    selection: {
      ...structuredClone(crossRefs.snapshot.selection),
      venues: crossRefs.snapshot.selection.venues.map((v) => v.id === venueId ? { ...v, overview: { id: venueId, path: singleOverviewPath } } : v),
    },
    files: [
      ...crossRefs.snapshot.files,
      { path: singleOverviewPath, sha256: await sha256Hex(crossOverviewContent), content: crossOverviewContent },
    ].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  };
  const crossAmendSnapshotJson = JSON.stringify({
    schema: "organizer-submission-snapshot/4",
    operation: "AMEND",
    candidateId: "amend-cross-overview",
    candidateVersion: 2,
    eventId: crossBaseline.event.id,
    draft: crossDraft,
    contentUpdatedAt: "2026-09-16T00:00:00.000Z",
    references: crossAmendedRefs,
    amendment: { baselineJson: crossBaselineJson, baselineSha256: hash(crossBaselineJson), changes: [] },
    import: { source: { sourceDescription: "更正" }, rows: crossRows },
    maps: crossMaps,
  });
  await assert.rejects(
    buildApprovedPublicationArtifacts({ snapshotJson: crossAmendSnapshotJson, approvalHash: hash(crossAmendSnapshotJson) }),
    (error) => error?.code === "snapshot_mismatch",
  );
});

test("admin reference edit/delete rejects venue-overview without mutating the stored row", async () => {
  const overviewRecord = multiRefs.find((record) => record.schema === "venue-overview/1");
  const jsonText = `${JSON.stringify(overviewRecord, null, 2)}\n`;
  const row = {
    path: "references/venue-overviews/sample-campus.json",
    kind: "venue-overview",
    id: "sample-campus",
    organizerId: null,
    revision: null,
    displayName: "範例藝術園區 總覽",
    publicReferenceJson: jsonText,
    sourceCapturedAt: 1,
  };
  let mutated = false;
  const repo = {
    listOrganizerVenueCatalog: async () => ({ venues: [] }),
    listOrganizerReferenceRecords: async () => [row],
    listAdminReferenceAccess: async () => [],
    mutateAdminReference: async () => { mutated = true; return true; },
  };
  const { adminCreateReference } = createAdminReferenceHandlers(
    repo,
    async () => ({ ok: true, session: { accountId: "admin-1" } }),
    () => Date.now(),
  );
  const version = await sha256Hex(jsonText);
  for (const action of ["edit", "delete"]) {
    const res = await adminCreateReference(new Request("https://example.test/api/admin/references", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        kind: "venue-overview",
        path: row.path,
        version,
        name: "誤改名稱",
        sourceUrl: "https://venue.example.invalid/campus",
      }),
    }));
    assert.equal(res.status, 400);
  }
  assert.equal(mutated, false);
  assert.equal(row.publicReferenceJson, jsonText);
  assert.throws(() => editSharedReference(row, { name: "誤改名稱", sourceUrl: "https://venue.example.invalid/campus" }, 1), /不支援編輯/);
});

test("event-map messages define complete zh-Hant, en, and ja translations for overview controls", () => {
  assert.deepEqual(missingMessageKeys(EVENT_MAP_MESSAGES, "zh-Hant"), []);
  assert.deepEqual(missingMessageKeys(EVENT_MAP_MESSAGES, "en"), []);
  assert.deepEqual(missingMessageKeys(EVENT_MAP_MESSAGES, "ja"), []);
});
