import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildDeploymentManifest } from "../scripts/build-deployment-manifest.mjs";

test("deployment build records every event and scoped map's real artifact bytes", async (t) => {
  const prefix = path.join(os.tmpdir(), "publication-manifest-");
  const root = await mkdtemp(prefix);
  t.after(async () => { if (path.resolve(root).startsWith(path.resolve(prefix))) await rm(root, { recursive: true, force: true }); });
  const write = async (relative, content) => { await mkdir(path.dirname(path.join(root, relative)), { recursive: true }); await writeFile(path.join(root, relative), content); };
  await write("data/published-events.json", JSON.stringify({ schema: "published-events/1", events: ["ff47", "ch-20"] }));
  const bytes = '{"name":"中文活動"}\n';
  for (const id of ["ff47", "ch-20"]) {
    await write(`data/event-data-pins/${id}.json`, JSON.stringify({ eventId: id, commit: "b".repeat(40) }));
    await write(`dist/data/events/${id}/event.json`, bytes);
    await write(`dist/data/events/${id}/maps/day-1/hall.json`, bytes);
  }
  const manifest = await buildDeploymentManifest({ root, commit: "a".repeat(40) });
  assert.equal(manifest.commit, "a".repeat(40));
  assert.deepEqual(manifest.events.map((event) => event.eventId), ["ff47", "ch-20"]);
  assert.equal(manifest.files.length, 4);
  for (const file of manifest.files) assert.equal(file.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(await buildDeploymentManifest({ root, commit: "a".repeat(40) }), manifest);
  await assert.rejects(buildDeploymentManifest({ root, commit: "main" }), /exact Git commit/);
});
