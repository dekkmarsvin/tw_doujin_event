import { inflateRawSync } from "node:zlib";

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
  return [...cellReference.match(/^[A-Z]+/)?.[0] ?? ""]
    .reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

export function unzipXlsx(buffer) {
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

function workbookSheets(files) {
  const workbookXml = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const relsXml = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const relationships = new Map(
    [...relsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)]
      .map((match) => [attribute(match[1], "Id"), attribute(match[1], "Target")]),
  );

  return [...workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)].map((match) => {
    const name = xmlText(attribute(match[1], "name"));
    const relationshipId = match[1].match(/r:id="([^"]+)"/)?.[1];
    const target = relationships.get(relationshipId)?.replace(/^\/?xl\//, "");
    if (!name || !target) throw new Error("Invalid XLSX workbook sheet relationship.");
    return {
      name,
      path: `xl/${target.replace(/^\//, "")}`.replace("xl/worksheets/../", "xl/"),
    };
  });
}

function sharedStrings(files) {
  const sharedXml = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  return [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
    .map((match) => [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((part) => xmlText(part[1]))
      .join(""));
}

function cellValue(type, body, strings) {
  if (type === "inlineStr") {
    return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((part) => xmlText(part[1]))
      .join("");
  }
  const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (raw === undefined) return "";
  if (type === "s") return strings[Number(raw)] ?? "";
  if (type === "b") return raw === "1";
  if (!type && raw !== "" && Number.isFinite(Number(raw))) return Number(raw);
  return xmlText(raw);
}

function worksheetCells(files, worksheetPath, strings) {
  const worksheetXml = files.get(worksheetPath)?.toString("utf8");
  if (!worksheetXml) throw new Error(`Worksheet file not found: ${worksheetPath}`);
  const cells = [];
  for (const match of worksheetXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const reference = attribute(match[1], "r");
    if (!reference) continue;
    const body = match[2] ?? "";
    const formula = body.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1];
    const value = cellValue(attribute(match[1], "t"), body, strings);
    if (formula === undefined && value === "") continue;
    cells.push({
      reference,
      value,
      ...(formula === undefined ? {} : { formula: xmlText(formula) }),
    });
  }
  return cells;
}

export function readXlsxWorkbook(buffer) {
  const files = unzipXlsx(buffer);
  const strings = sharedStrings(files);
  return {
    sheets: workbookSheets(files).map(({ name, path }) => ({
      name,
      cells: worksheetCells(files, path, strings),
    })),
  };
}

export function parseXlsxWorksheet(files, sheetName) {
  const sheet = workbookSheets(files).find((candidate) => candidate.name === sheetName);
  if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);
  const rows = [];
  for (const cell of worksheetCells(files, sheet.path, sharedStrings(files))) {
    const rowIndex = Number(cell.reference.match(/\d+$/)?.[0]) - 1;
    const colIndex = columnIndex(cell.reference);
    rows[rowIndex] ??= [];
    rows[rowIndex][colIndex] = cell.value;
  }
  return rows;
}
