import { githubPublicationFixture } from './support/github-publication-fixture.mjs';
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, isRunnableDevEnvironment } from "vite";
import { amendmentFixture } from "./support/organizer-amendment-fixture.mjs";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
if (!isRunnableDevEnvironment(vite.environments.ssr)) throw new Error("Vite SSR unavailable");
const runner = vite.environments.ssr.runner;
const { createGitHubPublicationDriver } = await runner.import("/app/github-publication-driver.ts");
const { PublicationFailure } = await runner.import("/app/organizer-publication.ts");
const catalog = await runner.import("/app/organizer-reference-catalog.ts");
const { PUBLICATION_REQUIRED_CHECKS } = await runner.import("/app/publication-rollout.ts");
after(() => vite.close());
const sha = (text, algorithm = "sha1") => createHash(algorithm).update(text).digest("hex");
const now = Date.parse("2026-09-14T10:00:00.000Z");

async function snapshotFixture() {
  const organizer = catalog.createOrganizerReference({ name: "主辦", sourceUrl: "https://organizer.example/" }, now);
  const category = catalog.createCategoryReference({ name: "分类", sourceUrl: "https://organizer.example/categories", categories: [{ label: "原創" }] }, organizer.id, now);
  const draft = { schema: "organizer-event-draft/1", event: { id: "next-event", name: "下一場", days: [{ id: "1", label: "第一天", date: "2026-11-07" }] },
    venue: { assignments: [{ venueId: "taipei-expo-park-zhengyan-hall", venueSpaceId: "zhengyan-exhibition-area", areaIds: ["A"], mapTemplate: "SAMPLE", areaMode: "imported" }] },
    officialSource: { label: "主辦提供", url: "https://organizer.example/event" },
    references: { organizerAssignments: [{ organizerId: organizer.id, role: "lead" }], categoryCatalog: { id: category.id, organizerId: organizer.id, revision: "1" } } };
  const references = (await catalog.resolveOrganizerReferences(draft, [organizer, category, ...catalog.initialVenueReferences()])).snapshot;
  return { schema: "organizer-submission-snapshot/3", candidateId: "candidate-1", candidateVersion: 8, eventId: "next-event", draft, contentUpdatedAt: new Date(now).toISOString(), references,
    import: { source: { sourceDescription: "官方" }, rows: [{ sourceRow: 2, dayId: "1", venueSpaceId: "zhengyan-exhibition-area", areaId: "A", codes: ["S01", "S02"], circleName: "社團", stableKey: null, identityGroup: null }] },
    maps: [{ id: "map-1", periodKey: "1", venueSpaceId: "zhengyan-exhibition-area", mapRevision: 1, content: { schema: "map-contribution-draft/1", layout: JSON.parse(await readFile("fixtures/events/sample/map.json", "utf8")).layout } }] };
}

// An in-memory GitHub boundary records real blob hashes and immutable commit /
// tree objects. Faults happen AFTER a remote side effect, before its response.
const remoteFixture = initial => githubPublicationFixture(initial, PUBLICATION_REQUIRED_CHECKS);
async function setup() {
  const remote = await remoteFixture(); const snapshot = await snapshotFixture();
  return harness(remote, snapshot);
}
function harness(remote, snapshot, served = false) {
  const snapshotJson = JSON.stringify(snapshot, null, 2); // Preserve approved whitespace.
  const job = { id: "abc123", candidate_id: snapshot.candidateId, candidate_version: snapshot.candidateVersion,
    approval_hash: sha(snapshotJson, "sha256"), data_pr_number: null, data_head_sha: null, data_merge_sha: null,
    main_pr_number: null, main_head_sha: null, main_merge_sha: null, workflow_run_id: null };
  let lease = true; let intent = 0;
  const assertLease = async () => { if (!lease) throw new PublicationFailure("lease_lost", "Expired", true); };
  const driver = createGitHubPublicationDriver({ tokenProvider: { getToken: async () => "test-token", invalidate() {} }, fetch: remote.fetch, publishedEvent: async () => served ? {} : null });
  const run = async (step) => {
    const result = await driver.run({ job, step, snapshot, snapshotJson, idempotencyKey: `${job.id}/${step}/${job.approval_hash}`,
      assertLease, beginRemoteWrite: async () => { await assertLease(); intent++; } });
    Object.assign(job, result.metadata); return result;
  };
  return { remote, job, driver, run, snapshot, snapshotJson, loseLease: () => { lease = false; }, setServed: () => { served = true; }, intent: () => intent };
}

async function setupAmendment() {
  const fixture = await amendmentFixture(runner);
  const remote = await remoteFixture({ data: fixture.dataFiles, main: fixture.mainFiles });
  const dataRepo = remote.repos.get("tw_doujin_event-data"), mainRepo = remote.repos.get("tw_doujin_event");
  const baseline = fixture.baseline;
  baseline.source.dataCommit = baseline.pin.commit = dataRepo.refs.get("main");
  const before = mainRepo.refs.get("main"), files = remote.filesAt(mainRepo, before);
  files.set("data/event-data-pins/event-alpha.json", JSON.stringify(baseline.pin));
  const mainCommit = remote.commit(mainRepo, remote.tree(mainRepo, files), [before], "Published baseline");
  mainRepo.refs.set("main", mainCommit); baseline.mainCommit = baseline.source.mainCommit = mainCommit;
  const changes = [{ kind: "released", sources: ["1:S02"], circleName: "接手社" }];
  const { planOrganizerAmendmentCandidate } = await runner.import("/app/organizer-amendment-baseline.ts");
  const plan = planOrganizerAmendmentCandidate(baseline, changes, () => "2026-09-16");
  const baselineJson = JSON.stringify(baseline);
  const snapshot = { ...fixture.snapshot, schema: "organizer-submission-snapshot/4", operation: "AMEND", candidateId: "amendment-candidate", candidateVersion: 4,
    contentUpdatedAt: "2026-09-16T00:00:00.000Z", import: { ...fixture.snapshot.import, rows: plan.rows },
    amendment: { baselineJson, baselineSha256: sha(baselineJson, "sha256"), changes } };
  return harness(remote, snapshot, true);
}
async function readyMain(testCase) {
  await testCase.run("preparing_data"); testCase.remote.green("data", testCase.job.data_head_sha);
  await testCase.run("merging_data"); await testCase.run("preparing_main");
  testCase.remote.green("main", testCase.job.main_head_sha);
}
function advance(remote, stage, alter) {
  const repo = remote.repos.get(stage === "data" ? "tw_doujin_event-data" : "tw_doujin_event");
  const previous = repo.refs.get("main"), files = remote.filesAt(repo, previous); alter(files);
  repo.refs.set("main", remote.commit(repo, remote.tree(repo, files), [previous], "Intervening change"));
}

test("AMEND uses the existing two-stage driver and preserves old circles, other files and published order", async () => {
  const t = await setupAmendment();
  assert.equal(await t.driver.eventExists(t.snapshot.eventId), true);
  const main = t.remote.repos.get("tw_doujin_event"), before = t.remote.filesAt(main, main.refs.get("main"));
  await readyMain(t); await t.run("merging_main");
  const after = t.remote.filesAt(main, t.job.main_merge_sha);
  assert.equal(after.get("data/published-events.json"), before.get("data/published-events.json"));
  assert.equal(after.get("README.md"), before.get("README.md"));
  const evidence = JSON.parse(after.get("data/circle-identities/evidence.json"));
  assert.equal(evidence.entries.find((entry) => entry.circleId === "c-000002").currentName, "乙社");
  assert.equal(evidence.entries.find((entry) => entry.circleId === "c-000003").currentName, "接手社");
  assert.equal(JSON.parse(after.get("data/event-data-pins/event-alpha.json")).commit, t.job.data_merge_sha);
  assert.equal(t.intent(), t.remote.calls.filter((call) => call.method !== "GET").length);
});

test("AMEND response loss resumes original data/main branches, PRs, approval and completed merges", async () => {
  for (const stage of ["data", "main"]) for (const operation of ["POST /git/refs", "POST /pulls", "POST /check-runs", "PUT /pulls/1/merge"]) {
    const t = await setupAmendment();
    if (stage === "main") { await t.run("preparing_data"); t.remote.green("data", t.job.data_head_sha); await t.run("merging_data"); }
    const merge = operation.startsWith("PUT");
    if (merge) { await t.run(`preparing_${stage}`); t.remote.green(stage, t.job[`${stage}_head_sha`]); }
    t.remote.loseNext(operation);
    const step = `${merge ? "merging" : "preparing"}_${stage}`;
    await assert.rejects(t.run(step), (error) => error.retryable);
    await t.run(step); await t.run(step);
    const name = stage === "data" ? "tw_doujin_event-data" : "tw_doujin_event";
    assert.equal(t.remote.calls.filter((call) => call.name === name && `${call.method} ${call.path}` === operation).length, 1, `${stage} ${operation}`);
    assert.equal(t.remote.repos.get(name).pulls.size, 1);
  }
});

test("AMEND rejects changed pin or data before any first write, and changed bases before merge", async () => {
  for (const when of ["preparing", "merging"]) for (const change of ["pin", "event-file", "extra-event-file"]) {
    const t = await setupAmendment();
    if (when === "merging") { await t.run("preparing_data"); t.remote.green("data", t.job.data_head_sha); }
    advance(t.remote, change === "pin" ? "main" : "data", (files) => {
      if (change === "pin") { const pin = JSON.parse(files.get("data/event-data-pins/event-alpha.json")); pin.commit = "f".repeat(40); files.set("data/event-data-pins/event-alpha.json", JSON.stringify(pin)); }
      else files.set(`events/event-alpha/${change === "event-file" ? "map" : "extra"}.json`, "{}");
    });
    const writes = t.intent();
    await assert.rejects(t.run(`${when}_data`), (error) => error.code === "amendment_baseline_changed");
    assert.equal(t.intent(), writes);
  }
  for (const change of ["pin", "ledger-format", "published-order"]) {
    const t = await setupAmendment(); await readyMain(t);
    advance(t.remote, "main", (files) => {
      if (change === "pin") { const pin = JSON.parse(files.get("data/event-data-pins/event-alpha.json")); pin.commit = "f".repeat(40); files.set("data/event-data-pins/event-alpha.json", JSON.stringify(pin)); }
      if (change === "ledger-format") files.set("data/circle-identities/allocations.json", files.get("data/circle-identities/allocations.json") + "\n");
      if (change === "published-order") files.set("data/published-events.json", '{"schema":"published-events/1","events":["event-alpha","prior-event"]}');
    });
    const writes = t.intent();
    await assert.rejects(t.run("merging_main"), (error) => ["amendment_baseline_changed", "amendment_base_conflict"].includes(error.code));
    assert.equal(t.intent(), writes);
    assert.equal(t.remote.repos.get("tw_doujin_event").pulls.get(1).merged, false);
  }
});

test("AMEND can merge after unrelated main code changes while changed PR contents and expired lease still stop writes", async () => {
  const t = await setupAmendment();
  await t.run("preparing_data"); t.remote.green("data", t.job.data_head_sha);
  advance(t.remote, "data", (files) => files.set("README.md", "Updated data documentation"));
  await t.run("merging_data");
  await t.run("preparing_main"); t.remote.green("main", t.job.main_head_sha);
  advance(t.remote, "main", (files) => files.set("README.md", "Updated main documentation"));
  await t.run("merging_main");
  for (const stage of ["data", "main"]) {
    const repo = t.remote.repos.get(stage === "data" ? "tw_doujin_event-data" : "tw_doujin_event");
    assert.equal(t.remote.filesAt(repo, repo.refs.get("main")).get("README.md"), `Updated ${stage} documentation`);
  }
  for (const changed of ["lease", "head-tree"]) {
    const attempt = await setupAmendment(); await readyMain(attempt);
    if (changed === "lease") attempt.loseLease();
    else {
      const repo = attempt.remote.repos.get("tw_doujin_event"), pull = repo.pulls.get(1), old = repo.commits.get(pull.head.sha);
      const files = attempt.remote.filesAt(repo, pull.head.sha); files.set(".github/unreviewed.yml", "unreviewed");
      const newHead = attempt.remote.commit(repo, attempt.remote.tree(repo, files), old.parents.map((parent) => parent.sha), old.message);
      pull.head.sha = newHead; repo.refs.set(pull.head.ref, newHead); attempt.job.main_head_sha = newHead;
      repo.checks.set(newHead, repo.checks.get(old.sha).map((check) => ({ ...check, head_sha: newHead })));
    }
    const writes = attempt.intent();
    await assert.rejects(attempt.run("merging_main"), (error) => ["lease_lost", "publication_tree_changed"].includes(error.code));
    assert.equal(attempt.intent(), writes);
  }
});

test("real driver stages data then main, pins merged bytes and preserves FF47", async () => {
  const { remote, job, driver, run, intent, setServed } = await setup();
  const main = remote.repos.get("tw_doujin_event"); const ff47 = remote.filesAt(main, main.refs.get("main")).get("data/event-data-pins/ff47.json");
  const publishedBefore = JSON.parse(remote.filesAt(main, main.refs.get("main")).get("data/published-events.json")).events;
  assert.equal(await driver.eventExists("next-event"), false);
  assert.equal(await driver.eventExists("ff47"), true);
  await run("preparing_data"); assert.equal((await run("waiting_data_checks")).pending, true);
  remote.green("data", job.data_head_sha); await run("waiting_data_checks"); await run("merging_data");
  await run("preparing_main"); assert.equal((await run("waiting_main_checks")).pending, true);
  remote.green("main", job.main_head_sha); await run("waiting_main_checks"); await run("merging_main");
  const files = remote.filesAt(main, job.main_merge_sha);
  assert.equal(files.get("data/event-data-pins/ff47.json"), ff47);
  assert.deepEqual(JSON.parse(files.get("data/published-events.json")).events, [...publishedBefore, "next-event"]);
  assert.equal(JSON.parse(files.get("data/event-data-pins/next-event.json")).commit, job.data_merge_sha);
  assert.equal(await driver.eventExists("next-event"), true);
  const reads = remote.calls.length; setServed(); assert.equal(await driver.eventExists("already-served"), true); assert.equal(remote.calls.length, reads);
  assert.equal(intent(), remote.calls.filter((call) => call.method !== "GET").length);
  await assert.rejects(run("waiting_deployment"), (error) => error.code === "publication_deployment_unavailable");
});

test("lost branch, PR, check and merge responses reconcile without duplicate effects", async () => {
  for (const operation of ["POST /git/refs", "POST /pulls", "POST /check-runs"]) {
    const { remote, job, run } = await setup();
    remote.loseNext(operation);
    await assert.rejects(run("preparing_data"), (error) => error.retryable);
    await run("preparing_data"); await run("preparing_data");
    assert.equal(remote.calls.filter((call) => `${call.method} ${call.path}` === operation).length, 1, operation);
    const repo = remote.repos.get("tw_doujin_event-data");
    assert.equal(repo.pulls.size, 1); assert.equal(repo.checks.get(job.data_head_sha).length, 1);
    remote.green("data", job.data_head_sha); remote.loseNext("PUT /pulls/1/merge");
    await assert.rejects(run("merging_data"), (error) => error.retryable);
    await run("merging_data"); await run("merging_data");
    assert.equal(remote.calls.filter((call) => call.method === "PUT").length, 1);
    assert.equal(job.data_merge_sha, repo.refs.get("main"));
  }
});

test("expired lease, changed tree or PR, and failed latest checks refuse writes", async () => {
  const expired = await setup(); expired.loseLease();
  await assert.rejects(expired.run("preparing_data"), (error) => error.code === "lease_lost");
  assert.equal(expired.remote.calls.filter((call) => call.method !== "GET").length, 0);
  for (const change of ["extra-file", "closed", "head", "approval", "latest-check"]) {
    const { remote, job, run } = await setup(); await run("preparing_data");
    const repo = remote.repos.get("tw_doujin_event-data"); const pull = repo.pulls.get(1);
    if (change === "extra-file") {
      const old = repo.commits.get(job.data_head_sha); const files = remote.filesAt(repo, job.data_head_sha); files.set(".github/hostile.yml", "x");
      const id = remote.commit(repo, remote.tree(repo, files), old.parents.map((parent) => parent.sha), old.message);
      pull.head.sha = id; repo.refs.set(pull.head.ref, id); job.data_head_sha = null; job.data_pr_number = null;
    } else if (change === "closed") pull.state = "closed";
    else if (change === "head") pull.head.sha = "e".repeat(40);
    else if (change === "approval") repo.checks.get(job.data_head_sha)[0].external_id = "different-job";
    else {
      remote.green("data", job.data_head_sha);
      repo.checks.get(job.data_head_sha).push({ id: 9999, name: "data / check", head_sha: job.data_head_sha, status: "completed", conclusion: "failure" });
    }
    const writes = remote.calls.filter((call) => call.method !== "GET").length;
    await assert.rejects(run(change === "extra-file" ? "preparing_data" : "merging_data"), (error) => error instanceof PublicationFailure);
    assert.equal(remote.calls.filter((call) => call.method !== "GET").length, writes, change);
  }
});

test("recovery requires a trusted main ancestor, including when no head checkpoint was saved", async () => {
  for (const stage of ["data", "main"]) {
    const { remote, job, run } = await setup();
    await run("preparing_data"); remote.green("data", job.data_head_sha); await run("merging_data");
    if (stage === "main") await run("preparing_main");
    const repo = remote.repos.get(stage === "data" ? "tw_doujin_event-data" : "tw_doujin_event");
    const pull = repo.pulls.get(1); const previous = repo.commits.get(pull.head.sha);
    const originalBase = previous.parents[0].sha;
    const changedBaseFiles = remote.filesAt(repo, originalBase); changedBaseFiles.set("README.md", "Unapproved parent change");
    const untrustedParent = remote.commit(repo, remote.tree(repo, changedBaseFiles), [originalBase], "Untrusted base");
    const changedHeadFiles = remote.filesAt(repo, pull.head.sha); changedHeadFiles.set("README.md", "Unapproved parent change");
    const untrustedHead = remote.commit(repo, remote.tree(repo, changedHeadFiles), [untrustedParent], previous.message);
    pull.head.sha = untrustedHead; repo.refs.set(pull.head.ref, untrustedHead);
    job[`${stage}_head_sha`] = null; job[`${stage}_pr_number`] = null;
    const writes = remote.calls.filter((call) => call.method !== "GET").length;
    await assert.rejects(run(`preparing_${stage}`), (error) => error.code === "publication_base_changed");
    assert.equal(remote.calls.filter((call) => call.method !== "GET").length, writes);
  }
  const { remote, job, run } = await setup();
  remote.loseNext("POST /git/refs"); await assert.rejects(run("preparing_data"));
  const repo = remote.repos.get("tw_doujin_event-data");
  const current = repo.refs.get("main"); const files = remote.filesAt(repo, current); files.set("README.md", "New main documentation");
  repo.refs.set("main", remote.commit(repo, remote.tree(repo, files), [current], "Trusted main advancement"));
  await run("preparing_data");
  assert.ok(job.data_head_sha); assert.equal(repo.pulls.size, 1, "a legitimate main ancestor can still recover");
});
