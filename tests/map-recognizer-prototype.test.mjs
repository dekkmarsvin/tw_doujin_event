import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

// The prototype under prototypes/map-recognizer is plain TypeScript meant for
// a Worker; the Vite SSR runner loads it the same way the other module tests
// load app/. Real organizer plans stay out of the repository, so every plan
// here is drawn in code with a 3×5 pixel digit font.
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { decodeImage, decodePng, cropImage, UnsupportedImageError } = await environment.runner.import("/prototypes/map-recognizer/src/decode-image.ts");
const { recognizeBoothGrid } = await environment.runner.import("/prototypes/map-recognizer/src/recognize.ts");
const { buildLayout, parseBoothList } = await environment.runner.import("/prototypes/map-recognizer/src/build-layout.ts");
const { recognizePlan, parseCrop } = await environment.runner.import("/prototypes/map-recognizer/src/pipeline.ts");
const { validateEventMapLayout } = await environment.runner.import("/app/event-map.ts");
const worker = (await environment.runner.import("/prototypes/map-recognizer/src/worker.ts")).default;
after(() => vite.close());

const FONT = {
  0: ["111", "101", "101", "101", "111"], 1: ["010", "110", "010", "010", "111"], 2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"], 4: ["101", "101", "111", "001", "001"], 5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"], 7: ["111", "001", "010", "010", "010"], 8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"],
};

function canvas(width, height, [r, g, b] = [255, 255, 255]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set([r, g, b, 255], i * 4);
  return { width, height, data };
}

function fill(image, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) image.data.set([...color, 255], (yy * image.width + xx) * 4);
}

/** Digits at 2× scale (6×10 each, 2 px apart), centred on (cx, cy). */
function text(image, value, cx, cy, color = [20, 20, 20]) {
  const width = value.length * 8 - 2;
  let x = Math.round(cx - width / 2);
  const y = Math.round(cy - 5);
  for (const digit of value) {
    FONT[digit].forEach((line, row) => [...line].forEach((bit, column) => { if (bit === "1") fill(image, x + column * 2, y + row * 2, 2, 2, color); }));
    x += 8;
  }
}

/** A ruled block of `columns × rows` cells with 2 px black walls. `label`
 * returns the number printed in a cell, or null to leave it blank. */
function ruledBlock(image, x0, y0, columns, rows, cellW, cellH, label) {
  for (let c = 0; c <= columns; c += 1) fill(image, x0 + c * cellW, y0, 2, rows * cellH + 2, [0, 0, 0]);
  for (let r = 0; r <= rows; r += 1) fill(image, x0, y0 + r * cellH, columns * cellW + 2, 2, [0, 0, 0]);
  for (let c = 0; c < columns; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const value = label(c, r);
      if (value !== null) text(image, value, x0 + c * cellW + 1 + cellW / 2, y0 + r * cellH + 1 + cellH / 2);
    }
  }
}

/** FF-style numbering: 1 at the bottom right, up the right column, then
 * down the left column. */
const uTurn = (rows) => (c, r) => String(c === 1 ? rows - r : rows + 1 + r);

function ruledPlan({ blankTopLeftOfA = false } = {}) {
  const image = canvas(420, 260);
  ruledBlock(image, 300, 80, 2, 8, 30, 18, (c, r) => (blankTopLeftOfA && c === 0 && r === 0 ? null : uTurn(8)(c, r)));
  ruledBlock(image, 200, 80, 2, 8, 30, 18, uTurn(8));
  ruledBlock(image, 200, 20, 6, 1, 20, 32, (c) => String(6 - c));
  return image;
}

const centreOf = (layout, code) => {
  const slot = layout.rows.flatMap((row) => row.slots).find((candidate) => candidate.code === code);
  return slot && { x: slot.rect.x + slot.rect.width / 2, y: slot.rect.y + slot.rect.height / 2 };
};
const near = (point, x, y, tolerance = 6) => point && Math.abs(point.x - x) <= tolerance && Math.abs(point.y - y) <= tolerance;

function encodePng({ width, height, data }, { cycleFilters = false } = {}) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, "ascii");
    Buffer.from(body).copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  const pixel = (x, y, ch) => (x < 0 || y < 0 ? 0 : data[(y * width + x) * 4 + ch]);
  for (let y = 0; y < height; y += 1) {
    const filter = cycleFilters ? y % 5 : 0;
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < width; x += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        const value = pixel(x, y, ch);
        const left = pixel(x - 1, y, ch);
        const up = pixel(x, y - 1, ch);
        const upLeft = pixel(x - 1, y - 1, ch);
        const paeth = (() => { const p = left + up - upLeft; const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft); return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft; })();
        const predicted = [0, left, up, (left + up) >> 1, paeth][filter];
        raw[y * (stride + 1) + 1 + x * 3 + ch] = (value - predicted) & 0xff;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

test("decodes PNG rows written with every filter type", async () => {
  const image = ruledPlan();
  const decoded = await decodePng(encodePng(image, { cycleFilters: true }));
  assert.equal(decoded.width, image.width);
  assert.equal(decoded.height, image.height);
  assert.deepEqual(decoded.data, image.data);
});

test("refuses files that are neither PNG nor JPEG", async () => {
  await assert.rejects(decodeImage(new TextEncoder().encode("GIF89a")), UnsupportedImageError);
});

test("reads the booth list: ranges, prefixes with separators and list order", () => {
  const { rows, ignored } = parseBoothList("B01~B03, A01 A02\nB5-01~B5-02 ??");
  assert.deepEqual(rows.map((row) => [row.label, row.entries.map((entry) => entry.code)]), [
    ["B", ["B01", "B02", "B03"]],
    ["A", ["A01", "A02"]],
    ["B5", ["B5-01", "B5-02"]],
  ]);
  assert.deepEqual(ignored, ["??"]);
});

test("finds ruled booths, matches rows by count and numbers them by glyph fit", () => {
  const result = recognizeBoothGrid(ruledPlan());
  assert.equal(result.cells.length, 38);
  const report = buildLayout(result, { boothList: "A01~A16\nB01~B16\nC01~C06" });
  assert.equal(report.valid, true, report.errors.join("\n"));
  assert.deepEqual(report.missingRows, []);
  assert.deepEqual(report.layout.rows.map((row) => [row.label, row.slots.length]), [["A", 16], ["B", 16], ["C", 6]]);
  // A is the right-hand block: 1 at its bottom right, 9 at its top left.
  assert.ok(near(centreOf(report.layout, "A01"), 346, 216), JSON.stringify(centreOf(report.layout, "A01")));
  assert.ok(near(centreOf(report.layout, "A08"), 346, 90));
  assert.ok(near(centreOf(report.layout, "A09"), 316, 90));
  assert.ok(near(centreOf(report.layout, "B01"), 246, 216));
  // The top row counts from its right end.
  assert.ok(near(centreOf(report.layout, "C01"), 311, 37));
  assert.ok(near(centreOf(report.layout, "C06"), 211, 37));
  assert.ok(report.rows.every((row) => row.numbering.includes("不補零")));
  assert.equal(validateEventMapLayout(report.layout).ok, true);
});

test("a booth the plan leaves blank is reported by its code, not shifted onto its neighbours", () => {
  const report = buildLayout(recognizeBoothGrid(ruledPlan({ blankTopLeftOfA: true })), { boothList: "A01~A16\nB01~B16\nC01~C06" });
  const a = report.layout.rows.find((row) => row.label === "A");
  assert.equal(a.slots.length, 15);
  assert.equal(centreOf(report.layout, "A09"), undefined);
  assert.ok(near(centreOf(report.layout, "A10"), 316, 108));
  assert.ok(report.warnings.some((warning) => warning.includes("A09")), report.warnings.join("\n"));
});

test("splits filled blocks that print two booth numbers each", () => {
  const image = canvas(200, 420);
  for (let k = 0; k < 6; k += 1) {
    const y = 20 + k * 58;
    fill(image, 80, y, 40, 54, [204, 163, 107]);
    text(image, String(k * 2 + 1).padStart(2, "0"), 100, y + 14, [255, 255, 255]);
    text(image, String(k * 2 + 2).padStart(2, "0"), 100, y + 40, [255, 255, 255]);
  }
  const result = recognizeBoothGrid(image);
  assert.equal(result.metrics.splitCells, 6);
  const report = buildLayout(result, { boothList: "A01~A12" });
  assert.deepEqual(report.layout.rows.map((row) => [row.label, row.slots.length]), [["A", 12]]);
  assert.ok(near(centreOf(report.layout, "A01"), 100, 33));
  assert.ok(near(centreOf(report.layout, "A12"), 100, 350));
  assert.ok(report.rows[0].numbering.includes("補零"));
});

test("without a booth list every block becomes a provisional row", () => {
  const report = buildLayout(recognizeBoothGrid(ruledPlan()));
  assert.equal(report.valid, true, report.errors.join("\n"));
  assert.deepEqual(report.layout.rows.map((row) => row.label).sort(), ["?1", "?2", "?3"]);
  assert.ok(report.layout.rows.every((row) => row.confidence <= 0.4));
});

test("crops one hall and reports where it sat on the sheet", async () => {
  assert.deepEqual(parseCrop("190, 70, 180 ,170"), { x: 190, y: 70, width: 180, height: 170 });
  assert.equal(parseCrop("1,2,3"), null);
  const sheet = ruledPlan();
  const hall = cropImage(sheet, { x: 190, y: 70, width: 180, height: 170 });
  assert.deepEqual([hall.width, hall.height], [180, 170]);
  const result = await recognizePlan(encodePng(sheet), { boothList: "A01~A16 B01~B16", crop: { x: 190, y: 70, width: 180, height: 170 } });
  assert.deepEqual(result.image, { width: 180, height: 170, offsetX: 190, offsetY: 70 });
  assert.equal(result.summary.booths, 32);
  assert.ok(near(centreOf(result.layout, "A01"), 346 - 190, 216 - 70));
});

test("the Worker serves its page and answers uploads without any binding", async () => {
  const page = await worker.fetch(new Request("http://prototype.test/"));
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(await page.text(), /配置圖自動辨識/);

  const bad = new FormData();
  bad.set("image", new Blob([new TextEncoder().encode("not an image")]), "notes.txt");
  const refused = await worker.fetch(new Request("http://prototype.test/recognize", { method: "POST", body: bad }));
  assert.equal(refused.status, 422);

  const form = new FormData();
  form.set("image", new Blob([encodePng(ruledPlan())], { type: "image/png" }), "plan.png");
  form.set("boothList", "A01~A16\nB01~B16\nC01~C06");
  const response = await worker.fetch(new Request("http://prototype.test/recognize", { method: "POST", body: form }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sourceName, "plan.png");
  assert.equal(body.summary.booths, 38);
  assert.equal(body.report.valid, true);
  assert.match(body.svg, /^<svg /);
  assert.equal(validateEventMapLayout(body.layout).ok, true);
});

test("the Worker rejects a nonempty invalid crop instead of recognizing the whole sheet", async () => {
  for (const crop of ["not coordinates", "1,2,3", "0,0,0,20", "-1,0,20,20", "0,0,NaN,20"]) {
    const form = new FormData();
    form.set("image", new Blob([encodePng(ruledPlan())], { type: "image/png" }), "plan.png");
    form.set("crop", crop);
    const response = await worker.fetch(new Request("http://prototype.test/recognize", { method: "POST", body: form }));
    assert.equal(response.status, 400, crop);
    const body = await response.json();
    assert.match(body.error, /框選範圍格式不正確/);
    assert.equal(body.layout, undefined);
  }
});
