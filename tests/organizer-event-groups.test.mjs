import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const { groupOrganizerEvents, latestOrganizerEdition } = await vite.environments.ssr.runner.import("/app/organizer-event-groups.ts");
after(() => vite.close());
const event = (id, eventId, edition, createdAt, updatedAt = createdAt) => ({ id, eventId, edition, createdAt, updatedAt, tentativeName: id, version: 20, role: "owner", status: "draft", workspaceMode: "binder" });
test("groups by event identity, picks newest edition rather than last edited candidate", () => {
  const events = [event("initial", "a", 1, 1, 100), event("amend", "a", 2, 2, 2), event("other", "b", 1, 3)];
  const groups = groupOrganizerEvents(events);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].editions.map(e => e.id), ["amend", "initial"]);
  assert.equal(latestOrganizerEdition(events, "initial"), "amend");
  assert.equal(latestOrganizerEdition(events), "amend");
  assert.equal(latestOrganizerEdition(events, "missing"), null);
});
test("unnamed event identities never merge by matching tentative names", () => {
  const events = [event("first", null, 1, 1), { ...event("second", null, 1, 2), tentativeName: "first" }];
  assert.equal(groupOrganizerEvents(events).length, 2);
  assert.deepEqual(events.map(e => e.id), ["first", "second"]);
});
