import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { prepareEventImage, parseEventImage, eventImagePublicKey, organizerEventImageObjectKey } = await environment.runner.import("/app/event-image.ts");
const { parseOrganizerEventDraft } = await environment.runner.import("/app/organizer-event.ts");
const { applyAmendmentSettings, normalizeAmendmentSettings, amendmentSettingsImpact } = await environment.runner.import("/app/organizer-amendment-settings.ts");
const { parseEventDefinition } = await environment.runner.import("/app/event-catalog.ts");
const { pageMetadata, SHARE_IMAGE } = await environment.runner.import("/app/seo.ts");
const { discoveryPages } = await environment.runner.import("/app/static-discovery.ts");
after(() => vite.close());

/** A real, minimal PNG of the given size: one grey channel, all zero. */
function png(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((width + 1) * height))), chunk("IEND", Buffer.alloc(0))]);
}
const ORIGIN = "https://thumbs.example";
const publicUrl = (key) => `${ORIGIN}/${key}`;
const file = (bytes, type = "image/png") => new File([bytes], "event.png", { type });

test("an event image is described by its own bytes and named by its hash", async () => {
  const { image, bytes } = await prepareEventImage(file(png(1200, 630)), publicUrl);
  assert.equal(bytes.byteLength, png(1200, 630).length);
  assert.deepEqual({ ...image, sha256: "" }, { url: `${ORIGIN}/event-images/${image.sha256}.png`, sha256: "", contentType: "image/png", width: 1200, height: 630 });
  assert.match(image.sha256, /^[0-9a-f]{64}$/);
  assert.equal(eventImagePublicKey(image), `event-images/${image.sha256}.png`);
  assert.equal(organizerEventImageObjectKey("cand-1", image), `organizer-event-images/cand-1/${image.sha256}.png`);
  // Any ratio is fine; only the width has a floor.
  assert.equal((await prepareEventImage(file(png(1200, 1200)), publicUrl)).image.height, 1200);
});

test("an upload that is too narrow, too large or not a picture is refused with the reason", async () => {
  await assert.rejects(prepareEventImage(file(png(1199, 630)), publicUrl), /寬度至少要 1200 px，這張是 1199 px/);
  await assert.rejects(prepareEventImage(file(Buffer.alloc(5 * 1024 * 1024 + 1)), publicUrl), /不可超過 5 MiB/);
  await assert.rejects(prepareEventImage(file(Buffer.from("GIF89a"), "image/gif"), publicUrl), /JPEG、PNG 或 WebP/);
  await assert.rejects(prepareEventImage(file(Buffer.alloc(0)), publicUrl), /大於 0 bytes/);
});

test("a draft can only name the address its picture's hash gives it", async () => {
  const { image } = await prepareEventImage(file(png(1200, 630)), publicUrl);
  assert.deepEqual(parseEventImage(image), image);
  assert.equal(parseEventImage({ ...image, url: `${ORIGIN}/events/ff47/circles/x/a.png` }), null, "no pointing at another object");
  assert.equal(parseEventImage({ ...image, url: image.url.replace("https:", "http:") }), null);
  const local = `http://127.0.0.1:8788/__local-thumbnail/${eventImagePublicKey(image)}`;
  assert.deepEqual(parseEventImage({ ...image, url: local }).url, local, "the local portal's own bucket origin");
  assert.equal(parseEventImage({ ...image, extra: true }), null);
  assert.equal(parseEventImage({ ...image, width: 0 }), null);

  const draft = { schema: "organizer-event-draft/1", event: { id: "pf45", name: "PF45", days: [] }, venue: { assignments: [] }, officialSource: { label: "", url: null } };
  assert.equal(Object.hasOwn(parseOrganizerEventDraft(draft).event, "image"), false, "a draft without a picture stays byte-identical");
  assert.deepEqual(parseOrganizerEventDraft({ ...draft, event: { ...draft.event, image } }).event.image, image);
  assert.equal(parseOrganizerEventDraft({ ...draft, event: { ...draft.event, image: { ...image, sha256: "0".repeat(64) } } }), null);
});

test("a correction replaces or removes the published picture, and naming the same one declares nothing", async () => {
  const { image: published } = await prepareEventImage(file(png(1200, 630)), publicUrl);
  const { image: replacement } = await prepareEventImage(file(png(1600, 900)), publicUrl);
  const baseline = parseOrganizerEventDraft({ schema: "organizer-event-draft/1",
    event: { id: "pf45", name: "PF45", image: published, days: [{ id: "1", label: "第一日", date: "2026-11-07" }] },
    venue: { assignments: [{ venueId: "v", venueSpaceId: "s", areaIds: ["ALL"], mapTemplate: "TAIWAN_GENERIC_V1", areaMode: "none" }] },
    officialSource: { label: "主辦", url: "https://organizer.example/" } });

  assert.equal(normalizeAmendmentSettings(baseline, { image: published }), null);
  assert.deepEqual(normalizeAmendmentSettings(baseline, { image: replacement }), { image: replacement });
  assert.deepEqual(normalizeAmendmentSettings(baseline, { image: null }), { image: null });
  assert.throws(() => normalizeAmendmentSettings(baseline, { image: { ...replacement, url: "https://elsewhere.example/a.png" } }), /活動圖片資料無效/);

  assert.deepEqual(applyAmendmentSettings(baseline, { image: replacement }).event.image, replacement);
  assert.equal(Object.hasOwn(applyAmendmentSettings(baseline, { image: null }).event, "image"), false);
  assert.deepEqual(applyAmendmentSettings(baseline, { name: "PF45 改" }).event.image, published, "other corrections keep the picture");
  assert.deepEqual(amendmentSettingsImpact(baseline, { image: null }), [{ field: "image", before: published, after: null }]);
});

test("a published event names its picture, and only its own page shares it", async () => {
  const definition = JSON.parse(await readFile("fixtures/events/sample/event.json", "utf8"));
  const references = JSON.parse(await readFile("fixtures/events/sample/reference-records.json", "utf8"));
  const image = { url: `${ORIGIN}/event-images/${"a".repeat(64)}.png`, width: 1200, height: 630 };
  const event = parseEventDefinition({ ...definition, image }, references);
  assert.deepEqual(event.image, image);
  assert.equal(Object.hasOwn(parseEventDefinition(definition, references), "image"), false);
  assert.throws(() => parseEventDefinition({ ...definition, image: { ...image, sha256: "x" } }, references), /image/);
  assert.throws(() => parseEventDefinition({ ...definition, image: { ...image, url: "http://thumbs.example/a.png" } }, references), /image/);

  assert.deepEqual(pageMetadata(event).image, image);
  assert.deepEqual(pageMetadata(event, { id: "c-1", name: "甲社" }).image, SHARE_IMAGE, "a circle page keeps the brand card");
  assert.deepEqual(pageMetadata().image, SHARE_IMAGE);
  assert.deepEqual(pageMetadata(parseEventDefinition(definition, references)).image, SHARE_IMAGE, "no picture, the brand card");

  const catalog = JSON.parse(await readFile("fixtures/events/sample/circles.json", "utf8"));
  const pages = discoveryPages(event, catalog);
  const html = pages.get(`/events/${event.id}/`);
  assert.ok(html.includes(`<meta property="og:image" content="${image.url}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`));
  const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(schema.image, [image.url]);
  const circlePage = [...pages.entries()].find(([path]) => path.includes("/circles/"))[1];
  assert.ok(circlePage.includes(`<meta property="og:image" content="${SHARE_IMAGE.url}">`));
});
