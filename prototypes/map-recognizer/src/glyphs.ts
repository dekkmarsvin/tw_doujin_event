/**
 * The glyphs written in a booth cell, as small normalised bitmaps.
 *
 * This is not OCR: nothing here knows what a "7" looks like. It is enough to
 * test a guess. Once a numbering hypothesis says which number each cell
 * carries, every glyph it calls "7" should look alike, and every cell should
 * hold as many glyphs as its number has characters. The right hypothesis
 * produces tight glyph classes; a wrong one mixes digits. That comparison is
 * how the numbering direction is chosen without a model.
 */
import type { RasterImage } from "./decode-image";
import type { Rect } from "./recognize";

export const GLYPH_W = 8;
export const GLYPH_H = 12;

export type Glyph = { x: number; bitmap: Float32Array };

function modeColor(image: RasterImage, box: Rect): [number, number, number] {
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

/** Glyphs inside `rect`, left to right. Blobs touching two opposite sides are
 * walls, not text; blobs sharing a column span are one glyph (a broken
 * stroke, a dotted character). */
export function extractGlyphs(image: RasterImage, rect: Rect): Glyph[] {
  const inset = 1;
  const box = {
    x: Math.max(0, Math.round(rect.x) + inset),
    y: Math.max(0, Math.round(rect.y) + inset),
    width: Math.round(rect.width) - inset * 2,
    height: Math.round(rect.height) - inset * 2,
  };
  if (box.width < 4 || box.height < 4 || box.x + box.width > image.width || box.y + box.height > image.height) return [];
  const [br, bg, bb] = modeColor(image, box);
  const w = box.width;
  const h = box.height;
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = ((box.y + y) * image.width + box.x + x) * 4;
      const d = Math.max(Math.abs(image.data[o] - br), Math.abs(image.data[o + 1] - bg), Math.abs(image.data[o + 2] - bb));
      if (d > 100) ink[y * w + x] = 1;
    }
  }
  // Walls inside or along the box (a faint separator left in a cell cut from
  // a merged run) are straight lines nearly as long as the box; digits never
  // are. Removing them keeps a digit that touches a wall from being mistaken
  // for part of it.
  for (let y = 0; y < h; y += 1) {
    let count = 0;
    for (let x = 0; x < w; x += 1) count += ink[y * w + x];
    if (count >= w * 0.85) for (let x = 0; x < w; x += 1) ink[y * w + x] = 0;
  }
  for (let x = 0; x < w; x += 1) {
    let count = 0;
    for (let y = 0; y < h; y += 1) count += ink[y * w + x];
    if (count >= h * 0.85) for (let y = 0; y < h; y += 1) ink[y * w + x] = 0;
  }
  const label = new Int32Array(w * h).fill(-1);
  const stack: number[] = [];
  const blobs: Array<{ x0: number; x1: number; y0: number; y1: number; area: number; pixels: number[] }> = [];
  for (let start = 0; start < w * h; start += 1) {
    if (!ink[start] || label[start] >= 0) continue;
    const id = blobs.length;
    const blob = { x0: w, x1: -1, y0: h, y1: -1, area: 0, pixels: [] as number[] };
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const index = stack.pop()!;
      const x = index % w;
      const y = (index - x) / w;
      blob.area += 1;
      blob.pixels.push(index);
      if (x < blob.x0) blob.x0 = x;
      if (x > blob.x1) blob.x1 = x;
      if (y < blob.y0) blob.y0 = y;
      if (y > blob.y1) blob.y1 = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const next = ny * w + nx;
          if (ink[next] && label[next] < 0) { label[next] = id; stack.push(next); }
        }
      }
    }
    blobs.push(blob);
  }
  const text = blobs.filter((b) => b.area >= 3 && !(b.x0 === 0 && b.x1 === w - 1 && b.y1 - b.y0 < 3) && !(b.y0 === 0 && b.y1 === h - 1 && b.x1 - b.x0 < 3));
  text.sort((a, b) => a.x0 - b.x0);
  const merged: typeof text = [];
  for (const blob of text) {
    const last = merged[merged.length - 1];
    const shared = last ? Math.min(last.x1, blob.x1) - Math.max(last.x0, blob.x0) : -1;
    if (last && shared >= Math.min(last.x1 - last.x0, blob.x1 - blob.x0) * 0.5) {
      last.x0 = Math.min(last.x0, blob.x0);
      last.x1 = Math.max(last.x1, blob.x1);
      last.y0 = Math.min(last.y0, blob.y0);
      last.y1 = Math.max(last.y1, blob.y1);
      last.area += blob.area;
      last.pixels.push(...blob.pixels);
    } else merged.push({ ...blob, pixels: [...blob.pixels] });
  }
  // Specks (JPEG ringing, a stray dot) are dropped relative to the tallest glyph.
  const tallest = Math.max(0, ...merged.map((b) => b.y1 - b.y0 + 1));
  return merged
    .filter((b) => b.y1 - b.y0 + 1 >= tallest * 0.4)
    .map((b) => {
      // Area coverage by 3×3 supersampling of each grid cell, so a 5×8 digit
      // and a 20×30 digit land on comparable bitmaps.
      const owned = new Uint8Array(w * h);
      for (const index of b.pixels) owned[index] = 1;
      const bitmap = new Float32Array(GLYPH_W * GLYPH_H);
      const bw = b.x1 - b.x0 + 1;
      const bh = b.y1 - b.y0 + 1;
      for (let gy = 0; gy < GLYPH_H; gy += 1) {
        for (let gx = 0; gx < GLYPH_W; gx += 1) {
          let hits = 0;
          for (let sy = 0; sy < 3; sy += 1) {
            for (let sx = 0; sx < 3; sx += 1) {
              const x = b.x0 + Math.min(bw - 1, Math.floor(((gx + (sx + 0.5) / 3) / GLYPH_W) * bw));
              const y = b.y0 + Math.min(bh - 1, Math.floor(((gy + (sy + 0.5) / 3) / GLYPH_H) * bh));
              hits += owned[y * w + x];
            }
          }
          bitmap[gy * GLYPH_W + gx] = hits / 9;
        }
      }
      return { x: box.x + (b.x0 + b.x1) / 2, bitmap };
    });
}

/**
 * How well a reading fits the glyphs: lower is better. `texts[i]` is what the
 * hypothesis says cell `i` shows. Cells whose glyph count differs from the
 * text length count as misses; the rest add each glyph to the class of the
 * character it is supposed to be, and the score is the mean distance of the
 * glyphs to their class average.
 */
export function readingCost(cells: Glyph[][], texts: string[]): { cost: number; misses: number; compared: number } {
  const classes = new Map<string, Float32Array[]>();
  let misses = 0;
  let compared = 0;
  cells.forEach((glyphs, i) => {
    if (!glyphs.length) return;
    compared += 1;
    const text = texts[i];
    if (glyphs.length !== text.length) { misses += 1; return; }
    glyphs.forEach((glyph, k) => {
      const list = classes.get(text[k]);
      if (list) list.push(glyph.bitmap);
      else classes.set(text[k], [glyph.bitmap]);
    });
  });
  let spread = 0;
  let members = 0;
  for (const list of classes.values()) {
    if (list.length < 2) continue;
    const mean = new Float32Array(GLYPH_W * GLYPH_H);
    for (const bitmap of list) for (let i = 0; i < mean.length; i += 1) mean[i] += bitmap[i] / list.length;
    for (const bitmap of list) {
      let distance = 0;
      for (let i = 0; i < mean.length; i += 1) distance += Math.abs(bitmap[i] - mean[i]);
      spread += distance / mean.length;
      members += 1;
    }
  }
  const missRate = compared ? misses / compared : 0;
  return { cost: (members ? spread / members : 0.5) + missRate * 0.6, misses, compared };
}

/** Average glyph per character, learned from every row's current best
 * reading. With a whole map to learn from, a row whose own evidence is thin
 * is judged against clean class means instead of its own noisy ones. */
export function learnPrototypes(readings: Array<{ cells: Glyph[][]; texts: string[] }>): Map<string, Float32Array> {
  const sums = new Map<string, { sum: Float32Array; n: number }>();
  for (const { cells, texts } of readings) {
    cells.forEach((glyphs, i) => {
      const text = texts[i];
      if (!glyphs.length || glyphs.length !== text.length) return;
      glyphs.forEach((glyph, k) => {
        let entry = sums.get(text[k]);
        if (!entry) { entry = { sum: new Float32Array(GLYPH_W * GLYPH_H), n: 0 }; sums.set(text[k], entry); }
        for (let p = 0; p < entry.sum.length; p += 1) entry.sum[p] += glyph.bitmap[p];
        entry.n += 1;
      });
    });
  }
  const prototypes = new Map<string, Float32Array>();
  // Even one clean sample of a character is evidence: a small plan may print
  // a "7" only once or twice.
  for (const [char, { sum, n }] of sums) prototypes.set(char, sum.map((value) => value / n));
  return prototypes;
}

/** Cost of reading one cell as `text`: the mean distance of its glyphs to
 * the prototypes of the characters they are supposed to be, or a fixed
 * penalty when the glyph count does not match the text. */
export function cellCost(glyphs: Glyph[], text: string, prototypes: Map<string, Float32Array>): number {
  if (glyphs.length !== text.length) return 0.6;
  let distance = 0;
  glyphs.forEach((glyph, k) => {
    const prototype = prototypes.get(text[k]);
    if (!prototype) { distance += 0.5; return; }
    let d = 0;
    for (let p = 0; p < prototype.length; p += 1) d += Math.abs(glyph.bitmap[p] - prototype[p]);
    distance += d / prototype.length;
  });
  return distance / glyphs.length;
}
