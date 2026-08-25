import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { recognizeFF47Map } = await environment.runner.import("/app/map-recognition.ts");
const { recognizeMapTemplate, validateMapTemplateLayout } = await environment.runner.import("/app/map-template-registry.ts");
const { resolveMapLandmarkKind, scaleMapLandmarks, validateEventMapLayout } = await environment.runner.import("/app/event-map.ts");
const { validateLayout: validateFf47Layout } = await environment.runner.import("/app/ff47-map-template-validator.ts");
const { resizeRectFromCorner, snapRectToAdjacentRects } = await environment.runner.import("/app/map-layout-editor-geometry.ts");
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
