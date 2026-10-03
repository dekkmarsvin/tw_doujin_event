import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const definition = JSON.parse(await readFile(new URL("../fixtures/events/sample/event.json", import.meta.url), "utf8"));
const references = JSON.parse(await readFile(new URL("../fixtures/events/sample/reference-records.json", import.meta.url), "utf8"));
const multi = structuredClone(definition);
multi.venueAssignments = [
  { venueId: "sample-venue", venueSpaceId: "sample-hall", areaIds: ["north"] },
  { venueId: "sample-venue", venueSpaceId: "south-hall", areaIds: ["south"] },
];
const multiReferences = [...references, { ...references.find(({ schema }) => schema === "venue-space/1"), id: "south-hall", name: "南館" }];
const single = { ...definition, id: "one-day", days: [definition.days[0]], officialData: { ...definition.officialData, boothListUrls: { 1: definition.officialData.boothListUrls[1] } } };
const legacy = { ...definition, id: "legacy" };
const injectedDescriptor = Object.getOwnPropertyDescriptor(globalThis, "__PUBLISHED_EVENTS__");
Object.defineProperty(globalThis, "__PUBLISHED_EVENTS__", { configurable: true, value: [
  { definition: multi, references: multiReferences }, { definition: single, references }, { definition: legacy, references },
] });
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment unavailable.");
const { offlineRequirements, checkOfflineReadiness, prepareOffline } = await environment.runner.import("/app/offline-readiness.ts");
if (injectedDescriptor) Object.defineProperty(globalThis, "__PUBLISHED_EVENTS__", injectedDescriptor);
else delete globalThis.__PUBLISHED_EVENTS__;
after(() => vite.close());

const origin = "https://reader.example";
const workerCache = "event-catalog-current";
const scope = { eventId: "sample", day: 2, venueSpaceId: "south-hall" };
const manifestPath = "/data/events/sample/map-manifest.json";
const mapPath = "/data/events/sample/maps/2/south-hall.json";
const manifest = { schema: "event-map-manifest/1", eventId: "sample", maps: [1, 2].flatMap((day) => ["sample-hall", "south-hall"].map((venueSpaceId) => ({
  periodKey: String(day), venueSpaceId, path: `maps/${day}/${venueSpaceId}.json`,
}))) };
const assets = ["/assets/reader-abc.js", "/assets/reader-def.css", "/assets/shared-ghi.js"];
const required = ["/index.html", ...assets, "/data/events/sample/circles.json", manifestPath, mapPath];

function artifact(body = "", { status = 200, type = "basic", redirected = false, contentType = "application/json" } = {}) {
  const decorate = (response) => {
    Object.defineProperties(response, { type: { value: type }, redirected: { value: redirected } });
    const clone = response.clone.bind(response);
    response.clone = () => decorate(clone());
    return response;
  };
  return decorate(new Response(typeof body === "object" ? JSON.stringify(body) : body, { status, headers: { "content-type": contentType, vary: "Origin" } }));
}

function responseFor(path) {
  if (path === manifestPath) return artifact(manifest);
  if (path === "/index.html") return artifact("<!doctype html><div id='root'></div>", { contentType: "text/html" });
  if (path.endsWith(".css")) return artifact("body {}", { contentType: "text/css; charset=utf-8" });
  if (path.endsWith(".js")) return artifact("export {};", { contentType: "text/javascript; charset=utf-8" });
  return artifact({ eventId: "sample" });
}

function install(t, { entries = { [manifestPath]: artifact(manifest) }, names = [workerCache], fetcher = responseFor, persist = true } = {}) {
  const stores = new Map(names.map((name) => [name, new Map(Object.entries(name === workerCache ? entries : {}))]));
  const requests = [];
  const writes = [];
  const storage = {
    async keys() { return [...stores.keys()]; },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(path, options) {
          assert.deepEqual(options, { ignoreVary: true });
          return store.get(path)?.clone();
        },
        async put(path, response) {
          writes.push({ name, path });
          if (persist) store.set(path, response.clone());
        },
        async delete(path, options) {
          assert.deepEqual(options, { ignoreVary: true });
          return store.delete(path);
        },
      };
    },
  };
  const element = (attributes) => ({ getAttribute: (key) => attributes[key] ?? null });
  const globals = {
    location: { origin },
    document: { baseURI: `${origin}/?event=sample`, querySelectorAll: () => [
      element({ src: assets[0] }), element({ href: assets[1] }), element({ href: `${origin}${assets[2]}` }),
      element({ src: assets[0] }), element({ src: "https://external.example/assets/image.js" }),
      element({ href: "/fonts/geist.css" }), element({ src: "/main.tsx" }),
    ] },
    navigator: { serviceWorker: { controller: { scriptURL: `${origin}/sw.js` } } },
    caches: storage,
    fetch: async (path, options) => {
      requests.push({ path, options });
      return fetcher(path, options);
    },
  };
  for (const [name, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
  return { stores, requests, writes };
}

test("requirements select only the chosen event day/venue, current DOM assets and official data", async (t) => {
  const env = install(t);
  assert.deepEqual(await offlineRequirements(scope), required);
  assert.equal(env.requests.length, 0, "cached manifest can resolve requirements without network");
  assert.ok(required.every((path) => !path.includes("overrides.json")));
  assert.deepEqual((await offlineRequirements({ ...scope, day: 1, venueSpaceId: "sample-hall" })).slice(-1), ["/data/events/sample/maps/1/sample-hall.json"]);
  await assert.rejects(offlineRequirements({ eventId: "sample", day: 2 }), /venue space/);
});

test("a single day/space requires its shared map without probing for a manifest", async (t) => {
  const env = install(t);
  assert.deepEqual(await offlineRequirements({ eventId: "one-day", day: 1 }), ["/index.html", ...assets, "/data/events/one-day/circles.json", "/data/events/one-day/map.json"]);
  assert.equal(env.requests.length, 0);
});

test("a 404 manifest selects the Reader's legacy shared-map fallback", async (t) => {
  install(t, { fetcher: () => artifact("", { status: 404 }) });
  assert.deepEqual((await offlineRequirements({ eventId: "legacy", day: 2 })).slice(-1), ["/data/events/legacy/map.json"]);
});

test("a single-venue offline absent manifest uses the cached shared map and can report ready", async (t) => {
  const scope = { eventId: "legacy", day: 2 };
  const manifestPath = "/data/events/legacy/map-manifest.json";
  const mapPath = "/data/events/legacy/map.json";
  const sharedRequired = ["/index.html", ...assets, "/data/events/legacy/circles.json", mapPath];
  const env = install(t, {
    entries: Object.fromEntries(sharedRequired.map((path) => [path, responseFor(path)])),
    fetcher: () => { throw new TypeError("Offline"); },
  });
  assert.deepEqual(await offlineRequirements(scope), sharedRequired);
  assert.deepEqual(await checkOfflineReadiness(scope), { state: "ready", required: sharedRequired, missing: [] });
  assert.ok(env.requests.every(({ path }) => path === manifestPath));
  env.stores.get(workerCache).delete(mapPath);
  await assert.rejects(offlineRequirements(scope), /Cannot resolve/);
  assert.equal((await checkOfflineReadiness(scope)).state, "missing");
});

test("a single-venue manifest error response requires a reachable shared map to be cached", async (t) => {
  const scope = { eventId: "legacy", day: 2 };
  const manifestPath = "/data/events/legacy/map-manifest.json";
  const mapPath = "/data/events/legacy/map.json";
  const sharedRequired = ["/index.html", ...assets, "/data/events/legacy/circles.json", mapPath];
  install(t, {
    entries: Object.fromEntries(sharedRequired.filter((path) => path !== mapPath).map((path) => [path, responseFor(path)])),
    fetcher: (path) => path === manifestPath ? Response.error() : responseFor(path),
  });
  assert.deepEqual(await offlineRequirements(scope), sharedRequired);
  assert.deepEqual(await checkOfflineReadiness(scope), { state: "missing", required: sharedRequired, missing: [mapPath] });
});

test("multi-venue manifest transport failures cannot select an obsolete shared map", async (t) => {
  let errorResponse = false;
  const env = install(t, {
    entries: Object.fromEntries([...required.filter((path) => path !== manifestPath), "/data/events/sample/map.json"].map((path) => [path, responseFor(path)])),
    fetcher: () => {
      if (errorResponse) return Response.error();
      throw new TypeError("Offline manifest");
    },
  });
  for (const responseError of [false, true]) {
    errorResponse = responseError;
    await assert.rejects(offlineRequirements(scope), /Cannot resolve/);
    assert.deepEqual(await checkOfflineReadiness(scope), { state: "missing", required: required.slice(0, -1), missing: [manifestPath] });
    assert.equal((await prepareOffline(scope)).state, "missing");
  }
  assert.ok(env.requests.every(({ path }) => path === manifestPath));
  assert.equal(env.writes.length, 0);
});

test("readiness checks the sole worker cache and ignores unrelated/legacy caches", async (t) => {
  const env = install(t, { entries: Object.fromEntries(required.map((path) => [path, responseFor(path)])), names: [workerCache, "unrelated", "ff47-catalog-old"] });
  assert.deepEqual(await checkOfflineReadiness(scope), { state: "ready", required, missing: [] });
  env.stores.get(workerCache).delete(mapPath);
  env.stores.get("unrelated").set(mapPath, responseFor(mapPath));
  env.stores.get("ff47-catalog-old").set(mapPath, responseFor(mapPath));
  assert.deepEqual(await checkOfflineReadiness(scope), { state: "missing", required, missing: [mapPath] });
});

test("multiple worker caches require reload even with complete or combined coverage", async (t) => {
  const env = install(t, { entries: Object.fromEntries(required.map((path) => [path, responseFor(path)])), names: [workerCache, "event-catalog-installing"] });
  const expected = { state: "missing", required, missing: required, ambiguousCache: true };
  assert.deepEqual(await checkOfflineReadiness(scope), expected);
  assert.deepEqual(await prepareOffline(scope), { ...expected, failed: required });
  env.stores.get(workerCache).delete(mapPath);
  env.stores.get("event-catalog-installing").set(mapPath, responseFor(mapPath));
  assert.deepEqual(await checkOfflineReadiness(scope), expected);
  assert.deepEqual(await prepareOffline(scope), { ...expected, failed: required });
  assert.equal(env.writes.length, 0);
});

test("a downloaded manifest is still missing until it is stored in the worker cache", async (t) => {
  const env = install(t, { entries: Object.fromEntries(required.filter((path) => path !== manifestPath).map((path) => [path, responseFor(path)])) });
  assert.deepEqual(await checkOfflineReadiness(scope), { state: "missing", required, missing: [manifestPath] });
  assert.equal(env.writes.length, 0);
});

test("prepare reloads only missing resources, stores guarded artifacts and reports progress", async (t) => {
  const env = install(t);
  const progress = [];
  assert.deepEqual(await prepareOffline(scope, (done, total) => progress.push([done, total])), { state: "ready", required, missing: [], failed: [] });
  const missing = required.filter((path) => path !== manifestPath);
  assert.deepEqual(env.requests.map(({ path }) => path), missing);
  assert.ok(env.requests.every(({ options }) => options.cache === "reload"));
  assert.deepEqual(env.writes, missing.map((path) => ({ name: workerCache, path })));
  assert.deepEqual(progress, Array.from({ length: missing.length + 1 }, (_, done) => [done, missing.length]));
});

test("HTML fallbacks, redirects, non-ok and non-basic responses stay missing and fail", async (t) => {
  const rejected = new Map([
    [assets[0], artifact("SPA fallback", { contentType: "text/html" })],
    [assets[1], artifact("SPA fallback", { contentType: "text/html" })],
    [assets[2], artifact("login", { contentType: "text/javascript", redirected: true })],
    ["/data/events/sample/circles.json", artifact("fallback", { contentType: "text/html" })],
    [mapPath, artifact("unavailable", { status: 503 })],
    ["/index.html", artifact("opaque", { contentType: "text/html", type: "opaque" })],
  ]);
  const env = install(t, { fetcher: (path) => rejected.get(path) ?? responseFor(path) });
  const result = await prepareOffline(scope);
  const missing = required.filter((path) => path !== manifestPath);
  assert.deepEqual(result, { state: "missing", required, missing, failed: missing });
  assert.deepEqual(env.writes, []);
});

test("fetch and cache write failures preserve partial success for retry", async (t) => {
  const env = install(t, { fetcher: (path) => {
    if (path === mapPath) throw new Error("Offline");
    return responseFor(path);
  } });
  const open = globalThis.caches.open;
  globalThis.caches.open = async (name) => {
    const cache = await open(name);
    const put = cache.put;
    cache.put = async (path, response) => {
      if (path === assets[0]) throw new Error("Quota exceeded");
      return put(path, response);
    };
    return cache;
  };
  const result = await prepareOffline(scope);
  assert.deepEqual(result.missing, [assets[0], mapPath]);
  assert.deepEqual(result.failed, [assets[0], mapPath]);
  assert.equal(result.state, "missing");
  assert.ok(env.stores.get(workerCache).has(assets[1]));
});

test("an HTML fallback cached by the existing worker still cannot make repair ready", async (t) => {
  const path = assets[0];
  const env = install(t, { entries: Object.fromEntries(required.filter((entry) => entry !== path).map((entry) => [entry, responseFor(entry)])), fetcher: () => {
    const fallback = artifact("SPA fallback", { contentType: "text/html" });
    // The existing worker's cache-first strategy can store this before replying to the page.
    env.stores.get(workerCache).set(path, fallback.clone());
    return fallback;
  } });
  assert.deepEqual(await prepareOffline(scope), { state: "missing", required, missing: [path], failed: [path] });
  assert.equal(env.writes.length, 0);
  assert.ok(env.stores.get(workerCache).has(path), "presence alone is not offline readiness");
});

test("repair evicts a rejected cached script so the worker can fetch its real replacement", async (t) => {
  const path = assets[0];
  const env = install(t, { entries: Object.fromEntries(required.map((entry) => [entry, entry === path
    ? artifact("SPA fallback", { contentType: "text/html" }) : responseFor(entry)])), fetcher: (entry) => {
    // Mirror cache-first: reload by itself cannot get past an existing bad entry.
    return env.stores.get(workerCache).get(entry)?.clone() ?? responseFor(entry);
  } });
  assert.deepEqual(await prepareOffline(scope), { state: "ready", required, missing: [], failed: [] });
  assert.deepEqual(env.requests.map(({ path: entry }) => entry), [path]);
  assert.deepEqual(env.writes, [{ name: workerCache, path }]);
});

test("re-check, not successful put calls, decides the final state", async (t) => {
  const env = install(t, { persist: false });
  const result = await prepareOffline(scope);
  assert.equal(env.writes.length, required.length - 1);
  assert.equal(result.state, "missing");
  assert.deepEqual(result.failed, result.missing);
});

test("a repaired manifest reveals and prepares the previously unknown scoped map", async (t) => {
  let manifestRequests = 0;
  const env = install(t, { entries: {}, fetcher: (path) => {
    if (path === manifestPath && ++manifestRequests === 1) throw new Error("Temporary manifest failure");
    if (path === "/data/events/sample/map.json") return artifact("", { status: 404 });
    return responseFor(path);
  } });
  const result = await prepareOffline(scope);
  assert.deepEqual(result, { state: "ready", required, missing: [], failed: [] });
  assert.ok(env.writes.some(({ path }) => path === manifestPath));
  assert.ok(env.writes.some(({ path }) => path === mapPath));
});

test("unresolvable manifests cannot certify a partial requirement list as ready", async (t) => {
  install(t, { entries: { [manifestPath]: artifact({ ...manifest, maps: manifest.maps.filter((entry) => entry.path !== "maps/2/south-hall.json") }) }, fetcher: () => artifact("", { status: 503 }) });
  await assert.rejects(offlineRequirements(scope), /Cannot resolve/);
  const result = await prepareOffline(scope);
  assert.equal(result.state, "missing");
  assert.ok(result.missing.includes(manifestPath));
  assert.ok(result.failed.includes(manifestPath));
});

test("unsupported environments make no requests and do not report readiness", async (t) => {
  const env = install(t);
  for (const unavailable of ["caches", "controller", "serviceWorker"]) {
    globalThis.caches = unavailable === "caches" ? undefined : { keys: async () => [workerCache] };
    globalThis.navigator = unavailable === "serviceWorker" ? {} : { serviceWorker: { controller: unavailable === "controller" ? null : {} } };
    assert.deepEqual(await checkOfflineReadiness(scope), { state: "unsupported", required: [], missing: [] });
    assert.deepEqual(await prepareOffline(scope), { state: "unsupported", required: [], missing: [], failed: [] });
  }
  assert.equal(env.requests.length, 0);
  assert.equal(env.writes.length, 0);
});

test("absent or ambiguous worker caches never cause repair to write an arbitrary cache", async (t) => {
  const env = install(t, { names: [workerCache, "event-catalog-installing"] });
  const result = await prepareOffline(scope);
  assert.equal(result.state, "missing");
  assert.deepEqual(result.failed, result.missing);
  assert.equal(env.writes.length, 0);
  env.stores.clear();
  const absent = await prepareOffline(scope);
  assert.equal(absent.state, "missing");
  assert.deepEqual(absent.failed, absent.missing);
  assert.equal(env.stores.size, 0);
});
