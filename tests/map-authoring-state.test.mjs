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

test("approved publication artifacts omit private guides entirely", async () => {
  const fixture = await amendmentFixture(runner, snapshot => { snapshot.maps[0].content.authoring = { guides: [guide] }; });
  const artifacts = await buildApprovedPublicationArtifacts(fixture.source);
  for (const file of artifacts.files) {
    assert.equal(file.text.includes("private-guide"), false, file.path);
    assert.equal(file.text.includes('"authoring"'), false, file.path);
  }
  assert.ok(JSON.parse(fixture.source.snapshotJson).maps[0].content.authoring.guides.length, "private approval snapshot preserves the saved draft");
});
