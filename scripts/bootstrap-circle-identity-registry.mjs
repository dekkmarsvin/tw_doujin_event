import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templates = JSON.parse(await readFile(resolve(root, "app/ff47-circle-templates.generated.json"), "utf8"));
const registryDir = resolve(root, "data/circle-identities");
const allocatedAt = "2026-08-14";

const allocations = {
  schema: "circle-id-allocations/1",
  nextSequence: templates.length + 1,
  allocations: templates.map((_, index) => ({
    id: `c-${String(index + 1).padStart(6, "0")}`,
    allocatedAt,
    reason: "FF47 identity registry bootstrap",
  })),
};

const evidence = {
  schema: "circle-identity-evidence/1",
  entries: templates.map((template, index) => ({
    circleId: allocations.allocations[index].id,
    currentName: template.name,
    aliases: [],
    sources: [{ eventId: "ff47", kind: "workbook-row", value: String(template.sourceRow) }],
  })),
};

const legacyIdMap = {
  schema: "legacy-circle-id-map/1",
  mappings: Object.fromEntries(templates.map((template, index) => [template.id, allocations.allocations[index].id])),
};

await mkdir(registryDir, { recursive: true });
await Promise.all([
  ["allocations.json", allocations],
  ["evidence.json", evidence],
  ["legacy-id-map.json", legacyIdMap],
].map(async ([name, value]) => {
  const path = resolve(registryDir, name);
  try {
    await readFile(path);
    throw new Error(`${path} already exists; refusing to replace an identity registry.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}));

console.log(`Bootstrapped ${templates.length} permanent circle identities.`);
