import { createOrganizerAreaNames, type OrganizerEventDraft, type OrganizerValidationIssue } from "./organizer-event";

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
  boothCodeMode?: "single" | "delimited" | "fixed-width";
  boothCodeWidth?: number;
};

export type OrganizerNormalizedImportRow = {
  /** Positive values refer to the original workbook; 0 marks a manual group. */
  sourceRow: number;
  dayId: string;
  venueSpaceId: string;
  areaId: string;
  codes: string[];
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
export type OrganizerRejectedImportRow = Omit<OrganizerNormalizedImportRow, "identityGroup" | "codes"> & {
  boothCode: string;
  codes: string[];
};

function compact(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

/** What the delimited format splits a booth cell on. */
const BOOTH_CODE_SEPARATORS = /[\s,，、;；/]+/u;

/** Matches `server/organizer-content.ts` JSON byte limit on `source.mapping`. */
export const ORGANIZER_IMPORT_MAPPING_MAX_BYTES = 100_000;

export function organizerImportMappingBytes(mapping: OrganizerImportMapping): number {
  try {
    return new TextEncoder().encode(JSON.stringify(mapping)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function isOrganizerImportMappingTooLarge(mapping: OrganizerImportMapping): boolean {
  return organizerImportMappingBytes(mapping) > ORGANIZER_IMPORT_MAPPING_MAX_BYTES;
}

export function isValidOrganizerBoothCodeWidth(width: unknown): width is number {
  return typeof width === "number" && Number.isSafeInteger(width) && width >= 1 && width <= 80;
}

const ownValue = (record: Readonly<Record<string, string>>, key: string) =>
  Object.hasOwn(record, key) ? record[key] : "";

export function splitOrganizerBoothCode(
  boothCode: string,
  mode: "single" | "delimited" | "fixed-width",
  width?: number,
): string[] | null {
  const trimmed = compact(boothCode);
  if (!trimmed) return [];
  let codes: string[];
  if (mode === "delimited") {
    codes = trimmed.split(BOOTH_CODE_SEPARATORS).filter(Boolean);
  } else if (mode === "fixed-width") {
    if (!isValidOrganizerBoothCodeWidth(width)) return null;
    const characters = [...trimmed];
    if (characters.length % width !== 0 || BOOTH_CODE_SEPARATORS.test(trimmed)) return null;
    codes = Array.from({ length: characters.length / width }, (_, index) =>
      characters.slice(index * width, (index + 1) * width).join(""));
  } else {
    codes = [trimmed];
  }
  if (!codes.length || codes.some((code) => code.length > 80)) return null;
  return codes;
}

/** Every unique non-empty column value, with the option it already matches
 * (`autoTarget`) or null when the organizer still has to choose one. Values
 * still waiting on a choice come first. */
export function listImportColumnValues(input: {
  rows: readonly OrganizerImportTableRow[];
  headerRow: number;
  column: number;
  knownValues: Readonly<Record<string, string>>;
}): Array<{ value: string; count: number; autoTarget: string | null }> {
  if (!Number.isSafeInteger(input.headerRow) || input.headerRow < 1 || input.headerRow >= input.rows.length
    || !Number.isSafeInteger(input.column) || input.column < 0) {
    return [];
  }
  const counts = new Map<string, number>();
  for (const row of input.rows.slice(input.headerRow)) {
    const value = compact(row.cells[input.column]);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count, autoTarget: compact(ownValue(input.knownValues, value)) || null }))
    .sort((a, b) => Number(a.autoTarget !== null) - Number(b.autoTarget !== null)
      || b.count - a.count || a.value.localeCompare(b.value, "zh-Hant"));
}

/** The one option whose name starts with `value`, as 「P3」 starts 「P3倉庫」.
 * Width, case and spaces are ignored. The prefix must end a token, so 「P3」
 * never suggests 「P30倉庫」, and two candidates suggest nothing: a guess
 * between them is the organizer's to make. */
export function suggestOrganizerImportValueTarget(value: string, options: ReadonlyArray<{ id: string; name: string }>): string | null {
  const key = (text: string) => compact(text).replace(/ /gu, "").toLocaleLowerCase("zh-Hant");
  const wanted = key(value);
  if (!wanted) return null;
  const matches = options.filter(({ name }) => {
    const candidate = key(name);
    return candidate.startsWith(wanted) && !/^[a-z0-9]/u.test(candidate.slice(wanted.length));
  });
  return matches.length === 1 ? matches[0].id : null;
}

export type OrganizerBoothSplitSample = {
  sourceRow: number;
  circleName: string;
  raw: string;
  codes: string[] | null;
  count: number | null;
};

export type OrganizerBoothSplitPreview = {
  rowCount: number;
  boothCount: number;
  multiRowCount: number;
  invalidRowCount: number;
  samples: OrganizerBoothSplitSample[];
};

export function previewOrganizerBoothSplits(input: {
  rows: readonly OrganizerImportTableRow[];
  headerRow: number;
  boothColumn: number;
  circleColumn: number | null;
  mode: "single" | "delimited" | "fixed-width";
  width?: number;
  limit?: number;
}): OrganizerBoothSplitPreview | null {
  if (!Number.isSafeInteger(input.headerRow) || input.headerRow < 1 || input.headerRow >= input.rows.length
    || !Number.isSafeInteger(input.boothColumn) || input.boothColumn < 0) {
    return { rowCount: 0, boothCount: 0, multiRowCount: 0, invalidRowCount: 0, samples: [] };
  }
  if (input.mode === "fixed-width" && !isValidOrganizerBoothCodeWidth(input.width)) {
    return null;
  }
  const circleColumn = input.circleColumn !== null && Number.isSafeInteger(input.circleColumn) && input.circleColumn >= 0
    ? input.circleColumn : null;
  const nonEmpty: Array<{ sourceRow: number; circleName: string; raw: string }> = [];
  for (const row of input.rows.slice(input.headerRow)) {
    const raw = compact(row.cells[input.boothColumn]);
    if (!raw) continue;
    const circleName = circleColumn !== null ? compact(row.cells[circleColumn]) : "";
    nonEmpty.push({ sourceRow: row.sourceRow, circleName, raw });
  }
  const suggestedWidth = input.mode === "single"
    ? suggestOrganizerBoothCodeWidth(nonEmpty.map((item) => item.raw))
    : null;
  let boothCount = 0;
  let multiRowCount = 0;
  let invalidRowCount = 0;
  const evaluated: Array<OrganizerBoothSplitSample & { interesting: boolean }> = nonEmpty.map((item) => {
    const codes = splitOrganizerBoothCode(item.raw, input.mode, input.width);
    if (codes === null) invalidRowCount += 1;
    else {
      boothCount += codes.length;
      if (codes.length > 1) multiRowCount += 1;
    }
    const looksCombined = input.mode === "single" && (
      findOrganizerListedBoothCodes([item.raw]) !== null
      || (suggestedWidth !== null && [...item.raw].length > suggestedWidth && [...item.raw].length % suggestedWidth === 0)
    );
    return {
      ...item,
      codes,
      count: codes ? codes.length : null,
      interesting: (codes !== null && codes.length > 1) || looksCombined,
    };
  });
  const limit = input.limit ?? 6;
  const selected = new Set<number>();
  const pick = (items: typeof evaluated, max: number) => {
    let added = 0;
    for (const item of items) {
      if (selected.size >= limit || added >= max) break;
      if (selected.has(item.sourceRow)) continue;
      selected.add(item.sourceRow);
      added += 1;
    }
  };
  pick(evaluated.filter((item) => item.codes === null), 2);
  pick(evaluated.filter((item) => item.interesting), 3);
  pick(evaluated, limit);
  const samples = evaluated
    .filter((item) => selected.has(item.sourceRow))
    .map(({ sourceRow, circleName, raw, codes, count }) => ({ sourceRow, circleName, raw, codes, count }))
    .sort((a, b) => a.sourceRow - b.sourceRow);
  return { rowCount: nonEmpty.length, boothCount, multiRowCount, invalidRowCount, samples };
}

/** Suggest only: choosing a width is an explicit organizer decision. */
export function suggestOrganizerBoothCodeWidth(values: readonly string[]): number | null {
  const lengths = values.map((value) => [...compact(value)].length).filter((length) => length > 0);
  if (!lengths.length) return null;
  const smallest = Math.min(...lengths);
  if (lengths.some((length) => length > smallest) && lengths.some((length) => length > smallest && length % smallest === 0)) return smallest;
  // Also recognize a file containing only concatenated letter-number codes.
  const units = values.flatMap((value) => compact(value).match(/[A-Za-z]+[0-9]+/gu) ?? []);
  if (units.length && values.every((value) => (compact(value).match(/[A-Za-z]+[0-9]+/gu) ?? []).join("") === compact(value))) {
    const width = [...units[0]].length;
    if (units.every((unit) => [...unit].length === width) && lengths.some((length) => length > width)) return width;
  }
  return null;
}

/** Cells that already list several codes for one circle. Every part must carry
 * a digit, so a spaced code such as 「A 01」 is not read as two booths.
 * Suggest only, like the width: the format stays the organizer's choice. */
export function findOrganizerListedBoothCodes(values: readonly string[]): { count: number; example: string } | null {
  const listed = values.map(compact).filter((value) => {
    const parts = value.split(BOOTH_CODE_SEPARATORS).filter(Boolean);
    return parts.length > 1 && parts.every((part) => /\d/u.test(part));
  });
  return listed.length ? { count: listed.length, example: listed[0] } : null;
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
  return mapping.values ? compact(ownValue(mapping.values, value)) : value;
}

export function prepareOrganizerImport(input: {
  rows: readonly OrganizerImportTableRow[];
  headerRow: number;
  mapping: OrganizerImportMapping;
  areaModeByVenueSpace?: Readonly<Record<string, "imported" | "none">>;
  areaAssignments?: OrganizerEventDraft["venue"]["assignments"];
  /** Initial candidate version, retained through a partial-save retry. */
  areaGeneration?: number;
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
  const mode = input.mapping.boothCodeMode ?? "single";
  const width = input.mapping.boothCodeWidth;
  if (!["single", "delimited", "fixed-width"].includes(mode)) throw new Error("請選擇攤位代碼格式。");
  if (mode === "fixed-width" && !isValidOrganizerBoothCodeWidth(width)) {
    throw new Error("請確認每個攤位代碼的字元數（1–80）。");
  }
  const suggestedWidth = suggestOrganizerBoothCodeWidth(input.rows.slice(input.headerRow)
    .filter((row) => !input.excludedRows?.includes(row.sourceRow))
    .map((row) => input.overrides?.[row.sourceRow]?.boothCode ?? mapped(row, input.mapping.boothCode)));
  const placements = new Map<string, { sourceRow: number; boothCode: string }>();
  const excluded = new Set(input.excludedRows ?? []);
  const areaNames = createOrganizerAreaNames(input.areaAssignments ?? [], input.areaGeneration ?? 0, "import");
  const areaMapping = input.mapping.area;
  const hasExplicitAreaMapping = Boolean(
    areaMapping && (!("fixed" in areaMapping) || compact(areaMapping.fixed) !== ""),
  );
  // Spaces without any area value in the mapped column are treated as undivided
  // (`ALL`), while a space that already supplies areas still catches blank cells.
  const spacesWithAreas = new Set<string>();
  if (hasExplicitAreaMapping) {
    for (const source of input.rows.slice(input.headerRow)) {
      if (excluded.has(source.sourceRow)) continue;
      const override = (source.sourceRow > input.headerRow && input.overrides?.[source.sourceRow]) || {};
      const venueSpaceId = override.venueSpaceId === undefined
        ? mapped(source, input.mapping.venueSpace)
        : compact(override.venueSpaceId);
      if (!venueSpaceId || input.areaModeByVenueSpace?.[venueSpaceId] === "none") continue;
      const rawArea = override.areaId === undefined ? mapped(source, areaMapping) : compact(override.areaId);
      if (rawArea) spacesWithAreas.add(venueSpaceId);
    }
  }
  const undividedSpaces = new Set<string>();

  for (const source of input.rows.slice(input.headerRow)) {
    // A removed row leaves before it can claim a placement, so removing one of
    // two rows on the same booth resolves the duplicate rather than leaving the
    // survivor blocked by a row nobody is importing any more.
    // A correction cannot resurrect a header line as data.
    const override = (source.sourceRow > input.headerRow && input.overrides?.[source.sourceRow]) || {};
    const corrected = (field: OrganizerImportOverrideField, cell: string) =>
      override[field] === undefined ? cell : compact(override[field]);

    const dayId = corrected("dayId", mapped(source, input.mapping.day));
    const venueSpaceId = corrected("venueSpaceId", mapped(source, input.mapping.venueSpace));
    // The area is decided after the venue space, because a corrected space can
    // be the one with no divisions — and a `none` space never reads an area
    // value from anywhere, corrected or mapped.
    const explicitlyUndivided = input.areaModeByVenueSpace?.[venueSpaceId] === "none";
    const implicitlyUndivided = Boolean(venueSpaceId) && (!hasExplicitAreaMapping || !spacesWithAreas.has(venueSpaceId));
    const undivided = explicitlyUndivided || implicitlyUndivided || (!venueSpaceId && !hasExplicitAreaMapping);
    const rawArea = explicitlyUndivided ? "ALL" : corrected("areaId", mapped(source, areaMapping));
    const areaId = undivided ? "ALL" : rawArea;
    // Reserve names even for excluded/rejected rows so toggling a row does not
    // renumber the remaining preview. Only accepted rows are persisted below.
    const normalizedAreaId = undivided ? "ALL"
      : areaId.length <= 60 ? areaNames.resolve(venueSpaceId, areaId) : "";
    if (excluded.has(source.sourceRow)) continue;
    const boothCode = corrected("boothCode", mapped(source, input.mapping.boothCode));
    const circleName = corrected("circleName", mapped(source, input.mapping.circleName));
    const stableKey = corrected("stableKey", mapped(source, input.mapping.stableKey)) || null;
    const missing = [
      [dayId, "missing_day", "活動日"],
      [venueSpaceId, "missing_venue_space", "場地"],
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
    if (rawArea.length > 60) {
      codes.push("invalid_area_name");
      issues.push({ severity: "error", step: "import", code: "invalid_area_name", row: source.sourceRow,
        message: "展區名稱不能超過 60 字。" });
    }
    if (circleName.length > 200) {
      codes.push("invalid_circle_name");
      issues.push({ severity: "error", step: "import", code: "invalid_circle_name", row: source.sourceRow,
        message: "社團名稱不能超過 200 字。" });
    }
    const rejectedAreaId = explicitlyUndivided ? "ALL" : rawArea;
    if (codes.length > 0) {
      rejected.push({ sourceRow: source.sourceRow, dayId, venueSpaceId, areaId: rejectedAreaId, boothCode, circleName, stableKey, codes });
      continue;
    }

    const boothCodes = splitOrganizerBoothCode(boothCode, mode, width);
    if (!boothCodes) {
      issues.push({ severity: "error", step: "import", code: "invalid_booth_width", row: source.sourceRow,
        message: `來源列 ${source.sourceRow} 的攤位代碼無法依目前格式拆分，請確認字元數與內容。` });
      rejected.push({ sourceRow: source.sourceRow, dayId, venueSpaceId, areaId: rejectedAreaId, boothCode, circleName, stableKey, codes: ["invalid_booth_width"] });
      continue;
    }
    const keys = boothCodes.map((code) => `${dayId}\u0000${venueSpaceId}\u0000${code.toLocaleLowerCase("en-US")}`);
    const local = new Set<string>();
    const duplicateIndex = keys.findIndex((key) => {
      if (placements.has(key) || local.has(key)) return true;
      local.add(key); return false;
    });
    if (duplicateIndex >= 0) {
      const code = boothCodes[duplicateIndex];
      const previousRow = placements.get(keys[duplicateIndex])?.sourceRow ?? source.sourceRow;
      issues.push({ severity: "error", step: "import", code: "duplicate_booth", row: source.sourceRow,
        target: `${dayId}/${venueSpaceId}/${code}`, message: `攤位 ${code} 與來源列 ${previousRow} 重複。` });
      rejected.push({ sourceRow: source.sourceRow, dayId, venueSpaceId, areaId: rejectedAreaId, boothCode, circleName, stableKey, codes: ["duplicate_booth"] });
      continue;
    }
    keys.forEach((key, index) => placements.set(key, { sourceRow: source.sourceRow, boothCode: boothCodes[index] }));
    if (mode === "single" && suggestedWidth && boothCode.length > suggestedWidth && boothCode.length % suggestedWidth === 0) {
      issues.push({ severity: "warning", step: "import", code: "possibly_combined_booth", row: source.sourceRow,
        message: `來源列 ${source.sourceRow} 的 ${boothCode} 可能包含多個攤位，請確認攤位代碼格式。` });
    }
    if (implicitlyUndivided && !explicitlyUndivided) undividedSpaces.add(venueSpaceId);
    rows.push({ sourceRow: source.sourceRow, dayId, venueSpaceId, areaId: normalizedAreaId, codes: boothCodes, circleName, stableKey,
      identityGroup: stableKey ? `stable:${stableKey}` : null });
  }
  /* 展區 is a required column, and an organizer whose list has no real one maps
   * the nearest thing to it -- which is almost always the row letter at the
   * front of the booth code. pf45-rf14 imported 1434 rows that way and ended up
   * with 13 "areas" that were 13 rows of one hall. Every value matching its own
   * booth code's first character is the shape that says so; it is a warning and
   * not a refusal, because an organizer really may use whole rows as areas
   * (#294). */
  const areaLabels = areaNames.labels();
  const areaRows = rows.filter((row) => row.areaId && row.areaId !== "ALL" && row.codes.length > 0);
  const areaName = (row: OrganizerNormalizedImportRow) => areaLabels[row.venueSpaceId]?.[row.areaId] ?? row.areaId;
  if (areaRows.length >= 10 && areaRows.every((row) => row.codes.every((code) => code.startsWith(areaName(row))))
    && new Set(areaRows.map(areaName)).size > 1) {
    issues.push({
      severity: "warning", step: "import", code: "area_looks_like_booth_row",
      message: "每一列的展區值都是該列攤位代碼的開頭，看起來對應到的是攤位排號而不是分區。"
        + "如果這場活動沒有真正的分區，請把這個場地的展區方式改成「沒有分區」；"
        + "如果有，請把展區對應到名單裡真正的分區欄位。",
    });
  }
  return {
    rows,
    issues,
    rejected,
    areaLabels,
    undividedSpaces: [...undividedSpaces].sort((a, b) => a.localeCompare(b, "en")),
    suggestedWidth,
    boothCount: rows.reduce((total, row) => total + row.codes.length, 0),
  };
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
    "活動日", "場地", ...(input.requiresArea ? ["展區"] : []),
    "攤位代碼", "社團名稱", "主辦內部編號",
  ];
  const samples = [
    { booth: "A01", circle: "範例社團一", stable: "circle-001" },
    { booth: "A02", circle: "範例社團二", stable: "circle-002" },
    { booth: "B01", circle: "範例社團三", stable: "circle-003" },
    // Two booths of one circle on one day stay in one row: two rows of one
    // name on one day publish as two circles unless they share an ID.
    { booth: "B02、B03", circle: "範例社團四", stable: "circle-004" },
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
