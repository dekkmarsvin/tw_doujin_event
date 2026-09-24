import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const sha = (text, algorithm = 'sha1') => createHash(algorithm).update(text).digest('hex');
const blobSha = text => sha(`blob ${Buffer.byteLength(text)}\0${text}`);

export async function githubPublicationFixture(initial = {}, PUBLICATION_REQUIRED_CHECKS) {
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
    const files = new Map(initial[stage] ?? (stage === "data" ? [["events/ff47/event.json", "{\"id\":\"ff47\"}"]] : await Promise.all([
      "data/published-events.json", "data/event-data-pins/ff47.json", "data/circle-identities/allocations.json", "data/circle-identities/evidence.json",
    ].map(async (path) => [path, await readFile(path, "utf8")]))));
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
    } else if (method === "GET" && path.startsWith("/compare/")) {
      const [base, head] = path.slice("/compare/".length).split("...");
      const ancestors = (id, found = new Set()) => { if (found.has(id)) return found; found.add(id); for (const parent of repo.commits.get(id).parents) ancestors(parent.sha, found); return found; };
      const baseHistory = ancestors(base); const headHistory = ancestors(head);
      const mergeBase = [...baseHistory].find((id) => headHistory.has(id));
      output = response({ status: base === head ? "identical" : headHistory.has(base) ? "ahead" : baseHistory.has(head) ? "behind" : "diverged", base_commit: { sha: base }, merge_base_commit: { sha: mergeBase } });
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
      // GitHub attributes a check run to the App that created it, and the
      // merge guard matches the PR author against that App (ADR-0066 3).
      const checks = repo.checks.get(body.head_sha) ?? []; checks.push({ ...body, id: ++checkId, app: { id: 4931208, slug: "publisher" } }); repo.checks.set(body.head_sha, checks); output = response(checks.at(-1), 201);
    } else if (method === "PUT" && path.endsWith("/merge")) {
      const pull = repo.pulls.get(Number(path.split("/")[2])); assert.equal(pull.merged, false); assert.equal(body.sha, pull.head.sha);
      // Preserve unrelated main changes as GitHub's three-way merge does.
      const base = filesAt(repo, repo.commits.get(pull.head.sha).parents[0].sha), head = filesAt(repo, pull.head.sha);
      const mergedFiles = filesAt(repo, repo.refs.get("main"));
      for (const path of new Set([...base.keys(), ...head.keys()])) {
        if (base.get(path) === head.get(path)) continue;
        assert.ok(mergedFiles.get(path) === base.get(path) || mergedFiles.get(path) === head.get(path), "merge conflict must not overwrite current main");
        if (head.has(path)) mergedFiles.set(path, head.get(path)); else mergedFiles.delete(path);
      }
      const merged = commit(repo, tree(repo, mergedFiles), [repo.refs.get("main")], "Squash " + pull.head.sha);
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
