/**
 * Turns recognised booth blocks into an `EventMapLayout` the existing editor
 * and reader accept, naming every booth.
 *
 * Geometry says where booths are, not what they are called. Names come from
 * the organizer's booth list when one is given:
 *
 * 1. **Which block is which row.** The list says how many booths each row
 *    prefix has. Blocks are walked in a spatial order and aligned with the
 *    list in order, each row taking a block (or run of collinear blocks) with
 *    that many booths, give or take two. Plans disagree on where "A" starts,
 *    so several walking orders are tried and the one that places the most
 *    rows wins.
 * 2. **Which booth is which number.** Every plausible path through a row
 *    (start corner, U-turn or parallel lines, printed with or without leading
 *    zeros) is scored by how alike the glyphs it calls "7" look, first within
 *    the row and then against glyph prototypes learned from the whole plan.
 *    No digit is ever recognised as such.
 *
 * Without a list the blocks still become rows, labelled `?1`, `?2`… in
 * reading order and numbered by the best-scoring path, for a person to rename.
 */
import { EVENT_MAP_VERSION, validateEventMapLayout, type EventMapLayout, type MapAccessPoint, type MapOrientation } from "../event-map";
import { cellCost, learnPrototypes, readingCost } from "./glyphs";
import type { BoothCell, CellBlock, RecognitionResult, Rect } from "./recognize";

export type BoothListRow = { label: string; prefix: string; entries: Array<{ code: string; number: number; digits: number }> };

/** Parses a pasted booth list: codes separated by whitespace, commas or
 * newlines, with `A01~A22` expanding to a range. Row order is the order in
 * which prefixes first appear, which is how organizers list them. */
export function parseBoothList(text: string): { rows: BoothListRow[]; ignored: string[] } {
  const rows = new Map<string, BoothListRow>();
  const ignored: string[] = [];
  const add = (prefix: string, number: number, digits: number) => {
    const code = `${prefix}${String(number).padStart(digits, "0")}`;
    let row = rows.get(prefix);
    if (!row) {
      row = { label: prefix.replace(/[-_\s]+$/u, "") || "#", prefix, entries: [] };
      rows.set(prefix, row);
    }
    if (!row.entries.some((entry) => entry.code === code)) row.entries.push({ code, number, digits });
  };
  for (const token of text.split(/[\s,，、;；]+/u).filter(Boolean)) {
    const range = /^(.*?)(\d+)[~～](.*?)(\d+)$/u.exec(token);
    if (range && (range[3] === "" || range[3] === range[1])) {
      const from = Number(range[2]);
      const to = Number(range[4]);
      if (to >= from && to - from <= 500) {
        for (let n = from; n <= to; n += 1) add(range[1], n, range[2].length);
        continue;
      }
    }
    const single = /^(.*?)(\d+)$/u.exec(token);
    if (single) add(single[1], Number(single[2]), single[2].length);
    else ignored.push(token);
  }
  for (const row of rows.values()) row.entries.sort((a, b) => a.number - b.number);
  return { rows: [...rows.values()], ignored };
}

type Unit = { blocks: number[]; count: number };

const orientationOf = (block: CellBlock): MapOrientation => (block.rows >= block.columns ? "vertical" : "horizontal");

function span(rect: Rect, axis: "x" | "y") {
  return axis === "x" ? [rect.x, rect.x + rect.width] : [rect.y, rect.y + rect.height];
}

function overlapShare(a: Rect, b: Rect, axis: "x" | "y") {
  const [a0, a1] = span(a, axis);
  const [b0, b1] = span(b, axis);
  return (Math.min(a1, b1) - Math.max(a0, b0)) / Math.min(a1 - a0, b1 - b0);
}

type Walk = { name: string; sequence: number[]; band: number[] };

/** Blocks grouped into bands along `major` (horizontal strips for y, vertical
 * strips for x), bands and blocks within them each walked in a direction. */
function walk(blocks: CellBlock[], major: "x" | "y", bandDirection: 1 | -1, withinDirection: 1 | -1): Walk {
  const minor = major === "y" ? "x" : "y";
  const center = (rect: Rect, axis: "x" | "y") => (axis === "x" ? rect.x + rect.width / 2 : rect.y + rect.height / 2);
  const sorted = blocks.map((_, i) => i).sort((a, b) => center(blocks[a].bounds, major) - center(blocks[b].bounds, major));
  // A block joins the current band when it shares at least half of the
  // shorter of the two spans: a half-height column beside full ones is in
  // their band, a single row drawn above them is not.
  const bands: number[][] = [];
  let bandLow = 0;
  let bandHigh = -Infinity;
  for (const i of sorted) {
    const [low, high] = span(blocks[i].bounds, major);
    const shared = Math.min(high, bandHigh) - Math.max(low, bandLow);
    if (bands.length && shared >= Math.min(high - low, bandHigh - bandLow) * 0.5) {
      bands[bands.length - 1].push(i);
      bandLow = Math.min(bandLow, low);
      bandHigh = Math.max(bandHigh, high);
    } else {
      bands.push([i]);
      bandLow = low;
      bandHigh = high;
    }
  }
  if (bandDirection < 0) bands.reverse();
  const sequence: number[] = [];
  const band: number[] = [];
  bands.forEach((members, bandIndex) => {
    members.sort((a, b) => (center(blocks[a].bounds, minor) - center(blocks[b].bounds, minor)) * withinDirection);
    for (const i of members) { sequence.push(i); band[i] = bandIndex; }
  });
  const words = major === "y"
    ? `${bandDirection > 0 ? "上到下" : "下到上"}分帶，帶內${withinDirection > 0 ? "左到右" : "右到左"}`
    : `${bandDirection > 0 ? "左到右" : "右到左"}分欄，欄內${withinDirection > 0 ? "上到下" : "下到上"}`;
  return { name: words, sequence, band };
}

/** Blocks that continue one row across an aisle: same line direction, along
 * the band, and lined up on the cross axis (CH20's 01–10 / 11–20 / 21–30). */
function chainable(blocks: CellBlock[], a: number, b: number, major: "x" | "y") {
  const along: MapOrientation = major === "x" ? "vertical" : "horizontal";
  const lines = (block: CellBlock) => (orientationOf(block) === "vertical" ? block.columns : block.rows);
  return orientationOf(blocks[a]) === along && orientationOf(blocks[b]) === along && lines(blocks[a]) === lines(blocks[b])
    && overlapShare(blocks[a].bounds, blocks[b].bounds, major) >= 0.7;
}

/** How far a block's booth count may be from the list and still be the
 * row: a booth or two the recogniser missed, never a fifth of the row. */
const tolerance = (need: number) => Math.min(2, Math.floor(need * 0.1));
const matchWeight = (difference: number) => (difference === 0 ? 1 : difference === 1 ? 0.7 : 0.5);

type Alignment = { assigned: Map<number, Unit>; score: number; skipped: number };

/** Order-preserving alignment of list rows to walked blocks: rows and blocks
 * may each be skipped (a row the plan does not draw, a block that is a
 * company booth), and a row may take a run of collinear blocks. */
function alignRows(blocks: CellBlock[], rows: BoothListRow[], rowIndexes: number[], walked: Walk, major: "x" | "y", used: Set<number>): Alignment {
  const sequence = walked.sequence.filter((b) => !used.has(b));
  const R = rowIndexes.length;
  const B = sequence.length;
  type Cell = { score: number; skipped: number; from: [number, number] | null; take: number[] | null };
  const table: Cell[][] = Array.from({ length: R + 1 }, () => Array.from({ length: B + 1 }, () => ({ score: -Infinity, skipped: 0, from: null, take: null })));
  table[0][0] = { score: 0, skipped: 0, from: null, take: null };
  const better = (a: Cell, score: number, skipped: number) => score > a.score + 1e-9 || (Math.abs(score - a.score) <= 1e-9 && skipped < a.skipped);
  for (let i = 0; i <= R; i += 1) {
    for (let j = 0; j <= B; j += 1) {
      const here = table[i][j];
      if (here.score === -Infinity) continue;
      if (j < B && better(table[i][j + 1], here.score, here.skipped + 1)) table[i][j + 1] = { score: here.score, skipped: here.skipped + 1, from: [i, j], take: null };
      if (i < R && better(table[i + 1][j], here.score, here.skipped)) table[i + 1][j] = { score: here.score, skipped: here.skipped, from: [i, j], take: null };
      if (i >= R || j >= B) continue;
      const need = rows[rowIndexes[i]].entries.length;
      const chain: number[] = [];
      let total = 0;
      for (let k = j; k < B; k += 1) {
        const block = sequence[k];
        if (chain.length && (walked.band[block] !== walked.band[chain[0]] || !chainable(blocks, chain[chain.length - 1], block, major))) break;
        chain.push(block);
        total += blocks[block].cells.length;
        const difference = Math.abs(total - need);
        if (difference <= tolerance(need)) {
          const score = here.score + matchWeight(difference);
          if (better(table[i + 1][k + 1], score, here.skipped)) table[i + 1][k + 1] = { score, skipped: here.skipped, from: [i, j], take: [...chain] };
        }
        if (total > need + 2) break;
      }
    }
  }
  const assigned = new Map<number, Unit>();
  let cursor: [number, number] | null = [R, B];
  const end = table[R][B];
  while (cursor) {
    const cell: Cell = table[cursor[0]][cursor[1]];
    if (cell.take && cell.from) assigned.set(rowIndexes[cell.from[0]], { blocks: cell.take, count: cell.take.reduce((sum, b) => sum + blocks[b].cells.length, 0) });
    cursor = cell.from;
  }
  return { assigned, score: end.score, skipped: end.skipped };
}

/** Matches list rows to blocks. One walking order rarely fits a whole sheet
 * that draws several halls, so after the best walk places what it can, the
 * rest is matched again with its own best walk. */
function matchRows(blocks: CellBlock[], rows: BoothListRow[]) {
  const walks: Array<{ walked: Walk; major: "x" | "y" }> = [];
  for (const major of ["y", "x"] as const) {
    for (const bandDirection of [-1, 1] as const) {
      for (const withinDirection of [-1, 1] as const) walks.push({ walked: walk(blocks, major, bandDirection, withinDirection), major });
    }
  }
  const used = new Set<number>();
  const assigned = new Map<number, Unit>();
  const names: string[] = [];
  for (let pass = 0; pass < 4; pass += 1) {
    const remaining = rows.map((_, i) => i).filter((i) => !assigned.has(i));
    if (!remaining.length) break;
    let best: { alignment: Alignment; name: string } | null = null;
    for (const { walked, major } of walks) {
      const alignment = alignRows(blocks, rows, remaining, walked, major, used);
      if (!best || alignment.score > best.alignment.score + 1e-9 || (Math.abs(alignment.score - best.alignment.score) <= 1e-9 && alignment.skipped < best.alignment.skipped)) best = { alignment, name: walked.name };
    }
    // A later pass has to place at least two rows: one row "matching" by
    // count alone is as likely to be a coincidence as a hall.
    if (!best || best.alignment.assigned.size < (pass === 0 ? 1 : 2)) break;
    for (const [row, unit] of best.alignment.assigned) {
      assigned.set(row, unit);
      for (const b of unit.blocks) used.add(b);
    }
    names.push(best.name);
  }
  // Last resort for a row outside every walking order (a short column tucked
  // into a corner): it takes an unused block only when exactly one has its
  // booth count, so nothing is guessed between look-alikes.
  rows.forEach((row, rowIndex) => {
    if (assigned.has(rowIndex)) return;
    const fits = blocks.map((block, b) => ({ block, b })).filter(({ block, b }) => !used.has(b) && block.cells.length === row.entries.length);
    if (fits.length !== 1) return;
    assigned.set(rowIndex, { blocks: [fits[0].b], count: row.entries.length });
    used.add(fits[0].b);
  });
  return { assigned, walkNames: names };
}

type Path = { name: string; cells: number[] };

/** Every plausible way to number a block: lines in either order, the first
 * line in either direction, then a U-turn (snake) or the same direction. */
function blockPaths(block: CellBlock): Path[] {
  const vertical = orientationOf(block) === "vertical";
  const lineCount = vertical ? block.columns : block.rows;
  const lines: number[][] = Array.from({ length: lineCount }, () => []);
  block.grid.forEach((position, k) => {
    const line = vertical ? position.column : position.row;
    lines[line].push(k);
  });
  const along = (k: number) => (vertical ? block.grid[k].row : block.grid[k].column);
  for (const line of lines) line.sort((a, b) => along(a) - along(b));
  const paths: Path[] = [];
  const seen = new Set<string>();
  for (const lineOrder of [1, -1]) {
    for (const firstDirection of [1, -1]) {
      for (const snake of [true, false]) {
        const ordered = lineOrder > 0 ? lines : [...lines].reverse();
        const cells: number[] = [];
        ordered.forEach((line, index) => {
          const forward = snake && index % 2 === 1 ? -firstDirection : firstDirection;
          cells.push(...(forward > 0 ? line : [...line].reverse()).map((k) => block.cells[k]));
        });
        const key = cells.join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        paths.push({ name: `${lineCount > 1 ? (snake ? "U 形折返" : "同向逐排") : "單排"}`, cells });
      }
    }
  }
  return paths;
}

function describeStart(cells: BoothCell[], first: number, bounds: Rect) {
  const cell = cells[first];
  const cx = cell.x + cell.width / 2;
  const cy = cell.y + cell.height / 2;
  const vertical = cy > bounds.y + bounds.height / 2 ? "下" : "上";
  const horizontal = cx > bounds.x + bounds.width / 2 ? "右" : "左";
  return `${vertical}${horizontal}`;
}

function unionBounds(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y };
}

type Entry = BoothListRow["entries"][number];

/** How a plan may print a booth's number inside its cell. */
const FORMS: Array<{ name: string; text: (entry: Entry) => string }> = [
  { name: "不補零", text: (entry) => String(entry.number) },
  { name: "補零", text: (entry) => String(entry.number).padStart(Math.max(2, entry.digits), "0") },
  { name: "完整代碼", text: (entry) => entry.code.replace(/\s/gu, "") },
];

type Numbering = { cells: number[]; texts: string[]; codes: string[]; description: string; confidence: number; dropped: string[] };

/** A way to number a row: a path through its cells and a printed form. When
 * the row has fewer cells than the list (or more), `cells` and `entries` are
 * the aligned pairs and `dropped` the codes left without a booth. */
type Hypothesis = { cells: number[]; entries: Entry[]; texts: string[]; path: string; form: string; dropped: string[]; cost: number };
type Base = { cells: number[]; entries: Entry[]; path: string; form: (typeof FORMS)[number] };

function numberingBases(result: RecognitionResult, unit: Unit, entries: Entry[]): Base[] {
  const { blocks } = result;
  const blockPathSets = unit.blocks.map((b) => blockPaths(blocks[b]));
  // Every block of a row follows the same rule, so path k of each block is
  // combined, in both chain directions.
  const bases: Base[] = [];
  const perBlock = Math.min(...blockPathSets.map((set) => set.length));
  for (let k = 0; k < perBlock; k += 1) {
    for (const reverseChain of unit.blocks.length > 1 ? [false, true] : [false]) {
      const order = reverseChain ? [...blockPathSets].reverse() : blockPathSets;
      const cells = order.flatMap((set) => set[k].cells);
      for (const form of FORMS) bases.push({ cells, entries, path: blockPathSets[0][k].name, form });
    }
  }
  return bases;
}

/** Scores a base with the row's own glyph classes. Only used when the row
 * has exactly as many cells as codes; otherwise there is nothing to align
 * against yet. */
function localHypothesis(result: RecognitionResult, base: Base): Hypothesis {
  const texts = base.entries.map(base.form.text);
  const { cost } = readingCost(base.cells.map((c) => result.glyphs[c]), texts);
  return { cells: base.cells, entries: base.entries, texts, path: base.path, form: base.form.name, dropped: [], cost };
}

/** Aligns the base's cells to its codes against learned prototypes: a
 * dynamic program over (cell, code) that may leave out as many codes (or
 * cells) as the counts differ, choosing which by glyph fit. */
function alignedHypothesis(result: RecognitionResult, base: Base, prototypes: Map<string, Float32Array>): Hypothesis {
  const texts = base.entries.map(base.form.text);
  const n = base.cells.length;
  const m = texts.length;
  const pairCost = (i: number, j: number) => {
    const glyphs = result.glyphs[base.cells[i]];
    return glyphs.length ? cellCost(glyphs, texts[j], prototypes) : 0;
  };
  if (n === m) {
    let total = 0;
    for (let k = 0; k < n; k += 1) total += pairCost(k, k);
    const compared = base.cells.filter((c) => result.glyphs[c].length).length;
    return { cells: base.cells, entries: base.entries, texts, path: base.path, form: base.form.name, dropped: [], cost: compared ? total / compared : 0.5 };
  }
  const costs = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  const moves = Array.from({ length: n + 1 }, () => new Int8Array(m + 1));
  costs[0][0] = 0;
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      if (i === 0 && j === 0) continue;
      let best = Infinity;
      let move = 0;
      if (i > 0 && j > 0 && costs[i - 1][j - 1] + pairCost(i - 1, j - 1) < best) { best = costs[i - 1][j - 1] + pairCost(i - 1, j - 1); move = 1; }
      if (j > 0 && j - i > 0 && m > n && costs[i][j - 1] < best) { best = costs[i][j - 1]; move = 2; }
      if (i > 0 && i - j > 0 && n > m && costs[i - 1][j] < best) { best = costs[i - 1][j]; move = 3; }
      costs[i][j] = best;
      moves[i][j] = move;
    }
  }
  const cells: number[] = [];
  const entries: Entry[] = [];
  const dropped: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const move = moves[i][j];
    if (move === 1) { cells.unshift(base.cells[i - 1]); entries.unshift(base.entries[j - 1]); i -= 1; j -= 1; }
    else if (move === 2) { dropped.unshift(base.entries[j - 1].code); j -= 1; }
    else if (move === 3) i -= 1;
    else break;
  }
  const compared = cells.filter((c) => result.glyphs[c].length).length;
  return { cells, entries, texts: entries.map(base.form.text), path: base.path, form: base.form.name, dropped, cost: compared ? costs[n][m] / compared : 0.5 };
}

/** How a hypothesis numbers its row, in words: start, path and printed
 * form. Two rows with the same words follow the same organizer rule. */
function describe(result: RecognitionResult, unit: Unit, hypothesis: Hypothesis) {
  const { cells, blocks } = result;
  const bounds = unionBounds(unit.blocks.map((b) => blocks[b].bounds));
  const single = unit.blocks.every((b) => Math.min(blocks[b].columns, blocks[b].rows) === 1);
  const vertical = orientationOf(blocks[unit.blocks[0]]) === "vertical";
  const corner = describeStart(cells, hypothesis.cells[0], bounds);
  const start = single ? (vertical ? corner[0] : corner[1]) + "端" : corner;
  return { scheme: `${single ? "single" : "multi"}|${start}|${hypothesis.path}|${hypothesis.form}`, text: `自${start}起，${hypothesis.path}，${hypothesis.form}` };
}

/** The chosen hypothesis with a confidence built from two kinds of evidence:
 * how clearly its glyphs beat the best reading that numbers the booths
 * differently, and whether it follows the rule most rows of the map follow
 * (organizers number a whole sheet one way). */
function finalize(result: RecognitionResult, unit: Unit, hypotheses: Hypothesis[], chosen: Hypothesis, agrees: boolean | null): Numbering {
  const { cells } = result;
  const signature = (h: Hypothesis) => h.cells.map((c, k) => `${c}:${h.entries[k].code}`).join(",");
  const chosenSignature = signature(chosen);
  const rival = hypotheses.find((h) => signature(h) !== chosenSignature);
  const margin = rival ? Math.max(0, (rival.cost - chosen.cost) / Math.max(rival.cost, 1e-6)) : 0;
  const inferredShare = chosen.cells.filter((c) => cells[c].source === "inferred").length / Math.max(1, chosen.cells.length);
  const consensus = agrees === null ? 0 : agrees ? 0.2 : -0.15;
  const confidence = Math.max(0.05, Math.min(0.95, 0.4 + margin * 2.5 + consensus - inferredShare * 0.3 - chosen.dropped.length * 0.1));
  return {
    cells: chosen.cells,
    texts: chosen.texts,
    codes: chosen.entries.map((entry) => entry.code),
    description: describe(result, unit, chosen).text,
    confidence: Math.round(confidence * 100) / 100,
    dropped: chosen.dropped,
  };
}

export type RowReport = { label: string; booths: number; blocks: number; numbering: string; confidence: number };
export type RecognitionDiagnostic = { kind: "notice"; message: string }
  | { kind: "missing-row" | "missing-slots"; label: string; codes: string[] };

export type LayoutReport = {
  layout: EventMapLayout;
  valid: boolean;
  errors: string[];
  warnings: string[];
  diagnostics: RecognitionDiagnostic[];
  confidence: number;
  rows: RowReport[];
  walk: string | null;
  unmatchedBlocks: number;
  missingRows: string[];
};

export type BuildOptions = { template?: string; boothList?: string };

export function buildLayout(result: RecognitionResult, options: BuildOptions = {}): LayoutReport {
  const warnings: string[] = [];
  const diagnostics: RecognitionDiagnostic[] = [];
  const notice = (message: string) => { warnings.push(message); diagnostics.push({ kind: "notice", message }); };
  const { cells, blocks } = result;
  const list = options.boothList?.trim() ? parseBoothList(options.boothList) : null;
  if (list?.ignored.length) notice(`攤位清單有 ${list.ignored.length} 個無法解讀的項目（例：${list.ignored.slice(0, 3).join("、")}）。`);

  const rowsOut: EventMapLayout["rows"] = [];
  const reports: RowReport[] = [];
  const usedBlocks = new Set<number>();
  const missingRows: string[] = [];
  let walkName: string | null = null;
  type Job = { label: string; unit: Unit; entries: Entry[]; provisional: boolean };
  const jobs: Job[] = [];

  if (list && list.rows.length) {
    const match = matchRows(blocks, list.rows);
    walkName = match.walkNames.join("；") || null;
    list.rows.forEach((row, rowIndex) => {
      const unit = match.assigned.get(rowIndex);
      if (!unit) { missingRows.push(row.label); diagnostics.push({ kind: "missing-row", label: row.label, codes: row.entries.map(entry => entry.code) }); return; }
      for (const b of unit.blocks) usedBlocks.add(b);
      jobs.push({ label: row.label, unit, entries: row.entries, provisional: false });
    });
    if (missingRows.length) warnings.push(`找不到攤位數相符的區塊：${missingRows.join("、")} 排。請在編輯器中手動新增。`);
  }

  // Blocks no row claimed (or every block, without a list) become provisional
  // rows in reading order so a person can see and rename them.
  const leftovers = walk(blocks, "y", 1, 1).sequence.filter((b) => !usedBlocks.has(b));
  leftovers.forEach((b, k) => {
    const label = `?${k + 1}`;
    const count = blocks[b].cells.length;
    const entries = Array.from({ length: count }, (_, n) => ({ code: `${label}-${String(n + 1).padStart(2, "0")}`, number: n + 1, digits: 2 }));
    jobs.push({ label, unit: { blocks: [b], count }, entries, provisional: true });
  });
  if (list && leftovers.length) notice(`有 ${leftovers.length} 個區塊沒有對應到清單中的排，暫以 ?1、?2… 標示；可能是企業攤或辨識多出的格子。`);

  // Numbering in two rounds. Rows whose cell count matches the list are read
  // on their own evidence first; their answers teach one glyph prototype per
  // character, and every row is then aligned against those prototypes, which
  // also decides which code a short row is missing.
  const bases = jobs.map((job) => numberingBases(result, job.unit, job.entries));
  const firstReadings = jobs.map((job, k) => {
    if (job.provisional || job.unit.count !== job.entries.length) return null;
    const hypotheses = bases[k].map((base) => localHypothesis(result, base)).sort((a, b) => a.cost - b.cost);
    return hypotheses[0] ?? null;
  });
  const prototypes = learnPrototypes(firstReadings.filter((h): h is Hypothesis => h !== null).map((h) => ({ cells: h.cells.map((c) => result.glyphs[c]), texts: h.texts })));
  const ranked = jobs.map((job, k) => {
    const hypotheses = prototypes.size
      ? bases[k].map((base) => alignedHypothesis(result, base, prototypes))
      : bases[k].filter((base) => base.cells.length === base.entries.length).map((base) => localHypothesis(result, base));
    return hypotheses.sort((a, b) => a.cost - b.cost);
  });
  // The map's own rule: the most common scheme among list rows, separately
  // for single lines and for rows that fold over several lines.
  const votes = new Map<string, number>();
  jobs.forEach((job, k) => {
    if (job.provisional || !ranked[k].length) return;
    const { scheme } = describe(result, job.unit, ranked[k][0]);
    votes.set(scheme, (votes.get(scheme) ?? 0) + 1);
  });
  const majority = (kind: string) => {
    const entries = [...votes.entries()].filter(([scheme]) => scheme.startsWith(kind + "|")).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    return entries.length && total >= 3 && entries[0][1] / total >= 0.6 ? entries[0][0] : null;
  };
  jobs.forEach((job, k) => {
    const hypotheses = ranked[k];
    if (!hypotheses.length) {
      missingRows.push(job.label);
      diagnostics.push({ kind: "missing-row", label: job.label, codes: job.entries.map(entry => entry.code) });
      warnings.push(`找不到可編號的區塊：${job.label} 排。請在編輯器中手動新增。`);
      return;
    }
    let chosen = hypotheses[0];
    const { scheme } = describe(result, job.unit, chosen);
    const rule = majority(scheme.split("|")[0]);
    let agrees: boolean | null = rule === null || job.provisional ? null : scheme === rule;
    if (agrees === false) {
      // A near tie against the map's rule goes to the rule.
      const follower = hypotheses.find((h) => describe(result, job.unit, h).scheme === rule);
      if (follower && follower.cost <= chosen.cost * 1.03) { chosen = follower; agrees = true; }
    }
    const numbering = finalize(result, job.unit, hypotheses, chosen, agrees);
    const secondary = job.unit.blocks.some((b) => blocks[b].cells.some((c) => cells[c].sizeGroup > 0));
    const confidence = job.provisional ? Math.min(numbering.confidence, secondary ? 0.2 : 0.4) : numbering.confidence;
    rowsOut.push({
      label: job.label,
      orientation: orientationOf(blocks[job.unit.blocks[0]]),
      confidence,
      slots: numbering.cells.map((cellIndex, n) => {
        const cell = cells[cellIndex];
        return { code: numbering.codes[n], rect: { x: cell.x, y: cell.y, width: cell.width, height: cell.height } };
      }),
    });
    reports.push({ label: job.label, booths: numbering.cells.length, blocks: job.unit.blocks.length, numbering: numbering.description, confidence });
    if (numbering.dropped.length) {
      warnings.push(`${job.label} 排比清單少 ${numbering.dropped.length} 格，推定 ${numbering.dropped.join("、")} 未畫出或未辨識，請人工補上。`);
      diagnostics.push({ kind: "missing-slots", label: job.label, codes: numbering.dropped });
    }
  });
  const provisional = leftovers.length;

  const floor = result.floor;
  const inside = (x: number, y: number) => ({ x: Math.min(Math.max(0, x), result.width), y: Math.min(Math.max(0, y), result.height) });
  const distanceToFloorEdge = (point: { x: number; y: number }) => Math.min(
    Math.abs(point.x - floor.x), Math.abs(point.x - floor.x - floor.width), Math.abs(point.y - floor.y), Math.abs(point.y - floor.y - floor.height));
  const floorCenter = { x: floor.x + floor.width / 2, y: floor.y + floor.height / 2 };
  const accessPoints: MapAccessPoint[] = result.arrows.map((arrow, k) => {
    const tailToCenter = Math.hypot(arrow.x - floorCenter.x, arrow.y - floorCenter.y);
    const tipToCenter = Math.hypot(arrow.tip.x - floorCenter.x, arrow.tip.y - floorCenter.y);
    const entrance = tipToCenter < tailToCenter;
    const door = distanceToFloorEdge(arrow.tip) < distanceToFloorEdge(arrow) ? arrow.tip : arrow;
    const point = inside(door.x, door.y);
    return { id: `door-${k + 1}`, kind: entrance ? "entrance" : "exit", direction: arrow.direction, x: Math.round(point.x), y: Math.round(point.y), label: entrance ? "入口" : "出口" };
  });

  const layout: EventMapLayout = {
    version: EVENT_MAP_VERSION,
    template: options.template?.trim() || "auto-grid",
    width: result.width,
    height: result.height,
    floor,
    rows: rowsOut,
    pillars: result.pillars.map((pillar, k) => ({ id: `pillar-${k + 1}`, x: pillar.x, y: pillar.y, width: pillar.width, height: pillar.height })),
    accessPoints,
    landmarks: result.largeBlocks.map((block, k) => ({ id: `area-${k + 1}`, kind: "other" as const, rect: { x: block.x, y: block.y, width: block.width, height: block.height }, label: `未命名區域 ${k + 1}` })),
  };
  const validation = validateEventMapLayout(layout);
  const booths = rowsOut.reduce((sum, row) => sum + row.slots.length, 0);
  const confidence = booths ? rowsOut.reduce((sum, row) => sum + row.confidence * row.slots.length, 0) / booths : 0;
  if (!result.cells.length) notice("沒有找到攤位格。這張配置圖可能不是格狀攤位，請改用空白地圖描摹。");
  if (result.largeBlocks.length) notice(`有 ${result.largeBlocks.length} 個大型區塊（企業攤、舞台或特區）已框出，名稱需要人工填寫。`);
  return {
    layout,
    valid: validation.ok,
    errors: validation.errors,
    warnings,
    diagnostics,
    confidence: Math.round(confidence * 100) / 100,
    rows: reports,
    walk: walkName,
    unmatchedBlocks: provisional,
    missingRows,
  };
}

export function layoutSummary(report: LayoutReport) {
  return {
    rows: report.layout.rows.length,
    booths: report.layout.rows.reduce((sum, row) => sum + row.slots.length, 0),
    pillars: report.layout.pillars.length,
    accessPoints: report.layout.accessPoints.length,
    landmarks: report.layout.landmarks.length,
  };
}

