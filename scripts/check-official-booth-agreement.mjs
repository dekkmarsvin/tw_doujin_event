/**
 * The organizer's daily booth lists are the placement authority (ADR-0012), but
 * the reviewed catalog still carries booth geometry the official pages do not
 * publish. Until the workbook is retired the two coexist — so the enforceable
 * form of "official is the authority" is this: the catalog may not drift from
 * the official lists without a human recording why.
 *
 * Offline by design. It reads only committed snapshots, so it runs inside
 * `npm run build` where there is no network.
 *
 *   node scripts/check-official-booth-agreement.mjs
 */
import { readFile } from "node:fs/promises";
import { compareOfficialWithCatalog } from "./official-booth-utils.mjs";

const OFFICIAL_PATH = "data_source_test/ff47-official-booths.json";
const CATALOG_PATH = "public/data/events/ff47/circles.json";
const ADJUDICATIONS_PATH = "data_source_test/ff47-official-name-adjudications.json";

const [official, catalog, adjudications] = await Promise.all(
  [OFFICIAL_PATH, CATALOG_PATH, ADJUDICATIONS_PATH].map((path) => readFile(path, "utf8").then(JSON.parse)),
);

const result = compareOfficialWithCatalog({ official, catalog, adjudications });
const failures = [];

if (result.missingFromCatalog.length) {
  failures.push(`${result.missingFromCatalog.length} booths are in the official lists but not in the catalog:\n`
    + result.missingFromCatalog.slice(0, 20).map((key) => `  + ${key} ${result.officialNames.get(key)}`).join("\n"));
}

if (result.missingFromOfficial.length) {
  failures.push(`${result.missingFromOfficial.length} booths are in the catalog but not in the official lists:\n`
    + result.missingFromOfficial.slice(0, 20).map((key) => `  - ${key} ${result.catalogNames.get(key)}`).join("\n"));
}

if (result.unrecorded.length) {
  failures.push(`${result.unrecorded.length} official/catalog name conflicts are not recorded in ${ADJUDICATIONS_PATH}:\n`
    + result.unrecorded.map(({ key, official, catalog }) => `  ~ ${key} official=${official} catalog=${catalog}`).join("\n")
    + "\nAdd each one with a decision, or correct the source it came from.");
}

if (result.stale.length) {
  failures.push(`${result.stale.length} recorded conflicts no longer exist and should be removed from ${ADJUDICATIONS_PATH}:\n`
    + result.stale.map((entry) => `  ${entry.key}`).join("\n"));
}

if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log(`Official booth agreement: ${result.officialNames.size} booths match the catalog grid exactly; `
  + `${result.conflicts.length} recorded name conflicts (${result.unadjudicated.length} still unadjudicated).`);
