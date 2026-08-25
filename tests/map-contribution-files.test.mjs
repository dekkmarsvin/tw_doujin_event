import assert from "node:assert/strict";
import { File } from "node:buffer";
import { deflateSync } from "node:zlib";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const files = await environment.runner.import("/app/map-contribution-files.ts");
after(() => vite.close());

const metadata = { sourceUrl: "https://organizer.example/map", documentDate: "2026-08-25" };

function png(width = 320, height = 240, options = {}) {
  const crc32 = (value) => {
    let crc = 0xffffffff;
    for (const byte of value) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const typeBytes = Buffer.from(type);
    const result = Buffer.alloc(12 + data.length);
    result.writeUInt32BE(data.length, 0);
    typeBytes.copy(result, 4);
    Buffer.from(data).copy(result, 8);
    result.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.length);
    return result;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  const bitDepth = options.bitDepth ?? 8;
  const colorType = options.colorType ?? 6;
  const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType) ?? 4;
  ihdr.set([bitDepth, colorType, 0, 0, options.interlace ?? 0], 8);
  const raw = options.raw ?? Buffer.alloc(height * (1 + Math.ceil(width * channels * bitDepth / 8)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function jpeg() {
  return Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==", "base64");
}

function webp() {
  return Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
}

function pdf(extra = "", pages = 1) {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${extra} >>`,
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, index) => `${index + 3} 0 R`).join(" ")}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>"),
  ];
  let body = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

test("accepts verified image bytes and records dimensions", async () => {
  for (const fixture of [
    { type: "image/png", bytes: png(), width: 320, height: 240, extension: "png" },
    { type: "image/jpeg", bytes: jpeg(), width: 1, height: 1, extension: "jpg" },
    { type: "image/webp", bytes: webp(), width: 1, height: 1, extension: "webp" },
  ]) {
    const prepared = await files.prepareMapContributionFile({ ...metadata, file: new File([fixture.bytes], "map.bin", { type: fixture.type }) });
    assert.equal(prepared.width, fixture.width);
    assert.equal(prepared.height, fixture.height);
    assert.equal(prepared.extension, fixture.extension);
    assert.match(prepared.sha256, /^[a-f0-9]{64}$/);
  }
});

test("accepts a bounded inert PDF and validates the selected page", async () => {
  const prepared = await files.prepareMapContributionFile({
    ...metadata, pageNumber: 2, file: new File([pdf("", 2)], "map.pdf", { type: "application/pdf" }),
  });
  assert.equal(prepared.pageCount, 2);
  assert.equal(prepared.pageNumber, 2);
  assert.equal(prepared.width, null);
  assert.equal(prepared.extension, "pdf");
});

test("rejects MIME mismatch, active PDF content, encryption and excessive pages", async () => {
  await assert.rejects(() => files.prepareMapContributionFile({
    ...metadata, file: new File([png()], "fake.jpg", { type: "image/jpeg" }),
  }), /baseline JPEG/);
  for (const marker of ["/JavaScript", "/OpenAction", "/EmbeddedFiles", "/Encrypt"]) {
    await assert.rejects(() => files.prepareMapContributionFile({
      ...metadata, file: new File([pdf(marker)], "active.pdf", { type: "application/pdf" }),
    }), /不得包含/);
  }
  await assert.rejects(() => files.prepareMapContributionFile({
    ...metadata, file: new File([pdf("/Type /ObjStm /Filter /FlateDecode")], "compressed.pdf", { type: "application/pdf" }),
  }), /不得包含/);
  await assert.rejects(() => files.prepareMapContributionFile({
    ...metadata, file: new File([pdf("", 21)], "large.pdf", { type: "application/pdf" }),
  }), /頁數/);
});

test("rejects truncated image containers and PDFs without a classic xref/trailer", async () => {
  for (const fixture of [
    { type: "image/png", bytes: png().subarray(0, 24) },
    { type: "image/jpeg", bytes: jpeg().subarray(0, jpeg().length - 2) },
    { type: "image/webp", bytes: webp().subarray(0, webp().length - 2) },
  ]) {
    await assert.rejects(() => files.prepareMapContributionFile({
      ...metadata, file: new File([fixture.bytes], "truncated.bin", { type: fixture.type }),
    }), /只接受/);
  }
  await assert.rejects(() => files.prepareMapContributionFile({
    ...metadata, file: new File([Buffer.from("%PDF-1.7\n1 0 obj<</Type /Page>>endobj\n%%EOF")], "truncated.pdf", { type: "application/pdf" }),
  }), /classic xref/);
});

test("rejects image profiles outside the bounded upload contract", async () => {
  await assert.rejects(() => files.prepareMapContributionFile({
    ...metadata,
    file: new File([png(1, 1, { interlace: 1 })], "interlaced.png", { type: "image/png" }),
  }), /非交錯/);

  const progressive = Buffer.from(jpeg());
  const sof = progressive.indexOf(Buffer.from([0xff, 0xc0]));
  assert.notEqual(sof, -1);
  progressive[sof + 1] = 0xc2;
  await assert.rejects(() => files.prepareMapContributionFile({
    ...metadata, file: new File([progressive], "progressive.jpg", { type: "image/jpeg" }),
  }), /progressive JPEG/);

  const originalWebp = webp();
  const vp8x = Buffer.alloc(18);
  vp8x.write("VP8X", 0, "ascii");
  vp8x.writeUInt32LE(10, 4);
  vp8x[8] = 0x02;
  const animated = Buffer.concat([Buffer.alloc(12), vp8x, originalWebp.subarray(12)]);
  animated.write("RIFF", 0, "ascii");
  animated.writeUInt32LE(animated.length - 8, 4);
  animated.write("WEBP", 8, "ascii");
  await assert.rejects(() => files.prepareMapContributionFile({
    ...metadata, file: new File([animated], "animated.webp", { type: "image/webp" }),
  }), /動畫 WebP/);

  await assert.rejects(() => files.prepareMapContributionFile({
    ...metadata,
    file: new File([png(4096, 4096, { bitDepth: 16, raw: Buffer.alloc(1) })], "wide.png", { type: "image/png" }),
  }), /32 MiB/);

  const wideJpeg = Buffer.from(jpeg());
  const jpegSof = wideJpeg.indexOf(Buffer.from([0xff, 0xc0]));
  assert.notEqual(jpegSof, -1);
  wideJpeg.writeUInt16BE(9_000, jpegSof + 7);
  await assert.rejects(() => files.prepareMapContributionFile({
    ...metadata, file: new File([wideJpeg], "wide.jpg", { type: "image/jpeg" }),
  }), /baseline JPEG/);

  const wideWebp = Buffer.from(webp());
  const vp8l = wideWebp.indexOf(Buffer.from("VP8L"));
  assert.notEqual(vp8l, -1);
  const webpBits = wideWebp.readUInt32LE(vp8l + 9);
  wideWebp.writeUInt32LE((webpBits & ~0x3fff) | (9_000 - 1), vp8l + 9);
  await assert.rejects(() => files.prepareMapContributionFile({
    ...metadata, file: new File([wideWebp], "wide.webp", { type: "image/webp" }),
  }), /靜態 WebP/);
});

test("rejects invalid source metadata, page use and file size", async () => {
  await assert.rejects(() => files.prepareMapContributionFile({
    ...metadata, sourceUrl: "http://organizer.example/map", file: new File([png()], "map.png", { type: "image/png" }),
  }), /HTTPS/);
  await assert.rejects(() => files.prepareMapContributionFile({
    ...metadata, documentDate: "2026-02-30", file: new File([png()], "map.png", { type: "image/png" }),
  }), /文件日期/);
  await assert.rejects(() => files.prepareMapContributionFile({
    ...metadata, pageNumber: 1, file: new File([png()], "map.png", { type: "image/png" }),
  }), /只有 PDF/);
  await assert.rejects(() => files.prepareMapContributionFile({
    ...metadata, file: new File([new Uint8Array(files.MAP_CONTRIBUTION_MAX_BYTES + 1)], "huge.png", { type: "image/png" }),
  }), /20 MiB/);
});

test("near-limit PNG validation avoids per-byte JavaScript work", async () => {
  const base = png(1, 1);
  const idatOffset = base.indexOf(Buffer.from("IDAT")) - 4;
  assert.ok(idatOffset > 0);
  const payloadSize = files.MAP_CONTRIBUTION_MAX_BYTES - base.length - 12;
  const ancillary = Buffer.alloc(payloadSize + 12);
  ancillary.writeUInt32BE(payloadSize, 0);
  ancillary.write("ruSt", 4, "ascii");
  const fixture = Buffer.concat([base.subarray(0, idatOffset), ancillary, base.subarray(idatOffset)]);
  assert.equal(fixture.length, files.MAP_CONTRIBUTION_MAX_BYTES);

  const started = performance.now();
  const prepared = await files.prepareMapContributionFile({
    ...metadata, file: new File([fixture], "near-limit.png", { type: "image/png" }),
  });
  assert.equal(prepared.width, 1);
  assert.ok(performance.now() - started < 500, "validation should stay chunk-bounded and use native hashing");
});

test("private object keys are scoped and reject traversal", () => {
  assert.equal(files.mapContributionObjectKey({ eventId: "ff47", draftId: "draft-a", fileId: "file-a", extension: "png" }), "map-contributions/ff47/draft-a/file-a.png");
  assert.throws(() => files.mapContributionObjectKey({ eventId: "../ff47", draftId: "draft-a", fileId: "file-a", extension: "png" }), /invalid/);
});
