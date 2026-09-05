import type { OrganizerValidationIssue } from "./organizer-event";

export type OrganizerImportTableRow = { sourceRow: number; cells: unknown[] };

export type OrganizerImportFieldMapping =
  | { column: number; values?: Readonly<Record<string, string>> }
  | { fixed: string };

export type OrganizerImportMapping = {
  day: OrganizerImportFieldMapping;
  venueSpace: OrganizerImportFieldMapping;
  area?: OrganizerImportFieldMapping;
  boothCode: OrganizerImportFieldMapping;
  circleName: OrganizerImportFieldMapping;
  stableKey?: OrganizerImportFieldMapping;
};

export type OrganizerNormalizedImportRow = {
  sourceRow: number;
  dayId: string;
  venueSpaceId: string;
  areaId: string;
  boothCode: string;
  circleName: string;
  stableKey: string | null;
  /** Name equality is deliberately absent from this field. */
  identityGroup: string | null;
};

export type OrganizerImportOverrideField =
  "dayId" | "venueSpaceId" | "areaId" | "boothCode" | "circleName" | "stableKey";

/** Corrections the organizer typed in the preview, keyed by physical source row. */
export type OrganizerImportOverrides =
  Readonly<Record<number, Readonly<Partial<Record<OrganizerImportOverrideField, string>>>>>;

/**
 * A row the mapping could not turn into a placement, carrying the values it did
 * resolve so the preview can show it and let the organizer fill in the rest.
 */
export type OrganizerRejectedImportRow = Omit<OrganizerNormalizedImportRow, "identityGroup"> & {
  codes: string[];
};

function compact(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

/**
 * Browser-side CSV adapter for the existing official booth import model.
 * It retains physical source rows so validation can point back to the file.
 */
export function parseOrganizerCsv(text: string): OrganizerImportTableRow[] {
  const input = String(text ?? "").replace(/^\uFEFF/u, "");
  const rows: OrganizerImportTableRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const finish = () => {
    cells.push(cell);
    rows.push({ sourceRow: rowLine, cells });
    cells = [];
    cell = "";
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else {
        cell += character;
        if (character === "\r" || (character === "\n" && input[index - 1] !== "\r")) line += 1;
      }
      continue;
    }
    if (character === '"' && cell === "") quoted = true;
    else if (character === ",") {
      cells.push(cell);
      cell = "";
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      finish();
      line += 1;
      rowLine = line;
    } else cell += character;
  }
  if (quoted) throw new Error(`CSV 第 ${rowLine} 列有未關閉的引號。`);
  if (cell !== "" || cells.length > 0 || (input.length > 0 && !/[\r\n]$/u.test(input))) finish();
  return rows.filter((row) => row.cells.some((value) => String(value) !== ""));
}

export function organizerRowsFromWorksheet(rows: readonly (readonly unknown[])[]): OrganizerImportTableRow[] {
  return rows.map((cells, index) => ({ sourceRow: index + 1, cells: [...cells] }))
    .filter((row) => row.cells.some((value) => compact(value) !== ""));
}

function mapped(row: OrganizerImportTableRow, mapping: OrganizerImportFieldMapping | undefined) {
  if (!mapping) return "";
  if ("fixed" in mapping) return compact(mapping.fixed);
  if (!Number.isSafeInteger(mapping.column) || mapping.column < 0) return "";
  const value = compact(row.cells[mapping.column]);
  return mapping.values ? compact(mapping.values[value]) : value;
}

export function prepareOrganizerImport(input: {
  rows: readonly OrganizerImportTableRow[];
  headerRow: number;
  mapping: OrganizerImportMapping;
  areaModeByVenueSpace?: Readonly<Record<string, "imported" | "none">>;
  /** Values the organizer corrected in the preview, replacing the mapped cell. */
  overrides?: OrganizerImportOverrides;
  /** Source rows the organizer removed; they import nothing and report nothing. */
  excludedRows?: readonly number[];
}) {
  if (!Number.isSafeInteger(input.headerRow) || input.headerRow < 1 || input.headerRow >= input.rows.length) {
    throw new Error("標題列必須在資料列前面。");
  }
  const issues: OrganizerValidationIssue[] = [];
  const rows: OrganizerNormalizedImportRow[] = [];
  const rejected: OrganizerRejectedImportRow[] = [];
  const placements = new Map<string, { sourceRow: number; boothCode: string }>();
  const excluded = new Set(input.excludedRows ?? []);

  for (const source of input.rows.slice(input.headerRow)) {
    // A removed row leaves before it can claim a placement, so removing one of
    // two rows on the same booth resolves the duplicate rather than leaving the
    // survivor blocked by a row nobody is importing any more.
    if (excluded.has(source.sourceRow)) continue;
    // A correction cannot resurrect a header line as data.
    const override = (source.sourceRow > input.headerRow && input.overrides?.[source.sourceRow]) || {};
    const corrected = (field: OrganizerImportOverrideField, cell: string) =>
      override[field] === undefined ? cell : compact(override[field]);

    const dayId = corrected("dayId", mapped(source, input.mapping.day));
    const venueSpaceId = corrected("venueSpaceId", mapped(source, input.mapping.venueSpace));
    // The area is decided after the venue space, because a corrected space can
    // be the one with no divisions — and a `none` space never reads an area
    // value from anywhere, corrected or mapped.
    const areaId = input.areaModeByVenueSpace?.[venueSpaceId] === "none"
      ? "ALL"
      : corrected("areaId", mapped(source, input.mapping.area));
    const boothCode = corrected("boothCode", mapped(source, input.mapping.boothCode));
    const circleName = corrected("circleName", mapped(source, input.mapping.circleName));
    const stableKey = corrected("stableKey", mapped(source, input.mapping.stableKey)) || null;
    const missing = [
      [dayId, "missing_day", "活動日"],
      [venueSpaceId, "missing_venue_space", "場館空間"],
      [areaId, "missing_area", "展區"],
      [boothCode, "missing_booth", "攤位代碼"],
      [circleName, "missing_circle", "社團名稱"],
    ] as const;
    const codes: string[] = [];
    for (const [value, code, label] of missing) {
      if (value) continue;
      codes.push(code);
      issues.push({ severity: "error", step: "import", code, row: source.sourceRow, message: `找不到${label}，請確認欄位對應。` });
    }
    if (codes.length > 0) {
      rejected.push({ sourceRow: source.sourceRow, dayId, venueSpaceId, areaId, boothCode, circleName, stableKey, codes });
      continue;
    }

    const placementKey = `${dayId}\u0000${venueSpaceId}\u0000${boothCode.toLocaleLowerCase("en-US")}`;
    const previous = placements.get(placementKey);
    if (previous) {
      issues.push({
        severity: "error", step: "import", code: "duplicate_booth", row: source.sourceRow,
        target: `${dayId}/${venueSpaceId}/${boothCode}`,
        message: `攤位 ${boothCode} 與來源列 ${previous.sourceRow} 重複。`,
      });
      rejected.push({
        sourceRow: source.sourceRow, dayId, venueSpaceId, areaId, boothCode, circleName, stableKey,
        codes: ["duplicate_booth"],
      });
      continue;
    }
    placements.set(placementKey, { sourceRow: source.sourceRow, boothCode });
    rows.push({
      sourceRow: source.sourceRow, dayId, venueSpaceId, areaId, boothCode, circleName, stableKey,
      identityGroup: stableKey ? `stable:${stableKey}` : null,
    });
  }
  return { rows, issues, rejected };
}

export async function buildOrganizerImportMetadata(input: {
  bytes: Uint8Array;
  fileName: string;
  worksheet: string | null;
  sourceDescription: string;
}) {
  const digest = await crypto.subtle.digest("SHA-256", input.bytes as BufferSource);
  const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return {
    fileName: compact(input.fileName),
    worksheet: input.worksheet === null ? null : compact(input.worksheet),
    sha256,
    sourceDescription: compact(input.sourceDescription),
  };
}

/**
 * A worked example of the file this panel expects, built from the event's own
 * activity days and venue spaces. A generic template teaches the shape but not
 * the values, and the values are what the organizer gets wrong.
 */
export function buildOrganizerImportSample(input: {
  days: readonly { id: string; label: string }[];
  spaces: readonly { id: string; label: string; divided: boolean }[];
  requiresArea: boolean;
}): { header: string[]; rows: string[][] } {
  const days = input.days.length > 0 ? input.days : [{ id: "1", label: "第一天" }];
  const spaces = input.spaces.length > 0 ? input.spaces : [{ id: "hall-a", label: "A 館", divided: true }];
  const header = [
    "活動日", "使用空間", ...(input.requiresArea ? ["展區"] : []),
    "攤位代碼", "社團名稱", "主辦內部編號",
  ];
  const samples = [
    { booth: "A01", circle: "範例社團一", stable: "circle-001" },
    { booth: "A02", circle: "範例社團二", stable: "circle-002" },
    { booth: "B01", circle: "範例社團三", stable: "circle-003" },
  ];
  const rows = samples.map((sample, index) => {
    const day = days[Math.min(index, days.length - 1)];
    const space = spaces[Math.min(index, spaces.length - 1)];
    // An undivided space leaves the column blank rather than showing a value
    // the import will ignore.
    return [
      day.id, space.label, ...(input.requiresArea ? [space.divided ? sample.booth.slice(0, 1) : ""] : []),
      sample.booth, sample.circle, sample.stable,
    ];
  });
  return { header, rows };
}

/**
 * Serialises the sample for download. The BOM is what makes Excel on Windows
 * open a UTF-8 CSV as Chinese rather than mojibake; `parseOrganizerCsv` strips
 * it again, so the file this panel hands out is one it can read back.
 */
export function toOrganizerCsv(rows: readonly (readonly string[])[]): string {
  const cell = (value: string) => /[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
  return `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
