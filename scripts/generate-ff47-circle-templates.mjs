import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { normalizeTextSource } from "./catalog-source-utils.mjs";

const WORKBOOK_PATH = "data_source_test/FF47 完整攤位整理.xlsx";
const THUMBNAIL_INDEX_PATH = "data_source_test/ff47-thumbnail-index.csv";
const OUTPUT_PATH = "app/ff47-circle-templates.generated.json";
const MANIFEST_PATH = "app/ff47-circle-templates.manifest.json";
const SOURCE_SHEET = "攤位整理表 請在此填寫資訊";
const GENERATOR_VERSION = 1;

function unzip(buffer) {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("Invalid XLSX: end-of-central-directory record not found.");
  const entries = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let index = 0; index < entries; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid XLSX central directory.");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + fileNameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) files.set(name, compressed);
    else if (method === 8) files.set(name, inflateRawSync(compressed));
    else throw new Error(`Unsupported XLSX compression method ${method} for ${name}.`);
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return files;
}

function xmlText(value = "") {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function attribute(fragment, name) {
  return fragment.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
}

function columnIndex(cellReference) {
  return [...cellReference.match(/^[A-Z]+/)?.[0] ?? ""].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function parseWorksheet(files, sheetName) {
  const workbookXml = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const relationshipId = [...workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)]
    .find((match) => xmlText(attribute(match[1], "name")) === sheetName)?.[1]
    ?.match(/r:id="([^"]+)"/)?.[1];
  if (!relationshipId) throw new Error(`Sheet not found: ${sheetName}`);
  const relsXml = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const target = [...relsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)]
    .find((match) => attribute(match[1], "Id") === relationshipId)
    ?.[1];
  const worksheetTarget = target && attribute(target, "Target")?.replace(/^\/?xl\//, "");
  if (!worksheetTarget) throw new Error(`Worksheet relationship not found: ${sheetName}`);
  const worksheetPath = `xl/${worksheetTarget.replace(/^\//, "")}`.replace("xl/worksheets/../", "xl/");
  const worksheetXml = files.get(worksheetPath)?.toString("utf8") ?? "";
  const sharedXml = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const sharedStrings = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
    .map((match) => [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => xmlText(part[1])).join(""));
  const rows = [];
  for (const match of worksheetXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const reference = attribute(match[1], "r");
    if (!reference) continue;
    const rowIndex = Number(reference.match(/\d+$/)?.[0]) - 1;
    const colIndex = columnIndex(reference);
    const type = attribute(match[1], "t");
    const body = match[2] ?? "";
    const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      ?? body.match(/<is>([\s\S]*?)<\/is>/)?.[1]
      ?? "";
    let value = type === "s" ? sharedStrings[Number(raw)] : xmlText(raw);
    if (type === "b") value = value === "1";
    else if (!type && value !== "" && Number.isFinite(Number(value))) value = Number(value);
    rows[rowIndex] ??= [];
    rows[rowIndex][colIndex] = value;
  }
  return rows;
}

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

function stableId(sourceRow, name) {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(`${sourceRow}\0${name}`, "utf8")) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `ff47-${hash.toString(36)}`;
}

const LINK_COLUMNS = [
  [18, "Facebook", "social"], [19, "Facebook", "social"], [20, "Bluesky", "social"], [21, "Bluesky", "social"],
  [22, "X", "social"], [23, "X", "social"], [24, "Plurk", "social"], [25, "pixiv", "social"],
  [26, "pixivFANBOX", "support"], [27, "Fantia", "support"], [28, "Creator Support", "support"], [29, "其他贊助平台", "support"],
  [30, "Instagram", "social"], [31, "YouTube", "social"], [32, "Twitch", "social"], [33, "LINE", "social"],
  [34, "Discord", "social"], [35, "巴哈姆特", "social"], [36, "官方網站", "website"], [37, "連結整合頁", "website"],
  [38, "其他連結", "website"], [39, "本次預告", "announcement"], [40, "品書", "catalog"], [41, "預購／通販", "store"], [44, "試閱", "sample"],
];

const workbookBytes = await readFile(WORKBOOK_PATH);
const thumbnailCsvText = normalizeTextSource(await readFile(THUMBNAIL_INDEX_PATH, "utf8"));
const thumbnailRows = parseCsv(thumbnailCsvText);
const thumbnails = new Map(thumbnailRows.slice(1).flatMap((row) => text(row[0]) && text(row[1]) ? [[text(row[0]), text(row[1])]] : []));
const rows = parseWorksheet(unzip(workbookBytes), SOURCE_SHEET);
const templates = rows.slice(1).flatMap((row, index) => {
  if (!row) return [];
  const sourceRow = index + 2;
  const name = text(row[0]);
  if (!name) return [];
  const sourceUrl = thumbnails.get(name);
  const driveId = sourceUrl?.match(/\/d\/([^/]+)/)?.[1] ?? sourceUrl?.match(/[?&]id=([^&]+)/)?.[1];
  const links = LINK_COLUMNS.flatMap(([column, provider, kind]) => urls(row[column]).map((url) => ({ provider, kind, url })));
  const entry = {
    id: stableId(sourceRow, name),
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
  counts: {
    templates: templates.length,
    links: templates.reduce((sum, entry) => sum + entry.links.length, 0),
    thumbnails: templates.filter((entry) => entry.thumbnail).length,
  },
};

if (process.argv.includes("--check")) {
  const [currentOutput, currentManifest] = await Promise.all([readFile(OUTPUT_PATH, "utf8"), readFile(MANIFEST_PATH, "utf8")]);
  if (currentOutput !== output || currentManifest !== `${JSON.stringify(manifest, null, 2)}\n`) {
    throw new Error("FF47 circle templates are stale. Run npm run catalog:generate.");
  }
  console.log(`Verified ${manifest.counts.templates} FF47 circle templates (${manifest.outputSha256.slice(0, 12)}).`);
} else {
  await Promise.all([
    writeFile(OUTPUT_PATH, output),
    writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`),
  ]);
  console.log(`Generated ${manifest.counts.templates} FF47 circle templates.`);
}
