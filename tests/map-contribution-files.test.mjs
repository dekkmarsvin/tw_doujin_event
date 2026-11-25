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

test("a layout plan is read with the same container checks and no source metadata", async () => {
  for (const fixture of [
    { type: "image/png", bytes: png(), width: 320, height: 240, extension: "png" },
    { type: "image/jpeg", bytes: jpeg(), width: 1, height: 1, extension: "jpg" },
    { type: "image/webp", bytes: webp(), width: 1, height: 1, extension: "webp" },
  ]) {
    const prepared = await files.prepareMapImageFile(new File([fixture.bytes], "plan.bin", { type: fixture.type }));
    assert.equal(prepared.width, fixture.width);
    assert.equal(prepared.height, fixture.height);
    assert.equal(prepared.extension, fixture.extension);
    assert.equal(prepared.contentType, fixture.type);
    assert.match(prepared.sha256, /^[a-f0-9]{64}$/);
  }
  await assert.rejects(() => files.prepareMapImageFile(new File([png(1, 1, { interlace: 1 })], "plan.png", { type: "image/png" })), /非交錯/);
  await assert.rejects(() => files.prepareMapImageFile(new File([png()], "plan.jpg", { type: "image/jpeg" })), /baseline JPEG/);
  // A document is evidence for a contribution, never a canvas to trace over.
  await assert.rejects(() => files.prepareMapImageFile(new File([pdf()], "plan.pdf", { type: "application/pdf" })), /JPEG、PNG 或 WebP/);
  await assert.rejects(() => files.prepareMapImageFile(new File([], "empty.png", { type: "image/png" })), /1 byte/);
  await assert.rejects(() => files.prepareMapImageFile(
    new File([new Uint8Array(files.MAP_IMAGE_MAX_BYTES + 1)], "huge.png", { type: "image/png" }),
  ), /10 MB/);
});

test("a candidate map's plan is addressed by the draft's own ids", () => {
  assert.equal(
    files.organizerMapBackgroundObjectKey({ candidateId: "candidate-a", draftId: "draft-a" }),
    "organizer-map-backgrounds/candidate-a/draft-a",
  );
  assert.throws(() => files.organizerMapBackgroundObjectKey({ candidateId: "../candidate-a", draftId: "draft-a" }), /invalid/);
});
