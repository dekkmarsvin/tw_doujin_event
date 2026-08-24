import assert from "node:assert/strict";
import { File } from "node:buffer";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const thumbnails = await environment.runner.import("/app/hosted-thumbnails.ts");
after(() => vite.close());

const fixtures = [
  { mime: "image/jpeg", extension: "jpg", bytes: [0xff, 0xd8, 0xff, 0xe0, 0x00] },
  { mime: "image/png", extension: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00] },
  { mime: "image/webp", extension: "webp", bytes: [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP"), 0] },
];

test("accepts only verified JPEG, PNG and WebP bytes and names them by content hash", async () => {
  for (const fixture of fixtures) {
    const file = new File([Uint8Array.from(fixture.bytes)], `claim.bin`, { type: fixture.mime });
    const first = await thumbnails.prepareHostedThumbnail({ eventId: "ff47", circleId: "c-1", file, sourceUrl: "https://circle.example/work", provider: "社團本人" });
    const second = await thumbnails.prepareHostedThumbnail({ eventId: "ff47", circleId: "c-1", file, sourceUrl: "https://circle.example/work", provider: "社團本人" });
    assert.match(first.key, new RegExp(`^events/ff47/circles/c-1/[a-f0-9]{64}\\.${fixture.extension}$`));
    assert.equal(first.key, second.key, "the same bytes must have the same object name");
    assert.equal(first.contentType, fixture.mime);
  }
});

test("rejects declared MIME that disagrees with the file signature", async () => {
  const file = new File([Uint8Array.from(fixtures[1].bytes)], "fake.jpg", { type: "image/jpeg" });
  await assert.rejects(
    thumbnails.prepareHostedThumbnail({ eventId: "ff47", circleId: "c-1", file, sourceUrl: "https://circle.example/work", provider: "社團本人" }),
    /MIME 一致/,
  );
});

test("enforces the 2 MiB limit before storing bytes", async () => {
  const file = new File([new Uint8Array(thumbnails.HOSTED_THUMBNAIL_MAX_BYTES + 1)], "large.png", { type: "image/png" });
  await assert.rejects(
    thumbnails.prepareHostedThumbnail({ eventId: "ff47", circleId: "c-1", file, sourceUrl: "https://circle.example/work", provider: "社團本人" }),
    /2 MiB/,
  );
});

test("R2 object deletion is split at the 1000-key Workers API boundary", async () => {
  const calls = [];
  const keys = Array.from({ length: 1001 }, (_, index) => `object-${index}`);
  await thumbnails.deleteObjectKeys({ delete: async (batch) => calls.push(batch) }, keys);
  assert.deepEqual(calls.map((batch) => batch.length), [1000, 1]);
  assert.deepEqual(calls.flat(), keys);
});
