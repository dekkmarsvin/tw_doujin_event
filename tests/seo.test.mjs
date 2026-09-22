import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer, isRunnableDevEnvironment } from "vite";
import { parse } from "parse5";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite test environment missing.");
const { getEventDefinition } = await environment.runner.import("/app/event-catalog.ts");
const { pageMetadata, readerLink, eventPath } = await environment.runner.import("/app/seo.ts");
const { discoveryPages, sitemapHtml } = await environment.runner.import("/app/static-discovery.ts");
after(() => vite.close());
const event = getEventDefinition("sample");
const catalog = JSON.parse(await readFile(new URL("../fixtures/events/sample/circles.json", import.meta.url), "utf8"));
const nodes = (node) => [node, ...(node.childNodes ?? []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find((attr) => attr.name === name)?.value;

test("metadata identifies events and circles with static canonical URLs", () => {
  assert.equal(pageMetadata().canonical, "https://map.kotoban.top/");
  const metadata = pageMetadata(event);
  assert.ok(metadata.title.includes(event.name));
  assert.ok(metadata.description.includes(event.venue));
  assert.equal(metadata.canonical, "https://map.kotoban.top/events/sample/");
  assert.equal(pageMetadata(event, catalog.circles[0]).canonical, "https://map.kotoban.top/events/sample/circles/c-900001/");
  assert.notEqual(metadata.title, pageMetadata(getEventDefinition("sample-two")).title);
  assert.equal(eventPath("a/b?x"), "/events/a%2Fb%3Fx/");
  assert.throws(() => eventPath(".."));
});

test("one circle page aggregates all its days and preserves exact map destinations", () => {
  const pages = discoveryPages(event, catalog);
  assert.equal(pages.size, 3);
  const html = pages.get("/events/sample/circles/c-900001/");
  const links = nodes(parse(html)).filter((node) => node.tagName === "a").map((node) => attr(node, "href"));
  const destinations = links.filter((href) => href.startsWith("/?"));
  assert.equal(destinations.length, 2);
  assert.deepEqual(destinations.map((href) => new URL(href, "https://example.test").searchParams.get("day")), ["1", "2"]);
  assert.ok(destinations.every((href) => new URL(href, "https://example.test").searchParams.get("selectedCircle") === "c-900001"));
  assert.equal(new URL(readerLink(event, catalog.placements[0]), "https://example.test").searchParams.get("venueSpaceId"), event.venueAssignments[0].venueSpaceId);
});

test("directory exposes every circle beyond the Reader's first 80 results", () => {
  const many = structuredClone(catalog);
  many.circles = Array.from({ length: 101 }, (_, index) => ({ id: `c-${index}`, name: `社團 ${index}` }));
  many.placements = many.circles.map((circle, index) => ({ ...catalog.placements[0], id: `p-${index}`, circleId: circle.id }));
  const pages = discoveryPages(event, many);
  const links = nodes(parse(pages.get("/events/sample/"))).filter((node) => node.tagName === "a" && attr(node, "href").includes("/circles/"));
  assert.equal(links.length, 101);
  assert.equal(pages.size, 102);
});

test("static output escapes untrusted names and omits overlay-shaped data", () => {
  const changed = structuredClone(catalog);
  changed.circles[0].name = '<img src=x onerror="alert(1)"> & </script>';
  changed.circles[0].description = "PRIVATE_OVERLAY_SENTINEL";
  changed.circles[0].media = [{ url: "https://private.test/image.jpg" }];
  changed.placements[0].status = "cancelled";
  const output = [...discoveryPages({ ...event, name: '</script><img src=x>' }, changed).values()].join("");
  assert.doesNotMatch(output, /<img|PRIVATE_OVERLAY_SENTINEL|private\.test/);
  assert.match(output, /已取消參展/);
  const scripts = nodes(parse(output)).filter((node) => node.tagName === "script");
  for (const script of scripts) assert.doesNotThrow(() => JSON.parse(script.childNodes[0].value));
  assert.throws(() => discoveryPages(event, { ...catalog, eventId: "other" }));
});

test("schema uses actual event days without fabricating an address or opening time", () => {
  const html = discoveryPages(event, catalog).get("/events/sample/");
  const script = nodes(parse(html)).find((node) => attr(node, "type") === "application/ld+json");
  const schema = JSON.parse(script.childNodes[0].value);
  assert.equal(schema["@type"], "Event");
  assert.match(schema.startDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(schema.location[0].name, event.venue);
  assert.equal(schema.location[0].address, undefined);
  const undated = { ...event, days: [{ ...event.days[0], dateLabel: "待確認" }] };
  assert.doesNotMatch(discoveryPages(undated, catalog).get("/events/sample/"), /application\/ld\+json/);
});

test("sitemap deduplicates canonical paths and never fabricates lastmod", () => {
  const xml = sitemapHtml(["/", "/events/sample/", "/events/sample/", "/events/a&b/"]);
  assert.equal((xml.match(/<url>/g) ?? []).length, 3);
  assert.match(xml, /a&amp;b/);
  assert.doesNotMatch(xml, /lastmod/);
});
