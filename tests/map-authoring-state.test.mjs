import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { amendmentFixture } from "./support/organizer-amendment-fixture.mjs";

const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const runner = vite.environments.ssr.runner;
const { validMapAuthoringState, scaleMapAuthoringState } = await runner.import("/app/map-authoring-state.ts");
const { parseMapContributionDraftContent } = await runner.import("/app/map-contribution-draft.ts");
const { snapRectToAdjacentRects: snap, segmentSlotRects } = await runner.import("/app/map-layout-editor-geometry.ts");
const { planSharedSegmentEdges } = await runner.import("/app/map-layout-editor-selection.ts");
const { createLayoutHistory, pushLayoutHistory, undoLayoutHistory, redoLayoutHistory } = await runner.import("/app/map-editor-history.ts");
const { buildApprovedPublicationArtifacts } = await runner.import("/app/publication-artifacts.ts");
after(() => vite.close());
const layout = JSON.parse(await readFile("fixtures/events/sample/map.json", "utf8")).layout;
const guide = { id: "private-guide", axis: "x", position: 50, locked: true };

test("old draft bytes remain unchanged; authoring metadata is bounded and strict", () => {
  const old = { schema: "map-contribution-draft/1", layout };
  assert.equal(parseMapContributionDraftContent(old), old);
  assert.deepEqual(Object.keys(old), ["schema", "layout"]);
  assert.ok(parseMapContributionDraftContent({ ...old, authoring: { guides: [guide] } }));
  for (const invalid of [null, { guides: [guide, guide] }, { guides: [{ ...guide, position: -1 }] }, { guides: [{ ...guide, position: 201 }] }, { guides: [{ ...guide, locked: "yes" }] }, { guides: [{ ...guide, position: NaN }] }, { guides: [guide], injected: true }]) {
    assert.equal(validMapAuthoringState(invalid, layout), false);
    assert.equal(parseMapContributionDraftContent({ ...old, authoring: invalid }), null);
  }
});

test("canvas rescale and undo restore geometry and guides as one snapshot", () => {
  const state = { guides: [guide, { id: "horizontal", axis: "y", position: 20, locked: false }] };
  const scaled = scaleMapAuthoringState(state, layout, { width: 400, height: 50 });
  assert.deepEqual(scaled.guides.map(g => g.position), [100, 10]);
  const original = { layout, authoring: state }, next = { layout: { ...layout, width: 400, height: 50 }, authoring: scaled };
  const history = pushLayoutHistory(createLayoutHistory(original), next);
  assert.equal(undoLayoutHistory(history).present, original);
  assert.equal(redoLayoutHistory(undoLayoutHistory(history)).present, next);
});

test("manual guide wins equal displacement and locked guides still snap", () => {
  const rect = { x: 46, y: 20, width: 20, height: 10 };
  const result = snap(rect, [{ id: "ordinary", rect: { x: 0, y: 20, width: 42, height: 10 } }], { bounds: layout, mode: "move", threshold: 8, manualGuides: [guide] });
  assert.equal(result.rect.x, 50);
  assert.equal(result.guides[0].targetId, "guide:private-guide");
  const nearer = snap(rect, [{ id: "closer", rect: { x: 0, y: 20, width: 45, height: 10 } }], { bounds: layout, mode: "move", threshold: 8, manualGuides: [guide] });
  assert.equal(nearer.rect.x, 45, "closest target precedes manual preference");
});

test("snap radius stays eight screen pixels at multiple zoom levels", () => {
  for (const unitsPerPixel of [.125, .5, 1, 4]) {
    const rect = { x: 50 - 7 * unitsPerPixel, y: 20, width: 60, height: 3 };
    assert.equal(snap(rect, [], { bounds: layout, mode: "nw", threshold: 8 * unitsPerPixel, minimumSize: .01, manualGuides: [guide] }).rect.x, 50);
    const point = { x: 50 - 9 * unitsPerPixel, y: 20, width: 0, height: 0 };
    assert.equal(snap(point, [], { bounds: layout, mode: "move", threshold: 8 * unitsPerPixel, manualGuides: [guide] }).rect.x, point.x);
  }
});

// #286 A: a reach wider than the gaps it can snap to pins the rectangle for
// several frames and then makes it leap. A copied facing pair lands flush with
// the row it came from, so its own source supplies edges one booth-pitch apart.
test("snap reach is capped by the gap between element edges, never for guides", () => {
  const column = (x, pitch, count) => Array.from({ length: count }, (_, index) =>
    ({ id: `booth-${x}-${index}`, rect: { x, y: 10 + index * pitch, width: 20, height: pitch } }));
  const moving = { x: 60, y: 10, width: 20, height: 40 };
  const reach = (targets, offset, guides = []) =>
    snap({ ...moving, y: moving.y + offset }, targets, { bounds: layout, mode: "move", threshold: 8, manualGuides: guides }).rect.y;

  // A lone neighbour is further away than the reach, so nothing is capped and
  // the full eight units still pull the box onto its edge.
  const sparse = [{ id: "lone", rect: { x: 60, y: 90, width: 20, height: 40 } }];
  assert.equal(reach(sparse, 44), 50, "a sparse target keeps the whole reach");

  // Ten booths at a pitch of 10 cap the reach at 1.25, so 4 units off an edge
  // is left where it is instead of being dragged back.
  const lattice = column(60, 10, 10);
  for (const [offset, expected] of [[1, 10], [4, 14], [5, 15], [9, 20], [10, 20]]) {
    assert.equal(reach(lattice, offset), expected, `offset ${offset} on a 10-unit pitch`);
  }
  // Tightening the pitch tightens the cap with it.
  for (const [pitch, offset, pulledBack] of [[40, 3, true], [40, 7, false], [10, 1, true], [10, 3, false], [4, 1, false]]) {
    const result = reach(column(60, pitch, 10), offset);
    assert.equal(result === moving.y, pulledBack, `pitch ${pitch} at offset ${offset}`);
  }
  // A hand-placed line is a deliberate target and keeps the full reach even
  // where the element edges around it are capped.
  const line = { id: "line", axis: "y", position: 17, locked: false };
  assert.equal(reach(lattice, 3, [line]), 17, "a guide still captures from four units away, where an element edge no longer would");
});

test("segment resize snaps only the active edge and remains gapless", () => {
  const frame = { x: 20, y: 10, width: 28, height: 60 };
  const result = snap(frame, [], { bounds: layout, mode: "se", threshold: 8, minimumSize: .1, manualGuides: [guide] }).rect;
  assert.deepEqual(result, { x: 20, y: 10, width: 30, height: 60 });
  const slots = segmentSlotRects(result, "vertical", 7, layout);
  for (let i = 1; i < slots.length; i++) assert.equal(slots[i].y, slots[i - 1].y + slots[i - 1].height);
});

// #286 D: the maintainer's six traced columns, each ten cells, each a few
// units off the next at the top and with its own cell height.
test("shared segment edges line columns up without closing the gangways", () => {
  const column = (x, top, pitch) => Array.from({ length: 10 }, (unused, index) =>
    ({ x, y: top + index * pitch, width: 24, height: pitch }));
  const layouts = [[120, 30, 40], [180, 34, 41], [250, 28, 39.5], [300, 31, 40.5], [370, 33, 40], [430, 29, 41.5]];
  const boxes = layouts.flatMap(([x, top, pitch]) => column(x, top, pitch));
  const plan = planSharedSegmentEdges(boxes, { width: 600, height: 700 });
  assert.equal(plan.ok, true);
  assert.equal(plan.columns, 6);
  assert.equal(plan.cells, 10);

  const top = Math.min(...boxes.map(box => box.y));
  const bottom = Math.max(...boxes.map(box => box.y + box.height));
  for (let index = 0; index < boxes.length; index += 1) {
    assert.equal(plan.boxes[index].x, boxes[index].x, "the gangways are untouched");
    assert.equal(plan.boxes[index].width, boxes[index].width, "so is every width");
  }
  const columns = layouts.map((unused, group) => plan.boxes.slice(group * 10, group * 10 + 10));
  for (const cells of columns) {
    assert.ok(Math.abs(cells[0].y - top) < 1e-9, "every column starts on the shared top");
    assert.ok(Math.abs(cells[9].y + cells[9].height - bottom) < 1e-9, "and ends on the shared bottom");
    for (let index = 1; index < cells.length; index += 1) {
      assert.ok(cells[index].y >= cells[index - 1].y + cells[index - 1].height - 1e-9, "no overlap inside a column");
      assert.ok(cells[index].y - (cells[index - 1].y + cells[index - 1].height) < 1e-9, "and no gap either");
    }
  }
  // The point of the shared cut: divider i of every column is the same line.
  for (let index = 0; index < 10; index += 1) {
    const line = columns[0][index].y;
    for (const cells of columns) assert.ok(Math.abs(cells[index].y - line) < 1e-9, `divider ${index} is shared`);
  }
});

test("shared segment edges refuse what they would get wrong", () => {
  const column = (x, count, pitch = 10) => Array.from({ length: count }, (unused, index) =>
    ({ x, y: 10 + index * pitch, width: 20, height: pitch }));
  const bounds = { width: 600, height: 700 };
  const cases = [
    [[], "請選取至少兩個直排的攤位。"],
    [column(10, 4), "這些攤位都在同一直排，沒有要對齊的第二排。"],
    [[...column(10, 4), ...column(50, 3)], "每一排的格數必須相同，目前是 4、3 格。"],
    // Two cells side by side at the same y are a horizontal run, not a column.
    [[{ x: 10, y: 10, width: 20, height: 10 }, { x: 10, y: 10, width: 20, height: 10 }, { x: 50, y: 10, width: 20, height: 10 }, { x: 50, y: 10, width: 20, height: 10 }],
      "同步上下邊界只適用於直排；這個選取裡有橫排的攤位。"],
  ];
  for (const [boxes, reason] of cases) {
    const plan = planSharedSegmentEdges(boxes, bounds);
    assert.equal(plan.ok, false, reason);
    assert.equal(plan.errors[0], reason);
  }
  // The height is checked once on the shared span, not cell by cell.
  const tight = [...column(10, 10, 1), ...column(50, 10, 1)];
  assert.equal(planSharedSegmentEdges(tight, bounds, 5).ok, false);
  assert.match(planSharedSegmentEdges(tight, bounds, 5).errors[0], /共同高度不足/);
});

test("approved publication artifacts omit private guides entirely", async () => {
  const fixture = await amendmentFixture(runner, snapshot => { snapshot.maps[0].content.authoring = { guides: [guide] }; });
  const artifacts = await buildApprovedPublicationArtifacts(fixture.source);
  for (const file of artifacts.files) {
    assert.equal(file.text.includes("private-guide"), false, file.path);
    assert.equal(file.text.includes('"authoring"'), false, file.path);
  }
  assert.ok(JSON.parse(fixture.source.snapshotJson).maps[0].content.authoring.guides.length, "private approval snapshot preserves the saved draft");
});
