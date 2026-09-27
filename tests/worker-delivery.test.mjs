import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { WORKER_TARGETS, sourceFingerprint, inputDigest, activeWorkerVersion, assertWorkerConfiguration, inspectWorker } from "../scripts/worker-delivery.mjs";
import { cloudflareApi } from "../scripts/cloudflare-api.mjs";

test("delivery covers each existing Worker once, built from a declared environment of its config", async () => {
  // The account's independent Workers. Adding one is a deliberate decision.
  assert.deepEqual(WORKER_TARGETS.map(target => target.name).sort(), ["tw-catalog-publication-dispatch",
    "tw-catalog-publication-dispatch-preview", "tw-catalog-retention-purge", "tw-catalog-retention-purge-preview"]);
  assert.equal(new Set(WORKER_TARGETS.map(target => target.id)).size, WORKER_TARGETS.length);
  const workflow = await readFile(new URL("../.github/workflows/deploy-workers.yml", import.meta.url), "utf8");
  for (const target of WORKER_TARGETS) {
    const parsed = ts.parseConfigFileTextToJson(target.config, await readFile(new URL(`../${target.config}`, import.meta.url), "utf8"));
    assert.ok(!parsed.error);
    assert.ok(!target.env || parsed.config.env?.[target.env], `${target.id} must name a declared environment`);
    assert.equal(target.name, target.env ? `${parsed.config.name}-${target.env}` : parsed.config.name);
    assert.match(workflow, new RegExp(`^ {10}- ${target.id}$`, "m"), `${target.id} must be selectable in the manual workflow`);
  }
});

test("Worker source identity is stable across checkout line endings and input order, but tracks dependency and environment changes", () => {
  assert.equal(inputDigest("app/handler.ts", Buffer.from("a\r\nb\r\n")), inputDigest("app/handler.ts", Buffer.from("a\nb\n")));
  assert.notEqual(inputDigest("asset.bin", Buffer.from("a\r\n")), inputDigest("asset.bin", Buffer.from("a\n")));
  const input = { target: "retention-preview", config: { vars: { FLAG: "off" } }, files: [["app/a.ts", "one"], ["app/shared.ts", "two"]] };
  const fingerprint = sourceFingerprint(input);
  assert.equal(fingerprint, sourceFingerprint({ ...input, files: [...input.files].reverse() }));
  assert.notEqual(fingerprint, sourceFingerprint({ ...input, files: [["app/a.ts", "one"], ["app/shared.ts", "changed"]] }));
  assert.notEqual(fingerprint, sourceFingerprint({ ...input, target: "retention-production" }));
  assert.notEqual(fingerprint, sourceFingerprint({ ...input, config: { vars: { FLAG: "on" } } }));
});

test("delivery evidence identifies the fully active version, never the newest uploaded version", async () => {
  const id = "a".repeat(8)+"-"+"a".repeat(4)+"-"+"a".repeat(4)+"-"+"a".repeat(4)+"-"+"a".repeat(12);
  const deployments = { deployments: [{ id: "deployment", versions: [{ version_id: id, percentage: 100 }] }] };
  const versions = [{ id: "new-but-inactive", annotations: { "workers/tag": "source-wrong" } }, { id, annotations: { "workers/tag": "source-active" } }];
  assert.equal(activeWorkerVersion(deployments, versions).tag, "source-active");
  assert.equal(activeWorkerVersion(deployments, [{ id }]).tag, null, "unknown source is not a matching delivery");
  assert.throws(() => activeWorkerVersion(deployments, []));
  assert.throws(() => activeWorkerVersion({ deployments: [{ id: "split", versions: [{ version_id: id, percentage: 50 }] }] }, versions));
  const calls = [];
  const remote = await inspectWorker(async suffix => {
    calls.push(suffix);
    return suffix.endsWith("/deployments") ? deployments : versions[1];
  }, { name: "fixture" });
  assert.equal(remote.versionId, id);
  assert.deepEqual(calls, ["workers/scripts/fixture/deployments", `workers/scripts/fixture/versions/${id}`]);
});

test("conditional deployment refuses runtime flag, resource, schedule or undeclared binding drift", () => {
  const config = { vars: { MODE: "disabled" }, d1_databases: [{ binding: "DB", database_id: "preview-db" }],
    r2_buckets: [{ binding: "FILES", bucket_name: "preview-files" }], triggers: { crons: ["17 3 * * *"] } };
  const settings = { bindings: [{ name: "MODE", type: "plain_text", text: "disabled" },
    { name: "DB", type: "d1", id: "preview-db" }, { name: "FILES", type: "r2_bucket", bucket_name: "preview-files" },
    { name: "TOKEN", type: "secret_text" }, { name: "RECIPIENTS", type: "plain_text", text: "managed-externally" }] };
  const schedules = { schedules: [{ cron: "17 3 * * *" }] };
  assert.doesNotThrow(() => assertWorkerConfiguration(config, settings, schedules));
  for (const mutate of [
    s => { s.bindings[0].text = "enabled"; }, s => { s.bindings[1].id = "production-db"; },
    s => { s.bindings[2].bucket_name = "production-files"; }, s => { s.bindings.shift(); },
    s => { s.bindings.push({ name: "EXTRA", type: "kv_namespace" }); },
  ]) {
    const changed = structuredClone(settings); mutate(changed);
    assert.throws(() => assertWorkerConfiguration(config, changed, schedules));
  }
  assert.throws(() => assertWorkerConfiguration(config, settings, { schedules: [] }));
});

test("Cloudflare evidence requests authenticate without redirects and fail closed on API errors", async () => {
  const options = { accountId: "a".repeat(32), token: "Authorization: Bearer fixture-token" };
  const api = cloudflareApi({ ...options, fetchImpl: async (url, init) => {
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/worker`);
    assert.equal(init.headers.authorization, "Bearer fixture-token");
    assert.equal(init.redirect, "error");
    return Response.json({ success: true, result: { id: "active" } });
  } });
  assert.deepEqual(await api("worker"), { id: "active" });
  for (const response of [Response.json({ success: false }), new Response("private error", { status: 403 })]) {
    await assert.rejects(cloudflareApi({ ...options, fetchImpl: async () => response })("worker"), /Cloudflare GET/);
  }
});
