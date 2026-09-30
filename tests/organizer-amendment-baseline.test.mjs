import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer, isRunnableDevEnvironment } from "vite";
import { adoptedAmendmentFixture, amendmentFixture, gitReaderFixture, hash } from "./support/organizer-amendment-fixture.mjs";
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
  await assert.rejects(loader(data)({ ...data.source, approvalHash: "a".repeat(64) }), { code: "amendment_baseline_changed" });
  await assert.rejects(loader(data)({ ...data.source, candidateVersion: 2 }), { code: "amendment_baseline_changed" });
});

const adoptionLoader = (data, extra = {}) => api.createPublishedAmendmentBaselineLoader({ tokenProvider: { getToken: async () => "test-token" },
  fetch: gitReaderFixture(data).fetch, published: async () => data.published, adoptions: [data.adoption], ...extra });

test("reviewed grouping adoption retains the original job and creates a current, immutable baseline", async () => {
  const data = await adoptedAmendmentFixture(vite.environments.ssr.runner);
  const baseline = await adoptionLoader(data)(data.source);
  assert.deepEqual(baseline, data.expectedBaseline);
  assert.notEqual(baseline.source.dataCommit, baseline.pin.commit);
  const json = JSON.stringify(baseline);
  assert.deepEqual(await api.readOrganizerAmendmentBaseline(json, hash(json)), baseline);
  assert.equal(data.published.catalog.circles.length, 2);
  assert.equal(data.published.catalog.placements.length, 4);
  assert.deepEqual(api.planOrganizerAmendmentCandidate(baseline, [], () => "2026-09-16").summary.groups.map((group) => group.circleId), ["c-000001", "c-000002"]);
  await assert.rejects(adoptionLoader(data, { adoptions: [] })(data.source), { code: "amendment_baseline_changed", status: 409 });
});

test("other publications can advance main and allocations during adoption without changing the target identities", async () => {
  const data = await adoptedAmendmentFixture(vite.environments.ssr.runner);
  const registry = JSON.parse(data.mainFiles.get("data/published-events.json")); registry.events.push("later-event");
  data.mainFiles.set("data/published-events.json", JSON.stringify(registry));
  const allocations = JSON.parse(data.mainFiles.get("data/circle-identities/allocations.json"));
  allocations.allocations.push({ id: "c-000005", allocatedAt: "2026-09-16", reason: "other publication" }); allocations.nextSequence = 6;
  data.mainFiles.set("data/circle-identities/allocations.json", JSON.stringify(allocations));
  const evidence = JSON.parse(data.mainFiles.get("data/circle-identities/evidence.json"));
  evidence.entries.push({ circleId: "c-000005", currentName: "其他社團", aliases: [], sources: [{ eventId: "later-event", kind: "organizer-booth", value: "1:X01" }] });
  data.mainFiles.set("data/circle-identities/evidence.json", JSON.stringify(evidence));
  const result = await adoptionLoader(data)(data.source);
  assert.equal(result.allocations.nextSequence, 6);
  assert.equal(result.evidence.entries.length, 3);
});

test("adoption refuses unreviewed bytes, a different source, identity drift and ambiguous records", async () => {
  for (const alter of [
    (data) => { data.adoption.source.jobId = "another-job"; },
    (data) => { data.adoption.target.pinSha256 = "a".repeat(64); },
    (data) => { data.adoption.target.groupingSha256 = "a".repeat(64); },
    (data) => { data.originalDataFiles.set("events/event-alpha/circle-identity-groups.json", "{}"); },
    (data) => { data.dataFiles.set("events/event-alpha/maps/1/zhengyan-exhibition-area.json", "{}"); },
    (data) => { data.published.catalog.circles[0].id = "c-999999"; },
    (data) => { const e = JSON.parse(data.mainFiles.get("data/circle-identities/evidence.json")); e.entries[0].aliases.push("changed"); data.mainFiles.set("data/circle-identities/evidence.json", JSON.stringify(e)); },
  ]) {
    const data = await adoptedAmendmentFixture(vite.environments.ssr.runner); alter(data);
    await assert.rejects(adoptionLoader(data)(data.source));
  }
  const data = await adoptedAmendmentFixture(vite.environments.ssr.runner);
  await assert.rejects(adoptionLoader(data, { adoptions: [data.adoption, data.adoption] })(data.source), { code: "amendment_baseline_changed" });
});

test("deployment lag and network failure have distinct actionable responses", async () => {
  const data = await adoptedAmendmentFixture(vite.environments.ssr.runner);
  await assert.rejects(adoptionLoader(data, { published: async () => ({ ...data.published, dataCommit: data.source.dataCommit }) })(data.source),
    { code: "amendment_publication_pending", status: 409 });
  await assert.rejects(adoptionLoader(data, { fetch: async () => { throw new Error("private upstream response"); } })(data.source),
    { code: "amendment_baseline_unavailable", status: 503, message: "暫時無法核對公開版本，請稍後再試。" });
});

test("baseline diagnostics distinguish GitHub responses, transport, authentication and published catalog failures without private data", async () => {
  const data = await fixture();
  const { PublicationFailure } = await vite.environments.ssr.runner.import("/app/organizer-publication.ts");
  const privateText = "private token, URL, account and upstream body";
  for (const [extra, expected] of [
    [{ fetch: async () => new Response(privateText, { status: 404 }) }, { stage: "github_ref", repository: "main", failure: "github_api_response", httpStatus: 404 }],
    [{ fetch: async () => new Response(privateText, { status: 429 }) }, { stage: "github_ref", repository: "main", failure: "github_api_response", httpStatus: 429 }],
    [{ fetch: async () => { throw new TypeError(privateText); } }, { stage: "github_ref", repository: "main", failure: "network", httpStatus: null }],
    [{ fetch: async () => { throw new DOMException(privateText, "TimeoutError"); } }, { stage: "github_ref", repository: "main", failure: "timeout", httpStatus: null }],
    [{ tokenProvider: { getToken: async () => { throw new PublicationFailure("github_app_key", privateText, false); } } },
      { stage: "github_ref", repository: "main", failure: "github_app_key", httpStatus: null }],
    [{ published: async () => { throw new SyntaxError(privateText); } }, { stage: "published_catalog", repository: null, failure: "invalid_json", httpStatus: null }],
  ]) {
    const diagnostics = [];
    const read = api.createPublishedAmendmentBaselineLoader({ tokenProvider: { getToken: async () => privateText },
      fetch: gitReaderFixture(data).fetch, published: async () => data.published,
      onUnavailable: (diagnostic) => diagnostics.push(diagnostic), ...extra });
    await assert.rejects(read(data.source), { code: "amendment_baseline_unavailable", status: 503,
      message: "暫時無法核對公開版本，請稍後再試。" });
    assert.equal(diagnostics.length, 1);
    const { elapsedMs, ...actual } = diagnostics[0];
    assert.deepEqual(actual, expected);
    assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= 0);
    assert.ok(!JSON.stringify(diagnostics).includes(privateText));
  }
});

test("token refresh failures are not attributed to a completed unauthorized request", async (t) => {
  const data = await fixture();
  const { PublicationFailure } = await vite.environments.ssr.runner.import("/app/organizer-publication.ts");
  const completedRequest = new AbortController();
  t.mock.method(AbortSignal, "timeout", () => completedRequest.signal);
  let tokenReads = 0;
  const rejectedTokens = [];
  const diagnostics = [];
  const read = api.createPublishedAmendmentBaselineLoader({ tokenProvider: {
    getToken: async () => {
      if (++tokenReads === 1) return "rejected-token";
      completedRequest.abort(new DOMException("Expired earlier request", "TimeoutError"));
      throw new PublicationFailure("github_app_request", "private authentication response", true);
    }, invalidate: (token) => rejectedTokens.push(token),
  }, fetch: async () => new Response(null, { status: 401 }), published: async () => data.published,
  onUnavailable: (diagnostic) => diagnostics.push(diagnostic) });
  await assert.rejects(read(data.source), { code: "amendment_baseline_unavailable", status: 503 });
  assert.equal(tokenReads, 2);
  assert.deepEqual(rejectedTokens, ["rejected-token"]);
  assert.equal(diagnostics.length, 1);
  const { elapsedMs, ...actual } = diagnostics[0];
  assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= 0);
  assert.deepEqual(actual, { stage: "github_ref", repository: "main", failure: "github_app_request", httpStatus: null });
});

test("a failed fetch after token refresh does not retain the earlier unauthorized status", async () => {
  const data = await fixture();
  let fetches = 0;
  const diagnostics = [];
  const read = api.createPublishedAmendmentBaselineLoader({ tokenProvider: { getToken: async () => "test-token", invalidate: () => {} },
    fetch: async () => {
      if (++fetches === 1) return new Response(null, { status: 401 });
      throw new TypeError("private network error");
    }, published: async () => data.published, onUnavailable: (diagnostic) => diagnostics.push(diagnostic) });
  await assert.rejects(read(data.source), { code: "amendment_baseline_unavailable", status: 503 });
  assert.equal(fetches, 2);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].failure, "network");
  assert.equal(diagnostics[0].httpStatus, null);
});

test("parallel GitHub reads retain their own response status and diagnostics do not change baseline decisions", async () => {
  const data = await fixture();
  const diagnostics = [];
  const remote = gitReaderFixture(data);
  const read = api.createPublishedAmendmentBaselineLoader({ tokenProvider: { getToken: async () => "test-token" },
    fetch: async (url, init) => {
      if (String(url).endsWith(`/git/commits/${data.source.mainCommit}`)) return new Response("private response", { status: 403 });
      return remote.fetch(url, init);
    }, published: async () => data.published, onUnavailable: (event) => diagnostics.push(event) });
  await assert.rejects(read(data.source), { code: "amendment_baseline_unavailable" });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].stage, "github_commit");
  assert.equal(diagnostics[0].httpStatus, 403);
  const options = { tokenProvider: { getToken: async () => "test-token" }, fetch: remote.fetch, published: async () => data.published,
    onUnavailable: () => { throw new Error("diagnostic sink failed"); } };
  assert.deepEqual(await api.createPublishedAmendmentBaselineLoader(options)(data.source), data.baseline);
  await assert.rejects(api.createPublishedAmendmentBaselineLoader({ ...options, fetch: async () => new Response(null, { status: 503 }) })(data.source),
    { code: "amendment_baseline_unavailable", status: 503 });
  data.published.catalog.circles[0].name = "changed";
  await assert.rejects(api.createPublishedAmendmentBaselineLoader(options)(data.source), { code: "amendment_baseline_changed", status: 409 });
});
