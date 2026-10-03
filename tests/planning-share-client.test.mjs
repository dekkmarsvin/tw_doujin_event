import assert from "node:assert/strict";
import test, { after, afterEach, mock } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { createShortLink, readShortLink } = await environment.runner.import("/app/planning-share-client.ts");
after(() => vite.close());
afterEach(() => mock.restoreAll());

const shareId = "A".repeat(22);
const snapshot = { version: 1, eventId: "sample", items: [{ circleId: "c-2", day: 2 }, { circleId: "c-1", day: 1 }] };
const created = { shareId, url: `https://map.example.test/s/${shareId}`, expiresAt: Date.parse("2026-11-01T00:00:00Z") };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const chineseError = value => {
  assert.equal(typeof value.error, "string");
  assert.match(value.error, /[\u3400-\u9fff]/u);
};

test("create sends the snapshot as JSON and returns the backend's 201 fields", async () => {
  const fetch = mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/shares");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), snapshot);
    return response(created, 201);
  });
  assert.deepEqual(await createShortLink(snapshot), { ok: true, ...created });
  assert.equal(fetch.mock.callCount(), 1);
});

for (const [status, error] of [[400, "分享清單格式無效。"], [429, "建立分享清單太頻繁，請稍後再試。"]]) {
  test(`create preserves the ${status} status and server message`, async () => {
    mock.method(globalThis, "fetch", async () => response({ error }, status));
    assert.deepEqual(await createShortLink(snapshot), { ok: false, status, error });
  });
}

test("create returns status zero with a Chinese error on network failure", async () => {
  mock.method(globalThis, "fetch", async () => { throw new TypeError("Network failed"); });
  const result = await createShortLink(snapshot);
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  chineseError(result);
});

test("create handles malformed success and non-JSON server errors without throwing", async () => {
  const fetch = mock.method(globalThis, "fetch");
  for (const reply of [response({ ...created, expiresAt: "invalid" }, 201), new Response("broken", { status: 201 }), new Response("unavailable", { status: 503 })]) {
    fetch.mock.mockImplementation(async () => reply);
    const result = await createShortLink(snapshot);
    assert.equal(result.ok, false);
    assert.equal(result.status, reply.status);
    chineseError(result);
  }
});

test("read requests the ID and returns the validated snapshot and expiry on 200", async () => {
  const fetch = mock.method(globalThis, "fetch", async url => {
    assert.equal(url, `/api/shares/${shareId}`);
    return response({ snapshot, expiresAt: created.expiresAt });
  });
  assert.deepEqual(await readShortLink(shareId), { kind: "ok", snapshot, expiresAt: created.expiresAt });
  assert.equal(fetch.mock.callCount(), 1);
});

test("read returns missing on 404", async () => {
  mock.method(globalThis, "fetch", async () => response({ error: "找不到分享清單。" }, 404));
  assert.deepEqual(await readShortLink(shareId), { kind: "missing" });
});

test("read returns expired and the event ID on 410, or null if unavailable", async () => {
  const fetch = mock.method(globalThis, "fetch");
  for (const eventId of ["sample", null, undefined, 42]) {
    fetch.mock.mockImplementation(async () => response({ error: "這份清單已過期。", eventId }, 410));
    assert.deepEqual(await readShortLink(shareId), { kind: "expired", eventId: typeof eventId === "string" ? eventId : null });
  }
});

test("malformed IDs short-circuit without a fetch, matching the backend's canonical ID shape", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected request"); });
  for (const id of ["", "1", "../secret", "A".repeat(21), "A".repeat(23), "B".repeat(22), `${shareId}\n`, "!".repeat(22)]) {
    assert.deepEqual(await readShortLink(id), { kind: "missing" });
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("read rejects malformed responses and snapshots with private fields, invalid days or unpublished events", async () => {
  const fetch = mock.method(globalThis, "fetch");
  const invalid = [
    null, {}, { snapshot, expiresAt: "invalid" },
    { snapshot: { ...snapshot, memo: "PRIVATE" }, expiresAt: created.expiresAt },
    { snapshot: { ...snapshot, items: [{ circleId: "c-1", day: 1, budget: 100 }] }, expiresAt: created.expiresAt },
    { snapshot: { ...snapshot, items: [{ circleId: "c-1", day: null }] }, expiresAt: created.expiresAt },
    { snapshot: { ...snapshot, items: [snapshot.items[0], snapshot.items[0]] }, expiresAt: created.expiresAt },
    { snapshot: { ...snapshot, eventId: "sample-two" }, expiresAt: created.expiresAt },
  ];
  for (const value of invalid) {
    fetch.mock.mockImplementation(async () => response(value));
    const result = await readShortLink(shareId);
    assert.equal(result.kind, "error");
    assert.equal("snapshot" in result, false);
    chineseError(result);
  }
  fetch.mock.mockImplementation(async () => new Response("not JSON"));
  const malformedJson = await readShortLink(shareId);
  assert.equal(malformedJson.kind, "error");
  chineseError(malformedJson);
});

test("read preserves other server errors and returns a Chinese error on network failure", async () => {
  const error = "服務暫時無法使用。";
  const fetch = mock.method(globalThis, "fetch", async () => response({ error }, 503));
  assert.deepEqual(await readShortLink(shareId), { kind: "error", error });
  fetch.mock.mockImplementation(async () => { throw new TypeError("Network failed"); });
  const result = await readShortLink(shareId);
  assert.equal(result.kind, "error");
  chineseError(result);
});
