import assert from "node:assert/strict";
import { canvas, fill, text, ruledPlan, centreOf, near, encodePng } from "./support/map-recognition-fixture.mjs";
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
const { recognizeBoothGrid } = await environment.runner.import("/app/map-auto-recognition/recognize.ts");
const { buildLayout, parseBoothList } = await environment.runner.import("/app/map-auto-recognition/build-layout.ts");
const { recognizePlan, parseCrop } = await environment.runner.import("/prototypes/map-recognizer/src/pipeline.ts");
const { validateEventMapLayout } = await environment.runner.import("/app/event-map.ts");
const worker = (await environment.runner.import("/prototypes/map-recognizer/src/worker.ts")).default;
after(() => vite.close());

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

test("oversized JPEG frames return an actionable size error before pixel decoding", async () => {
  for (const marker of [0xc0, 0xc2]) {
    // A 10000 × 4800 frame header, matching the public Pier-2 source image.
    // No pixel data is needed: size validation must stop at the frame header.
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, marker, 0, 11, 8, 0x12, 0xc0, 0x27, 0x10, 1, 1, 0x11, 0, 0xff, 0xd9]);
    await assert.rejects(decodeImage(bytes), (error) => error instanceof UnsupportedImageError && /7 百萬像素/.test(error.message));
    const form = new FormData();
    form.set("image", new Blob([bytes], { type: "image/jpeg" }), "large-plan.jpg");
    const response = await worker.fetch(new Request("http://prototype.test/recognize", { method: "POST", body: form }));
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /7 百萬像素.*縮小後再上傳/);
  }
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
