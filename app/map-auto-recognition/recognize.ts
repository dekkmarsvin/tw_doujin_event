/**
 * Booth-grid recognition over raw RGBA pixels, with no template.
 *
 * The recognizer assumes only what Taiwanese doujin floor plans share: booths
 * are drawn as many same-sized rectangles packed edge to edge into straight
 * runs. Everything else (row letters, numbering direction, hall outline) varies
 * per organizer, so it is left to the booth list or to a person.
 *
 * Two independent passes propose booth cells, because plans draw them two ways:
 *
 * - **Ruled grids** (FF, PF, CWT, Pier-2): white cells separated by dark lines,
 *   with digits nearly filling each cell. Long straight runs of dark pixels
 *   are the walls; whatever they enclose, digits included, is one cell.
 * - **Filled blocks** (CH, Bahamut): coloured rectangles separated by gaps of a
 *   different colour. Flat regions of one colour are cells; their text is
 *   holes, which the shape measure fills back in.
 *
 * Candidates from both passes are deduplicated, blocks that visibly hold
 * several booth numbers are split, and the dominant cell size decides what is
 * a booth. Adjacent cells then chain into blocks and straight segments.
 *
 * All work is a handful of linear passes over the pixels plus per-candidate
 * work inside each cell's bounding box: roughly a second of CPU for a
 * 4-megapixel plan, and never a model or an external service.
 */
import type { RasterImage } from "./raster";
import { extractGlyphs, type Glyph } from "./glyphs";

export type Rect = { x: number; y: number; width: number; height: number };
export type Rgb = [number, number, number];

export type CellCandidate = Rect & {
  /** `inferred` cells were not seen but sit in a one-booth gap of a run. */
  source: "ruled" | "filled" | "inferred";
  color: Rgb;
  /** Rank of the size cluster the cell belongs to; 0 is the dominant booth size. */
  sizeGroup?: number;
  /** Number of booth numbers stacked along each axis inside the cell, and
   * the share of the cell covered by text. */
  bands: { x: number; y: number; ink: number };
};

/** A booth after grid snapping. `inner` is the outline as first seen (a ruled
 * cell's interior without its walls), which is where its text is read. */
export type BoothCell = Rect & { color: Rgb; source: CellCandidate["source"]; inner: Rect; sizeGroup: number };

export type CellBlock = {
  /** Indexes into `cells`, ordered by the block's grid (row-major). */
  cells: number[];
  bounds: Rect;
  columns: number;
  rows: number;
  /** Grid position of each cell, parallel to `cells`. */
  grid: Array<{ column: number; row: number }>;
};

export type DetectedPillar = Rect;
export type DetectedBlock = Rect & { color: Rgb };
export type DetectedArrow = { x: number; y: number; direction: "north" | "south" | "east" | "west"; tip: { x: number; y: number } };

export type RecognitionResult = {
  width: number;
  height: number;
  floor: Rect;
  cells: BoothCell[];
  blocks: CellBlock[];
  pillars: DetectedPillar[];
  largeBlocks: DetectedBlock[];
  arrows: DetectedArrow[];
  /** Glyph bitmaps per cell, parallel to `cells`. Not serialised. */
  glyphs: Glyph[][];
  metrics: {
    cellSize: { short: number; long: number } | null;
    candidateCount: number;
    rejectedIsolated: number;
    splitCells: number;
    inferredCells: number;
    glyphHeight: number;
    timingsMs: Record<string, number>;
  };
};

type Labeling = { labels: Int32Array; count: number; area: Int32Array; minX: Int32Array; minY: Int32Array; maxX: Int32Array; maxY: Int32Array; sumR: Float64Array; sumG: Float64Array; sumB: Float64Array };

const luminance = (data: Uint8Array, offset: number) => (data[offset] * 299 + data[offset + 1] * 587 + data[offset + 2] * 114) / 1000;

function channelDistance(data: Uint8Array, a: number, b: number) {
  return Math.max(Math.abs(data[a] - data[b]), Math.abs(data[a + 1] - data[b + 1]), Math.abs(data[a + 2] - data[b + 2]));
}

/** Connected components over pixels where `open(i)` holds, joined when
 * `joins(seed, candidate)` holds. Scanline-free BFS with a shared stack, so the
 * cost is one visit per pixel. */
function labelComponents(
  width: number,
  height: number,
  open: (index: number) => boolean,
  joins: (seed: number, candidate: number) => boolean,
  data: Uint8Array,
): Labeling {
  const size = width * height;
  const labels = new Int32Array(size).fill(-1);
  const stack = new Int32Array(size);
  let capacity = 1024;
  let area = new Int32Array(capacity);
  let minX = new Int32Array(capacity);
  let minY = new Int32Array(capacity);
  let maxX = new Int32Array(capacity);
  let maxY = new Int32Array(capacity);
  let sumR = new Float64Array(capacity);
  let sumG = new Float64Array(capacity);
  let sumB = new Float64Array(capacity);
  const grow = () => {
    capacity *= 2;
    const growInt = (source: Int32Array) => { const next = new Int32Array(capacity); next.set(source); return next; };
    const growFloat = (source: Float64Array) => { const next = new Float64Array(capacity); next.set(source); return next; };
    area = growInt(area); minX = growInt(minX); minY = growInt(minY); maxX = growInt(maxX); maxY = growInt(maxY);
    sumR = growFloat(sumR); sumG = growFloat(sumG); sumB = growFloat(sumB);
  };
  let count = 0;
  for (let start = 0; start < size; start += 1) {
    if (labels[start] !== -1 || !open(start)) continue;
    if (count === capacity) grow();
    const id = count;
    count += 1;
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    let n = 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    let r = 0;
    let g = 0;
    let b = 0;
    while (top > 0) {
      const index = stack[--top];
      const x = index % width;
      const y = (index - x) / width;
      n += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const offset = index * 4;
      r += data[offset];
      g += data[offset + 1];
      b += data[offset + 2];
      if (x > 0) { const next = index - 1; if (labels[next] === -1 && open(next) && joins(start, next)) { labels[next] = id; stack[top++] = next; } }
      if (x < width - 1) { const next = index + 1; if (labels[next] === -1 && open(next) && joins(start, next)) { labels[next] = id; stack[top++] = next; } }
      if (y > 0) { const next = index - width; if (labels[next] === -1 && open(next) && joins(start, next)) { labels[next] = id; stack[top++] = next; } }
      if (y < height - 1) { const next = index + width; if (labels[next] === -1 && open(next) && joins(start, next)) { labels[next] = id; stack[top++] = next; } }
    }
    area[id] = n;
    minX[id] = x0; minY[id] = y0; maxX[id] = x1; maxY[id] = y1;
    sumR[id] = r; sumG[id] = g; sumB[id] = b;
  }
  return { labels, count, area, minX, minY, maxX, maxY, sumR, sumG, sumB };
}

/** Median height of small dark blobs: on a booth plan these are overwhelmingly
 * the digits of booth numbers, which sets the scale for what counts as a wall. */
function estimateGlyphHeight(image: RasterImage, dark: Uint8Array): number {
  const { width, height } = image;
  const components = labelComponents(width, height, (i) => dark[i] === 1, () => true, image.data);
  const heights: number[] = [];
  for (let id = 0; id < components.count; id += 1) {
    const h = components.maxY[id] - components.minY[id] + 1;
    const w = components.maxX[id] - components.minX[id] + 1;
    if (h >= 5 && h <= 80 && w <= h * 1.5 && components.area[id] >= 6) heights.push(h);
  }
  if (!heights.length) return 8;
  heights.sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)];
}

/** Dark pixels on straight runs at least `minRun` long, along one axis.
 * Pixels flagged in `discount` still extend a run but do not count toward its
 * length. */
function axisRuns(width: number, height: number, dark: Uint8Array, minRun: number, vertical: boolean, discount: Uint8Array | null): Uint8Array {
  const mask = new Uint8Array(width * height);
  const lines = vertical ? width : height;
  const length = vertical ? height : width;
  const at = vertical ? (line: number, t: number) => t * width + line : (line: number, t: number) => line * width + t;
  for (let line = 0; line < lines; line += 1) {
    let runStart = -1;
    let net = 0;
    for (let t = 0; t <= length; t += 1) {
      const index = t < length ? at(line, t) : -1;
      const on = index >= 0 && dark[index] === 1;
      if (on) {
        if (runStart < 0) { runStart = t; net = 0; }
        if (!discount || discount[index] === 0) net += 1;
      } else if (runStart >= 0) {
        if (net >= minRun) for (let fill = runStart; fill < t; fill += 1) mask[at(line, fill)] = 1;
        runStart = -1;
      }
    }
  }
  return mask;
}

/** Grid walls: dark pixels on straight horizontal or vertical runs clearly
 * longer than a digit. In a narrow cell the digits plus their anti-aliasing
 * can bridge the two side walls into one long dark row, so a run's length is
 * counted without the pixels where it crosses a perpendicular wall: a real
 * wall is long on its own, a row of digits is only long by borrowing. */
function ruledLineMask(image: RasterImage, dark: Uint8Array, minRun: number): Uint8Array {
  const { width, height } = image;
  const rawHorizontal = axisRuns(width, height, dark, minRun, false, null);
  const rawVertical = axisRuns(width, height, dark, minRun, true, null);
  const horizontal = axisRuns(width, height, dark, minRun, false, rawVertical);
  const vertical = axisRuns(width, height, dark, minRun, true, rawHorizontal);
  for (let i = 0; i < horizontal.length; i += 1) horizontal[i] |= vertical[i];
  return horizontal;
}

/** A pixel is flat when none of its 4-neighbours differs by more than
 * `tolerance` in any channel. Edges, anti-aliasing and text are not flat. */
function flatMask(image: RasterImage, tolerance: number): Uint8Array {
  const { width, height, data } = image;
  const flat = new Uint8Array(width * height).fill(1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x < width - 1 && channelDistance(data, index * 4, (index + 1) * 4) > tolerance) { flat[index] = 0; flat[index + 1] = 0; }
      if (y < height - 1 && channelDistance(data, index * 4, (index + width) * 4) > tolerance) { flat[index] = 0; flat[index + width] = 0; }
    }
  }
  return flat;
}

type Shape = { rectangularity: number; fill: number };

/** How much of a component's bounding box it covers once its holes (the text
 * written on it) are filled in: 1 for a rectangle, far less for a glyph, a
 * diagonal or an L-shaped corridor. `scratch` is reused between calls. */
function measureShape(labels: Int32Array, width: number, id: number, box: Rect, area: number, scratch: { buffer: Uint8Array; stack: Int32Array }): Shape {
  const w = box.width;
  const h = box.height;
  const size = w * h;
  if (scratch.buffer.length < size) {
    scratch.buffer = new Uint8Array(size);
    scratch.stack = new Int32Array(size);
  }
  const local = scratch.buffer;
  const stack = scratch.stack;
  for (let y = 0; y < h; y += 1) {
    const row = (box.y + y) * width + box.x;
    for (let x = 0; x < w; x += 1) local[y * w + x] = labels[row + x] === id ? 1 : 0;
  }
  let top = 0;
  const push = (index: number) => { if (local[index] === 0) { local[index] = 2; stack[top++] = index; } };
  for (let x = 0; x < w; x += 1) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y += 1) { push(y * w); push(y * w + w - 1); }
  let outside = 0;
  while (top > 0) {
    const index = stack[--top];
    outside += 1;
    const x = index % w;
    if (x > 0) push(index - 1);
    if (x < w - 1) push(index + 1);
    if (index >= w) push(index - w);
    if (index < size - w) push(index + w);
  }
  // Text touching an edge opens its hole to the outside, which the flood above
  // then counts as missing. Row and column spans fill such a notch from the
  // intact sides, while an L or a diagonal still leaves its gaps.
  let rowSpans = 0;
  for (let y = 0; y < h; y += 1) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < w; x += 1) if (local[y * w + x] === 1) { if (first < 0) first = x; last = x; }
    if (first >= 0) rowSpans += last - first + 1;
  }
  let columnSpans = 0;
  for (let x = 0; x < w; x += 1) {
    let first = -1;
    let last = -1;
    for (let y = 0; y < h; y += 1) if (local[y * w + x] === 1) { if (first < 0) first = y; last = y; }
    if (first >= 0) columnSpans += last - first + 1;
  }
  const spans = (rowSpans + columnSpans) / 2 / size;
  return { rectangularity: Math.max((size - outside) / size, spans), fill: area / size };
}

/** Counts the text lines inside a cell along each axis: bands of pixels that
 * differ from the cell's own colour, separated by clear gaps. A block drawn
 * with two booth numbers stacked in it ("01" over "02") has two y-bands. */
function countTextBands(image: RasterImage, cell: Rect, color: Rgb): { x: number; y: number; ink: number } {
  const { width, data } = image;
  const inset = Math.max(1, Math.round(Math.min(cell.width, cell.height) * 0.08));
  const x0 = cell.x + inset;
  const y0 = cell.y + inset;
  const w = cell.width - inset * 2;
  const h = cell.height - inset * 2;
  if (w < 4 || h < 4) return { x: 1, y: 1, ink: 0 };
  let ink = 0;
  const columns = new Int32Array(w);
  const rows = new Int32Array(h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const offset = ((y0 + y) * width + x0 + x) * 4;
      const distance = Math.max(Math.abs(data[offset] - color[0]), Math.abs(data[offset + 1] - color[1]), Math.abs(data[offset + 2] - color[2]));
      if (distance > 60) { columns[x] += 1; rows[y] += 1; ink += 1; }
    }
  }
  return { x: significantBands(columns), y: significantBands(rows), ink: ink / (w * h) };
}

/** Bands in a projection profile, merging those separated by a gap narrower
 * than half the mean band: the gap between two digits of one number is small,
 * the gap between two stacked numbers is about a line height. Bands must be of
 * similar thickness, so a crown icon over a booth code is not a second booth. */
function significantBands(profile: Int32Array): number {
  const bands: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= profile.length; i += 1) {
    const on = i < profile.length && profile[i] > 0;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { bands.push([start, i]); start = -1; }
  }
  const solid = bands.filter(([a, b]) => b - a >= 2);
  if (solid.length < 2) return 1;
  const mean = solid.reduce((sum, [a, b]) => sum + b - a, 0) / solid.length;
  const merged: Array<[number, number]> = [[...solid[0]]];
  for (const band of solid.slice(1)) {
    const last = merged[merged.length - 1];
    if (band[0] - last[1] < mean * 0.5) last[1] = band[1];
    else merged.push([...band]);
  }
  if (merged.length < 2) return 1;
  const thickness = merged.map(([a, b]) => b - a);
  if (Math.min(...thickness) < Math.max(...thickness) * 0.6) return 1;
  return merged.length;
}

function rectOf(labeling: Labeling, id: number): Rect {
  return { x: labeling.minX[id], y: labeling.minY[id], width: labeling.maxX[id] - labeling.minX[id] + 1, height: labeling.maxY[id] - labeling.minY[id] + 1 };
}

function meanColor(labeling: Labeling, id: number): Rgb {
  const n = labeling.area[id];
  return [Math.round(labeling.sumR[id] / n), Math.round(labeling.sumG[id] / n), Math.round(labeling.sumB[id] / n)];
}

function overlap(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export type RecognizeOptions = {
  /** Smallest booth side in pixels. Plans are rarely legible below this. */
  minCellSide?: number;
  /** Largest booth side, as a fraction of the longer image side. */
  maxCellFraction?: number;
};

export function recognizeBoothGrid(image: RasterImage, options: RecognizeOptions = {}): RecognitionResult {
  const timings: Record<string, number> = {};
  let mark = performance.now();
  const lap = (name: string) => { const now = performance.now(); timings[name] = Math.round(now - mark); mark = now; };
  const { width, height, data } = image;
  const size = width * height;
  const minSide = options.minCellSide ?? 6;
  const maxSide = Math.max(64, Math.max(width, height) * (options.maxCellFraction ?? 0.12));

  const dark = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) dark[i] = luminance(data, i * 4) < 200 ? 1 : 0;
  const glyphHeight = estimateGlyphHeight(image, dark);
  lap("glyphs");

  const candidates: CellCandidate[] = [];
  const scratch = { buffer: new Uint8Array(4096), stack: new Int32Array(4096) };
  const collect = (labeling: Labeling, source: CellCandidate["source"], minRectangularity: number) => {
    for (let id = 0; id < labeling.count; id += 1) {
      const box = rectOf(labeling, id);
      if (box.width < minSide || box.height < minSide || box.width > maxSide || box.height > maxSide) continue;
      if (Math.max(box.width, box.height) / Math.min(box.width, box.height) > 5) continue;
      if (labeling.area[id] < box.width * box.height * 0.25) continue;
      const shape = measureShape(labeling.labels, width, id, box, labeling.area[id], scratch);
      if (shape.rectangularity < minRectangularity) continue;
      const color = meanColor(labeling, id);
      candidates.push({ ...box, source, color, bands: { x: 1, y: 1, ink: 0 } });
    }
  };

  // Ruled pass: walls are dark runs clearly longer than a digit is tall.
  const walls = ruledLineMask(image, dark, Math.max(8, Math.ceil(glyphHeight * 1.8)));
  const ruled = labelComponents(width, height, (i) => walls[i] === 0, () => true, data);
  collect(ruled, "ruled", 0.85);
  lap("ruled");

  // Filled pass: regions of one flat colour, grown against the seed's colour
  // so a slow gradient cannot chain two different fills together.
  const flat = flatMask(image, 22);
  const filled = labelComponents(width, height, (i) => flat[i] === 1, (seed, next) => channelDistance(data, seed * 4, next * 4) <= 40, data);
  collect(filled, "filled", 0.9);
  lap("filled");

  // Split cells that visibly carry several booth numbers. The decision is made
  // per size cluster, not per cell: a lone "11" has two well-separated glyphs
  // too, but only a plan that draws two numbers in every block ("01" over
  // "02") has most of its cells agree on the same count along the same axis.
  for (const candidate of candidates) candidate.bands = countTextBands(image, candidate, candidate.color);
  // Every plan writes a number or code on its booths. A rectangle with
  // nothing in it is a pillar, a blank table, a legend swatch or a margin.
  const credible = candidates.filter((c) => c.bands.ink >= 0.02);
  candidates.length = 0;
  candidates.push(...credible);
  const clusters = sizeClusters(candidates);
  let splitCells = 0;
  const accepted: CellCandidate[] = [];
  const inCluster = new Set(clusters.flat());
  const unit = clusters.length ? medianCellSize(clusters[0].map((i) => candidates[i])) : null;
  // Merged runs: a faint, dashed or digit-bridged wall leaves several booths
  // in one rectangle. One side matches the booth size and the other is a
  // whole multiple of it, so it is cut back into equal booths.
  if (unit) {
    // Only rectangles filled like the booths themselves: a labelled service
    // desk of the right height is still not a run of booths.
    const boothColors = clusters[0].map((i) => candidates[i].color);
    const likeBooth = (color: Rgb) => boothColors.filter((c) => Math.max(Math.abs(c[0] - color[0]), Math.abs(c[1] - color[1]), Math.abs(c[2] - color[2])) <= 30).length >= Math.max(3, boothColors.length * 0.1);
    for (let i = 0; i < candidates.length; i += 1) {
      if (inCluster.has(i) || !likeBooth(candidates[i].color)) continue;
      const pieces = splitMergedRun(candidates[i], unit);
      if (pieces) { accepted.push(...pieces.map((piece) => ({ ...piece, sizeGroup: 0 }))); splitCells += 1; }
    }
  }
  clusters.forEach((cluster, rank) => { for (const i of cluster) candidates[i].sizeGroup = rank; });
  for (const cluster of clusters) {
    const votes = new Map<string, number>();
    for (const i of cluster) {
      const { x, y } = candidates[i].bands;
      const key = x > 1 && y === 1 ? `x${x}` : y > 1 && x === 1 ? `y${y}` : "1";
      votes.set(key, (votes.get(key) ?? 0) + 1);
    }
    const [winner, count] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    const along = winner[0] === "x" ? "x" : winner[0] === "y" ? "y" : null;
    const parts = along ? Number(winner.slice(1)) : 1;
    const agreed = along !== null && count >= cluster.length * 0.6 && parts <= 6;
    for (const i of cluster) {
      const candidate = candidates[i];
      const pieceSide = along === "y" ? candidate.height / parts : candidate.width / parts;
      if (!agreed || pieceSide < minSide) {
        accepted.push(candidate);
        continue;
      }
      splitCells += 1;
      for (let k = 0; k < parts; k += 1) {
        accepted.push(along === "y"
          ? { ...candidate, y: candidate.y + (candidate.height * k) / parts, height: candidate.height / parts }
          : { ...candidate, x: candidate.x + (candidate.width * k) / parts, width: candidate.width / parts });
      }
    }
  }
  lap("split");

  // Deduplicate booth-sized candidates only, so a large non-booth region can
  // never suppress the cells it overlaps. Both passes often find the same
  // cell; the larger outline wins (a ruled cell over its own white interior).
  accepted.sort((a, b) => b.width * b.height - a.width * a.height);
  const unique: CellCandidate[] = [];
  const index = new SpatialIndex(Math.max(16, Math.round(glyphHeight * 4)));
  for (const candidate of accepted) {
    const area = candidate.width * candidate.height;
    if (index.query(candidate).some((other) => overlap(other, candidate) > area * 0.5)) continue;
    unique.push(candidate);
    index.insert(candidate);
  }

  const inferred = fillSingleGaps(image, unique);
  const { cells, blocks, rejected } = chainBlocks([...unique, ...inferred]);
  lap("blocks");

  const glyphs = cells.map((cell) => extractGlyphs(image, cell.inner));
  lap("glyphs-read");
  const cellSize = medianCellSize(cells);
  const floor = findFloor(filled, cells, width, height);
  // Wall pillars straddle the floor outline, so only the centre must be in.
  const onFloor = (rect: Rect) => {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    return cx >= floor.x && cy >= floor.y && cx <= floor.x + floor.width && cy <= floor.y + floor.height;
  };
  const pillars = findPillars(filled, cellSize, cells).filter(onFloor);
  const largeBlocks = findLargeBlocks(filled, cellSize, cells, width, height, scratch).filter(onFloor);
  const arrows = findArrows(image, cellSize);
  lap("features");

  return {
    width,
    height,
    floor,
    cells,
    blocks,
    pillars,
    largeBlocks,
    arrows,
    glyphs,
    metrics: { cellSize, candidateCount: candidates.length, rejectedIsolated: rejected, splitCells, inferredCells: inferred.length, glyphHeight, timingsMs: timings },
  };
}

/** A uniform grid of buckets for overlap queries between rectangles. */
class SpatialIndex {
  private buckets = new Map<string, Rect[]>();
  constructor(private cell: number) {}
  private keys(rect: Rect) {
    const keys: string[] = [];
    for (let gx = Math.floor(rect.x / this.cell); gx <= Math.floor((rect.x + rect.width) / this.cell); gx += 1) {
      for (let gy = Math.floor(rect.y / this.cell); gy <= Math.floor((rect.y + rect.height) / this.cell); gy += 1) keys.push(`${gx},${gy}`);
    }
    return keys;
  }
  insert(rect: Rect) {
    for (const key of this.keys(rect)) {
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(rect);
      else this.buckets.set(key, [rect]);
    }
  }
  query(rect: Rect): Rect[] {
    const found = new Set<Rect>();
    for (const key of this.keys(rect)) for (const other of this.buckets.get(key) ?? []) found.add(other);
    return [...found];
  }
}

/** Booths on one plan share a size (up to rotation). The densest size cluster
 * wins; further clusters are kept only when they are also populous, which is
 * how a plan with several halls drawn at different scales keeps all of them. */
function sizeClusters(pieces: Rect[]): number[][] {
  const dims = pieces.map((piece) => ({ short: Math.min(piece.width, piece.height), long: Math.max(piece.width, piece.height) }));
  const remaining = new Set(dims.map((_, i) => i));
  const clusters: number[][] = [];
  let total = 0;
  const near = (a: { short: number; long: number }, b: { short: number; long: number }) =>
    Math.abs(a.short - b.short) <= b.short * 0.22 && Math.abs(a.long - b.long) <= b.long * 0.22;
  for (let round = 0; round < 4 && remaining.size; round += 1) {
    let best = -1;
    let bestCount = 0;
    for (const i of remaining) {
      let count = 0;
      for (const j of remaining) if (near(dims[j], dims[i])) count += 1;
      if (count > bestCount) { best = i; bestCount = count; }
    }
    const minimum = clusters.length ? Math.max(10, total * 0.02) : 6;
    if (best < 0 || bestCount < minimum) break;
    const center = dims[best];
    const cluster = [...remaining].filter((j) => near(dims[j], center));
    for (const j of cluster) remaining.delete(j);
    clusters.push(cluster);
    total += cluster.length;
  }
  return clusters;
}

function splitMergedRun(candidate: CellCandidate, unit: { short: number; long: number }): CellCandidate[] | null {
  const matches = (value: number, target: number) => Math.abs(value - target) <= target * 0.22;
  for (const [across, along] of [[unit.short, unit.long], [unit.long, unit.short]]) {
    for (const axis of ["x", "y"] as const) {
      const fixed = axis === "x" ? candidate.height : candidate.width;
      const length = axis === "x" ? candidate.width : candidate.height;
      if (!matches(fixed, along)) continue;
      const count = Math.round(length / across);
      if (count < 2 || count > 40 || Math.abs(length - count * across) > across * 0.35) continue;
      return Array.from({ length: count }, (_, k) => axis === "x"
        ? { ...candidate, x: candidate.x + (length * k) / count, width: length / count }
        : { ...candidate, y: candidate.y + (length * k) / count, height: length / count });
    }
  }
  return null;
}

function medianCellSize(cells: Rect[]): { short: number; long: number } | null {
  if (!cells.length) return null;
  const shorts = cells.map((c) => Math.min(c.width, c.height)).sort((a, b) => a - b);
  const longs = cells.map((c) => Math.max(c.width, c.height)).sort((a, b) => a - b);
  return { short: shorts[shorts.length >> 1], long: longs[longs.length >> 1] };
}

/** A run with one booth missing (a wall the passes could not close) shows up
 * as two same-sized cells exactly one booth apart with nothing between them.
 * The gap becomes an inferred booth when it carries text like its neighbours
 * and is not a dark fill (a pillar standing in the run). */
function fillSingleGaps(image: RasterImage, cells: CellCandidate[]): CellCandidate[] {
  const index = new SpatialIndex(64);
  for (const cell of cells) index.insert(cell);
  const similar = (a: Rect, b: Rect) => Math.abs(a.width - b.width) <= a.width * 0.22 && Math.abs(a.height - b.height) <= a.height * 0.22;
  const added: CellCandidate[] = [];
  const seen = new Set<string>();
  for (const a of cells) {
    for (const axis of ["x", "y"] as const) {
      const size = axis === "x" ? a.width : a.height;
      const probe = axis === "x"
        ? { x: a.x + a.width, y: a.y, width: size * 2.6, height: a.height }
        : { x: a.x, y: a.y + a.height, width: a.width, height: size * 2.6 };
      for (const other of index.query(probe)) {
        const b = other as CellCandidate;
        if (b === a || !similar(a, b)) continue;
        const gap = axis === "x" ? b.x - (a.x + a.width) : b.y - (a.y + a.height);
        const cross = axis === "x"
          ? Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
          : Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        if (cross < (axis === "x" ? a.height : a.width) * 0.7) continue;
        if (gap < size * 0.75 || gap > size * 1.5) continue;
        const middle: Rect = axis === "x"
          ? { x: a.x + a.width + (gap - size) / 2, y: (a.y + b.y) / 2, width: size, height: (a.height + b.height) / 2 }
          : { x: (a.x + b.x) / 2, y: a.y + a.height + (gap - size) / 2, width: (a.width + b.width) / 2, height: size };
        const key = `${Math.round(middle.x)},${Math.round(middle.y)}`;
        if (seen.has(key)) continue;
        if (index.query(middle).some((c) => overlap(c, middle) > middle.width * middle.height * 0.2)) continue;
        const box = { x: Math.round(middle.x), y: Math.round(middle.y), width: Math.max(1, Math.round(middle.width)), height: Math.max(1, Math.round(middle.height)) };
        const color = averageColor(image, box);
        const text = countTextBands(image, box, color);
        if (text.ink < 0.03 || (color[0] * 299 + color[1] * 587 + color[2] * 114) / 1000 < 110) continue;
        seen.add(key);
        added.push({ ...middle, source: "inferred", color: a.color, bands: text, sizeGroup: a.sizeGroup });
      }
    }
  }
  return added;
}

function averageColor(image: RasterImage, box: Rect): Rgb {
  // The most common light-ish colour, not the mean, so digits do not darken it.
  const counts = new Map<number, number>();
  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      const o = (y * image.width + x) * 4;
      const key = ((image.data[o] >> 4) << 8) | ((image.data[o + 1] >> 4) << 4) | (image.data[o + 2] >> 4);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let best = 0;
  let bestCount = -1;
  for (const [key, count] of counts) if (count > bestCount) { best = key; bestCount = count; }
  return [((best >> 8) & 15) * 16 + 8, ((best >> 4) & 15) * 16 + 8, (best & 15) * 16 + 8];
}

/** Links cells that touch edge to edge (allowing the width of a drawn wall)
 * into blocks, drops isolated cells, and reads each block as a grid. */
function chainBlocks(candidates: CellCandidate[]): { cells: BoothCell[]; blocks: CellBlock[]; rejected: number } {
  const n = candidates.length;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const index = new SpatialIndex(64);
  const lookup = new Map<Rect, number>();
  candidates.forEach((candidate, i) => { index.insert(candidate); lookup.set(candidate, i); });
  for (let i = 0; i < n; i += 1) {
    const a = candidates[i];
    const gapLimit = Math.max(4, Math.min(a.width, a.height) * 0.3);
    const probe = { x: a.x - gapLimit, y: a.y - gapLimit, width: a.width + gapLimit * 2, height: a.height + gapLimit * 2 };
    for (const other of index.query(probe)) {
      const j = lookup.get(other)!;
      if (j <= i) continue;
      const b = candidates[j];
      const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const yOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      const vertical = xOverlap >= Math.min(a.width, b.width) * 0.7 && -yOverlap <= gapLimit && yOverlap < Math.min(a.height, b.height) * 0.3;
      const horizontal = yOverlap >= Math.min(a.height, b.height) * 0.7 && -xOverlap <= gapLimit && xOverlap < Math.min(a.width, b.width) * 0.3;
      if (vertical || horizontal) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(i);
    else groups.set(root, [i]);
  }
  const cells: BoothCell[] = [];
  const blocks: CellBlock[] = [];
  let rejected = 0;
  for (const members of groups.values()) {
    if (members.length < 2) { rejected += 1; continue; }
    const block = readGrid(members.map((i) => candidates[i]));
    const offset = cells.length;
    for (const cell of block.cells) cells.push({ x: cell.x, y: cell.y, width: cell.width, height: cell.height, color: cell.color, source: cell.source, inner: cell.inner, sizeGroup: cell.sizeGroup ?? 0 });
    blocks.push({ cells: block.cells.map((_, k) => offset + k), grid: block.grid, columns: block.columns, rows: block.rows, bounds: block.bounds });
  }
  return { cells, blocks, rejected };
}

/** Assigns grid columns and rows by clustering cell centres, then snaps every
 * cell to shared column and row edges so neighbours abut at the midline of the
 * wall between them instead of leaving the wall as a gap. */
function readGrid(members: CellCandidate[]) {
  const cluster = (values: number[], tolerance: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    const centers: number[] = [];
    let group: number[] = [];
    for (const value of sorted) {
      if (group.length && value - group[group.length - 1] > tolerance) { centers.push(group.reduce((s, v) => s + v, 0) / group.length); group = []; }
      group.push(value);
    }
    if (group.length) centers.push(group.reduce((s, v) => s + v, 0) / group.length);
    return centers;
  };
  const medianWidth = [...members.map((m) => m.width)].sort((a, b) => a - b)[members.length >> 1];
  const medianHeight = [...members.map((m) => m.height)].sort((a, b) => a - b)[members.length >> 1];
  const xs = cluster(members.map((m) => m.x + m.width / 2), medianWidth * 0.45);
  const ys = cluster(members.map((m) => m.y + m.height / 2), medianHeight * 0.45);
  const nearestIndex = (values: number[], value: number) => values.reduce((best, v, i) => (Math.abs(v - value) < Math.abs(values[best] - value) ? i : best), 0);
  // One cell per grid position: when two candidates land on the same spot,
  // keep the one closest to the block's typical size.
  const byPosition = new Map<string, { cell: CellCandidate; column: number; row: number }>();
  const misfit = (cell: CellCandidate) => Math.abs(cell.width - medianWidth) + Math.abs(cell.height - medianHeight);
  for (const cell of members) {
    const column = nearestIndex(xs, cell.x + cell.width / 2);
    const row = nearestIndex(ys, cell.y + cell.height / 2);
    const key = `${column},${row}`;
    const existing = byPosition.get(key);
    if (!existing || misfit(cell) < misfit(existing.cell)) byPosition.set(key, { cell, column, row });
  }
  const placed = [...byPosition.values()];
  placed.sort((a, b) => a.row - b.row || a.column - b.column);

  // Shared edges: each column spans from the mean left edge to the mean right
  // edge of its cells; the boundary between neighbours is the midpoint.
  const edges = (count: number, key: "column" | "row") => {
    const low: number[] = [];
    const high: number[] = [];
    for (let k = 0; k < count; k += 1) {
      const own = placed.filter((p) => p[key] === k).map((p) => p.cell);
      low.push(own.length ? own.reduce((s, c) => s + (key === "column" ? c.x : c.y), 0) / own.length : NaN);
      high.push(own.length ? own.reduce((s, c) => s + (key === "column" ? c.x + c.width : c.y + c.height), 0) / own.length : NaN);
    }
    for (let k = 0; k + 1 < count; k += 1) {
      const gap = low[k + 1] - high[k];
      if (Number.isFinite(gap) && gap >= 0 && gap <= Math.max(4, (high[k] - low[k]) * 0.35)) {
        const middle = (high[k] + low[k + 1]) / 2;
        high[k] = middle;
        low[k + 1] = middle;
      }
    }
    return { low, high };
  };
  const columnEdges = edges(xs.length, "column");
  const rowEdges = edges(ys.length, "row");
  const round = (value: number) => Math.round(value * 10) / 10;
  const cells = placed.map(({ cell, column, row }) => {
    const x = Number.isFinite(columnEdges.low[column]) ? columnEdges.low[column] : cell.x;
    const y = Number.isFinite(rowEdges.low[row]) ? rowEdges.low[row] : cell.y;
    const right = Number.isFinite(columnEdges.high[column]) ? columnEdges.high[column] : cell.x + cell.width;
    const bottom = Number.isFinite(rowEdges.high[row]) ? rowEdges.high[row] : cell.y + cell.height;
    return { ...cell, inner: { x: cell.x, y: cell.y, width: cell.width, height: cell.height }, x: round(x), y: round(y), width: round(right - x), height: round(bottom - y) };
  });
  const bounds = {
    x: Math.min(...cells.map((c) => c.x)),
    y: Math.min(...cells.map((c) => c.y)),
    width: Math.max(...cells.map((c) => c.x + c.width)) - Math.min(...cells.map((c) => c.x)),
    height: Math.max(...cells.map((c) => c.y + c.height)) - Math.min(...cells.map((c) => c.y)),
  };
  return { cells, grid: placed.map(({ column, row }) => ({ column, row })), columns: xs.length, rows: ys.length, bounds };
}

/** Solid near-black squares about one to three booths across: the structural
 * columns every hall plan draws the same way. */
function findPillars(filled: Labeling, cellSize: { short: number; long: number } | null, cells: BoothCell[]): DetectedPillar[] {
  if (!cellSize) return [];
  const pillars: DetectedPillar[] = [];
  for (let id = 0; id < filled.count; id += 1) {
    const box = rectOf(filled, id);
    const [r, g, b] = meanColor(filled, id);
    if ((r * 299 + g * 587 + b * 114) / 1000 > 70) continue;
    const side = Math.min(box.width, box.height);
    if (side < cellSize.short * 0.6 || Math.max(box.width, box.height) > cellSize.long * 3) continue;
    if (Math.max(box.width, box.height) / side > 2.2) continue;
    if (filled.area[id] < box.width * box.height * 0.85) continue;
    if (cells.some((cell) => overlap(cell, box) > 0)) continue;
    pillars.push(box);
  }
  return pillars;
}

/** Large solid rectangles that are not booths: sponsor areas, stages, special
 * zones. Their names are text the recognizer does not read, so they come out
 * unnamed for a person to label. */
function findLargeBlocks(filled: Labeling, cellSize: { short: number; long: number } | null, cells: BoothCell[], width: number, height: number, scratch: { buffer: Uint8Array; stack: Int32Array }): DetectedBlock[] {
  if (!cellSize) return [];
  const minArea = cellSize.short * cellSize.long * 6;
  const blocks: DetectedBlock[] = [];
  for (let id = 0; id < filled.count; id += 1) {
    const box = rectOf(filled, id);
    if (box.width * box.height < minArea || box.width * box.height > width * height * 0.25) continue;
    if (Math.min(box.width, box.height) < cellSize.short * 1.5) continue;
    const color = meanColor(filled, id);
    const [r, g, b] = color;
    const light = Math.min(r, g, b) > 235;
    if (light) continue;
    if (filled.area[id] < box.width * box.height * 0.5) continue;
    const shape = measureShape(filled.labels, width, id, box, filled.area[id], scratch);
    if (shape.rectangularity < 0.9) continue;
    if (cells.some((cell) => overlap(cell, box) > cell.width * cell.height * 0.3)) continue;
    blocks.push({ ...box, color });
  }
  return blocks;
}

/** Saturated red, thin, elongated marks: the entrance and exit arrows most
 * plans draw at the doors. They are thin strokes, so they are found on a
 * colour mask rather than among flat regions, and they cover little of their
 * box (a red signboard covers nearly all of it). The wider end is the head. */
function findArrows(image: RasterImage, cellSize: { short: number; long: number } | null): DetectedArrow[] {
  if (!cellSize) return [];
  const { width, height, data } = image;
  const red = new Uint8Array(width * height);
  for (let i = 0; i < red.length; i += 1) {
    const o = i * 4;
    red[i] = data[o] > 110 && data[o] - data[o + 1] > 50 && data[o] - data[o + 2] > 40 ? 1 : 0;
  }
  const components = labelComponents(width, height, (i) => red[i] === 1, () => true, data);
  const arrows: DetectedArrow[] = [];
  for (let id = 0; id < components.count; id += 1) {
    const box = rectOf(components, id);
    const long = Math.max(box.width, box.height);
    const short = Math.min(box.width, box.height);
    if (long < cellSize.long * 1.5 || short > long * 0.5 || long > cellSize.long * 12) continue;
    if (components.area[id] > box.width * box.height * 0.6) continue;
    const vertical = box.height >= box.width;
    const span = Math.max(1, Math.round(long / 5));
    let startMass = 0;
    let endMass = 0;
    for (let t = 0; t < span; t += 1) {
      for (let s = 0; s < short; s += 1) {
        const [ax, ay, bx, by] = vertical
          ? [box.x + s, box.y + t, box.x + s, box.y + box.height - 1 - t]
          : [box.x + t, box.y + s, box.x + box.width - 1 - t, box.y + s];
        if (components.labels[ay * width + ax] === id) startMass += 1;
        if (components.labels[by * width + bx] === id) endMass += 1;
      }
    }
    if (Math.max(startMass, endMass) < Math.min(startMass, endMass) * 1.5 + 2) continue;
    const headAtStart = startMass > endMass;
    const direction = vertical ? (headAtStart ? "north" : "south") : (headAtStart ? "west" : "east");
    const tip = vertical
      ? { x: box.x + box.width / 2, y: headAtStart ? box.y : box.y + box.height }
      : { x: headAtStart ? box.x : box.x + box.width, y: box.y + box.height / 2 };
    const tail = vertical
      ? { x: box.x + box.width / 2, y: headAtStart ? box.y + box.height : box.y }
      : { x: headAtStart ? box.x + box.width : box.x, y: box.y + box.height / 2 };
    arrows.push({ ...tail, direction, tip });
  }
  return arrows;
}

/** The hall floor: the smallest large region whose box holds nearly every
 * booth, or the booths' own extent with a margin when no outline is drawn. */
function findFloor(filled: Labeling, cells: BoothCell[], width: number, height: number): Rect {
  const clamp = (rect: Rect): Rect => {
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    return { x, y, width: Math.min(width, Math.ceil(rect.x + rect.width)) - x, height: Math.min(height, Math.ceil(rect.y + rect.height)) - y };
  };
  if (!cells.length) return { x: 0, y: 0, width, height };
  const minX = Math.min(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  const maxX = Math.max(...cells.map((c) => c.x + c.width));
  const maxY = Math.max(...cells.map((c) => c.y + c.height));
  let best: Rect | null = null;
  for (let id = 0; id < filled.count; id += 1) {
    if (filled.area[id] < width * height * 0.05) continue;
    const box = rectOf(filled, id);
    const inside = cells.filter((c) => c.x >= box.x - 2 && c.y >= box.y - 2 && c.x + c.width <= box.x + box.width + 2 && c.y + c.height <= box.y + box.height + 2).length;
    if (inside < cells.length * 0.9) continue;
    if (box.width >= width - 2 && box.height >= height - 2) continue;
    if (!best || box.width * box.height < best.width * best.height) best = box;
  }
  if (best) return clamp(best);
  const margin = Math.max(maxX - minX, maxY - minY) * 0.04;
  return clamp({ x: minX - margin, y: minY - margin, width: maxX - minX + margin * 2, height: maxY - minY + margin * 2 });
}
