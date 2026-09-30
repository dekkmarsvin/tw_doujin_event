import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";
import { ruledPlan, centreOf } from "./support/map-recognition-fixture.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR unavailable");
const { recognizeEditorDraft } = await environment.runner.import("/app/map-auto-recognition/editor.ts");
const { adoptRecognitionDraft } = await environment.runner.import("/app/map-recognition-draft.ts");
const { createLayoutHistory, pushLayoutHistory, undoLayoutHistory } = await environment.runner.import("/app/map-editor-history.ts");
after(() => vite.close());
const input = () => ({ image: ruledPlan(), sourceRect: { x: 100, y: 200, width: 420, height: 260 }, sourceSize: { width: 840, height: 520 }, targetSize: { width: 420, height: 260 }, template: "SAMPLE", boothList: "A01~A16 B01~B16 C01~C06" });
const report = recognizeEditorDraft(input());
const blank = () => ({ ...structuredClone(report.layout), floor: { x: 0, y: 0, width: 420, height: 260 }, rows: [], pillars: [], accessPoints: [], landmarks: [] });

test("crop offsets and source-to-editor scaling preserve the original background coordinates", () => {
  const point = centreOf(report.layout, "A01");
  assert.ok(Math.abs(point.x - (100 + 346) / 2) < 3);
  assert.ok(Math.abs(point.y - (200 + 216) / 2) < 3);
  assert.equal(report.valid, true);
  assert.equal(report.layout.width, 420);
});
test("large sources work through small crops; oversized pixel selections are rejected", () => {
  const cropped = recognizeEditorDraft({ ...input(), sourceSize: { width: 10000, height: 4800 }, targetSize: { width: 10000, height: 4800 } });
  assert.equal(cropped.valid, true);
  assert.throws(() => recognizeEditorDraft({ ...input(), image: { width: 10000, height: 4800, data: new Uint8Array(0) } }), /700 萬/);
});
test("explicit adoption preserves manual content and authoring; one undo removes the entire adoption", () => {
  const current = blank();
  current.rows = [{ label: "Z", orientation: "horizontal", confidence: 1, slots: [{ code: "Z01", rect: { x: 10, y: 10, width: 10, height: 10 } }] }];
  current.landmarks.push({ id: "stage", label: "人工舞台", kind: "stage", rect: { x: 20, y: 20, width: 20, height: 20 } });
  current.servicePoints = [{ id: "info", kind: "information", label: "", x: 50, y: 20 }];
  const before = structuredClone(current);
  const result = adoptRecognitionDraft(current, report.layout, [{ kind: "row", index: 0 }, { kind: "row", index: 1 }]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(current, before);
  assert.deepEqual(result.layout.rows[0], before.rows[0]);
  assert.deepEqual(result.layout.floor, before.floor);
  assert.deepEqual(result.layout.landmarks, before.landmarks);
  assert.deepEqual(result.layout.servicePoints, before.servicePoints);
  assert.equal(result.layout.rows.flatMap(row => row.slots).length, 33);
  const authoring = { guides: [{ id: "g1", axis: "x", position: 15, locked: true }] };
  const history = pushLayoutHistory(createLayoutHistory({ layout: current, authoring }), { layout: result.layout, authoring });
  assert.deepEqual(undoLayoutHistory(history).present, { layout: current, authoring });
});
test("duplicate codes or overlapping geometry reject the whole selection without partial writes", () => {
  for (const code of ["A01", "Z01"]) {
    const current = blank();
    current.rows = [{ label: "Z", orientation: "vertical", confidence: 1, slots: [{ ...structuredClone(report.layout.rows[0].slots[0]), code }] }];
    const before = structuredClone(current);
    const result = adoptRecognitionDraft(current, report.layout, [{ kind: "row", index: 1 }, { kind: "row", index: 0 }]);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(), /已存在|重疊/);
    assert.deepEqual(current, before);
  }
});
test("facilities are opt-in, get distinct IDs and reject overlaps", () => {
  const proposal = structuredClone(report.layout);
  proposal.pillars = [{ id: "p1", x: 10, y: 10, width: 10, height: 10 }, { id: "p2", x: 30, y: 10, width: 10, height: 10 }];
  const result = adoptRecognitionDraft(blank(), proposal, [{ kind: "pillar", index: 0 }, { kind: "pillar", index: 1 }, { kind: "pillar", index: 0 }]);
  assert.equal(result.ok, true);
  assert.equal(result.layout.pillars.length, 2);
  assert.equal(new Set(result.layout.pillars.map(pillar => pillar.id)).size, 2);
  assert.equal(result.layout.rows.length, 0);
  assert.equal(adoptRecognitionDraft(result.layout, proposal, [{ kind: "pillar", index: 0 }]).ok, false);
  assert.equal(adoptRecognitionDraft(blank(), proposal, []).ok, false);
  assert.equal(adoptRecognitionDraft({ ...blank(), width: 500 }, proposal, [{ kind: "row", index: 0 }]).ok, false);
});
