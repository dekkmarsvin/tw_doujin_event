import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { eventFileResponse, eventIndexResponse, readEventJson } = await environment.runner.import("/functions/_event-data.ts");
const { withPublishedEvents } = await environment.runner.import("/functions/_published-events-html.ts");
const { discoveryResponse, sitemapResponse } = await environment.runner.import("/functions/_discovery.ts");
after(() => vite.close());

const fixture = async (file) => JSON.parse(await readFile(new URL(`../fixtures/events/sample/${file}`, import.meta.url), "utf8"));
const [definition, references, circles, map] = await Promise.all(["event.json", "reference-records.json", "circles.json", "map.json"].map(fixture));

/** An R2 bucket holding one published version of the sample event. */
function bucket(version = "20261122000000", extra = {}) {
  const objects = new Map(Object.entries({
    "index.json": { schema: "event-index/1", events: [{ eventId: "sample", version, files: ["circles.json", "event.json", "map.json", "reference-records.json"], definition, references }] },
    [`events/sample/${version}/circles.json`]: circles,
    [`events/sample/${version}/event.json`]: definition,
    [`events/sample/${version}/map.json`]: map,
    [`events/sample/${version}/reference-records.json`]: references,
    ...extra,
  }).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    objects,
    async get(key) {
      if (!objects.has(key)) return null;
      const text = objects.get(key);
      return { body: new Response(text).body, httpEtag: `"${key}"`, text: async () => text };
    },
  };
}

const assets = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/discovery-assets.json") return Response.json({ circlePageAssets: '<script type="module" src="/assets/circle-page.js"></script>', pageAssets: '<script type="module" src="/assets/page.js"></script>' });
    if (path === "/404.html") return new Response("<!doctype html><title>404</title>", { headers: { "content-type": "text/html" } });
    return new Response("missing", { status: 404 });
  },
};

test("readers get the current version's files, and only the files it lists", async () => {
  const env = { EVENT_DATA: bucket() };
  const request = (path, headers) => new Request(`https://example.com${path}`, { headers });
  const file = await eventFileResponse(env, request("/data/events/sample/circles.json"), "sample", "circles.json");
  assert.equal(file.status, 200);
  assert.deepEqual(await file.json(), circles);
  assert.match(file.headers.get("content-type"), /application\/json/);
  const etag = file.headers.get("etag");
  assert.equal((await eventFileResponse(env, request("/x", { "if-none-match": etag }), "sample", "circles.json")).status, 304);
  for (const [eventId, path] of [["sample", "secret.json"], ["other", "circles.json"], ["sample", "../index.json"], ["Sample", "circles.json"]]) {
    assert.equal((await eventFileResponse(env, request("/x"), eventId, path)).status, 404, `${eventId}/${path}`);
  }
  const index = await eventIndexResponse(env, request("/data/events/index.json"));
  assert.equal((await index.json()).events[0].eventId, "sample");
});

test("a new version takes over as soon as the index names it", async () => {
  const env = { EVENT_DATA: bucket("20261122000000") };
  const renamed = { ...circles, circles: circles.circles.map((circle) => ({ ...circle, name: `${circle.name}（新）` })) };
  env.EVENT_DATA.objects.set("events/sample/20261123000000/circles.json", JSON.stringify(renamed));
  assert.deepEqual(await readEventJson(env, "sample", "circles.json"), circles);
  const index = JSON.parse(env.EVENT_DATA.objects.get("index.json"));
  index.events[0].version = "20261123000000";
  env.EVENT_DATA.objects.set("index.json", JSON.stringify(index));
  assert.deepEqual(await readEventJson(env, "sample", "circles.json"), renamed);
  assert.equal(await readEventJson(env, "nope", "circles.json"), null);
});

test("every HTML page carries the published events as data, and the homepage its summary", async () => {
  const env = { EVENT_DATA: bucket() };
  const page = () => new Response('<html><head><title>x</title></head><body><div id="root"></div><script>untrusted()</script></body></html>', { headers: { "content-type": "text/html; charset=utf-8", "content-length": "1" } });
  const home = await (await withPublishedEvents(env, "/", page())).text();
  const block = home.match(/<script type="application\/json" id="published-events">(.*?)<\/script><\/head>/)?.[1];
  assert.ok(block, "the data block closes the head");
  assert.deepEqual(JSON.parse(block), [{ definition, references }]);
  assert.match(home, /<div id="root"><header[\s\S]*範例創作市集[\s\S]*<\/main><\/div>/);
  const portal = await withPublishedEvents(env, "/circle", page());
  assert.equal(portal.headers.get("content-length"), null);
  const text = await portal.text();
  assert.ok(text.includes('id="published-events"'));
  assert.ok(text.includes('<div id="root"></div>'), "only the homepage gets the summary");
  const json = new Response("{}", { headers: { "content-type": "application/json" } });
  assert.equal(await withPublishedEvents(env, "/", json), json);
});

test("event names cannot close the data block", async () => {
  const hostile = { ...definition, name: "</script><script>alert(1)</script>" };
  const env = { EVENT_DATA: bucket() };
  const index = JSON.parse(env.EVENT_DATA.objects.get("index.json"));
  index.events[0].definition = hostile;
  env.EVENT_DATA.objects.set("index.json", JSON.stringify(index));
  const text = await (await withPublishedEvents(env, "/circle", new Response("<head></head><script src=\"/a.js\"></script>", { headers: { "content-type": "text/html" } }))).text();
  assert.equal(text.match(/<\/script>/g).length, 2, "only the data block and the page script close");
  assert.ok(!text.includes("<script>alert"));
});

test("without a published index, pages say the data is unavailable instead of serving an empty site", async () => {
  const env = { EVENT_DATA: { get: async () => null } };
  const response = await withPublishedEvents(env, "/", new Response("<head></head><script></script>", { headers: { "content-type": "text/html" } }));
  assert.equal(response.status, 503);
  assert.match(await response.text(), /暫時無法載入活動資料/);
});

test("event and circle introductions and the sitemap are built from the published version", async () => {
  const env = { EVENT_DATA: bucket(), ASSETS: assets };
  const get = (path) => discoveryResponse(env, new Request(`https://example.com${path}`));
  const eventPage = await get("/events/sample/");
  assert.equal(eventPage.status, 200);
  assert.match(await eventPage.text(), /範例創作市集/);
  const circleId = circles.circles[0].id;
  const circlePage = await (await get(`/events/sample/circles/${circleId}/`)).text();
  assert.ok(circlePage.includes(circles.circles[0].name));
  assert.ok(circlePage.includes("/assets/circle-page.js"));
  assert.equal((await get(`/events/sample/circles/${circleId}/index.html`)).status, 200);
  const redirect = await get("/events/sample");
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "https://example.com/events/sample/");
  assert.equal((await get("/events/sample/circles/unknown/")).status, 404);
  assert.equal((await get("/events/unpublished/")).status, 404);
  const sitemap = await (await sitemapResponse(env, new Request("https://example.com/sitemap.xml"))).text();
  for (const path of ["/", "/events/sample/", `/events/sample/circles/${circleId}/`, "/portal/"]) assert.ok(sitemap.includes(`https://map.kotoban.top${path}</loc>`), path);
});
