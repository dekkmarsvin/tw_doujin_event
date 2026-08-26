import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { recognizeFF47Map } = await environment.runner.import("/app/map-recognition.ts");
const { hasMapTemplateRecognizer, recognizeMapTemplate, validateMapTemplateLayout } = await environment.runner.import("/app/map-template-registry.ts");
const { createBlankEventMapLayout, resolveMapLandmarkKind, scaleMapLandmarks, validateEventMapLayout } = await environment.runner.import("/app/event-map.ts");
const { validateLayout: validateFf47Layout } = await environment.runner.import("/app/ff47-map-template-validator.ts");
const { formatSlotCode, generateRowSlots, resizeRectFromCorner, rowOrientationFromEndpoints, snapRectToAdjacentRects } = await environment.runner.import("/app/map-layout-editor-geometry.ts");
const { validateStagedEventArtifacts } = await environment.runner.import("/app/staged-event-data.ts");
after(() => vite.close());

test("validates the staged fixture map without FF47-specific counts", async () => {
  const event = JSON.parse(await readFile(new URL("../fixtures/events/sample/event.json", import.meta.url), "utf8"));
  const references = JSON.parse(await readFile(new URL("../fixtures/events/sample/reference-records.json", import.meta.url), "utf8"));
  const catalog = JSON.parse(await readFile(new URL("../fixtures/events/sample/circles.json", import.meta.url), "utf8"));
  const snapshot = JSON.parse(await readFile(new URL("../fixtures/events/sample/map.json", import.meta.url), "utf8"));
  assert.equal(snapshot.eventId, "sample");
  assert.ok(Number.isSafeInteger(snapshot.revision) && snapshot.revision > 0);
  assert.equal(validateEventMapLayout(snapshot.layout).ok, true);
  assert.equal(validateFf47Layout(snapshot.layout).ok, false);
  assert.equal(validateStagedEventArtifacts(event, references, catalog, snapshot, "sample").map, snapshot);
  assert.throws(() => validateStagedEventArtifacts(event, references, catalog, { ...snapshot, layout: { ...snapshot.layout, template: "FF47" } }, "sample"), /does not match/);
  assert.throws(() => validateStagedEventArtifacts(event, references, { ...catalog, placements: [...catalog.placements, catalog.placements[0]] }, snapshot, "sample"), /duplicate placement/);
  const multiSpaceReferences = [...references, {
    ...structuredClone(references.find(({ schema }) => schema === "venue-space/1")),
    id: "sample-south-floor",
    name: "範例南館樓層",
  }];
  const multiSpaceEvent = {
    ...event,
    venueAssignments: [
      { venueId: "sample-venue", venueSpaceId: "sample-hall", areaIds: ["north"] },
      { venueId: "sample-venue", venueSpaceId: "sample-south-floor", areaIds: ["south"] },
    ],
  };
  assert.throws(() => validateStagedEventArtifacts(multiSpaceEvent, multiSpaceReferences, catalog, snapshot, "sample"), /Per-space published map artifacts/);
});

function syntheticFF47Image() {
  const width = 1200;
  const height = 848;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const pixel = (x, y, [r, g, b] = [0, 0, 0]) => {
    const offset = (y * width + x) * 4;
    data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = 255;
  };
  const vline = (x, y1, y2, color) => { for (let y = y1; y <= y2; y += 1) pixel(x, y, color); };
  const hline = (y, x1, x2) => { for (let x = x1; x <= x2; x += 1) pixel(x, y); };
  const block = (x, y, w, h) => { for (let py = y; py < y + h; py += 1) for (let px = x; px < x + w; px += 1) pixel(px, py); };

  const upper = [408, 472, 534, 598, 662, 726, 790, 854, 918];
  const lower = [394, 449, 504, 558, 613, 711, 766, 821, 876, 931, 986, 1041];
  upper.forEach((start) => [0, 14, 28].forEach((dx) => vline(start + dx, 205, 405)));
  lower.forEach((start) => [0, 14, 28].forEach((dx) => vline(start + dx, 483, 683)));
  vline(1100, 483, 683); vline(1114, 483, 683);
  for (let index = 0; index < 23; index += 1) {
    upper.forEach((start) => hline(205 + index * 9, start, start + 28));
    lower.forEach((start) => hline(483 + index * 9, start, start + 28));
  }

  hline(130, 400, 988); hline(150, 400, 988);
  for (let index = 0; index <= 42; index += 1) vline(400 + index * 14, 130, 150);

  [{ y: 35, count: 7 }, { y: 80, count: 3 }, { y: 725, count: 9 }, { y: 775, count: 9 }].forEach(({ y, count }) => {
    for (let index = 0; index < count; index += 1) block(70 + index * 70, y, 8, 12);
  });
  vline(250, 5, 30, [220, 30, 30]);
  [200, 450, 700, 950].forEach((x) => vline(x, 815, 842, [220, 30, 30]));
  return { data, width, height };
}

test("recognizes A-W with horizontal W, pillars, and access points", () => {
  const report = recognizeMapTemplate("FF47", syntheticFF47Image());
  assert.deepEqual(report.diagnostics, { rowCount: 23, slotCount: 988, pillarCount: 28, accessPointCount: 5 });
  assert.equal(validateEventMapLayout(report.layout).ok, true);
  assert.equal(validateFf47Layout(report.layout).ok, true);
  const rows = Object.fromEntries(report.layout.rows.map((row) => [row.label, row]));
  assert.equal(rows.A.orientation, "vertical");
  assert.equal(rows.A.slots.length, 22);
  assert.equal(rows.V.slots.length, 44);
  assert.equal(rows.W.orientation, "horizontal");
  assert.equal(rows.W.slots.length, 42);
  assert.deepEqual(report.layout.landmarks, []);
  assert.ok(report.warnings.some((warning) => warning.includes("企業攤與舞台目前不會自動辨識")));
  assert.ok(rows.A.slots.find((slot) => slot.code === "A01").rect.y > rows.A.slots.find((slot) => slot.code === "A22").rect.y);
  assert.ok(rows.B.slots.find((slot) => slot.code === "B23").rect.y < rows.B.slots.find((slot) => slot.code === "B44").rect.y);
  assert.ok(rows.W.slots.find((slot) => slot.code === "W42").rect.x < rows.W.slots.find((slot) => slot.code === "W01").rect.x);
});

test("template registry dispatches event-specific adapters without making them global invariants", () => {
  const fixture = JSON.parse('{"version":2,"template":"SAMPLE","width":10,"height":10,"floor":{"x":0,"y":0,"width":10,"height":10},"rows":[{"label":"S","orientation":"horizontal","confidence":1,"slots":[{"code":"S01","rect":{"x":1,"y":1,"width":2,"height":2}}]}],"pillars":[],"accessPoints":[],"landmarks":[]}');
  assert.equal(validateMapTemplateLayout("SAMPLE", fixture).ok, true);
  assert.equal(validateMapTemplateLayout("FF47", fixture).ok, false);
  assert.throws(() => recognizeMapTemplate("SAMPLE", syntheticFF47Image()), /尚未提供圖片辨識 adapter/);
});

test("accepts a generic future event layout without FF47-specific counts", () => {
  const layout = { version: 2, template: "TAIWAN_GENERIC_V1", width: 100, height: 100, floor: { x: 0, y: 0, width: 100, height: 100 }, rows: [{ label: "創作區", orientation: "horizontal", confidence: 1, slots: [{ code: "創01", rect: { x: 10, y: 10, width: 10, height: 10 } }] }], pillars: [], accessPoints: [], landmarks: [] };
  assert.equal(validateEventMapLayout(layout).ok, true);
  assert.equal(validateFf47Layout(layout).ok, false);
});

test("rejects malformed or duplicate non-booth landmarks", () => {
  const base = { version: 2, template: "TAIWAN_GENERIC_V1", width: 100, height: 100, floor: { x: 0, y: 0, width: 100, height: 100 }, rows: [], pillars: [], accessPoints: [] };
  assert.equal(validateEventMapLayout({ ...base, landmarks: [null] }).ok, false);
  assert.equal(validateEventMapLayout({ ...base, landmarks: [{ id: "stage-1", label: "", rect: { x: 10, y: 10, width: 20, height: 10 } }] }).ok, false);
  assert.equal(validateEventMapLayout({ ...base, landmarks: [{ id: "stage-1", label: "舞台", rect: { x: 95, y: 10, width: 20, height: 10 } }] }).ok, false);
  assert.equal(validateEventMapLayout({ ...base, landmarks: [{ id: "stage-1", label: "舞台", rect: { x: 10, y: 10, width: 20, height: 10 } }, { id: "stage-1", label: "企業攤", rect: { x: 40, y: 10, width: 20, height: 10 } }] }).ok, false);
  assert.equal(validateEventMapLayout({ ...base, landmarks: [{ id: "stage-1", kind: "billboard", label: "舞台", rect: { x: 10, y: 10, width: 20, height: 10 } }] }).ok, false);
});

test("resizes any non-booth landmark rectangle from all four corners", () => {
  const rect = { x: 20, y: 30, width: 40, height: 20 };
  const bounds = { width: 100, height: 100 };
  assert.deepEqual(resizeRectFromCorner(rect, "nw", -10, -15, bounds, 12), { x: 10, y: 15, width: 50, height: 35 });
  assert.deepEqual(resizeRectFromCorner(rect, "ne", 20, -15, bounds, 12), { x: 20, y: 15, width: 60, height: 35 });
  assert.deepEqual(resizeRectFromCorner(rect, "se", 20, 15, bounds, 12), { x: 20, y: 30, width: 60, height: 35 });
  assert.deepEqual(resizeRectFromCorner(rect, "sw", -10, 15, bounds, 12), { x: 10, y: 30, width: 50, height: 35 });
  assert.deepEqual(resizeRectFromCorner(rect, "nw", 100, 100, bounds, 12), { x: 48, y: 38, width: 12, height: 12 });
});

test("snaps enterprise rectangles to the nearest overlapping adjacent edge", () => {
  const bounds = { width: 200, height: 120 };
  const target = { id: "enterprise-a", rect: { x: 20, y: 8, width: 30, height: 28 } };
  const moved = snapRectToAdjacentRects({ x: 52, y: 10, width: 20, height: 20 }, [target], { bounds, mode: "move", threshold: 3 });
  assert.deepEqual(moved.rect, { x: 50, y: 10, width: 20, height: 20 });
  assert.deepEqual(moved.guides, [{ axis: "x", position: 50, start: 8, end: 36, targetId: "enterprise-a" }]);

  const separated = snapRectToAdjacentRects({ x: 52, y: 70, width: 20, height: 20 }, [target], { bounds, mode: "move", threshold: 3 });
  assert.deepEqual(separated, { rect: { x: 52, y: 70, width: 20, height: 20 }, guides: [] });
});

test("snaps only the active resize-corner edges without moving the opposite corner", () => {
  const snapped = snapRectToAdjacentRects({ x: 50, y: 42, width: 18, height: 18 }, [
    { id: "enterprise-right", rect: { x: 70, y: 45, width: 20, height: 20 } },
    { id: "enterprise-above", rect: { x: 52, y: 20, width: 14, height: 20 } },
  ], { bounds: { width: 200, height: 120 }, mode: "ne", threshold: 3, minimumSize: 12 });
  assert.deepEqual(snapped.rect, { x: 50, y: 40, width: 20, height: 20 });
  assert.deepEqual(snapped.guides.map((guide) => [guide.axis, guide.position, guide.targetId]), [
    ["x", 70, "enterprise-right"],
    ["y", 40, "enterprise-above"],
  ]);

  const minimumProtected = snapRectToAdjacentRects({ x: 50, y: 40, width: 24, height: 24 }, [
    { id: "enterprise-right", rect: { x: 70, y: 40, width: 20, height: 24 } },
  ], { bounds: { width: 200, height: 120 }, mode: "se", threshold: 5 });
  assert.deepEqual(minimumProtected, { rect: { x: 50, y: 40, width: 24, height: 24 }, guides: [] });
});

test("keeps landmark types editable and scales manual regions for a replacement image", () => {
  assert.equal(resolveMapLandmarkKind({ label: "企業攤" }), "enterprise");
  assert.equal(resolveMapLandmarkKind({ label: "主舞台", kind: "stage" }), "stage");
  assert.equal(resolveMapLandmarkKind({ label: "主舞台" }), "other");
  assert.deepEqual(
    scaleMapLandmarks([{ id: "stage-1", kind: "stage", label: "主舞台", rect: { x: 10, y: 20, width: 30, height: 40 } }], { width: 100, height: 200 }, { width: 200, height: 100 }),
    [{ id: "stage-1", kind: "stage", label: "主舞台", rect: { x: 20, y: 10, width: 60, height: 20 } }],
  );
});

test("rejects images that are too small", () => {
  const report = recognizeFF47Map({ data: new Uint8ClampedArray(400 * 300 * 4), width: 400, height: 300 });
  assert.equal(report.confidence, 0);
  assert.match(report.warnings[0], /解析度太低/);
});

test("a template without a recognition adapter still yields a publishable blank canvas", () => {
  // Authoring must not depend on recognition: a brand-new venue has no adapter,
  // and the maintainer traces the official plan by hand instead.
  assert.equal(hasMapTemplateRecognizer("FF47"), true);
  assert.equal(hasMapTemplateRecognizer("PIER2-2025"), false);
  const blank = createBlankEventMapLayout("PIER2-2025", 1600, 1000);
  assert.equal(validateEventMapLayout(blank).ok, true);
  assert.deepEqual(blank.floor, { x: 0, y: 0, width: 1600, height: 1000 });
  assert.deepEqual([blank.rows, blank.pillars, blank.accessPoints, blank.landmarks], [[], [], [], []]);
  assert.equal(createBlankEventMapLayout("PIER2-2025", 0, -5).width, 1);
});

test("a row is generated from two endpoints, a count and a numbering rule", () => {
  const definition = {
    label: "B", start: { x: 100, y: 50 }, end: { x: 100, y: 950 },
    slotCount: 10, slotWidth: 40, slotHeight: 30, codePrefix: "B", startNumber: 1, numberPadding: 2,
  };
  const result = generateRowSlots(definition, { width: 1600, height: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.row.label, "B");
  assert.equal(result.row.orientation, "vertical");
  assert.equal(result.row.confidence, 1);
  assert.equal(result.row.slots.length, 10);
  assert.deepEqual(result.row.slots.map(({ code }) => code).slice(0, 3), ["B01", "B02", "B03"]);
  assert.equal(result.row.slots.at(-1).code, "B10");
  // Endpoints are slot centres, so the first rectangle straddles y = 50.
  assert.deepEqual(result.row.slots[0].rect, { x: 80, y: 35, width: 40, height: 30 });
  assert.equal(result.row.slots.at(-1).rect.y, 935);
  const gaps = result.row.slots.slice(1).map((slot, index) => slot.rect.y - result.row.slots[index].rect.y);
  assert.equal(new Set(gaps.map((gap) => Math.round(gap * 1e6))).size, 1);
});

test("row labels and booth codes accept any script, including branch characters", () => {
  // 駁二動漫祭 numbers eight of its rows with 地支 characters, and CWT gives its
  // commercial section the 商 prefix. Neither may need special handling.
  const rows = [
    generateRowSlots({ label: "子", start: { x: 20, y: 20 }, end: { x: 20, y: 80 }, slotCount: 32, slotWidth: 6, slotHeight: 2, codePrefix: "子", startNumber: 1, numberPadding: 2 }, { width: 100, height: 100 }),
    generateRowSlots({ label: "商", start: { x: 20, y: 90 }, end: { x: 80, y: 90 }, slotCount: 4, slotWidth: 8, slotHeight: 4, codePrefix: "商", startNumber: 1, numberPadding: 2 }, { width: 100, height: 100 }),
  ];
  assert.deepEqual(rows.map(({ ok }) => ok), [true, true]);
  assert.equal(rows[0].row.slots[0].code, "子01");
  assert.equal(rows[0].row.slots.at(-1).code, "子32");
  assert.deepEqual(rows[1].row.slots.map(({ code }) => code), ["商01", "商02", "商03", "商04"]);
  const layout = { ...createBlankEventMapLayout("PIER2-2025", 100, 100), rows: rows.map(({ row }) => row) };
  assert.equal(validateEventMapLayout(layout).ok, true);
  assert.equal(formatSlotCode("辰", 7, 2), "辰07");
  assert.equal(formatSlotCode("K", 6, 0), "K6");
});

test("row generation refuses definitions that cannot produce a valid row", () => {
  const bounds = { width: 100, height: 100 };
  const base = { label: "A", start: { x: 10, y: 10 }, end: { x: 10, y: 90 }, slotCount: 4, slotWidth: 8, slotHeight: 8, codePrefix: "A", startNumber: 1, numberPadding: 2 };
  assert.equal(generateRowSlots({ ...base, label: "  " }, bounds).ok, false);
  assert.equal(generateRowSlots({ ...base, slotCount: 0 }, bounds).ok, false);
  assert.equal(generateRowSlots({ ...base, slotCount: 2.5 }, bounds).ok, false);
  assert.equal(generateRowSlots({ ...base, slotWidth: 0 }, bounds).ok, false);
  assert.equal(generateRowSlots({ ...base, startNumber: -1 }, bounds).ok, false);
  assert.equal(generateRowSlots({ ...base, end: { x: Number.NaN, y: 90 } }, bounds).ok, false);
  // A zero-length step would stack every booth on one code.
  const collapsed = generateRowSlots({ ...base, startNumber: 1, numberPadding: 2, slotCount: 3, end: { x: 10, y: 10 } }, bounds);
  assert.equal(collapsed.ok, true);
  assert.deepEqual(collapsed.row.slots.map(({ code }) => code), ["A01", "A02", "A03"]);
  // Rectangles never leave the sheet, even when an endpoint sits on the edge.
  const clamped = generateRowSlots({ ...base, start: { x: 0, y: 0 }, end: { x: 100, y: 100 } }, bounds);
  assert.equal(clamped.ok, true);
  assert.ok(clamped.row.slots.every(({ rect }) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 100 && rect.y + rect.height <= 100));
});

test("row orientation comes from the endpoints, so it can never contradict them", () => {
  // Both renderers place the row label from `orientation`
  // (`row.orientation === "horizontal" ? maxY + 30 : minY - 13`), so a value
  // that disagrees with the geometry puts the label on the wrong axis.
  assert.equal(rowOrientationFromEndpoints({ x: 0, y: 0 }, { x: 100, y: 0 }), "horizontal");
  assert.equal(rowOrientationFromEndpoints({ x: 0, y: 0 }, { x: 0, y: 100 }), "vertical");
  assert.equal(rowOrientationFromEndpoints({ x: 100, y: 0 }, { x: 0, y: 0 }), "horizontal");
  // A square span and coincident endpoints are called vertical, matching how
  // every recognized row is stored.
  assert.equal(rowOrientationFromEndpoints({ x: 0, y: 0 }, { x: 50, y: 50 }), "vertical");
  assert.equal(rowOrientationFromEndpoints({ x: 20, y: 20 }, { x: 20, y: 20 }), "vertical");

  const bounds = { width: 200, height: 200 };
  const base = { label: "R", slotCount: 4, slotWidth: 10, slotHeight: 10, codePrefix: "R", startNumber: 1, numberPadding: 2 };
  assert.equal(generateRowSlots({ ...base, start: { x: 20, y: 100 }, end: { x: 180, y: 100 } }, bounds).row.orientation, "horizontal");
  assert.equal(generateRowSlots({ ...base, start: { x: 100, y: 20 }, end: { x: 100, y: 180 } }, bounds).row.orientation, "vertical");
});
