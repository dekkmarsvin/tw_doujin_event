import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePublishedEvents } from "../app/published-events.mjs";
import { buildDeploymentManifest } from "./build-deployment-manifest.mjs";

async function filesIn(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await filesIn(path.join(directory, entry.name), `${relative}/`));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(relative);
    else throw new Error(`Unexpected public event artifact: ${relative}`);
  }
  return files.sort();
}

export async function checkPublishedArtifact(root) {
  const json = async file => JSON.parse(await readFile(path.join(root, file), "utf8"));
  const events = parsePublishedEvents(await json("data/published-events.json"));
  const stage = await json(".event-data-stage.json");
  assert.deepEqual(stage.events, events.map(eventId => ({ eventId, source: "pin" })), "build must use the entire published pinned set");
  assert.deepEqual((await readdir(path.join(root, "dist/data/events"))).sort(), [...events].sort(), "dist must contain exactly the published events");
  let fileCount = 0;
  for (const eventId of events) {
    const relative = `data/events/${eventId}`;
    const stagedFiles = await filesIn(path.join(root, "public", relative));
    assert.ok(stagedFiles.includes("event.json") && stagedFiles.includes("circles.json") && stagedFiles.includes("reference-records.json"), "published event is incomplete");
    assert.deepEqual(await filesIn(path.join(root, "dist", relative)), stagedFiles, `${eventId}: built file set differs from validated staging`);
    for (const file of stagedFiles) {
      assert.deepEqual(await readFile(path.join(root, "dist", relative, file)), await readFile(path.join(root, "public", relative, file)), `${eventId}/${file}: built bytes differ from validated staging`);
      fileCount++;
    }
    // A known day/area must resolve each placement to exactly one venue space.
    // The existing build validates schemas, references, identity allocations,
    // map manifests and every pinned source hash before this artifact check.
    const event = await json(`dist/${relative}/event.json`);
    const catalog = await json(`dist/${relative}/circles.json`);
    const days = new Set(event.days.map(day => String(day.id)));
    for (const placement of catalog.placements) {
      assert.ok(days.has(String(placement.day)), `${eventId}/${placement.id}: unknown day`);
      assert.equal(event.venueAssignments.filter(space => space.areaIds.includes(placement.area)).length, 1, `${eventId}/${placement.id}: ambiguous or unknown venue area`);
    }
    const discovery = await readFile(path.join(root, `dist/events/${eventId}/index.html`), "utf8");
    assert.ok(discovery.includes(`href="/?event=${eventId}"`), `${eventId}: discovery page must link to its reader`);
    for (const circle of catalog.circles) await readFile(path.join(root, `dist/events/${eventId}/circles/${circle.id}/index.html`));
  }
  for (const entry of ["index.html", "circle.html", "organizer.html", "admin.html"]) {
    const html = await readFile(path.join(root, "dist", entry), "utf8");
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1]);
    assert.ok(assets.some(file => file.endsWith(".js")), `${entry}: missing application script`);
    for (const asset of assets) await readFile(path.join(root, "dist", asset));
  }
  const manifest = await json("dist/deployment-manifest.json");
  assert.deepEqual(manifest, await buildDeploymentManifest({ root, commit: manifest.commit }), "deployment proof must match every built event byte and pin");
  return { events, fileCount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkPublishedArtifact(fileURLToPath(new URL("..", import.meta.url)));
  console.log(`Verified published artifact: ${result.events.join(", ")}; ${result.fileCount} JSON files match validated staging and deployment hashes.`);
}
