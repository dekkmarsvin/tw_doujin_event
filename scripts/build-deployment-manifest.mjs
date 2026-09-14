import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePublishedEvents } from "../app/published-events.mjs";

export async function buildDeploymentManifest({ root, commit }) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Deployment requires an exact Git commit SHA.");
  const registry = parsePublishedEvents(JSON.parse(await readFile(path.join(root, "data/published-events.json"), "utf8")));
  const events = [];
  const files = [];
  for (const eventId of registry) {
    const pin = JSON.parse(await readFile(path.join(root, `data/event-data-pins/${eventId}.json`), "utf8"));
    if (pin.eventId !== eventId || !/^[0-9a-f]{40}$/.test(pin.commit)) throw new Error("Invalid deployment pin.");
    events.push({ eventId, dataCommit: pin.commit });
    async function collect(relative) {
      for (const entry of await readdir(path.join(root, "dist", relative), { withFileTypes: true })) {
        const child = `${relative}/${entry.name}`;
        if (entry.isDirectory()) await collect(child);
        else if (entry.isFile() && entry.name.endsWith(".json")) {
          files.push({ path: `/${child}`, sha256: createHash("sha256").update(await readFile(path.join(root, "dist", child))).digest("hex") });
        } else throw new Error("Unexpected event artifact.");
      }
    }
    await collect(`data/events/${eventId}`);
  }
  return { schema: "publication-deployment/1", commit, events, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const manifest = await buildDeploymentManifest({ root, commit: process.argv[2] });
  await writeFile(path.join(root, "dist/deployment-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
