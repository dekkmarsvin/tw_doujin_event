import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR test environment is not runnable.");
const { ACTIVE_EVENT, EVENT_DEFINITION_SCHEMA, parseEventDefinition } = await environment.runner.import("/app/event-catalog.ts");
after(async () => vite.close());

test("the active event comes from a versioned validated definition", () => {
  assert.equal(ACTIVE_EVENT.schema, EVENT_DEFINITION_SCHEMA);
  assert.equal(ACTIVE_EVENT.id, "ff47");
  assert.equal(ACTIVE_EVENT.dataLastUpdatedLabel, "2026 年 8 月 11 日");
  assert.equal(ACTIVE_EVENT.organizer.boothListUrls[1].startsWith("https://www.f-2.com.tw/"), true);
});

test("event definitions fail closed on unknown versions and incomplete organizer data", () => {
  assert.throws(() => parseEventDefinition({ schema: "event-definition/999" }), /Unsupported/);
  assert.throws(() => parseEventDefinition({ ...ACTIVE_EVENT, organizer: { ...ACTIVE_EVENT.organizer, boothListUrls: { 9: "https://example.com" } } }), /cover organizer booth lists/);
});
