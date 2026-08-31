import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { recognizeFF47Map } = await environment.runner.import("/app/map-recognition.ts");
const { hasMapTemplateRecognizer, recognizeMapTemplate, validateMapTemplateLayout } = await environment.runner.import("/app/map-template-registry.ts");
const { createBlankEventMapLayout, mapAccessArrowTransform, resolveMapLandmarkKind, scaleEventMapLayout, scaleMapLandmarks, validateEventMapLayout, MAP_ACCESS_DIRECTIONS } = await environment.runner.import("/app/event-map.ts");
const { validateLayout: validateFf47Layout } = await environment.runner.import("/app/ff47-map-template-validator.ts");
const { confirmedDraftSlots, formatSlotCode, generateRowSlots, inferRowFromAnchors, resizeRectFromCorner, rowOrientationFromEndpoints, snapRectToAdjacentRects } = await environment.runner.import("/app/map-layout-editor-geometry.ts");
const { alignBoxesToEdge, applySelectionBoxes, boundingBox, findRowConflicts, mergeSelections, pasteRowAtOffset, removeSelectionsFrom, resolveSelectionBoxes, scaleBoxesIntoBox, selectionSetKey, selectionsWithinBox, toggleSelection, translateBoxesWithin } = await environment.runner.import("/app/map-layout-editor-selection.ts");
const { LAYOUT_HISTORY_LIMIT, canRedoLayoutHistory, canUndoLayoutHistory, createLayoutHistory, pushLayoutHistory, redoLayoutHistory, sealLayoutHistory, undoLayoutHistory } = await environment.runner.import("/app/map-editor-history.ts");
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
  assert.throws(() => validateStagedEventArtifacts(multiSpaceEvent, multiSpaceReferences, catalog, snapshot, "sample"), /requires scoped map artifacts/);
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
  assert.throws(() => recognizeMapTemplate("SAMPLE", syntheticFF47Image()), /不支援自動辨識/);
});

test("accepts a generic future event layout without FF47-specific counts", () => {
  const layout = { version: 2, template: "TAIWAN_GENERIC_V1", width: 100, height: 100, floor: { x: 0, y: 0, width: 100, height: 100 }, rows: [{ label: "創作區", orientation: "horizontal", confidence: 1, slots: [{ code: "創01", rect: { x: 10, y: 10, width: 10, height: 10 } }] }], pillars: [], accessPoints: [], landmarks: [] };
  assert.equal(validateEventMapLayout(layout).ok, true);
  assert.equal(validateFf47Layout(layout).ok, false);
});

test("access points point at all four compass directions", () => {
  // 倉庫群、多棟園區與跨館場地的出入口開在東西側，只有南北時只能畫成錯的方向。
  const base = { version: 2, template: "PIER2-2025", width: 100, height: 100, floor: { x: 0, y: 0, width: 100, height: 100 }, rows: [], pillars: [], landmarks: [] };
  const accessPoint = (id, direction, x) => ({ id, kind: "entrance", direction, x, y: 50, label: `${id} 出入口` });
  assert.equal(validateEventMapLayout({ ...base, accessPoints: [accessPoint("east-1", "east", 90), accessPoint("west-1", "west", 10)] }).ok, true);
  assert.equal(validateEventMapLayout({ ...base, accessPoints: [accessPoint("north-1", "north", 40), accessPoint("south-1", "south", 60)] }).ok, true);
  assert.equal(validateEventMapLayout({ ...base, accessPoints: [accessPoint("up-1", "up", 50)] }).ok, false);
  assert.deepEqual(MAP_ACCESS_DIRECTIONS.map((direction) => mapAccessArrowTransform({ direction, x: 10, y: 20 })), [undefined, "rotate(180, 10, 20)", "rotate(90, 10, 20)", "rotate(270, 10, 20)"]);
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

test("a corner grab never enlarges a rectangle already smaller than the handle minimum", () => {
  // Recognised FF47 booths are 18 units tall, well under the 24-unit default.
  const slot = { x: 40, y: 40, width: 28, height: 18 };
  const bounds = { width: 2400, height: 1696 };
  assert.deepEqual(resizeRectFromCorner(slot, "se", 1, 1, bounds), { x: 40, y: 40, width: 29, height: 19 });
  assert.deepEqual(resizeRectFromCorner(slot, "nw", -1, -1, bounds), { x: 39, y: 39, width: 29, height: 19 });
  assert.deepEqual(resizeRectFromCorner(slot, "se", 0, 0, bounds), slot, "an idle grab leaves the booth untouched");
  assert.deepEqual(resizeRectFromCorner(slot, "se", -999, -999, bounds), { x: 40, y: 40, width: 24, height: 18 },
    "the height floor is the booth's own 18, never the default that would inflate it");
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

test("resizes and snaps booth and pillar rectangles exactly like a landmark rectangle", () => {
  const bounds = { width: 200, height: 100 };
  const rect = { x: 40, y: 20, width: 40, height: 28 };
  const deltas = { nw: [-8, -6], ne: [8, -6], se: [8, 6], sw: [-8, 6] };
  const expected = {
    nw: { x: 32, y: 14, width: 48, height: 34 },
    ne: { x: 40, y: 14, width: 48, height: 34 },
    se: { x: 40, y: 20, width: 48, height: 34 },
    sw: { x: 32, y: 20, width: 48, height: 34 },
  };
  for (const corner of ["nw", "ne", "se", "sw"]) {
    assert.deepEqual(resizeRectFromCorner(rect, corner, ...deltas[corner], bounds), expected[corner]);
  }

  // A booth, a pillar and an enterprise landmark differ only in which siblings
  // the editor offers as snap partners; the geometry itself is one path.
  const neighbour = { x: 90, y: 20, width: 40, height: 28 };
  const resized = resizeRectFromCorner(rect, "se", 8, 6, bounds);
  const snapTo = (id) => snapRectToAdjacentRects(resized, [{ id, rect: neighbour }], { bounds, mode: "se", threshold: 3 });
  const asSlot = snapTo("A02");
  const asPillar = snapTo("pillar-2");
  const asLandmark = snapTo("landmark-2");
  assert.deepEqual(asSlot.rect, { x: 40, y: 20, width: 50, height: 34 });
  assert.deepEqual(asPillar.rect, asSlot.rect);
  assert.deepEqual(asLandmark.rect, asSlot.rect);
  assert.deepEqual(asSlot.guides.map(({ axis, position, targetId }) => [axis, position, targetId]), [["x", 90, "A02"]]);
  assert.deepEqual(asPillar.guides.map(({ axis, position }) => [axis, position]), [["x", 90]]);

  assert.equal(validateEventMapLayout({
    version: 2, template: "TAIWAN_GENERIC_V1", width: 200, height: 100, floor: { x: 10, y: 5, width: 180, height: 90 },
    rows: [{ label: "A", orientation: "horizontal", confidence: 1, slots: [{ code: "A01", rect: { ...asSlot.rect } }, { code: "A02", rect: { ...neighbour } }] }],
    pillars: [{ id: "pillar-1", ...asPillar.rect, y: 60 }, { id: "pillar-2", x: 90, y: 60, width: 40, height: 28 }],
    accessPoints: [{ id: "entrance-1", kind: "entrance", direction: "north", x: 100, y: 95, label: "入口" }],
    landmarks: [{ id: "landmark-1", kind: "enterprise", label: "企業攤", rect: { x: 140, y: 20, width: 40, height: 28 } }],
  }).ok, true);
});

test("resizing the canvas keeps rows, pillars, access points and landmarks in place proportionally", () => {
  const layout = {
    version: 2, template: "TAIWAN_GENERIC_V1", width: 200, height: 100, floor: { x: 10, y: 5, width: 180, height: 90 },
    rows: [{ label: "A", orientation: "horizontal", confidence: 1, slots: [{ code: "A01", rect: { x: 20, y: 20, width: 40, height: 28 } }] }],
    pillars: [{ id: "pillar-1", x: 90, y: 60, width: 40, height: 28 }],
    accessPoints: [{ id: "entrance-1", kind: "entrance", direction: "north", x: 100, y: 95, label: "入口" }],
    landmarks: [{ id: "landmark-1", kind: "enterprise", label: "企業攤", rect: { x: 140, y: 20, width: 40, height: 28 } }],
  };
  assert.equal(validateEventMapLayout(layout).ok, true);

  const scaled = scaleEventMapLayout(layout, { width: 400, height: 300 });
  assert.equal(validateEventMapLayout(scaled).ok, true);
  assert.deepEqual([scaled.width, scaled.height], [400, 300]);
  assert.deepEqual(scaled.floor, { x: 20, y: 15, width: 360, height: 270 });
  assert.deepEqual(scaled.rows[0].slots[0], { code: "A01", rect: { x: 40, y: 60, width: 80, height: 84 } });
  assert.deepEqual(scaled.pillars[0], { id: "pillar-1", x: 180, y: 180, width: 80, height: 84 });
  assert.deepEqual(scaled.accessPoints[0], { id: "entrance-1", kind: "entrance", direction: "north", x: 200, y: 285, label: "入口" });
  assert.deepEqual(scaled.landmarks[0], { id: "landmark-1", kind: "enterprise", label: "企業攤", rect: { x: 280, y: 60, width: 80, height: 84 } });

  // Relative placement is the invariant, so scaling back lands on the original,
  // and the layout handed in is never mutated.
  assert.deepEqual(scaleEventMapLayout(scaled, { width: 200, height: 100 }), layout);
  assert.deepEqual([layout.width, layout.height, layout.rows[0].slots[0].rect.x], [200, 100, 20]);
  assert.deepEqual(
    scaleEventMapLayout(layout, { width: 200, height: 100 }).landmarks,
    scaleMapLandmarks(layout.landmarks, layout, { width: 200, height: 100 }),
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

test("three anchors on a straight row extrapolate every booth between them", () => {
  // The 1st, 5th and 12th booth of a row pitched 30 units apart, marked exactly.
  const result = inferRowFromAnchors([{ index: 1, x: 40, y: 60 }, { index: 5, x: 160, y: 60 }, { index: 12, x: 370, y: 60 }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.inference.start, { x: 40, y: 60 });
  assert.deepEqual(result.inference.end, { x: 370, y: 60 });
  assert.equal(result.inference.slotCount, 12, "the row runs from the lowest anchor ordinal to the highest");
  assert.equal(result.inference.startNumber, 1);
  assert.equal(result.inference.residual, 0, "an exact fit leaves no anchor off the line");
});

test("anchors given out of order, on a diagonal row, describe the same row", () => {
  const result = inferRowFromAnchors([{ index: 9, x: 100, y: 190 }, { index: 1, x: 20, y: 30 }, { index: 5, x: 60, y: 110 }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.inference.start, { x: 20, y: 30 });
  assert.deepEqual(result.inference.end, { x: 100, y: 190 });
  assert.equal(result.inference.slotCount, 9);
  assert.equal(result.inference.residual, 0);
});

test("a mis-clicked anchor is averaged out and reported as the residual", () => {
  const clean = inferRowFromAnchors([{ index: 1, x: 10, y: 50 }, { index: 2, x: 40, y: 50 }, { index: 3, x: 70, y: 50 }]);
  const nudged = inferRowFromAnchors([{ index: 1, x: 10, y: 50 }, { index: 2, x: 40, y: 62 }, { index: 3, x: 70, y: 50 }]);
  assert.equal(clean.inference.residual, 0);
  assert.ok(nudged.inference.residual > 7, `a 12-unit slip shows up as a residual, got ${nudged.inference.residual}`);
  assert.deepEqual(nudged.inference.start, { x: 10, y: 54 }, "the fit splits the error instead of following the stray anchor");
});

test("anchor inference refuses input it cannot fit", () => {
  assert.deepEqual(inferRowFromAnchors([{ index: 1, x: 0, y: 0 }, { index: 2, x: 10, y: 0 }]).errors, ["至少需要三個錨點。"]);
  assert.deepEqual(inferRowFromAnchors([{ index: 1, x: 0, y: 0 }, { index: 1, x: 10, y: 0 }, { index: 3, x: 20, y: 0 }]).errors, ["錨點編號不可重複。"]);
  assert.deepEqual(inferRowFromAnchors([{ index: 1.5, x: 0, y: 0 }, { index: 2, x: 10, y: 0 }, { index: 3, x: 20, y: 0 }]).errors, ["錨點編號必須是 0 或正整數。"]);
  assert.deepEqual(inferRowFromAnchors([{ index: 1, x: Number.NaN, y: 0 }, { index: 2, x: 10, y: 0 }, { index: 3, x: 20, y: 0 }]).errors, ["錨點座標必須是有效數字。"]);
  assert.equal(inferRowFromAnchors([]).inference, null);
});

test("an inferred row is only placed booth by booth, on a template with no recognizer", () => {
  const layout = createBlankEventMapLayout("TAIWAN_GENERIC_V1", 400, 300);
  assert.equal(hasMapTemplateRecognizer(layout.template), false, "inference must not depend on a venue-specific recognizer");
  const inferred = inferRowFromAnchors([{ index: 1, x: 60, y: 80 }, { index: 4, x: 150, y: 80 }, { index: 8, x: 270, y: 80 }]);
  assert.equal(inferred.ok, true);
  const { start, end, slotCount, startNumber } = inferred.inference;
  const generated = generateRowSlots({
    label: "甲", start, end, slotCount, startNumber, slotWidth: 24, slotHeight: 18, codePrefix: "甲", numberPadding: 2,
  }, layout);
  assert.equal(generated.ok, true);
  assert.deepEqual(generated.row.slots.map((slot) => slot.code), ["甲01", "甲02", "甲03", "甲04", "甲05", "甲06", "甲07", "甲08"]);

  // The draft never enters the layout whole: only what was confirmed is placed.
  const draft = { slots: generated.row.slots, keep: generated.row.slots.map((slot, index) => index !== 2 && index !== 6) };
  const confirmed = confirmedDraftSlots(draft);
  assert.deepEqual(confirmed.map((slot) => slot.code), ["甲01", "甲02", "甲04", "甲05", "甲06", "甲08"], "the two booths that were dropped are not placed");
  layout.rows.push({ label: "甲", orientation: "horizontal", confidence: 1, slots: confirmed });
  assert.equal(validateEventMapLayout(layout).ok, true);
  assert.deepEqual(confirmedDraftSlots({ slots: generated.row.slots, keep: generated.row.slots.map(() => false) }), [],
    "a draft nobody confirmed contributes nothing, so it can never reach a submission");
});

test("interpolation invents booths, so confirmation starts empty rather than pre-ticked", () => {
  // Anchors on the 1st and 9th booth of a row whose 5th position is a gangway:
  // the fit has no way to know, so booth 5 is generated and must be dropped.
  const layout = createBlankEventMapLayout("TAIWAN_GENERIC_V1", 400, 300);
  const inferred = inferRowFromAnchors([{ index: 1, x: 40, y: 100 }, { index: 3, x: 120, y: 100 }, { index: 9, x: 360, y: 100 }]);
  const { start, end, slotCount, startNumber } = inferred.inference;
  const generated = generateRowSlots({
    label: "A", start, end, slotCount, startNumber, slotWidth: 30, slotHeight: 20, codePrefix: "A", numberPadding: 2,
  }, layout);
  assert.equal(generated.row.slots.length, 9);
  const untouched = { slots: generated.row.slots, keep: generated.row.slots.map(() => false) };
  assert.deepEqual(confirmedDraftSlots(untouched), [], "pressing place on an untouched draft must have nothing to place");
  const reviewed = { slots: generated.row.slots, keep: generated.row.slots.map((slot, index) => index !== 4) };
  assert.equal(confirmedDraftSlots(reviewed).length, 8);
  assert.equal(confirmedDraftSlots(reviewed).some((slot) => slot.code === "A05"), false, "the invented booth stays out of the layout");
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

test("multi-selection history keys distinguish every member without depending on order", () => {
  const first = { kind: "slot", rowIndex: 0, itemIndex: 0 };
  const second = { kind: "slot", rowIndex: 0, itemIndex: 1 };
  const third = { kind: "slot", rowIndex: 0, itemIndex: 2 };
  assert.notEqual(selectionSetKey([first, second]), selectionSetKey([first, third]));
  assert.equal(selectionSetKey([first, second]), selectionSetKey([second, first]));
});

test("row conflict detection includes duplicate codes inside the candidate row", () => {
  const layout = createBlankEventMapLayout("PIER2-2025", 100, 100);
  const duplicate = {
    label: "B", orientation: "horizontal", confidence: 1,
    slots: [
      { code: "B01", rect: { x: 10, y: 10, width: 10, height: 10 } },
      { code: "B01", rect: { x: 30, y: 10, width: 10, height: 10 } },
    ],
  };
  assert.deepEqual(findRowConflicts(duplicate, layout), ["攤位代碼 B01 重複。"]);
});

function multiSelectLayout() {
  return {
    version: 2, template: "TAIWAN_GENERIC_V1", width: 200, height: 120,
    floor: { x: 0, y: 0, width: 200, height: 120 },
    rows: [
      { label: "A", orientation: "horizontal", confidence: 1, slots: [
        { code: "A01", rect: { x: 10, y: 10, width: 20, height: 10 } },
        { code: "A02", rect: { x: 40, y: 14, width: 20, height: 10 } },
        { code: "A03", rect: { x: 70, y: 18, width: 20, height: 10 } },
      ] },
      { label: "B", orientation: "horizontal", confidence: 1, slots: [{ code: "B01", rect: { x: 10, y: 60, width: 20, height: 10 } }] },
    ],
    pillars: [{ id: "pillar-1", x: 120, y: 20, width: 8, height: 8 }, { id: "pillar-2", x: 140, y: 20, width: 8, height: 8 }],
    accessPoints: [{ id: "entrance-1", kind: "entrance", direction: "north", x: 50, y: 100, label: "入口" }],
    landmarks: [{ id: "stage-1", kind: "stage", label: "舞台", rect: { x: 150, y: 80, width: 30, height: 20 } }],
  };
}

test("shift clicking builds a selection set and clicking the same element again drops it", () => {
  const first = { kind: "slot", rowIndex: 0, itemIndex: 0 };
  const second = { kind: "pillar", itemIndex: 1 };
  const both = toggleSelection(toggleSelection([], first), second);
  assert.deepEqual(both, [first, second]);
  assert.deepEqual(toggleSelection(both, first), [second], "a second shift click removes rather than duplicates");
  assert.deepEqual(mergeSelections(both, [second, { kind: "landmark", itemIndex: 0 }]), [...both, { kind: "landmark", itemIndex: 0 }],
    "a band merged into an existing set adds only what is new");
});

test("a rubber band picks up every kind of element it touches, but never the hall outline", () => {
  const layout = multiSelectLayout();
  assert.deepEqual(selectionsWithinBox(layout, { x: 0, y: 0, width: 95, height: 30 }), [
    { kind: "slot", rowIndex: 0, itemIndex: 0 },
    { kind: "slot", rowIndex: 0, itemIndex: 1 },
    { kind: "slot", rowIndex: 0, itemIndex: 2 },
  ]);
  const wide = selectionsWithinBox(layout, { x: 0, y: 0, width: 200, height: 120 });
  assert.equal(wide.length, 4 + 2 + 1 + 1, "every booth, pillar, access point and landmark is inside");
  assert.equal(wide.some((item) => item.kind === "floor"), false, "the outline spans the sheet, so a band would always catch it");
});

test("a multi-selection moves as one group and stops at the canvas without losing its spacing", () => {
  const layout = multiSelectLayout();
  const selections = [
    { kind: "slot", rowIndex: 0, itemIndex: 0 },
    { kind: "slot", rowIndex: 0, itemIndex: 2 },
    { kind: "access", itemIndex: 0 },
  ];
  const resolved = resolveSelectionBoxes(layout, selections);
  assert.deepEqual(resolved.boxes.map((box) => box.x), [10, 70, 50]);
  const moved = translateBoxesWithin(resolved.boxes, 9999, 5, layout);
  assert.deepEqual(moved.map((box) => box.x), [120, 180, 160], "the shared delta stops when the group's right edge reaches the canvas");
  applySelectionBoxes(layout, resolved.selections, moved);
  assert.equal(layout.rows[0].slots[0].rect.x, 120);
  assert.equal(layout.rows[0].slots[2].rect.x, 180);
  assert.deepEqual([layout.accessPoints[0].x, layout.accessPoints[0].y], [160, 105], "an access point moves by the same delta as a rectangle");
  assert.equal(validateEventMapLayout(layout).ok, true);
});

test("aligning a multi-selection keeps every element inside the canvas", () => {
  const layout = multiSelectLayout();
  const selections = [0, 1, 2].map((itemIndex) => ({ kind: "slot", rowIndex: 0, itemIndex }));
  const resolved = resolveSelectionBoxes(layout, selections);
  applySelectionBoxes(layout, resolved.selections, alignBoxesToEdge(resolved.boxes, "top", layout));
  assert.deepEqual(layout.rows[0].slots.map((slot) => slot.rect.y), [10, 10, 10]);
  applySelectionBoxes(layout, resolved.selections, alignBoxesToEdge(resolveSelectionBoxes(layout, selections).boxes, "right", layout));
  assert.deepEqual(layout.rows[0].slots.map((slot) => slot.rect.x), [70, 70, 70]);
  assert.equal(validateEventMapLayout(layout).ok, true, "alignment never pushes an element past an edge");
});

test("resizing a multi-selection maps every box from the old bounding box into the new one", () => {
  const boxes = [{ x: 10, y: 10, width: 20, height: 10 }, { x: 70, y: 10, width: 20, height: 10 }];
  const from = boundingBox(boxes);
  assert.deepEqual(from, { x: 10, y: 10, width: 80, height: 10 });
  const scaled = scaleBoxesIntoBox(boxes, from, { x: 10, y: 10, width: 40, height: 10 }, { width: 200, height: 120 });
  assert.deepEqual(scaled, [{ x: 10, y: 10, width: 10, height: 10 }, { x: 40, y: 10, width: 10, height: 10 }],
    "halving the group halves each booth and the gap between them");
});

test("removing a multi-selection splices from the highest index down so the rest stay addressable", () => {
  const layout = multiSelectLayout();
  removeSelectionsFrom(layout, [
    { kind: "slot", rowIndex: 0, itemIndex: 0 },
    { kind: "slot", rowIndex: 0, itemIndex: 2 },
    { kind: "slot", rowIndex: 1, itemIndex: 0 },
    { kind: "pillar", itemIndex: 0 },
  ]);
  assert.deepEqual(layout.rows.map((row) => row.label), ["A"], "row B lost its last booth, so the row went with it");
  assert.deepEqual(layout.rows[0].slots.map((slot) => slot.code), ["A02"], "the surviving booth is the untouched middle one");
  assert.deepEqual(layout.pillars.map((pillar) => pillar.id), ["pillar-2"]);
  assert.equal(validateEventMapLayout(layout).ok, true);
});

test("a copied row pasted at an offset never duplicates a booth code", () => {
  const layout = multiSelectLayout();
  const clipboard = { label: "A", slots: layout.rows[0].slots.map((slot) => ({ code: slot.code, rect: { ...slot.rect } })) };
  const renamed = pasteRowAtOffset(clipboard, layout, { offsetX: 0, offsetY: 30, label: "C" });
  assert.equal(renamed.ok, true);
  assert.deepEqual(renamed.row.slots.map((slot) => slot.code), ["C01", "C02", "C03"], "codes follow the pasted row's label");
  layout.rows.push(renamed.row);

  // Pasting again with no label reuses the copied one, which is already taken.
  const repeated = pasteRowAtOffset(clipboard, layout, { offsetX: 0, offsetY: 60, label: "" });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.row.label, "A-2", "the row label is made unique rather than refused");
  assert.deepEqual(repeated.row.slots.map((slot) => slot.code), ["A-201", "A-202", "A-203"], "codes track the deduplicated label, so they need no suffix of their own");
  layout.rows.push(repeated.row);
  assert.equal(validateEventMapLayout(layout).ok, true, "no duplicate row label and no duplicate booth code survives");
});

test("offset paste stops a whole row at the canvas edge without collapsing its geometry", () => {
  const layout = createBlankEventMapLayout("PIER2-2025", 50, 30);
  const result = pasteRowAtOffset({
    label: "A",
    slots: [
      { code: "A1", rect: { x: 10, y: 5, width: 10, height: 10 } },
      { code: "A2", rect: { x: 30, y: 5, width: 10, height: 10 } },
    ],
  }, layout, { offsetX: 100, offsetY: 0, label: "B" });
  assert.equal(result.ok, true);
  assert.equal(result.row.orientation, "horizontal");
  assert.deepEqual(result.row.slots.map(({ rect }) => rect), [
    { x: 20, y: 5, width: 10, height: 10 },
    { x: 40, y: 5, width: 10, height: 10 },
  ]);
  assert.equal(validateEventMapLayout({ ...layout, rows: [result.row] }).ok, true);
});

function historyLayout(marker) {
  return { ...createBlankEventMapLayout("PIER2-2025", 100, 100), marker };
}

test("editor history steps back and forward through every intermediate layout", () => {
  const [first, second, third] = ["a", "b", "c"].map(historyLayout);
  let history = createLayoutHistory(first);
  assert.equal(canUndoLayoutHistory(history), false);
  assert.equal(canRedoLayoutHistory(history), false);

  history = pushLayoutHistory(history, second);
  history = pushLayoutHistory(history, third);
  assert.equal(history.present.marker, "c");

  history = undoLayoutHistory(history);
  assert.equal(history.present.marker, "b");
  history = undoLayoutHistory(history);
  assert.equal(history.present.marker, "a");
  assert.equal(canUndoLayoutHistory(history), false);
  // Undoing past the start is a no-op rather than an error state.
  assert.equal(undoLayoutHistory(history), history);

  history = redoLayoutHistory(history);
  assert.equal(history.present.marker, "b");
  history = redoLayoutHistory(history);
  assert.equal(history.present.marker, "c");
  assert.equal(canRedoLayoutHistory(history), false);
  assert.equal(redoLayoutHistory(history), history);
});

test("a gesture collapses into one step, and sealing ends the run", () => {
  // Every pointer move during a drag commits, so without coalescing one drag
  // would bury the previous edit under hundreds of undo steps.
  let history = createLayoutHistory(historyLayout("start"));
  history = pushLayoutHistory(history, historyLayout("drag-1"), "drag:1:move:slot:0:0");
  history = pushLayoutHistory(history, historyLayout("drag-2"), "drag:1:move:slot:0:0");
  history = pushLayoutHistory(history, historyLayout("drag-3"), "drag:1:move:slot:0:0");
  assert.equal(history.past.length, 1);
  assert.equal(undoLayoutHistory(history).present.marker, "start");

  // A second drag of the same element reuses the pointer id, so the seal on
  // pointer up is what keeps the two gestures separately undoable.
  history = sealLayoutHistory(history);
  history = pushLayoutHistory(history, historyLayout("drag-4"), "drag:1:move:slot:0:0");
  assert.equal(history.past.length, 2);
  assert.equal(undoLayoutHistory(history).present.marker, "drag-3");

  // Arrow-key runs need the same treatment on key release: two runs in the
  // same direction share a key, so an unsealed second run would swallow the
  // first run's step and undo would jump back past both.
  history = pushLayoutHistory(history, historyLayout("nudge-1"), "nudge:slot:0:0:-1,0");
  history = pushLayoutHistory(history, historyLayout("nudge-2"), "nudge:slot:0:0:-1,0");
  assert.equal(history.past.length, 3);
  history = sealLayoutHistory(history);
  history = pushLayoutHistory(history, historyLayout("nudge-3"), "nudge:slot:0:0:-1,0");
  assert.equal(history.past.length, 4);
  assert.equal(undoLayoutHistory(history).present.marker, "nudge-2");

  // A different key ends the run without an explicit seal.
  history = pushLayoutHistory(history, historyLayout("typed"), "field:slot:0:0:code");
  assert.equal(history.past.length, 5);
  // Unkeyed pushes never coalesce, not even with each other.
  history = pushLayoutHistory(history, historyLayout("added"));
  history = pushLayoutHistory(history, historyLayout("removed"));
  assert.equal(history.past.length, 7);
});

test("editing after an undo discards the redo branch", () => {
  let history = createLayoutHistory(historyLayout("a"));
  history = pushLayoutHistory(history, historyLayout("b"));
  history = pushLayoutHistory(history, historyLayout("c"));
  history = undoLayoutHistory(history);
  assert.equal(canRedoLayoutHistory(history), true);
  history = pushLayoutHistory(history, historyLayout("d"));
  assert.equal(canRedoLayoutHistory(history), false);
  assert.equal(history.present.marker, "d");
  assert.equal(undoLayoutHistory(history).present.marker, "b");
});

test("history keeps a bounded number of layouts and never image bytes", () => {
  let history = createLayoutHistory(historyLayout("step-0"));
  for (let step = 1; step <= LAYOUT_HISTORY_LIMIT + 20; step += 1) history = pushLayoutHistory(history, historyLayout(`step-${step}`));
  assert.equal(history.past.length, LAYOUT_HISTORY_LIMIT);
  // The oldest steps fall off the back; what remains is contiguous.
  assert.equal(history.past[0].marker, `step-${20}`);
  assert.equal(history.past.at(-1).marker, `step-${LAYOUT_HISTORY_LIMIT + 19}`);
  // Entries are the layout objects themselves, so nothing but layout data —
  // never the source image — is retained by undo.
  const entries = [...history.past, history.present, ...history.future];
  assert.ok(entries.every((entry) => validateEventMapLayout({ ...entry, marker: undefined }).ok));
  assert.ok(entries.every((entry) => Object.keys(entry).every((key) => key !== "image" && key !== "source")));
});
