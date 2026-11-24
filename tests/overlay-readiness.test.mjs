import assert from "node:assert/strict";
import test from "node:test";
import { verifyOverlayReadiness } from "../scripts/overlay-readiness.mjs";

const document = { schema: "circle-overrides/1", eventId: "ff47", revision: 10, overrides: [] };
function ready(payload = document) {
  return Response.json(payload);
}

test("deployment readiness verifies two live reads with preview access and no conditional cache", async () => {
  const calls = [];
  await verifyOverlayReadiness("https://example.pages.dev", "ff47", {
    headers: { "cf-access-client-id": "test-id" },
    fetchImpl: async (url, init) => { calls.push({ url, init }); return ready(); },
  });
  assert.equal(calls.length, 2);
  for (const { url, init } of calls) {
    assert.equal(String(url), "https://example.pages.dev/data/events/ff47/overrides.json");
    assert.equal(init.headers["cf-access-client-id"], "test-id");
    assert.equal(init.headers["cache-control"], "no-cache");
    assert.equal(init.redirect, "error");
    assert.equal(init.body, undefined);
  }
});

test("readiness rejects a failed read, wrong event and false empty success", async () => {
  for (const response of [
    new Response(null, { status: 503 }),
    ready({ ...document, eventId: "another" }),
    ready({ error: "unavailable" }),
  ]) {
    await assert.rejects(verifyOverlayReadiness("https://example.pages.dev", "ff47", { fetchImpl: async () => response }), /readiness/);
  }
  let calls = 0;
  await assert.rejects(verifyOverlayReadiness("https://example.pages.dev", "ff47", {
    fetchImpl: async () => ++calls === 1 ? ready() : new Response(null, { status: 500 }),
  }), /500/);
  assert.equal(calls, 2);
});
