import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";
import { cloudflareApi, normalizeCloudflareToken } from "./cloudflare-api.mjs";

export const WORKER_TARGETS = [
  { id: "publication-production", name: "tw-catalog-publication-dispatch", config: "workers/publication-dispatch/wrangler.jsonc", env: "" },
  { id: "retention-production", name: "tw-catalog-retention-purge", config: "workers/retention-purge/wrangler.jsonc", env: "" },
  { id: "retention-preview", name: "tw-catalog-retention-purge-preview", config: "workers/retention-purge/wrangler.jsonc", env: "preview" },
];
const root = fileURLToPath(new URL("../", import.meta.url));
const hash = value => createHash("sha256").update(value).digest("hex");
export function inputDigest(filename, bytes) {
  // Git checkouts on Windows and Linux must identify the same source.
  return hash(/\.(?:[cm]?[jt]sx?|json)$/.test(filename) || filename === ".nvmrc"
    ? bytes.toString("utf8").replaceAll("\r\n", "\n") : bytes);
}
export function sourceFingerprint({ target, config, files }) {
  return hash(JSON.stringify({ target, config, files: [...files].sort(([a], [b]) => a.localeCompare(b)) }));
}
export function activeWorkerVersion(deployments, versions) {
  const current = deployments.deployments?.[0];
  assert.ok(current?.id && current.versions?.length === 1 && current.versions[0].percentage === 100, "Worker must have one fully active version; split deployments need an explicit decision.");
  const version = versions.find(item => item.id === current.versions[0].version_id);
  assert.ok(version, "Active Worker version metadata is missing.");
  return { deploymentId: current.id, versionId: version.id, tag: version.annotations?.["workers/tag"] ?? null,
    source: version.annotations?.["workers/message"] ?? null };
}

/** Never silently change runtime flags, resources, schedules or extra bindings
 * while installing code. Secrets stay managed by Cloudflare and keep-vars. */
export function assertWorkerConfiguration(config, settings, schedules) {
  const bindings = settings.bindings;
  assert.ok(Array.isArray(bindings));
  const expected = new Set();
  for (const [name, value] of Object.entries(config.vars ?? {})) {
    expected.add(name);
    const matches = bindings.filter(binding => binding.name === name && binding.type === "plain_text");
    assert.equal(matches.length, 1, `Worker variable ${name} is missing.`);
    assert.equal(matches[0].text, String(value), `Worker variable ${name} differs; review it before deploying.`);
  }
  for (const [field, type, identity] of [["d1_databases", "d1", "database_id"], ["r2_buckets", "r2_bucket", "bucket_name"]]) {
    for (const binding of config[field] ?? []) {
      expected.add(binding.binding);
      const matches = bindings.filter(remote => remote.name === binding.binding && remote.type === type);
      assert.equal(matches.length, 1, `Worker binding ${binding.binding} is missing.`);
      assert.equal(matches[0][type === "d1" ? "id" : "bucket_name"], binding[identity], `Worker binding ${binding.binding} differs.`);
    }
  }
  assert.ok(bindings.every(binding => expected.has(binding.name) || ["plain_text", "secret_text"].includes(binding.type)), "Unexpected Worker bindings would be removed; review the config first.");
  assert.deepEqual(schedules.schedules.map(item => item.cron).sort(), [...(config.triggers?.crons ?? [])].sort(), "Worker schedule differs; review it before deploying.");
}

function wrangler(target, args) {
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/wrangler/bin/wrangler.js"), "deploy", "--config", target.config,
    "--env", target.env, ...args], { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Wrangler ${target.id} failed: ${result.stderr || result.error?.message || result.status}`);
}
export async function buildWorker(target) {
  const output = path.join(root, ".wrangler/worker-proof", target.id);
  await mkdir(output, { recursive: true });
  const metafile = path.join(output, "meta.json");
  wrangler(target, ["--dry-run", "--outdir", output, "--metafile", metafile]);
  const metadata = JSON.parse(await readFile(metafile, "utf8"));
  const parsed = ts.parseConfigFileTextToJson(target.config, await readFile(path.join(root, target.config), "utf8"));
  assert.ok(!parsed.error);
  const { env, ...base } = parsed.config;
  const config = target.env ? { ...base, ...env[target.env] } : base;
  config.name = target.name;
  delete config.$schema;
  const inputs = [...Object.keys(metadata.inputs).map(input => path.resolve(root, path.dirname(target.config), input)),
    path.join(root, "package-lock.json"), path.join(root, ".nvmrc")];
  const files = await Promise.all([...new Set(inputs)].map(async input => {
    const relative = path.relative(root, input).replaceAll("\\", "/");
    assert.ok(relative && !relative.startsWith("../") && !path.isAbsolute(relative), "Worker input must be inside this repository.");
    return [relative, inputDigest(relative, await readFile(input))];
  }));
  const fingerprint = sourceFingerprint({ target: target.id, config, files });
  return { target, config, fingerprint, tag: `source-${fingerprint.slice(0, 48)}`, inputCount: files.length };
}

export async function inspectWorker(api, target) {
  const prefix = `workers/scripts/${target.name}`;
  const deployments = await api(`${prefix}/deployments`);
  const id = deployments.deployments?.[0]?.versions?.[0]?.version_id;
  assert.match(id ?? "", /^[a-f0-9-]{36}$/);
  const version = await api(`${prefix}/versions/${id}`);
  return activeWorkerVersion(deployments, [version]);
}

async function main() {
  const { values } = parseArgs({ options: { "build-only": { type: "boolean" }, audit: { type: "boolean" }, apply: { type: "boolean" }, target: { type: "string", default: "all" } }, strict: true, allowPositionals: false });
  assert.equal([values["build-only"], values.audit, values.apply].filter(Boolean).length, 1, "Choose exactly one of --build-only, --audit or --apply.");
  const targets = values.target === "all" ? WORKER_TARGETS : WORKER_TARGETS.filter(target => target.id === values.target);
  assert.ok(targets.length, "Unknown Worker target.");
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const commit = git(["rev-parse", "HEAD"]);
  const workingTreeDirty = git(["status", "--porcelain"]) !== "";
  if (!values["build-only"]) {
    process.env.CLOUDFLARE_API_TOKEN = normalizeCloudflareToken(process.env.CLOUDFLARE_API_TOKEN) ?? "";
    if (process.env.GITHUB_ACTIONS === "true" && process.env.CLOUDFLARE_API_TOKEN) console.log(`::add-mask::${process.env.CLOUDFLARE_API_TOKEN}`);
  }
  if (values.apply) {
    assert.equal(workingTreeDirty, false, "Worker deployment requires a committed checkout.");
    assert.equal(git(["ls-remote", "origin", "refs/heads/main"]).split(/\s/)[0], commit, "Only the current main commit may deploy Workers.");
  }
  const api = values["build-only"] ? null : cloudflareApi({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN });
  const report = { schema: "worker-delivery/1", commit, workingTreeDirty, mode: values.apply ? "apply" : values.audit ? "audit" : "build-only", workers: [] };
  try { for (const target of targets) {
    const built = await buildWorker(target);
    let remote = api ? await inspectWorker(api, target) : null;
    const entry = { target: target.id, worker: target.name, environment: target.env || "production",
      fingerprint: built.fingerprint, inputCount: built.inputCount,
      status: !remote ? "built-not-deployed" : remote.tag === built.tag ? "matching-source" : remote.tag?.startsWith("source-") ? "different-source" : "source-unverified",
      deploymentId: remote?.deploymentId ?? null, versionId: remote?.versionId ?? null };
    report.workers.push(entry);
    if (values.apply && remote.tag !== built.tag) {
      const prefix = `workers/scripts/${target.name}`;
      assertWorkerConfiguration(built.config, await api(`${prefix}/settings`), await api(`${prefix}/schedules`));
      // Recheck immediately before each mutation after possibly slow builds.
      assert.equal(git(["ls-remote", "origin", "refs/heads/main"]).split(/\s/)[0], commit, "main advanced before Worker deployment.");
      entry.status = "deployment-unconfirmed";
      wrangler(target, ["--keep-vars", "--tag", built.tag, "--message", `commit:${commit} source:${built.fingerprint}`]);
      remote = await inspectWorker(api, target);
      assert.equal(remote.tag, built.tag, "Cloudflare did not confirm the expected active Worker version.");
      Object.assign(entry, { status: "deployed", deploymentId: remote.deploymentId, versionId: remote.versionId });
    }
  } } finally {
  await mkdir(path.join(root, ".wrangler"), { recursive: true });
  await writeFile(path.join(root, ".wrangler/worker-delivery.json"), JSON.stringify(report, null, 2)+"\n");
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## Worker delivery evidence\n\nSource commit: ${commit}. Dirty checkout: ${workingTreeDirty}. Mode: ${report.mode}. Builds and unknown fingerprints do not prove delivery.\n\n`
    + "| Worker | Result | Active version | Source fingerprint |\n|---|---|---|---|\n"
    + report.workers.map(w => `| ${w.worker} | ${w.status} | ${w.versionId ?? "not queried"} | ${w.fingerprint} |`).join("\n")+"\n");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
