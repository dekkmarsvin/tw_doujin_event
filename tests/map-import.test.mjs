import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { recognizeFF47Map } = await environment.runner.import("/app/map-recognition.ts");
const { validateEventMapLayout, validateFF47EventMapLayout } = await environment.runner.import("/app/event-map.ts");
after(() => vite.close());

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
  const report = recognizeFF47Map(syntheticFF47Image());
  assert.deepEqual(report.diagnostics, { rowCount: 23, slotCount: 988, pillarCount: 28, accessPointCount: 5 });
  assert.equal(validateEventMapLayout(report.layout).ok, true);
  assert.equal(validateFF47EventMapLayout(report.layout).ok, true);
  const rows = Object.fromEntries(report.layout.rows.map((row) => [row.label, row]));
  assert.equal(rows.A.orientation, "vertical");
  assert.equal(rows.A.slots.length, 22);
  assert.equal(rows.V.slots.length, 44);
  assert.equal(rows.W.orientation, "horizontal");
  assert.equal(rows.W.slots.length, 42);
  assert.ok(rows.A.slots.find((slot) => slot.code === "A01").rect.y > rows.A.slots.find((slot) => slot.code === "A22").rect.y);
  assert.ok(rows.B.slots.find((slot) => slot.code === "B23").rect.y < rows.B.slots.find((slot) => slot.code === "B44").rect.y);
  assert.ok(rows.W.slots.find((slot) => slot.code === "W42").rect.x < rows.W.slots.find((slot) => slot.code === "W01").rect.x);
});

test("accepts a generic future event layout without FF47-specific counts", () => {
  const layout = { version: 2, template: "TAIWAN_GENERIC_V1", width: 100, height: 100, floor: { x: 0, y: 0, width: 100, height: 100 }, rows: [{ label: "創作區", orientation: "horizontal", confidence: 1, slots: [{ code: "創01", rect: { x: 10, y: 10, width: 10, height: 10 } }] }], pillars: [], accessPoints: [], landmarks: [] };
  assert.equal(validateEventMapLayout(layout).ok, true);
  assert.equal(validateFF47EventMapLayout(layout).ok, false);
});

test("rejects images that are too small", () => {
  const report = recognizeFF47Map({ data: new Uint8ClampedArray(400 * 300 * 4), width: 400, height: 300 });
  assert.equal(report.confidence, 0);
  assert.match(report.warnings[0], /解析度太低/);
});
