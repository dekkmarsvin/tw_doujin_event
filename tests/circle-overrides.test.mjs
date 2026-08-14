import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const records = await environment.runner.import("/app/circle-records.ts");
const overrides = await environment.runner.import("/app/circle-overrides.ts");
const messages = await environment.runner.import("/app/circle-override-messages.ts");
after(() => vite.close());

const payload = JSON.parse(await readFile(new URL("../public/data/events/ff47/circles.json", import.meta.url), "utf8"));
const base = records.buildCircleCatalog(payload);

/** A circle that actually holds placements, so detaching would be observable. */
const placed = base.circles.find((circle) => (base.recordsByCircleId.get(circle.id)?.length ?? 0) > 1);
assert.ok(placed, "fixture needs a circle with more than one placement");

function envelope(list) {
  return { schema: "circle-overrides/1", eventId: "ff47", generatedAt: "2026-08-13T00:00:00.000Z", revision: 1, overrides: list };
}

function withFields(circleId, fields) {
  return envelope([{ circleId, updatedAt: "2026-08-13T00:00:00.000Z", fields }]);
}

test("a circle cannot author its own name", () => {
  // The name keys booth matching, the thumbnail index and the circle id hash.
  // Refused outright rather than accepted-and-ignored, so a client sending one
  // learns the field is not authorable.
  assert.equal(overrides.isCircleOverrideFields({ name: "完全不同的名字" }), false);
  assert.equal(overrides.parseCircleOverridesPayload(withFields(placed.id, { name: "x" })).overrides.length, 0);

  // A payload mixing an authorable field with the name is refused whole, not
  // partially applied.
  assert.equal(overrides.isCircleOverrideFields({ saleInfo: "有效", name: "x" }), false);
});

test("an override never moves a circle off its booth placements", () => {
  // The booth-matching indexes are built from the reviewed sources. This pins
  // that the merge seam stays downstream of them: whatever a circle writes, the
  // placement rows are organizer data and must come through byte-identical.
  const edited = records.buildCircleCatalog(payload, withFields(placed.id, {
    saleInfo: "新刊 300 元", referencedWorks: ["完全不同的作品"], pen: "另一個筆名",
  }));

  assert.equal(edited.records.length, base.records.length);
  assert.equal(edited.placements.length, base.placements.length);
  assert.equal(edited.circles.length, base.circles.length);
  assert.equal(edited.recordsByCircleId.get(placed.id).length, base.recordsByCircleId.get(placed.id).length);
  assert.equal(edited.circlesById.get(placed.id).name, base.circlesById.get(placed.id).name, "the name is not authorable");

  assert.deepEqual(
    edited.recordsByCircleId.get(placed.id).map((record) => record.placement),
    base.recordsByCircleId.get(placed.id).map((record) => record.placement),
  );
});

test("an absent overlay produces exactly the reviewed catalog", () => {
  const withEmpty = records.buildCircleCatalog(payload, envelope([]));
  assert.equal(withEmpty.records.length, base.records.length);
  assert.deepEqual(withEmpty.records[0], base.records[0]);
  assert.deepEqual(records.buildCircleCatalog(payload, undefined).records[0], base.records[0]);
});

test("circle-authored content is labelled as self-reported, never as organizer data", () => {
  const edited = records.buildCircleCatalog(payload, withFields(placed.id, { saleInfo: "新刊 300 元" }));
  const circle = edited.circlesById.get(placed.id);

  const self = circle.sources.find((source) => source.provider === "社團本人");
  assert.ok(self, "an override must add its own provenance entry");
  assert.equal(self.contentType, "circle");
  assert.equal(self.status, "unverified");
  assert.equal(self.url, "", "self-reported content has no external page to link");
  assert.equal(circle.updatedAt, "2026-08-13T00:00:00.000Z");

  // The organizer source is still present and still first.
  assert.equal(edited.recordsByCircleId.get(placed.id)[0].sources[0].provider, "開拓動漫");
  assert.equal(base.circlesById.get(placed.id).sources.some((source) => source.provider === "社團本人"), false);
});

test("edited text flows into the derived read model and becomes searchable", () => {
  const edited = records.buildCircleCatalog(payload, withFields(placed.id, {
    saleInfo: "限定壓克力吊飾",
    referencedWorks: ["蔚藍檔案"],
    specialTags: ["新刊"],
  }));
  const circle = edited.circlesById.get(placed.id);

  assert.equal(circle.saleInfo, "限定壓克力吊飾");
  assert.equal(circle.description, "限定壓克力吊飾");
  assert.equal(circle.work, "蔚藍檔案");
  assert.ok(circle.categories.includes("蔚藍檔案"));
  assert.ok(circle.categories.includes("新刊"));

  const record = edited.recordsByCircleId.get(placed.id)[0];
  assert.ok(records.circleSearchText(record).includes("限定壓克力吊飾"));
});

test("an override replaces a list wholesale instead of merging it", () => {
  const edited = records.buildCircleCatalog(payload, withFields(placed.id, { specialTags: ["只剩這個"] }));
  assert.deepEqual(edited.circlesById.get(placed.id).specialTags, ["只剩這個"]);
});

test("one malformed entry is dropped without discarding the rest", () => {
  const parsed = overrides.parseCircleOverridesPayload(envelope([
    { circleId: placed.id, updatedAt: "2026-08-13T00:00:00.000Z", fields: { saleInfo: "有效" } },
    { circleId: "ff47-broken", updatedAt: "2026-08-13T00:00:00.000Z", fields: { saleInfo: 42 } },
  ]));
  assert.equal(parsed.overrides.length, 1);
  assert.equal(parsed.overrides[0].circleId, placed.id);
});

test("rejects a malformed envelope outright", () => {
  assert.equal(overrides.parseCircleOverridesPayload(null), null);
  assert.equal(overrides.parseCircleOverridesPayload({ ...envelope([]), schema: "circle-overrides/2" }), null);
  assert.equal(overrides.parseCircleOverridesPayload({ ...envelope([]), revision: "1" }), null);
  assert.equal(overrides.parseCircleOverridesPayload({ ...envelope([]), overrides: {} }), null);
});

test("refuses fields the circle may not author", () => {
  // Placements and provenance are organizer authority; accepting them would let
  // a circle relocate itself or forge official attribution.
  assert.equal(overrides.isCircleOverrideFields({ placements: { 1: ["A01"] } }), false);
  assert.equal(overrides.isCircleOverrideFields({ sources: [] }), false);
  assert.equal(overrides.isCircleOverrideFields({ id: "ff47-other" }), false);
  assert.equal(overrides.isCircleOverrideFields({ sourceRow: 12 }), false);
  assert.equal(overrides.isCircleOverrideFields({ name: "改名" }), false);
});

test("enforces length caps so one circle cannot bloat every reader's download", () => {
  const { pen, saleInfo, listItems, listItemLength, links, serializedFields } = overrides.OVERRIDE_LIMITS;
  assert.equal(overrides.isCircleOverrideFields({ pen: "x".repeat(pen) }), true);
  assert.equal(overrides.isCircleOverrideFields({ pen: "x".repeat(pen + 1) }), false);
  assert.equal(overrides.isCircleOverrideFields({ saleInfo: "x".repeat(saleInfo + 1) }), false);
  assert.equal(overrides.isCircleOverrideFields({ specialTags: Array(listItems + 1).fill("t") }), false);
  assert.equal(overrides.isCircleOverrideFields({ specialTags: ["x".repeat(listItemLength + 1)] }), false);
  assert.equal(overrides.isCircleOverrideFields({
    links: Array(links + 1).fill({ provider: "X", kind: "social", url: "https://example.com/a" }),
  }), false);
  assert.ok(JSON.stringify({ saleInfo: "x".repeat(saleInfo) }).length < serializedFields);
});

test("only https links and allowlisted image hosts are accepted", () => {
  const link = (url) => overrides.isCircleOverrideFields({ links: [{ provider: "官方網站", kind: "website", url }] });
  assert.equal(link("https://example.com/a"), true);
  assert.equal(link("http://example.com/a"), false);
  assert.equal(link("javascript:alert(1)"), false);
  assert.equal(link("data:text/html,hi"), false);
  assert.equal(link("not a url"), false);

  const thumb = (url) => overrides.isCircleOverrideFields({
    thumbnail: { url, sourceUrl: "https://drive.google.com/file/d/x", provider: "Google Drive" },
  });
  assert.equal(thumb("https://drive.google.com/thumbnail?id=x"), true);
  // An arbitrary host would fire from every reader's browser, logging their IP.
  assert.equal(thumb("https://tracker.example.com/pixel.png"), false);
  assert.equal(thumb("http://drive.google.com/thumbnail?id=x"), false);
});

test("rejects a link kind outside the catalog vocabulary", () => {
  assert.equal(overrides.isCircleOverrideFields({
    links: [{ provider: "X", kind: "official", url: "https://example.com/a" }],
  }), false);
});

/**
 * The editor blocks saving whenever it can name a problem, so its idea of valid
 * has to match the validator the write route runs. Stricter, and an author is
 * told to fix a field the server would have accepted. Looser, and they get the
 * shared 400 with no clue which row caused it — the exact failure the per-field
 * messages exist to prevent. Compared directly rather than restating either rule.
 */
const ALLOWED_HOST = overrides.THUMBNAIL_HOST_ALLOWLIST[0];
const URL_CASES = [
  "https://example.com/circle",
  `https://${ALLOWED_HOST}/file/abc`,
  "http://example.com/insecure",
  "javascript:alert(1)",
  "data:text/html,hi",
  "example.com/no-protocol",
  "",
  "   ",
];

test("the editor accepts a link URL exactly when the validator does", () => {
  for (const url of URL_CASES) {
    assert.equal(
      messages.linkUrlProblem(url) === "",
      overrides.isCircleOverrideFields({ links: [{ provider: "p", kind: "social", url }] }),
      `disagreement on ${JSON.stringify(url)}`,
    );
  }
});

test("the editor accepts a thumbnail URL exactly when the validator does", () => {
  for (const url of [...URL_CASES, "https://not-on-the-allowlist.example/img.png"]) {
    assert.equal(
      messages.thumbnailUrlProblem(url) === "",
      overrides.isCircleOverrideFields({ thumbnail: { url, sourceUrl: "https://example.com/s", provider: "p" } }),
      `disagreement on ${JSON.stringify(url)}`,
    );
  }
});

test("an off-allowlist thumbnail host is refused with the usable hosts named", () => {
  const problem = messages.thumbnailUrlProblem("https://not-on-the-allowlist.example/img.png");
  // "Rejected" alone leaves the author guessing which hosts would work.
  assert.match(problem, /允許清單/);
  assert.ok(problem.includes(ALLOWED_HOST), "the message should name at least one usable host");
});

test("an empty URL reads as missing rather than malformed", () => {
  assert.match(messages.linkUrlProblem(""), /請填寫/);
  assert.match(messages.thumbnailUrlProblem("   "), /請填寫/);
});
