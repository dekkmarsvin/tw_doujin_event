import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";
import { amendmentFixture, gitReaderFixture, hash } from "./support/organizer-amendment-fixture.mjs";
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
if (!isRunnableDevEnvironment(vite.environments.ssr)) throw new Error("Vite SSR unavailable");
const api = await vite.environments.ssr.runner.import("/app/organizer-amendment-baseline.ts");
after(() => vite.close());
const fixture = () => amendmentFixture(vite.environments.ssr.runner);
const loader = (data, remote = gitReaderFixture(data)) => api.createPublishedAmendmentBaselineLoader({ tokenProvider: { getToken: async () => "test-token" },
  fetch: remote.fetch, published: async () => data.published });

test("baseline is bound to published job, approved bytes, pinned Git files and actual Reader catalog", async () => {
  const data = await fixture();
  const remote = gitReaderFixture(data);
  const baseline = await loader(data, remote)(data.source);
  assert.deepEqual(baseline, data.baseline);
  assert.ok(remote.reads.some((path) => path.includes(data.source.mainCommit)));
  assert.ok(remote.reads.some((path) => path.includes(data.source.dataCommit)));
  assert.equal("snapshotJson" in baseline.source, false, "do not recursively embed prior baselines");
  const json = JSON.stringify(baseline);
  assert.deepEqual(await api.readOrganizerAmendmentBaseline(json, hash(json)), baseline);
  await assert.rejects(api.readOrganizerAmendmentBaseline(json + " ", hash(json)), /完整性/);
  const plan = api.planOrganizerAmendmentCandidate(baseline, [{ kind: "released", sources: ["1:S02"], circleName: "新社" }], () => "2026-09-15");
  assert.equal(plan.rows[1].areaId, "B");
  assert.equal(plan.rows[1].venueSpaceId, baseline.draft.venue.assignments[0].venueSpaceId);
  assert.equal(plan.impact[0].before[0].circleId, "c-000002");
  assert.equal(plan.impact[0].after[0].circleId, "c-000003");
});

test("changed pin, unserved deployment, corrupted blobs and changed Reader identity refuse baseline", async () => {
  for (const alter of [
    (data) => { data.published.dataCommit = "4".repeat(40); },
    (data, remote) => { remote.original.set("data/event-data-pins/event-alpha.json", "{}"); },
    (data) => { data.dataFiles.set("events/event-alpha/official-booths.json", "{}"); },
    (data) => { data.published.catalog.circles[0].name = "錯誤社團"; },
    (data) => { data.mainFiles.set("data/published-events.json", '{"schema":"published-events/1","events":[]}'); },
  ]) {
    const data = await fixture();
    const remote = gitReaderFixture(data);
    alter(data, remote);
    await assert.rejects(loader(data, remote)(data.source));
  }
  const data = await fixture();
  await assert.rejects(loader(data)({ ...data.source, approvalHash: "a".repeat(64) }), /hash/);
  await assert.rejects(loader(data)({ ...data.source, candidateVersion: 2 }), /核准版本/);
});
