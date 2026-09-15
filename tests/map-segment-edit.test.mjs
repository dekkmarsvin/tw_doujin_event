import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { editSegmentFrame, replaceSegment, segmentCodeRange, segmentNaming } = await environment.runner.import("/app/map-segment-edit.ts");
const { segmentSlotRects } = await environment.runner.import("/app/map-layout-editor-geometry.ts");
after(() => vite.close());

const BOUNDS = { width: 1000, height: 1600 };
const near = (value, expected, message) => assert.ok(Math.abs(value - expected) < 1e-9, `${message ?? ""} ${value} != ${expected}`);

/** One frame cut into `count` booths, the way placing a segment leaves it. */
function segment(frame, orientation, count, { prefix = "A", start = 1, padding = 2, reversed = false } = {}) {
  const rects = segmentSlotRects(frame, orientation, count, BOUNDS);
  return rects.map((rect, index) => ({
    code: `${prefix}${String(start + (reversed ? count - 1 - index : index)).padStart(padding, "0")}`,
    rect,
  }));
}

function layoutWith(rows) {
  return {
    version: 1, template: "test", ...BOUNDS,
    floor: { x: 0, y: 0, ...BOUNDS },
    rows, pillars: [], accessPoints: [], landmarks: [],
  };
}

const column = { x: 200, y: 240, width: 60, height: 400 };

test("naming is read back off the codes a placed segment already carries", () => {
  const forward = segmentNaming(segment(column, "vertical", 4), "vertical", "A");
  assert.deepEqual(forward, { codePrefix: "A", startNumber: "1", endNumber: "4", numberPadding: "2", orientation: "vertical", numberingStart: "top" });
  // Spatial order is the input, so a column numbered upwards reads as reversed
  // and reopens on the end it actually starts from.
  const reversed = segmentNaming(segment(column, "vertical", 4, { start: 5, reversed: true }), "vertical", "A");
  assert.deepEqual(reversed, { codePrefix: "A", startNumber: "5", endNumber: "8", numberPadding: "2", orientation: "vertical", numberingStart: "bottom" });
  assert.equal(segmentNaming(segment(column, "horizontal", 3, { reversed: true }), "horizontal", "A").numberingStart, "right");
  assert.equal(segmentNaming(segment(column, "horizontal", 3), "horizontal", "A").numberingStart, "left");
});

test("codes that are not a plain run fall back to the row label rather than inventing a prefix", () => {
  const irregular = [{ code: "A01", rect: column }, { code: "B07", rect: column }, { code: "A03", rect: column }];
  assert.deepEqual(segmentNaming(irregular, "vertical", "西一"), { codePrefix: "西一", startNumber: "1", endNumber: "3", numberPadding: "2", orientation: "vertical", numberingStart: "top" });
  // A gap in the numbers is irregular too: renumbering it would silently close
  // the gap, so the form offers a fresh run instead of claiming to describe it.
  assert.equal(segmentNaming([{ code: "A01", rect: column }, { code: "A03", rect: column }], "vertical", "A").codePrefix, "A");
  assert.equal(segmentNaming([{ code: "A01", rect: column }, { code: "A03", rect: column }], "vertical", "A").startNumber, "1");
  assert.equal(segmentCodeRange({ codePrefix: "A", startNumber: "7", endNumber: "12", numberPadding: "3" }), "A007–A012");
});

test("frame fields keep the segment inside the canvas and never collapse it", () => {
  const frame = { x: 100, y: 100, width: 200, height: 300 };
  // Moving against an edge stops at the edge with its size intact.
  assert.deepEqual(editSegmentFrame(frame, { x: -50 }, BOUNDS), { x: 0, y: 100, width: 200, height: 300 });
  assert.deepEqual(editSegmentFrame(frame, { x: 9999 }, BOUNDS), { x: 800, y: 100, width: 200, height: 300 });
  assert.deepEqual(editSegmentFrame(frame, { y: 9999 }, BOUNDS), { x: 100, y: 1300, width: 200, height: 300 });
  // Growing past the far edge pushes the origin back rather than overflowing.
  assert.deepEqual(editSegmentFrame(frame, { width: 1200 }, BOUNDS), { x: 0, y: 100, width: 1000, height: 300 });
  assert.deepEqual(editSegmentFrame(frame, { width: 0 }, BOUNDS), { x: 100, y: 100, width: .5, height: 300 });
  assert.deepEqual(editSegmentFrame(frame, { height: -4 }, BOUNDS), { x: 100, y: 100, width: 200, height: .5 });
  assert.deepEqual(editSegmentFrame(frame, {}, BOUNDS), frame);
});

test("re-cutting a segment stays seamless and fills exactly the frame it was given", () => {
  for (const [orientation, frame, count] of [
    ["vertical", { x: 200, y: 240, width: 60, height: 400 }, 4],
    ["vertical", { x: 0, y: 0, width: 33, height: 1000 }, 26],
    ["horizontal", { x: 12.5, y: 700, width: 613.25, height: 40 }, 7],
    ["horizontal", { x: 400, y: 10, width: 300, height: 25 }, 1],
  ]) {
    const rects = segmentSlotRects(frame, orientation, count, BOUNDS);
    assert.equal(rects.length, count);
    const along = orientation === "vertical" ? ["y", "height"] : ["x", "width"];
    near(rects[0][along[0]], frame[along[0]], orientation);
    near(rects.at(-1)[along[0]] + rects.at(-1)[along[1]], frame[along[0]] + frame[along[1]], orientation);
    for (let index = 1; index < count; index += 1) {
      // Touching exactly: no gap to accumulate, and no overlap to be rejected.
      assert.ok(rects[index][along[0]] >= rects[index - 1][along[0]] + rects[index - 1][along[1]], `${orientation} booth ${index} may not begin inside its neighbour`);
      near(rects[index][along[0]], rects[index - 1][along[0]] + rects[index - 1][along[1]], orientation);
    }
  }
});

test("applying a new count and direction replaces only the selected run", () => {
  const rows = [{ label: "A", orientation: "vertical", confidence: 1, slots: [...segment(column, "vertical", 4), ...segment({ x: 400, y: 240, width: 60, height: 400 }, "vertical", 4, { start: 11, reversed: true })] }];
  const layout = layoutWith(rows);
  const result = replaceSegment(layout, 0, [0, 1, 2, 3], column, { codePrefix: "A", startNumber: "1", endNumber: "6", numberPadding: "2", orientation: "vertical", numberingStart: "bottom" });
  assert.equal(result.ok, true);
  const slots = result.layout.rows[0].slots;
  assert.equal(slots.length, 10);
  assert.deepEqual(result.items, [0, 1, 2, 3, 4, 5]);
  // The facing column keeps its own bytes, codes and reversed numbering.
  assert.deepEqual(slots.slice(6).map(slot => slot.code), ["A14", "A13", "A12", "A11"]);
  assert.deepEqual(slots.slice(6).map(slot => slot.rect), layout.rows[0].slots.slice(4).map(slot => slot.rect));
  // The replaced run is renumbered from the bottom and re-cut into six.
  assert.deepEqual(slots.slice(0, 6).map(slot => slot.code), ["A06", "A05", "A04", "A03", "A02", "A01"]);
  near(slots[0].rect.y, column.y);
  near(slots[5].rect.y + slots[5].rect.height, column.y + column.height);
  for (const slot of slots.slice(0, 6)) near(slot.rect.height, column.height / 6);
});

test("a segment cannot take a code another segment already uses, and its own codes are free to reuse", () => {
  const rows = [{ label: "A", orientation: "vertical", confidence: 1, slots: [...segment(column, "vertical", 2), ...segment({ x: 400, y: 240, width: 60, height: 400 }, "vertical", 2, { start: 5 })] }];
  const layout = layoutWith(rows);
  const clash = replaceSegment(layout, 0, [0, 1], column, { codePrefix: "A", startNumber: "4", endNumber: "6", numberPadding: "2", orientation: "vertical", numberingStart: "top" });
  assert.equal(clash.ok, false);
  assert.deepEqual(clash.errors, ["攤位代碼 A05 已被其他排段使用。"]);
  // Renumbering a run onto codes it already holds is not a clash with itself.
  assert.equal(replaceSegment(layout, 0, [0, 1], column, { codePrefix: "A", startNumber: "1", endNumber: "2", numberPadding: "2", orientation: "vertical", numberingStart: "bottom" }).ok, true);
  // The whole row turning is what turns the stored row; a run inside it is not.
  const turned = replaceSegment(layoutWith([{ label: "A", orientation: "vertical", confidence: 1, slots: segment(column, "vertical", 2) }]), 0, [0, 1], column, { codePrefix: "A", startNumber: "1", endNumber: "2", numberPadding: "2", orientation: "horizontal", numberingStart: "left" });
  assert.equal(turned.layout.rows[0].orientation, "horizontal");
  assert.equal(replaceSegment(layout, 0, [0, 1], column, { codePrefix: "A", startNumber: "1", endNumber: "2", numberPadding: "2", orientation: "horizontal", numberingStart: "left" }).layout.rows[0].orientation, "vertical");
});

test("an unusable selection or count is reported instead of writing a broken row", () => {
  const layout = layoutWith([{ label: "A", orientation: "vertical", confidence: 1, slots: segment(column, "vertical", 3) }]);
  const naming = { codePrefix: "A", startNumber: "1", endNumber: "3", numberPadding: "2", orientation: "vertical", numberingStart: "top" };
  for (const [items, message] of [[[], "請重新選取排段。"], [[0, 9], "請重新選取排段。"]]) {
    const result = replaceSegment(layout, 0, items, column, naming);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [message]);
  }
  assert.equal(replaceSegment(layout, 4, [0], column, naming).ok, false);
  for (const invalid of [{ endNumber: "" }, { startNumber: " " }, { endNumber: "3.5" }, { endNumber: "abc" }]) {
    assert.deepEqual(replaceSegment(layout, 0, [0, 1, 2], column, { ...naming, ...invalid }).errors, ["請輸入有效的起始與結束編號。"]);
  }
  // A count below one is the generator's own boundary, reported in its words.
  assert.equal(replaceSegment(layout, 0, [0, 1, 2], column, { ...naming, startNumber: "5", endNumber: "3" }).ok, false);
  assert.equal(replaceSegment(layout, 0, [0, 1, 2], { ...column, width: 0 }, naming).ok, false);
});
