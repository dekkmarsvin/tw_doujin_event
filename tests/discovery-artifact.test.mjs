import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "parse5";

const read = (path) => readFile(new URL(`../dist/${path}`, import.meta.url), "utf8");
const nodes = (node) => [node, ...(node.childNodes ?? []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find((attr) => attr.name === name)?.value;

test("built sitemap covers exactly the staged introductions and grouped circles", async () => {
  const stage = JSON.parse(await readFile(new URL("../.event-data-stage.json", import.meta.url), "utf8"));
  const expected = ["https://map.kotoban.top/"];
  for (const { eventId } of stage.events) {
    expected.push(`https://map.kotoban.top/events/${eventId}/`);
    const catalog = JSON.parse(await read(`data/events/${eventId}/circles.json`));
    for (const circle of catalog.circles.filter((circle) => catalog.placements.some((placement) => placement.circleId === circle.id))) {
      expected.push(`https://map.kotoban.top/events/${eventId}/circles/${circle.id}/`);
    }
  }
  const sitemap = await read("sitemap.xml");
  const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(urls, expected);
  for (const url of urls.slice(1)) {
    const html = await read(`${new URL(url).pathname.slice(1)}index.html`);
    const elements = nodes(parse(html));
    assert.equal(elements.filter((node) => attr(node, "rel") === "canonical").length, 1);
    assert.equal(attr(elements.find((node) => attr(node, "rel") === "canonical"), "href"), url);
    assert.equal(attr(elements.find((node) => attr(node, "property") === "og:url"), "content"), url);
    assert.ok(elements.some((node) => node.tagName === "h1"));
    assert.doesNotMatch(html, /type="module"|overrides\.json/);
  }
});

// #361: every introduction is its own search result.
test("every built introduction has its own title and description", async () => {
  const sitemap = await read("sitemap.xml");
  const heads = await Promise.all([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(async ([, url]) => {
    const path = new URL(url).pathname.slice(1);
    const elements = nodes(parse(await read(`${path}index.html`)));
    const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
    return { title: text(elements.find((node) => node.tagName === "title")), description: attr(elements.find((node) => attr(node, "name") === "description"), "content") };
  }));
  assert.equal(new Set(heads.map((head) => head.title)).size, heads.length);
  assert.equal(new Set(heads.map((head) => head.description)).size, heads.length);
});

test("shared shell has a static fallback without conflicting query canonical", async () => {
  const html = await read("index.html");
  const elements = nodes(parse(html));
  assert.equal(elements.filter((node) => attr(node, "name") === "description").length, 1);
  assert.equal(elements.filter((node) => attr(node, "rel") === "canonical").length, 0);
  assert.match(html, /href="\/events\/sample\/"/);
  assert.match(html, /property="og:title"/);
  assert.match(await read("robots.txt"), /Sitemap: https:\/\/map.kotoban.top\/sitemap.xml/);
  const worker = await read("sw.js");
  const manifest = JSON.parse(worker.match(/const PRECACHE_MANIFEST = (\[[^\]]*\]);/)[1]);
  assert.ok(!manifest.some((path) => path.startsWith("/events/")), "discovery must not inflate the offline map precache");
  assert.match(worker, /event\.respondWith\(isReaderNavigation\(url\) \? networkFirstNavigation\(request\) : fetch\(request\)\)/);
});
