import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, isRunnableDevEnvironment } from "vite";

const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
if (!isRunnableDevEnvironment(vite.environments.ssr)) throw new Error("Vite SSR unavailable");
const runner = vite.environments.ssr.runner;
const { createGitHubPublicationDriver } = await runner.import("/app/github-publication-driver.ts");
const { PublicationFailure } = await runner.import("/app/organizer-publication.ts");
const catalog = await runner.import("/app/organizer-reference-catalog.ts");
const { PUBLICATION_REQUIRED_CHECKS } = await runner.import("/app/publication-rollout.ts");
after(() => vite.close());
const sha = (text, algorithm = "sha1") => createHash(algorithm).update(text).digest("hex");
const blobSha = (text) => sha(`blob ${Buffer.byteLength(text)}\0${text}`);
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
async function remoteFixture() {
  const repos = new Map();
  let checkId = 0;
  const calls = [];
  let loseResponse = null;
  function tree(repo, files) {
    const entries = [...files].map(([path, text]) => { const hash = blobSha(text); repo.blobs.set(hash, text); return { path, mode: "100644", type: "blob", sha: hash }; }).sort((a, b) => a.path.localeCompare(b.path));
    const id = sha(JSON.stringify(entries)); repo.trees.set(id, entries); return id;
  }
  function commit(repo, tree, parents, message) {
    const id = sha(JSON.stringify({ tree, parents, message }));
    repo.commits.set(id, { sha: id, tree: { sha: tree }, parents: parents.map((sha) => ({ sha })), message }); return id;
  }
  function filesAt(repo, commitId) { return new Map(repo.trees.get(repo.commits.get(commitId).tree.sha).map((entry) => [entry.path, repo.blobs.get(entry.sha)])); }
  for (const [stage, name] of [["data", "tw_doujin_event-data"], ["main", "tw_doujin_event"]]) {
    const repo = { stage, blobs: new Map(), trees: new Map(), commits: new Map(), refs: new Map(), pulls: new Map(), checks: new Map() };
    const files = new Map(stage === "data" ? [["events/ff47/event.json", "{\"id\":\"ff47\"}"]] : await Promise.all([
      "data/published-events.json", "data/event-data-pins/ff47.json", "data/circle-identities/allocations.json", "data/circle-identities/evidence.json",
    ].map(async (path) => [path, await readFile(path, "utf8")])));
    files.set("README.md", "Existing repository file\n");
    repo.refs.set("main", commit(repo, tree(repo, files), [], "Initial")); repos.set(name, repo);
  }
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (raw, init = {}) => {
    const url = new URL(raw); const segments = decodeURIComponent(url.pathname).split("/");
    const name = segments[3]; const repo = repos.get(name); const path = "/" + segments.slice(4).join("/");
    const method = init.method ?? "GET"; const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ name, path, method, body });
    assert.equal(init.headers.authorization, "Bearer test-token");
    let output;
    if (method === "GET" && path.startsWith("/git/ref/heads/")) {
      const branch = path.slice("/git/ref/heads/".length); const id = repo.refs.get(branch);
      output = id ? response({ ref: `refs/heads/${branch}`, object: { type: "commit", sha: id } }) : response({}, 404);
    } else if (method === "GET" && path.startsWith("/git/commits/")) output = response(repo.commits.get(path.split("/").at(-1)));
    else if (method === "GET" && path.startsWith("/git/trees/")) {
      const id = path.split("/").at(-1); output = response({ sha: id, tree: repo.trees.get(id), truncated: false });
    } else if (method === "GET" && path.startsWith("/git/blobs/")) {
      const id = path.split("/").at(-1); output = response({ sha: id, encoding: "base64", content: Buffer.from(repo.blobs.get(id)).toString("base64") });
    } else if (method === "POST" && path === "/git/trees") {
      const files = new Map(repo.trees.get(body.base_tree).map((entry) => [entry.path, repo.blobs.get(entry.sha)]));
      for (const entry of body.tree) { assert.equal(entry.mode, "100644"); files.set(entry.path, entry.content); }
      output = response({ sha: tree(repo, files) }, 201);
    } else if (method === "POST" && path === "/git/commits") output = response({ sha: commit(repo, body.tree, body.parents, body.message) }, 201);
    else if (method === "POST" && path === "/git/refs") {
      const branch = body.ref.slice("refs/heads/".length); assert.equal(repo.refs.has(branch), false); repo.refs.set(branch, body.sha); output = response({}, 201);
    } else if (method === "GET" && path === "/pulls") {
      output = response([...repo.pulls.values()].filter((pull) => `dekkmarsvin:${pull.head.ref}` === url.searchParams.get("head")));
    } else if (method === "POST" && path === "/pulls") {
      const number = repo.pulls.size + 1; const full_name = `dekkmarsvin/${name}`;
      const pull = { number, state: "open", merged: false, merge_commit_sha: null, body: body.body,
        base: { ref: body.base, repo: { full_name } }, head: { ref: body.head, sha: repo.refs.get(body.head), repo: { full_name } }, user: { login: "publisher[bot]" } };
      repo.pulls.set(number, pull); output = response(pull, 201);
    } else if (method === "GET" && /^\/pulls\/\d+$/.test(path)) output = response(repo.pulls.get(Number(path.split("/").at(-1))));
    else if (method === "GET" && path.endsWith("/check-runs")) output = response({ check_runs: repo.checks.get(path.split("/")[2]) ?? [] });
    else if (method === "POST" && path === "/check-runs") {
      const checks = repo.checks.get(body.head_sha) ?? []; checks.push({ ...body, id: ++checkId }); repo.checks.set(body.head_sha, checks); output = response(checks.at(-1), 201);
    } else if (method === "PUT" && path.endsWith("/merge")) {
      const pull = repo.pulls.get(Number(path.split("/")[2])); assert.equal(pull.merged, false); assert.equal(body.sha, pull.head.sha);
      const merged = commit(repo, repo.commits.get(pull.head.sha).tree.sha, [repo.refs.get("main")], "Squash " + pull.head.sha);
      repo.refs.set("main", merged); pull.merged = true; pull.state = "closed"; pull.merge_commit_sha = merged;
      output = response({ merged: true, sha: merged });
    } else throw new Error(`Unexpected ${method} ${path}`);
    if (loseResponse === `${method} ${path}`) { loseResponse = null; throw new Error("Connection lost after remote effect"); }
    return output;
  };
  return { repos, calls, fetch, filesAt, tree, commit, loseNext: (operation) => { loseResponse = operation; },
    green(stage, head) {
      const repo = repos.get(stage === "data" ? "tw_doujin_event-data" : "tw_doujin_event");
      const checks = repo.checks.get(head) ?? [];
      for (const name of PUBLICATION_REQUIRED_CHECKS[stage].filter((name) => name !== "Organizer publication approval")) checks.push({ id: ++checkId, name, head_sha: head, status: "completed", conclusion: "success" });
      repo.checks.set(head, checks);
    } };
}
async function setup() {
  const remote = await remoteFixture(); const snapshot = await snapshotFixture();
  const snapshotJson = JSON.stringify(snapshot, null, 2); // Preserve approved whitespace.
  const job = { id: "abc123", candidate_id: snapshot.candidateId, candidate_version: snapshot.candidateVersion,
    approval_hash: sha(snapshotJson, "sha256"), data_pr_number: null, data_head_sha: null, data_merge_sha: null,
    main_pr_number: null, main_head_sha: null, main_merge_sha: null, workflow_run_id: null };
  let lease = true; let intent = 0; let served = false;
  const assertLease = async () => { if (!lease) throw new PublicationFailure("lease_lost", "Expired", true); };
  const driver = createGitHubPublicationDriver({ tokenProvider: { getToken: async () => "test-token", invalidate() {} }, fetch: remote.fetch, publishedEvent: async () => served ? {} : null });
  const run = async (step) => {
    const result = await driver.run({ job, step, snapshot, snapshotJson, idempotencyKey: `${job.id}/${step}/${job.approval_hash}`,
      assertLease, beginRemoteWrite: async () => { await assertLease(); intent++; } });
    Object.assign(job, result.metadata); return result;
  };
  return { remote, job, driver, run, loseLease: () => { lease = false; }, setServed: () => { served = true; }, intent: () => intent };
}

test("real driver stages data then main, pins merged bytes and preserves FF47", async () => {
  const { remote, job, driver, run, intent, setServed } = await setup();
  const main = remote.repos.get("tw_doujin_event"); const ff47 = remote.filesAt(main, main.refs.get("main")).get("data/event-data-pins/ff47.json");
  assert.equal(await driver.eventExists("next-event"), false);
  assert.equal(await driver.eventExists("ff47"), true);
  await run("preparing_data"); assert.equal((await run("waiting_data_checks")).pending, true);
  remote.green("data", job.data_head_sha); await run("waiting_data_checks"); await run("merging_data");
  await run("preparing_main"); assert.equal((await run("waiting_main_checks")).pending, true);
  remote.green("main", job.main_head_sha); await run("waiting_main_checks"); await run("merging_main");
  const files = remote.filesAt(main, job.main_merge_sha);
  assert.equal(files.get("data/event-data-pins/ff47.json"), ff47);
  assert.deepEqual(JSON.parse(files.get("data/published-events.json")).events, ["ff47", "next-event"]);
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
