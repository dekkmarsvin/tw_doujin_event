/**
 * Fail loudly when a claimed circle id no longer exists in the catalog.
 *
 * `circle.id` is `FNV-1a(sourceRow + "\0" + name)`, so inserting a row upstream
 * or renaming a circle re-ids everything below it. A claim or an override still
 * pointing at the old id would silently stop appearing — or, worse, land on a
 * different circle. This turns that into an error.
 *
 * Run it after regenerating the catalog and BEFORE committing:
 *   npm run claims:check            against the local authoring D1
 *   npm run claims:check -- --remote  against the deployed D1
 *
 * Deliberately not part of `npm run build`: CI has no D1 binding, so wiring it
 * there would fail every deploy rather than catching real drift.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");
const remote = process.argv.includes("--remote");

const catalog = JSON.parse(await readFile(resolve(root, "public", "data", "events", "ff47", "circles.json"), "utf8"));
const known = new Set(catalog.templates.map((template) => template.id));
const byName = new Map(catalog.templates.map((template) => [template.name, template.id]));

function query(sql) {
  const args = [wranglerCli, "d1", "execute", "tw-catalog-identity", remote ? "--remote" : "--local", "--json", "--command", sql];
  if (!remote) args.push("--persist-to", ".wrangler/state");
  const stdout = execFileSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  const [execution] = JSON.parse(stdout);
  return execution?.results ?? [];
}

let rows;
try {
  rows = [
    ...query("SELECT 'claim' AS kind, circle_id, circle_name_at_claim AS name FROM circle_claims WHERE status = 'verified'"),
    ...query("SELECT 'override' AS kind, circle_id, '' AS name FROM circle_overrides WHERE status = 'live'"),
  ];
} catch (error) {
  console.error(`Could not read the identity database${remote ? " (remote)" : " (local)"}.`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const orphans = rows.filter((row) => !known.has(row.circle_id));
if (orphans.length === 0) {
  console.log(`All ${rows.length} claimed or edited circles still resolve in the catalog.`);
  process.exit(0);
}

console.error(`${orphans.length} claimed or edited circle(s) no longer exist in the catalog:\n`);
for (const orphan of orphans) {
  // The name recorded at claim time is the breadcrumb back to the new id.
  const suggestion = orphan.name && byName.has(orphan.name)
    ? `  → the catalog now has "${orphan.name}" as ${byName.get(orphan.name)}; remap it.`
    : "  → no catalog row matches the name recorded at claim time; resolve by hand.";
  console.error(`  ${orphan.kind} ${orphan.circle_id} ${orphan.name ? `("${orphan.name}")` : ""}`);
  console.error(suggestion);
}
console.error("\nRemap these rows before publishing the regenerated catalog.");
process.exit(1);
