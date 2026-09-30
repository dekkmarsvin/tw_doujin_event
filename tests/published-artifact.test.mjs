import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkPublishedArtifact } from "../scripts/check-published-artifact.mjs";
import { buildDeploymentManifest } from "../scripts/build-deployment-manifest.mjs";

async function artifact(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "published-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (file, value) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), typeof value === "string" ? value : JSON.stringify(value));
  };
  await put("data/published-events.json", { schema: "published-events/1", events: ["sample"] });
  await put("data/event-data-pins/sample.json", { eventId: "sample", commit: "a".repeat(40) });
  await put(".event-data-stage.json", { events: [{ eventId: "sample", source: "pin" }] });
  await cp(new URL("../fixtures/events/sample/", import.meta.url), path.join(root, "public/data/events/sample"), { recursive: true });
  await cp(path.join(root, "public/data/events/sample"), path.join(root, "dist/data/events/sample"), { recursive: true });
  const catalog = JSON.parse(await readFile(path.join(root, "dist/data/events/sample/circles.json"), "utf8"));
  await put("dist/events/sample/index.html", '<a href="/?event=sample">map</a>');
  for (const circle of catalog.circles) await put(`dist/events/sample/circles/${circle.id}/index.html`, "circle");
  for (const entry of ["index", "circle", "organizer", "admin"]) await put(`dist/${entry}.html`, '<script src="/assets/app.js"></script>');
  await put("dist/assets/app.js", "application");
  const manifest = async () => put("dist/deployment-manifest.json", await buildDeploymentManifest({ root, commit: "b".repeat(40) }));
  await manifest();
  return { root, put, manifest };
}

test("published artifact rejects changed bytes, stale files, missing assets and mismatched proof", async t => {
  const { root, put, manifest } = await artifact(t);
  assert.deepEqual((await checkPublishedArtifact(root)).events, ["sample"]);
  const catalogPath = "dist/data/events/sample/circles.json";
  const original = await readFile(path.join(root, catalogPath), "utf8");
  await put(catalogPath, `${original}\n`);
  await assert.rejects(checkPublishedArtifact(root), /built bytes differ/);
  await put(catalogPath, original);
  await put("dist/data/events/leftover/event.json", "{}");
  await assert.rejects(checkPublishedArtifact(root), /exactly the published/);
  await rm(path.join(root, "dist/data/events/leftover"), { recursive: true });
  await put("dist/deployment-manifest.json", { commit: "b".repeat(40) });
  await assert.rejects(checkPublishedArtifact(root), /deployment proof/);
  await manifest();
  await rm(path.join(root, "dist/assets/app.js"));
  await assert.rejects(checkPublishedArtifact(root), /ENOENT/);
});

test("published artifact rejects fixtures and unknown placement dates/venue areas", async t => {
  const { root, put } = await artifact(t);
  await put(".event-data-stage.json", { events: [{ eventId: "sample", source: "fixture" }] });
  await assert.rejects(checkPublishedArtifact(root), /published pinned set/);
  await put(".event-data-stage.json", { events: [{ eventId: "sample", source: "pin" }] });
  const catalog = JSON.parse(await readFile(path.join(root, "public/data/events/sample/circles.json"), "utf8"));
  const originalDay = catalog.placements[0].day;
  for (const [key, value, error] of [["day", "absent", /unknown day/], ["area", "absent", /unknown venue area/]]) {
    catalog.placements[0].day = originalDay;
    catalog.placements[0][key] = value;
    for (const tree of ["public", "dist"]) await put(`${tree}/data/events/sample/circles.json`, catalog);
    await assert.rejects(checkPublishedArtifact(root), error);
  }
});
