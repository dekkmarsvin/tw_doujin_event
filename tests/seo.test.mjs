import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer, isRunnableDevEnvironment } from "vite";
import { parse } from "parse5";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite test environment missing.");
const { getEventDefinition } = await environment.runner.import("/app/event-catalog.ts");
const { buildCircleCatalog } = await environment.runner.import("/app/circle-records.ts");
const { pageMetadata, readerLink, eventPath } = await environment.runner.import("/app/seo.ts");
const { discoveryPages, homepageSummary, metadataHtml, sitemapHtml } = await environment.runner.import("/app/static-discovery.ts");
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

const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
const ldJson = (html) => JSON.parse(nodes(parse(html)).find((node) => attr(node, "type") === "application/ld+json").childNodes[0].value);

// #362: an event without aliases keeps every title, line and schema it had.
test("an event without aliases names itself only by its official name", () => {
  assert.equal(event.aliases, undefined);
  assert.equal(pageMetadata(event).title, `${event.name} 攤位地圖與社團查詢｜場刊 Map`);
  assert.ok(pageMetadata(event).description.startsWith(`${event.name}的社團與攤位地圖。`));
  assert.equal(pageMetadata(event, catalog.circles[0], catalog.placements.slice(0, 1)).title, `${catalog.circles[0].name}｜${event.name} 9/1 S01｜場刊 Map`);
  const html = discoveryPages(event, catalog).get("/events/sample/");
  assert.doesNotMatch(html, /別稱|alternateName/);
});

// ADR-0068: aliases are what organizers and readers call the event. They name
// it on its own pages; the homepage list and the map keep the official name.
test("aliases name the event on its pages, the same in text and schema", () => {
  const aliased = { ...event, aliases: ["CH20 百合ONLY", "百合 <Only>"] };
  const metadata = pageMetadata(aliased);
  assert.equal(metadata.title, `${event.name}（CH20 百合ONLY）攤位地圖與社團查詢｜場刊 Map`);
  assert.ok(metadata.description.startsWith(`${event.name}（CH20 百合ONLY、百合 <Only>）的社團與攤位地圖。`));
  const pages = discoveryPages(aliased, catalog);
  const eventPage = pages.get("/events/sample/");
  const line = nodes(parse(eventPage)).find((node) => node.tagName === "p" && text(node).startsWith("別稱："));
  assert.equal(text(line), "別稱：CH20 百合ONLY、百合 <Only>");
  assert.match(eventPage, /別稱：CH20 百合ONLY、百合 &lt;Only&gt;/);
  assert.deepEqual(ldJson(eventPage).alternateName, aliased.aliases);
  assert.equal(ldJson(eventPage).name, event.name);
  const circlePage = pages.get("/events/sample/circles/c-900001/");
  const title = text(nodes(parse(circlePage)).find((node) => node.tagName === "title"));
  assert.equal(title, `${catalog.circles[0].name}｜CH20 百合ONLY 9/1 S01｜場刊 Map`);
  assert.equal(homepageSummary([aliased]), homepageSummary([event]), "the homepage list keeps the official name");
});

const head = (html) => {
  const elements = nodes(parse(html));
  return { title: text(elements.find((node) => node.tagName === "title")), description: attr(elements.find((node) => attr(node, "name") === "description"), "content") };
};
/** What the Reader puts in the head when this circle is selected. */
const readerHead = (definition, payload, circleId) => {
  const records = buildCircleCatalog(payload, undefined, definition).recordsByCircleId.get(circleId);
  const { title, description } = pageMetadata(definition, records[0].circle, records.map((record) => record.placement));
  return { title, description };
};
const placed = (id, circleId, day, boothCode, status = "active") => ({ ...catalog.placements[0], id, circleId, day, area: day === 1 ? "north" : "south", boothCode, status });
const withPlacements = (placements, names = {}) => ({ ...catalog,
  circles: catalog.circles.map((circle) => ({ ...circle, name: names[circle.id] ?? circle.name })), placements });

// #361: a circle page says when and where the circle is, so two same-named
// circles (one per day, as the data records them) never share a title.
test("same-named circles on different days get their own titles, descriptions and directory entries", () => {
  const payload = withPlacements([placed("1-s01", "c-900001", 1, "S01"), placed("2-s02", "c-900002", 2, "S02")],
    { "c-900001": "杏。Xing", "c-900002": "杏。Xing" });
  const pages = discoveryPages(event, payload);
  const first = head(pages.get("/events/sample/circles/c-900001/"));
  const second = head(pages.get("/events/sample/circles/c-900002/"));
  assert.equal(first.title, `杏。Xing｜${event.name} 9/1 S01｜場刊 Map`);
  assert.equal(second.title, `杏。Xing｜${event.name} 9/2 S02｜場刊 Map`);
  assert.ok(first.description.startsWith(`杏。Xing在${event.name}的攤位：2026年9月1日 S01。`));
  assert.notEqual(first.description, second.description);
  const entries = nodes(parse(pages.get("/events/sample/"))).filter((node) => node.tagName === "a" && attr(node, "href").includes("/circles/"))
    .map((node) => [attr(node, "href"), text(node)]);
  assert.deepEqual(entries, [["/events/sample/circles/c-900001/", "杏。Xing（9/1 S01）"], ["/events/sample/circles/c-900002/", "杏。Xing（9/2 S02）"]]);
  assert.deepEqual(readerHead(event, payload, "c-900001"), first);
  assert.deepEqual(readerHead(event, payload, "c-900002"), second);
});

test("a circle moved to another day is titled by where it is now, and the old booth keeps its status words", () => {
  const payload = withPlacements([placed("1-s01", "c-900001", 1, "S01", "moved"), placed("2-s03", "c-900001", 2, "S03"), placed("1-s02", "c-900002", 1, "S02")]);
  const page = head(discoveryPages(event, payload).get("/events/sample/circles/c-900001/"));
  assert.equal(page.title, `北風畫室｜${event.name} 9/2 S03｜場刊 Map`);
  assert.match(page.description, /2026年9月1日 S01（已移動攤位）；2026年9月2日 S03。/);
  assert.deepEqual(readerHead(event, payload, "c-900001"), page);
});

test("a circle with every placement cancelled is titled by its earliest one with its status, at the same address", () => {
  const payload = withPlacements([placed("1-s01", "c-900001", 1, "S01", "cancelled"), placed("2-s01", "c-900001", 2, "S01", "cancelled"), placed("1-s02", "c-900002", 1, "S02")]);
  const html = discoveryPages(event, payload).get("/events/sample/circles/c-900001/");
  const page = head(html);
  assert.equal(page.title, `北風畫室｜${event.name} 9/1 S01 已取消參展｜場刊 Map`);
  assert.match(page.description, /2026年9月1日 S01（已取消參展）；2026年9月2日 S01（已取消參展）。/);
  assert.equal(attr(nodes(parse(html)).find((node) => attr(node, "rel") === "canonical"), "href"), "https://map.kotoban.top/events/sample/circles/c-900001/");
  assert.deepEqual(readerHead(event, payload, "c-900001"), page);
});

test("the earliest placement is the earliest date, even when a corrected day now comes after the next one", () => {
  const corrected = { ...event, days: [{ ...event.days[0], dateLabel: "2026-09-15" }, { ...event.days[1], dateLabel: "2026-09-02" }],
    eventEndsAt: "2026-09-15T23:59:59+08:00" };
  const payload = withPlacements([placed("1-s01", "c-900001", 1, "S01"), placed("2-s03", "c-900001", 2, "S03"), placed("1-s02", "c-900002", 1, "S02")]);
  const page = head(discoveryPages(corrected, payload).get("/events/sample/circles/c-900001/"));
  assert.equal(page.title, `北風畫室｜${event.name} 9/2 S03｜場刊 Map`);
  assert.match(page.description, /的攤位：2026年9月2日 S03；2026年9月15日 S01。/);
  assert.deepEqual(readerHead(corrected, payload, "c-900001"), page);
});

test("dates read in full in summaries and in one format on booth rows, however the event published them", () => {
  const description = pageMetadata(event).description;
  assert.match(description, /2026年9月1日至2日/);
  assert.doesNotMatch(description, /\d{2}\.\d{2}\.\d{2}/, "no two-digit years");
  const iso = { ...event, days: [{ ...event.days[0], dateLabel: "2026-09-01" }, { ...event.days[1], dateLabel: "2026-09-02" }] };
  const rows = (definition) => nodes(parse(discoveryPages(definition, catalog).get("/events/sample/circles/c-900001/")))
    .filter((node) => node.tagName === "p" && text(node).includes("9月")).map(text);
  assert.deepEqual(rows(event), rows(iso));
  assert.match(rows(event)[0], /^9月1日（二）/);
  assert.equal(head(discoveryPages(iso, catalog).get("/events/sample/circles/c-900001/")).title,
    head(discoveryPages(event, catalog).get("/events/sample/circles/c-900001/")).title);
});

// #363: platforms that unfurl a link fetch the card themselves, so its address
// is absolute and the card asks to be shown large.
test("every page's head shares the brand card as a large image", () => {
  const heads = [metadataHtml(pageMetadata(), false), ...discoveryPages(event, catalog).values()];
  for (const html of heads) {
    const elements = nodes(parse(html));
    const content = (key, value) => attr(elements.find((node) => attr(node, key) === value), "content");
    assert.equal(content("property", "og:image"), "https://map.kotoban.top/share-card.png");
    assert.equal(content("property", "og:image:width"), "1200");
    assert.equal(content("property", "og:image:height"), "630");
    assert.equal(content("name", "twitter:card"), "summary_large_image");
  }
});

test("sitemap deduplicates canonical paths and never fabricates lastmod", () => {
  const xml = sitemapHtml(["/", "/events/sample/", "/events/sample/", "/events/a&b/"]);
  assert.equal((xml.match(/<url>/g) ?? []).length, 3);
  assert.match(xml, /a&amp;b/);
  assert.doesNotMatch(xml, /lastmod/);
});
