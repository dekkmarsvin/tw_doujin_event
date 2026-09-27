import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite test environment missing.");
const { catalogFileProblem, catalogImageSize, catalogPreviewSize } = await environment.runner.import("/app/catalog-image-prepare.ts");
const { CATALOG_IMAGE_RULES, circleOverrideFieldsProblem, clearCircleOverrideField, circleOverrideFieldMode } = await environment.runner.import("/app/circle-overrides.ts");
const { catalogKeyOf, catalogKeysOf, hostedCatalogImage, jpegDimensions, prepareHostedCatalogImage } = await environment.runner.import("/app/hosted-thumbnails.ts");
const { buildCircleCatalog, representativeMedia } = await environment.runner.import("/app/circle-records.ts");
after(() => vite.close());

/** The smallest JPEG header that names a frame size: SOI, a JFIF APP0 and one frame marker. */
function jpeg(width, height, { progressive = false, filler = 0 } = {}) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const frame = [0xff, progressive ? 0xc2 : 0xc0, 0x00, 0x11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...new Array(filler).fill(0xff), ...frame, 0xff, 0xd9]);
}
const file = (bytes, type = "image/jpeg", name = "page.jpg") => new File([bytes], name, { type });
const store = { url: (key) => `https://media-preview.kotoban.top/${key}` };

test("the readable image keeps a strip's width and brings a print sheet under the pixel budget", () => {
  // Sizes measured on real sale sheets for #413.
  assert.deepEqual(catalogImageSize(800, 4381), { width: 800, height: 4381 }, "a tall strip is left alone");
  assert.deepEqual(catalogImageSize(2048, 1448), { width: 2048, height: 1448 }, "a web export is left alone");
  for (const [width, height] of [[5787, 4093], [4093, 2894], [2000, 3749], [4093, 11108]]) {
    const size = catalogImageSize(width, height);
    assert.ok(size.width * size.height <= CATALOG_IMAGE_RULES.maxPixels, `${width}×${height} fits the budget`);
    assert.ok(size.width * size.height > CATALOG_IMAGE_RULES.maxPixels * 0.998, `${width}×${height} uses the budget`);
    assert.ok(Math.abs(size.width / size.height - width / height) < 0.01, "and keeps its proportions");
  }
  assert.deepEqual(catalogImageSize(5787, 4093), { width: 2658, height: 1880 });
  // Under the pixel budget but longer than the field accepts on one side.
  assert.deepEqual(catalogImageSize(100, 25_000), { width: 80, height: 20_000 }, "an extreme strip is brought within the side limit");
  assert.deepEqual(catalogImageSize(250, 20_000), { width: 250, height: 20_000 }, "exactly at the limit is left alone");
});

test("the card preview is a fixed width, and only the top of a very tall sheet", () => {
  assert.deepEqual(catalogPreviewSize(2048, 1448), { width: 640, height: 453, sourceHeight: 1448 });
  assert.deepEqual(catalogPreviewSize(800, 4381), { width: 640, height: 960, sourceHeight: 1200 }, "a strip keeps its top");
  assert.deepEqual(catalogPreviewSize(400, 300), { width: 400, height: 300, sourceHeight: 300 }, "never enlarged");
});

test("files a print shop hands over are named when they cannot be used", () => {
  assert.equal(catalogFileProblem({ name: "品書.pdf", type: "application/pdf" }), "PDF 請先匯出成 JPG 或 PNG 再上傳。");
  assert.equal(catalogFileProblem({ name: "品書.PSD", type: "" }), "PSD 請先匯出成 JPG 或 PNG 再上傳。");
  assert.equal(catalogFileProblem({ name: "a.gif", type: "image/gif" }), "品書圖片請使用 JPG、PNG 或 WebP。");
  for (const type of ["image/jpeg", "image/png", "image/webp"]) assert.equal(catalogFileProblem({ name: "a", type }), null);
});

test("a JPEG's size is read from its frame header, baseline or progressive", () => {
  assert.deepEqual(jpegDimensions(jpeg(2658, 1880)), { width: 2658, height: 1880 });
  assert.deepEqual(jpegDimensions(jpeg(640, 960, { progressive: true, filler: 3 })), { width: 640, height: 960 });
  assert.equal(jpegDimensions(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), null);
  assert.equal(jpegDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), null, "no frame, no size");
});

test("the upload route holds a prepared page to the same rules the browser prepares to", async () => {
  const prepared = await prepareHostedCatalogImage({ eventId: "ff47", circleId: "c-000001", file: file(jpeg(2658, 1880)), preview: file(jpeg(640, 453)) });
  assert.match(prepared.full.key, /^events\/ff47\/circles\/c-000001\/catalog\/[a-f0-9]{64}\.jpg$/);
  assert.match(prepared.preview.key, /^events\/ff47\/circles\/c-000001\/catalog\/[a-f0-9]{64}\.jpg$/);
  assert.notEqual(prepared.full.key, prepared.preview.key, "each object is named by its own content");
  assert.deepEqual(hostedCatalogImage(store, prepared), {
    url: `https://media-preview.kotoban.top/${prepared.full.key}`, previewUrl: `https://media-preview.kotoban.top/${prepared.preview.key}`, width: 2658, height: 1880,
  });

  const refused = async (input, message) => assert.rejects(prepareHostedCatalogImage({ eventId: "ff47", circleId: "c-000001", ...input }), message);
  await refused({ file: file(jpeg(5787, 4093)), preview: file(jpeg(640, 453)) }, /尺寸超過上限/);
  await refused({ file: file(jpeg(100, 25_000)), preview: file(jpeg(3, 960)) }, /尺寸超過上限/, "a side the field would refuse is refused here too");
  await refused({ file: file(jpeg(2658, 1880)), preview: file(jpeg(641, 453)) }, /預覽圖尺寸超過上限/);
  await refused({ file: file(jpeg(2658, 1880)), preview: file(jpeg(640, 961)) }, /預覽圖尺寸超過上限/);
  await refused({ file: file(jpeg(100, 100), "image/png"), preview: file(jpeg(64, 64)) }, /格式無效/);
  await refused({ file: file(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), "image/jpeg"), preview: file(jpeg(64, 64)) }, /格式無效/);
  await refused({ file: file(new Uint8Array(CATALOG_IMAGE_RULES.maxBytes + 1)), preview: file(jpeg(64, 64)) }, /大小上限/);
});

test("only this circle's own sale-sheet objects map back to keys", () => {
  const own = `https://media-preview.kotoban.top/events/ff47/circles/c-000001/catalog/${"a".repeat(64)}.jpg`;
  assert.equal(catalogKeyOf(store, own, "ff47", "c-000001"), own.slice("https://media-preview.kotoban.top/".length));
  assert.equal(catalogKeyOf(store, own, "ff47", "c-000002"), null, "another circle's page");
  assert.equal(catalogKeyOf(store, `https://media-preview.kotoban.top/events/ff47/circles/c-000001/${"a".repeat(64)}.jpg`, "ff47", "c-000001"), null, "the thumbnail slot is not a page");
  assert.equal(catalogKeyOf(store, `https://elsewhere.example/events/ff47/circles/c-000001/catalog/${"a".repeat(64)}.jpg`, "ff47", "c-000001"), null, "not hosted here");
  assert.deepEqual(catalogKeysOf(store, { catalogImages: [{ url: own, previewUrl: own, width: 1, height: 1 }] }, "ff47", "c-000001").length, 2);
});

test("the field accepts up to three hosted pages and is a list like any other", () => {
  const page = { url: "https://media.example/a.jpg", previewUrl: "https://media.example/b.jpg", width: 2658, height: 1880 };
  assert.equal(circleOverrideFieldsProblem({ catalogImages: [page, page, page] }, null), null);
  assert.equal(circleOverrideFieldsProblem({ catalogImages: [] }, null), null, "the tombstone");
  for (const catalogImages of [
    [page, page, page, page],
    [{ ...page, url: "http://media.example/a.jpg" }],
    [{ ...page, width: 0 }],
    [{ ...page, height: 1.5 }],
    [{ ...page, alt: "extra" }],
    [{ url: page.url, previewUrl: page.previewUrl, width: 1 }],
    page,
  ]) assert.match(circleOverrideFieldsProblem({ catalogImages }, null), /品書最多 3 張/, JSON.stringify(catalogImages).slice(0, 80));
  assert.deepEqual(clearCircleOverrideField({}, "catalogImages"), { catalogImages: [] });
  assert.equal(circleOverrideFieldMode({ catalogImages: [] }, "catalogImages"), "clear");
});

test("a sale-sheet page never stands in for the representative picture", async () => {
  const catalog = JSON.parse(await readFile(new URL("../fixtures/events/sample/circles.json", import.meta.url), "utf8"));
  const page = (n) => ({ url: `https://media.example/${n}.jpg`, previewUrl: `https://media.example/${n}-card.jpg`, width: 2000, height: 1400 });
  const overlay = (fields) => ({ schema: "circle-overrides/1", eventId: "sample", generatedAt: "2026-01-01T00:00:00.000+08:00", revision: 1, overrides: [{ circleId: "c-900001", updatedAt: "2026-08-20T00:00:00.000+08:00", fields }] });

  const onlyPages = buildCircleCatalog(catalog, overlay({ catalogImages: [page(1), page(2)] })).circlesById.get("c-900001");
  assert.deepEqual(onlyPages.media.map(({ kind, url, previewUrl }) => [kind, url, previewUrl]), [
    ["catalog", "https://media.example/1.jpg", "https://media.example/1-card.jpg"],
    ["catalog", "https://media.example/2.jpg", "https://media.example/2-card.jpg"],
  ]);
  assert.equal(representativeMedia(onlyPages.media), undefined, "no picture for the list card or the map slot");
  assert.equal(onlyPages.media[1].alt, "北風畫室 品書第 2 張");

  const both = buildCircleCatalog(catalog, overlay({ thumbnail: { url: "https://media.example/cut.png", sourceUrl: "", provider: "" }, catalogImages: [page(1)] })).circlesById.get("c-900001");
  assert.deepEqual(both.media.map(({ kind }) => kind), ["thumbnail", "catalog"], "the picture first, then the pages");
  assert.equal(representativeMedia(both.media).url, "https://media.example/cut.png");
});
