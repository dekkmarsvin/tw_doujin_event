import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { previewFixture } from "../app/preview-fixture.ts";
import { cloudflareApi } from "./cloudflare-api.mjs";
import { previewRequestInit } from "./preview-transport.mjs";

export function previewOrigin(url) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
  assert.match(parsed.hostname, /^[a-f0-9]{8,32}\.tw-catalog\.pages\.dev$/);
  assert.equal(parsed.username + parsed.password + parsed.port + parsed.search + parsed.hash, "");
  assert.equal(parsed.pathname, "/");
  return parsed.origin;
}

export function previewResources(config, deployment, { deploymentId, baseUrl, sha }) {
  const origin = previewOrigin(baseUrl);
  assert.match(deploymentId, /^[a-f0-9-]{36}$/);
  assert.match(sha, /^[a-f0-9]{40}$/);
  assert.equal(deployment.id, deploymentId);
  assert.equal(deployment.project_name, "tw-catalog");
  assert.equal(deployment.environment, "preview");
  assert.equal(deployment.url, origin);
  assert.equal(deployment.deployment_trigger?.metadata?.commit_hash, sha);
  assert.equal(deployment.latest_stage?.name, "deploy");
  assert.equal(deployment.latest_stage?.status, "success");
  const names = ["THUMBNAILS", "MAP_CONTRIBUTIONS"];
  const select = env => {
    assert.equal(env.d1_databases.length, 1);
    assert.equal(env.d1_databases[0].binding, "DB");
    assert.match(env.d1_databases[0].database_id, /^[a-f0-9-]{36}$/);
    const buckets = names.map(name => {
      const matches = env.r2_buckets.filter(bucket => bucket.binding === name);
      assert.equal(matches.length, 1);
      assert.match(matches[0].bucket_name, /^[a-z0-9-]+$/);
      return matches[0].bucket_name;
    });
    assert.equal(new Set(buckets).size, 2);
    return { databaseId: env.d1_databases[0].database_id, buckets };
  };
  const production = select(config), preview = select(config.env.preview);
  assert.notEqual(preview.databaseId, production.databaseId, "preview D1 must differ from production");
  assert.ok(preview.buckets.every(bucket => !production.buckets.includes(bucket)), "preview buckets must differ from production");
  assert.equal(deployment.d1_databases?.DB?.id, preview.databaseId, "deployed DB binding mismatch");
  for (let i = 0; i < names.length; i++) assert.equal(deployment.r2_buckets?.[names[i]]?.name, preview.buckets[i], `deployed ${names[i]} mismatch`);
  return { deploymentId, ...preview };
}

const statePath = () => path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), `tw-preview-${process.env.GITHUB_RUN_ID ?? "local"}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}.json`);
export async function preparePreviewFixture({ baseUrl, deploymentId, sha, api = cloudflareApi({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN }) }) {
  assert.match(deploymentId ?? "", /^[a-f0-9-]{36}$/);
  const ts = (await import("typescript")).default;
  const parsed = ts.parseConfigFileTextToJson("wrangler.jsonc", await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  if (parsed.error) throw new Error("Cannot parse Pages bindings.");
  const deployment = await api(`pages/projects/tw-catalog/deployments/${deploymentId}`);
  const proof = previewResources(parsed.config, deployment, { deploymentId, baseUrl, sha });
  const fixture = previewFixture(`run-${process.env.GITHUB_RUN_ID ?? randomUUID()}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}`);
  assert.ok(fixture);
  await writeFile(statePath(), JSON.stringify({ ...fixture, baseUrl: previewOrigin(baseUrl) }));
  console.log(JSON.stringify({ event: "preview.resources_verified", ...proof, runId: fixture.runId }));
  return fixture;
}

export async function cleanupPreviewFixture() {
  let state;
  try { state = JSON.parse(await readFile(statePath(), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  const origin = previewOrigin(state.baseUrl), fixture = previewFixture(state.runId);
  assert.ok(fixture);
  const response = await fetch(`${origin}/api/preview/mail`, previewRequestInit(origin, {
    method: "DELETE", e2eToken: process.env.PREVIEW_E2E_TOKEN,
    accessHeaders: {
      "cf-access-client-id": process.env.CF_ACCESS_CLIENT_ID, "cf-access-client-secret": process.env.CF_ACCESS_CLIENT_SECRET },
    body: { runId: fixture.runId },
  }));
  if (!response.ok) throw new Error(`Scoped preview cleanup failed (HTTP ${response.status}).`);
  await rm(statePath(), { force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] !== "--cleanup" || process.argv.length !== 3) throw new Error("Use --cleanup.");
  await cleanupPreviewFixture();
}
