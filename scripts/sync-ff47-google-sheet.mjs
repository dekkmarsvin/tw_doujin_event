import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { compareWorkbookData } from "./workbook-diff-utils.mjs";
import { readXlsxWorkbook } from "./xlsx-source-utils.mjs";

const SOURCE_ID = "1LvbfijXkjcoK6nKw06U2YBZ655vcIXWvyEVX-pP0ovU";
const SOURCE_URL = `https://docs.google.com/spreadsheets/d/${SOURCE_ID}/export?format=xlsx`;
const TARGET_PATH = "data_source_test/FF47 完整攤位整理.xlsx";
const REQUIRED_SHEET = "攤位整理表 請在此填寫資訊";
const MINIMUM_SOURCE_ROWS = 1_000;
const mode = process.argv.includes("--update") ? "update" : process.argv.includes("--check") ? "check" : undefined;

if (!mode) {
  throw new Error("Choose --check to report drift or --update to replace the local workbook.");
}

function displayValue(cell) {
  if (!cell) return "∅";
  const formula = cell.formula === undefined ? "" : ` formula=${cell.formula}`;
  const value = JSON.stringify(cell.value).replaceAll("\n", "\\n");
  const output = `${value}${formula}`;
  return output.length > 100 ? `${output.slice(0, 97)}...` : output;
}

async function downloadWorkbook() {
  const response = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "tw-doujin-event-source-sync/1.0" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Google Sheets download failed: HTTP ${response.status} ${response.statusText}`);
  const contentType = response.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`Google Sheets returned a non-XLSX response (${contentType || "unknown content type"}).`);
  }
  return buffer;
}

function validateExpectedSource(workbook) {
  const sheet = workbook.sheets.find((candidate) => candidate.name === REQUIRED_SHEET);
  if (!sheet) throw new Error(`Downloaded workbook is missing required sheet: ${REQUIRED_SHEET}`);
  const populatedRows = new Set(sheet.cells.map((cell) => Number(cell.reference.match(/\d+$/)?.[0]))).size;
  if (populatedRows < MINIMUM_SOURCE_ROWS) {
    throw new Error(`Downloaded workbook has only ${populatedRows} populated source rows; expected at least ${MINIMUM_SOURCE_ROWS}.`);
  }
}

function printDiff(diff) {
  if (!diff.changed) {
    console.log("No spreadsheet data changes detected.");
    return;
  }
  console.log(`Spreadsheet data differs: ${diff.totals.added} added, ${diff.totals.removed} removed, ${diff.totals.changed} changed cells.`);
  for (const sheet of diff.sheets) {
    console.log(`- ${sheet.name} (${sheet.status}): +${sheet.added} -${sheet.removed} ~${sheet.changed}`);
  }
  if (diff.samples.length) {
    console.log("Sample changes:");
    for (const sample of diff.samples) {
      console.log(`- ${sample.sheet}!${sample.reference} [${sample.kind}] ${displayValue(sample.before)} -> ${displayValue(sample.after)}`);
    }
  }
}

const incomingBytes = await downloadWorkbook();
const incomingWorkbook = readXlsxWorkbook(incomingBytes);
validateExpectedSource(incomingWorkbook);

let currentWorkbook = { sheets: [] };
try {
  currentWorkbook = readXlsxWorkbook(await readFile(TARGET_PATH));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const diff = compareWorkbookData(currentWorkbook, incomingWorkbook);
printDiff(diff);

if (!diff.changed) process.exit(0);
if (mode === "check") {
  console.error("Local FF47 workbook is stale. Run npm run source:update.");
  process.exit(1);
}

await mkdir(dirname(TARGET_PATH), { recursive: true });
const temporaryPath = `${TARGET_PATH}.download-${process.pid}-${Date.now()}`;
try {
  await writeFile(temporaryPath, incomingBytes);
  await rename(temporaryPath, TARGET_PATH);
} finally {
  await rm(temporaryPath, { force: true });
}
console.log(`Updated ${TARGET_PATH}.`);
