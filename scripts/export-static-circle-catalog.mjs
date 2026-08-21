/**
 * Export the reviewed FF47 booth and circle sources into the public static
 * catalog snapshot. Keeping the payload out of the application bundle lets the
 * shell paint before the catalog arrives, and lets the snapshot be cached and
 * revalidated independently of a code deploy.
 *
 *   node scripts/export-static-circle-catalog.mjs           writes the snapshot
 *   node scripts/export-static-circle-catalog.mjs --check    fails on drift
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, isRunnableDevEnvironment } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templatesPath = resolve(root, "app", "ff47-circle-templates.generated.json");
const outputPath = resolve(root, "public", "data", "events", "ff47", "circles.json");
const check = process.argv.includes("--check");

const vite = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: "custom", environments: { ssr: {} }, logLevel: "silent" });
const environment = vite.environments.ssr;
if (!isRunnableDevEnvironment(environment)) throw new Error("Vite SSR environment is not runnable.");

try {
  const { BOOTHS } = await environment.runner.import("/app/ff47-booths.ts");
  const { FF47_OFFICIAL_SUPPLEMENT_KEYS } = await environment.runner.import("/app/ff47-official-booths.ts");
  const { ACTIVE_EVENT } = await environment.runner.import("/app/event-catalog.ts");
  const templates = JSON.parse(await readFile(templatesPath, "utf8"));

  if (!Array.isArray(BOOTHS) || BOOTHS.length === 0) throw new Error("The reviewed booth source is empty.");
  if (!Array.isArray(templates) || templates.length === 0) throw new Error("The generated circle templates file is empty.");

  const payload = {
    schema: "circle-catalog/2",
    eventId: ACTIVE_EVENT.id,
    generatedAt: ACTIVE_EVENT.dataUpdatedAt,
    officialSupplementKeys: FF47_OFFICIAL_SUPPLEMENT_KEYS,
    booths: BOOTHS,
    templates,
  };

  const serialized = `${JSON.stringify(payload)}\n`;
  const summary = `ff47 catalog snapshot: ${BOOTHS.length} placements, ${templates.length} circle templates.`;

  if (check) {
    let current;
    try {
      current = await readFile(outputPath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      console.error("Missing public/data/events/ff47/circles.json. Run: npm run catalog:snapshot");
      process.exit(1);
    }
    if (current !== serialized) {
      console.error("public/data/events/ff47/circles.json is stale. Run: npm run catalog:snapshot");
      process.exit(1);
    }
    console.log(`Static catalog snapshot is up to date. ${summary}`);
  } else {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, "utf8");
    console.log(`Exported ${summary}`);
  }
} finally {
  await vite.close();
}
