import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";
import { ruledPlan, centreOf } from "./support/map-recognition-fixture.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR unavailable");
const { recognizeEditorDraft } = await environment.runner.import("/app/map-auto-recognition/editor.ts");
const { adoptRecognitionDraft } = await environment.runner.import("/app/map-recognition-draft.ts");
const { adoptRecognitionPreview, recognitionWarnings } = await environment.runner.import("/app/map-recognition-review.ts");
const { createLayoutHistory, pushLayoutHistory, undoLayoutHistory, redoLayoutHistory } = await environment.runner.import("/app/map-editor-history.ts");
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
    assert.match(result.errors.join(), /已在地圖上|重疊/);
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

test("one recognition session adopts A then B with stable keys and separate undo steps", () => {
  const current = blank();
  const preview = { base: current, report, adopted: [] };
  const a = adoptRecognitionPreview(current, preview, [{ kind: "row", index: 0 }]);
  assert.equal(a.ok, true);
  assert.strictEqual(a.preview.base, a.layout);
  assert.strictEqual(a.preview.report, report);
  assert.deepEqual(a.preview.adopted, ["row:0"]);
  assert.equal(adoptRecognitionPreview(a.layout, a.preview, [{ kind: "row", index: 0 }]).ok, false);
  const b = adoptRecognitionPreview(a.layout, a.preview, [{ kind: "row", index: 1 }]);
  assert.equal(b.ok, true);
  assert.deepEqual(b.preview.adopted, ["row:0", "row:1"]);
  assert.equal(b.layout.rows.flatMap(row => row.slots).length, 32);
  let history = createLayoutHistory({ layout: current });
  history = pushLayoutHistory(history, { layout: a.layout });
  history = pushLayoutHistory(history, { layout: b.layout });
  const undo = undoLayoutHistory(history);
  assert.deepEqual(undo.present.layout, a.layout);
  assert.equal(adoptRecognitionPreview(undo.present.layout, b.preview, [{ kind: "row", index: 2 }]).ok, false);
  assert.deepEqual(redoLayoutHistory(undo).present.layout, b.layout);
  assert.equal(adoptRecognitionPreview(structuredClone(b.layout), b.preview, [{ kind: "row", index: 2 }]).ok, false, "an external replacement cannot rebase a session");
});

test("a conflict created by an earlier batch rejects the whole next batch and leaves progress intact", () => {
  const proposal = structuredClone(report);
  proposal.layout.rows[1].slots[0].rect = structuredClone(proposal.layout.rows[0].slots[0].rect);
  const current = blank();
  const a = adoptRecognitionPreview(current, { base: current, report: proposal, adopted: [] }, [{ kind: "row", index: 0 }]);
  assert.equal(a.ok, true);
  const before = structuredClone(a);
  const rejected = adoptRecognitionPreview(a.layout, a.preview, [{ kind: "row", index: 2 }, { kind: "row", index: 1 }]);
  assert.equal(rejected.ok, false);
  assert.match(rejected.errors.join(), /重疊/);
  assert.deepEqual(a, before, "neither the successful earlier batch nor review progress changes on failure");
});

test("missing-row reminders subtract actual codes, not a matching row label or any one drawn slot", () => {
  const unmatched = recognizeEditorDraft({ ...input(), boothList: "Z01~Z50" });
  const diagnostic = unmatched.diagnostics.find(item => item.kind === "missing-row");
  assert.equal(diagnostic.label, "Z");
  assert.equal(diagnostic.codes.length, 50);
  const current = blank();
  const slot = code => ({ code, rect: { x: 0, y: 0, width: 1, height: 1 } });
  current.rows = [{ label: "Z", slots: [slot("OTHER01")] }];
  assert.match(recognitionWarnings(unmatched, current).find(text => text.startsWith("Z 排")), /Z01/);
  current.rows[0].slots = [slot("Z01")];
  const partial = recognitionWarnings(unmatched, current).find(text => text.startsWith("Z 排"));
  assert.ok(!partial.includes("Z01"));
  assert.match(partial, /Z02/);
  current.rows[0].slots = diagnostic.codes.map(slot);
  assert.ok(!recognitionWarnings(unmatched, current).some(text => text.startsWith("Z 排")));
  assert.ok(recognitionWarnings(unmatched, current).some(text => text.includes("沒有對應")), "other valid warnings remain");
});

test("missing slots within a matched row are structured and disappear only when their codes are drawn", () => {
  const sparse = recognizeEditorDraft({ ...input(), image: ruledPlan({ blankTopLeftOfA: true }) });
  const diagnostic = sparse.diagnostics.find(item => item.kind === "missing-slots");
  assert.deepEqual(diagnostic.codes, ["A09"]);
  const current = blank();
  assert.match(recognitionWarnings(sparse, current).find(text => text.startsWith("A 排")), /A09/);
  current.rows = [{ label: "Other", slots: [{ code: "A09", rect: { x: 0, y: 0, width: 1, height: 1 } }] }];
  assert.ok(!recognitionWarnings(sparse, current).some(text => text.includes("A09")));
  assert.ok(sparse.warnings.some(text => text.includes("A09")), "the standalone prototype keeps its fallback report");
});
