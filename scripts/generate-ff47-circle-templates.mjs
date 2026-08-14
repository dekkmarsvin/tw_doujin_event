import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { normalizeTextSource } from "./catalog-source-utils.mjs";
import { CircleIdentityAdjudicationError, createCircleIdentityRegistry } from "./circle-identity-registry.mjs";
import { parseXlsxWorksheet, unzipXlsx } from "./xlsx-source-utils.mjs";

const WORKBOOK_PATH = "data_source_test/FF47 完整攤位整理.xlsx";
const THUMBNAIL_INDEX_PATH = "data_source_test/ff47-thumbnail-index.csv";
const OUTPUT_PATH = "app/ff47-circle-templates.generated.json";
const MANIFEST_PATH = "app/ff47-circle-templates.manifest.json";
const ALLOCATIONS_PATH = "data/circle-identities/allocations.json";
const EVIDENCE_PATH = "data/circle-identities/evidence.json";
const LEGACY_ID_MAP_PATH = "data/circle-identities/legacy-id-map.json";
const SOURCE_SHEET = "攤位整理表 請在此填寫資訊";
const GENERATOR_VERSION = 2;
const check = process.argv.includes("--check");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") { row.push(field); field = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const text = (value) => value === null || value === undefined ? "" : String(value).normalize("NFKC").trim();
const list = (value) => [...new Set(text(value).split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean))];
const urls = (value) => [...new Set(text(value).match(/https?:\/\/[^\s]+/g) ?? [])];
const placements = (value) => [...new Set((text(value).toUpperCase().match(/[A-W]\d{2}/g) ?? []))];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const LINK_COLUMNS = [
  [18, "Facebook", "social"], [19, "Facebook", "social"], [20, "Bluesky", "social"], [21, "Bluesky", "social"],
  [22, "X", "social"], [23, "X", "social"], [24, "Plurk", "social"], [25, "pixiv", "social"],
  [26, "pixivFANBOX", "support"], [27, "Fantia", "support"], [28, "Creator Support", "support"], [29, "其他贊助平台", "support"],
  [30, "Instagram", "social"], [31, "YouTube", "social"], [32, "Twitch", "social"], [33, "LINE", "social"],
  [34, "Discord", "social"], [35, "巴哈姆特", "social"], [36, "官方網站", "website"], [37, "連結整合頁", "website"],
  [38, "其他連結", "website"], [39, "本次預告", "announcement"], [40, "品書", "catalog"], [41, "預購／通販", "store"], [44, "試閱", "sample"],
];

/**
 * Workbook rows whose 攤位名稱 cell holds something other than a circle name —
 * here, a pasted announcement URL. The organizer's daily booth list is the
 * naming authority for these, exactly as it is for the placement supplements in
 * `app/ff47-official-booths.ts`.
 *
 * Keyed on the pasted URL, not the row number: a row inserted upstream would
 * silently move a row-keyed correction onto a different circle.
 *
 * D09 (day 1 and 2) = 紅色荔枝樹, per
 * https://www.f-2.com.tw/【ff47】第一天攤位編號/
 */
const NAME_CORRECTIONS = new Map([
  ["https://www.facebook.com/akarizu223/posts/pfbid02j1kG39tNgZLhoWtp3uXDD7bz6Hsa3eMD7zACDvoaZCgoPc8nsCpXdA4xtJ92U8mUl", "紅色荔枝樹"],
]);

/**
 * A URL in the name column is a data defect, never a name. Left alone it
 * produces a circle whose displayed name is a raw link, and its booths fall
 * back to positional ids that split one circle across days. Fail rather than
 * publish that.
 */
function correctedName(raw, sourceRow) {
  if (!/^https?:\/\//.test(raw)) return raw;
  const [firstUrl] = raw.match(/https?:\/\/\S+/) ?? [];
  const corrected = firstUrl && NAME_CORRECTIONS.get(firstUrl);
  if (corrected) return corrected;
  throw new Error(
    `Row ${sourceRow} has a URL where the circle name should be:\n  ${firstUrl ?? raw}\n`
    + "Look the booth up in the organizer's daily list and add the name to NAME_CORRECTIONS,\n"
    + "or have the upstream spreadsheet corrected.",
  );
}

const workbookBytes = await readFile(WORKBOOK_PATH);
const thumbnailCsvText = normalizeTextSource(await readFile(THUMBNAIL_INDEX_PATH, "utf8"));
const [allocationsRegistry, evidenceRegistry, legacyIdMap] = await Promise.all([
  readFile(ALLOCATIONS_PATH, "utf8").then(JSON.parse),
  readFile(EVIDENCE_PATH, "utf8").then(JSON.parse),
  readFile(LEGACY_ID_MAP_PATH, "utf8").then(JSON.parse),
]);
const identityRegistry = createCircleIdentityRegistry({
  allocations: allocationsRegistry,
  evidence: evidenceRegistry,
  legacyIdMap,
  check,
});

function circleIdentity(sourceRow, name) {
  try {
    return identityRegistry.resolve({ eventId: "ff47", kind: "workbook-row", value: String(sourceRow) }, name);
  } catch (error) {
    if (error instanceof CircleIdentityAdjudicationError) console.error(JSON.stringify(error.report, null, 2));
    throw error;
  }
}

const thumbnailRows = parseCsv(thumbnailCsvText);
const thumbnails = new Map(thumbnailRows.slice(1).flatMap((row) => text(row[0]) && text(row[1]) ? [[text(row[0]), text(row[1])]] : []));
const rows = parseXlsxWorksheet(unzipXlsx(workbookBytes), SOURCE_SHEET);
const templates = rows.slice(1).flatMap((row, index) => {
  if (!row) return [];
  const sourceRow = index + 2;
  const rawName = text(row[0]);
  if (!rawName) return [];
  const name = correctedName(rawName, sourceRow);
  const sourceUrl = thumbnails.get(name);
  const driveId = sourceUrl?.match(/\/d\/([^/]+)/)?.[1] ?? sourceUrl?.match(/[?&]id=([^&]+)/)?.[1];
  const links = LINK_COLUMNS.flatMap(([column, provider, kind]) => urls(row[column]).map((url) => ({ provider, kind, url })));
  const entry = {
    id: circleIdentity(sourceRow, name),
    sourceRow,
    name,
    ...(text(row[1]) ? { pen: text(row[1]) } : {}),
    placements: { 1: placements(row[2]), 2: placements(row[3]), 3: placements(row[4]) },
    creatorTypes: list(row[6]),
    ageRatings: list(row[7]),
    workTypes: list(row[8]),
    referencedWorks: list(row[9]),
    ...(text(row[10]) ? { saleInfo: text(row[10]) } : {}),
    specialTags: list(row[11]),
    surveyUrls: urls(row[17]),
    links,
    ...(sourceUrl && driveId ? { thumbnail: {
      sourceUrl,
      url: `https://drive.google.com/thumbnail?id=${driveId}&sz=w800`,
      provider: "Google Drive 縮圖索引",
    } } : {}),
  };
  return [entry];
});

const ids = new Set(templates.map((entry) => entry.id));
if (ids.size !== templates.length) throw new Error("Generated circle IDs are not unique.");
const output = `${JSON.stringify(templates, null, 2)}\n`;
const manifest = {
  schemaVersion: 1,
  generatorVersion: GENERATOR_VERSION,
  sourceWorkbook: WORKBOOK_PATH,
  sourceSheet: SOURCE_SHEET,
  sourceWorkbookSha256: sha256(workbookBytes),
  thumbnailIndex: THUMBNAIL_INDEX_PATH,
  thumbnailIndexSha256: sha256(thumbnailCsvText),
  output: OUTPUT_PATH,
  outputSha256: sha256(output),
  identityRegistry: {
    allocations: ALLOCATIONS_PATH,
    evidence: EVIDENCE_PATH,
    legacyIdMap: LEGACY_ID_MAP_PATH,
  },
  counts: {
    templates: templates.length,
    links: templates.reduce((sum, entry) => sum + entry.links.length, 0),
    thumbnails: templates.filter((entry) => entry.thumbnail).length,
  },
};

const serializedAllocations = `${JSON.stringify(identityRegistry.allocations, null, 2)}\n`;
const serializedEvidence = `${JSON.stringify(identityRegistry.evidence, null, 2)}\n`;

if (check) {
  const [currentOutput, currentManifest, currentAllocations, currentEvidence] = await Promise.all([
    readFile(OUTPUT_PATH, "utf8"),
    readFile(MANIFEST_PATH, "utf8"),
    readFile(ALLOCATIONS_PATH, "utf8"),
    readFile(EVIDENCE_PATH, "utf8"),
  ]);
  if (identityRegistry.changed || currentAllocations !== serializedAllocations || currentEvidence !== serializedEvidence
    || currentOutput !== output || currentManifest !== `${JSON.stringify(manifest, null, 2)}\n`) {
    throw new Error("FF47 circle templates are stale. Run npm run catalog:generate.");
  }
  console.log(`Verified ${manifest.counts.templates} FF47 circle templates (${manifest.outputSha256.slice(0, 12)}).`);
} else {
  await Promise.all([
    writeFile(OUTPUT_PATH, output),
    writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(ALLOCATIONS_PATH, serializedAllocations),
    writeFile(EVIDENCE_PATH, serializedEvidence),
  ]);
  console.log(`Generated ${manifest.counts.templates} FF47 circle templates.`);
}
