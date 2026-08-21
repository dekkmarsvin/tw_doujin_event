import {
  EVENT_MAP_VERSION,
  type BoothRow,
  type BoothSlot,
  type EventMapLayout,
  type MapAccessPoint,
  type MapPillar,
  type MapRecognitionReport,
} from "./event-map";
import { validateLayout } from "./ff47-map-template-validator";

export type PixelSource = { data: Uint8ClampedArray; width: number; height: number };

export const LANDMARK_RECOGNITION_WARNING = "企業攤與舞台目前不會自動辨識；若配置圖含有這些區域，請在發布前手動新增。";

type Line = { start: number; end: number; center: number; score: number };
type Triple = { left: Line; middle: Line; right: Line };
type Component = { x: number; y: number; width: number; height: number; area: number; fill: number };

const UPPER_LABELS = ["V", "U", "T", "S", "R", "Q", "P", "O", "N"];
const LOWER_LABELS = ["M", "L", "K", "J", "I", "H", "G", "F", "E", "D", "C", "B"];
const DARK_THRESHOLD = 185;

function luminance(data: Uint8ClampedArray, index: number) {
  return (data[index] * 299 + data[index + 1] * 587 + data[index + 2] * 114) / 1000;
}

function isDark(data: Uint8ClampedArray, index: number, threshold = DARK_THRESHOLD) {
  return luminance(data, index) < threshold;
}

function runsFromScores(scores: number[], threshold: number): Line[] {
  const lines: Line[] = [];
  let start = -1;
  let peak = 0;
  for (let index = 0; index <= scores.length; index += 1) {
    const score = scores[index] ?? -1;
    if (score >= threshold) {
      if (start < 0) start = index;
      peak = Math.max(peak, score);
      continue;
    }
    if (start >= 0) {
      const end = index - 1;
      lines.push({ start, end, center: (start + end) / 2, score: peak });
      start = -1;
      peak = 0;
    }
  }
  return lines;
}

function verticalLines(source: PixelSource, yStartRatio: number, yEndRatio: number) {
  const { data, width, height } = source;
  const yStart = Math.round(height * yStartRatio);
  const yEnd = Math.round(height * yEndRatio);
  const scores = new Array<number>(width).fill(0);
  for (let y = yStart; y < yEnd; y += 1) {
    let pixel = y * width * 4;
    for (let x = 0; x < width; x += 1, pixel += 4) if (isDark(data, pixel)) scores[x] += 1;
  }
  return runsFromScores(scores, (yEnd - yStart) * 0.7).filter((line) => line.center > width * 0.3 && line.center < width * 0.96);
}

function horizontalLines(source: PixelSource, group: Triple, yStartRatio: number, yEndRatio: number) {
  const { data, width, height } = source;
  const xStart = Math.max(0, Math.round(group.left.center));
  const xEnd = Math.min(width - 1, Math.round(group.right.center));
  const yStart = Math.round(height * yStartRatio);
  const yEnd = Math.round(height * yEndRatio);
  const scores = new Array<number>(height).fill(0);
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x <= xEnd; x += 1) if (isDark(data, (y * width + x) * 4)) scores[y] += 1;
  }
  const raw = runsFromScores(scores, Math.max(3, (xEnd - xStart) * 0.68));
  const minGap = height * 0.007;
  const maxGap = height * 0.014;
  let best: Line[] = [];
  for (let start = 0; start < raw.length; start += 1) {
    const sequence = [raw[start]];
    for (let index = start + 1; index < raw.length; index += 1) {
      const gap = raw[index].center - sequence.at(-1)!.center;
      if (gap >= minGap && gap <= maxGap) sequence.push(raw[index]);
      else if (gap > maxGap) break;
    }
    if (sequence.length > best.length) best = sequence;
  }
  return best.slice(0, 23);
}

function groupTriples(lines: Line[], width: number) {
  const triples: Triple[] = [];
  const used = new Set<number>();
  const minGap = width * 0.008;
  const maxGap = width * 0.016;
  const tolerance = width * 0.003;
  for (let index = 0; index < lines.length - 2; index += 1) {
    if (used.has(index)) continue;
    const first = lines[index];
    const second = lines[index + 1];
    const third = lines[index + 2];
    const firstGap = second.center - first.center;
    const secondGap = third.center - second.center;
    if (firstGap >= minGap && firstGap <= maxGap && secondGap >= minGap && secondGap <= maxGap && Math.abs(firstGap - secondGap) <= tolerance) {
      triples.push({ left: first, middle: second, right: third });
      used.add(index);
      used.add(index + 1);
      used.add(index + 2);
      index += 2;
    }
  }
  return { triples, used };
}

function rowConfidence(group: Triple, verticalSpan: number) {
  return Math.min(1, (group.left.score + group.middle.score + group.right.score) / (verticalSpan * 3));
}

function verticalRow(label: string, group: Triple, horizontal: Line[], width: number, height: number, confidence: number): BoothRow {
  const slots: BoothSlot[] = [];
  if (horizontal.length === 23) {
    for (let number = 1; number <= 22; number += 1) {
      const index = 22 - number;
      slots.push({ code: `${label}${String(number).padStart(2, "0")}`, rect: { x: group.middle.center, y: horizontal[index].center, width: group.right.center - group.middle.center, height: horizontal[index + 1].center - horizontal[index].center } });
    }
    for (let number = 23; number <= 44; number += 1) {
      const index = number - 23;
      slots.push({ code: `${label}${number}`, rect: { x: group.left.center, y: horizontal[index].center, width: group.middle.center - group.left.center, height: horizontal[index + 1].center - horizontal[index].center } });
    }
  }
  return { label, orientation: "vertical", confidence, slots: slots.map((slot) => ({ ...slot, rect: clampRect(slot.rect, width, height) })) };
}

function findSingleColumn(lines: Line[], used: Set<number>, after: number, width: number) {
  const candidates = lines.map((line, index) => ({ line, index })).filter(({ line, index }) => !used.has(index) && line.center > after && line.center < width * 0.95);
  const minGap = width * 0.008;
  const maxGap = width * 0.016;
  for (let index = 0; index < candidates.length - 1; index += 1) {
    const gap = candidates[index + 1].line.center - candidates[index].line.center;
    if (gap >= minGap && gap <= maxGap) return [candidates[index].line, candidates[index + 1].line] as const;
  }
  return null;
}

function clampRect(rect: BoothSlot["rect"], width: number, height: number) {
  const x = Math.max(0, Math.min(width, rect.x));
  const y = Math.max(0, Math.min(height, rect.y));
  return { x, y, width: Math.max(0.5, Math.min(width - x, rect.width)), height: Math.max(0.5, Math.min(height - y, rect.height)) };
}

function detectWRow(source: PixelSource): BoothRow {
  const { data, width, height } = source;
  const yScores = new Array<number>(height).fill(0);
  const xFrom = Math.round(width * 0.3);
  const xTo = Math.round(width * 0.96);
  for (let y = Math.round(height * 0.15); y < Math.round(height * 0.19); y += 1) {
    for (let x = xFrom; x <= xTo; x += 1) if (isDark(data, (y * width + x) * 4)) yScores[y] += 1;
  }
  const horizontal = runsFromScores(yScores, width * 0.23);
  const top = horizontal[0];
  const bottom = horizontal.at(-1);
  const slots: BoothSlot[] = [];
  if (!top || !bottom || bottom.center <= top.center) return { label: "W", orientation: "horizontal", confidence: 0, slots };

  const xScores = new Array<number>(width).fill(0);
  const yStart = Math.round(top.center);
  const yEnd = Math.round(bottom.center);
  for (let x = xFrom; x <= xTo; x += 1) {
    for (let y = yStart; y <= yEnd; y += 1) if (isDark(data, (y * width + x) * 4)) xScores[x] += 1;
  }
  const vertical = runsFromScores(xScores, (yEnd - yStart) * 0.72).filter((line) => line.center >= xFrom && line.center <= xTo);
  const minGap = width * 0.005;
  const maxGap = width * 0.012;
  const cells: Array<{ left: Line; right: Line }> = [];
  const edgeCoverage = (y: number, left: number, right: number) => {
    let dark = 0;
    let total = 0;
    for (let x = Math.ceil(left); x <= Math.floor(right); x += 1) {
      total += 1;
      if (isDark(data, (Math.round(y) * width + x) * 4)) dark += 1;
    }
    return total ? dark / total : 0;
  };
  for (let index = 0; index < vertical.length - 1; index += 1) {
    const left = vertical[index];
    const right = vertical[index + 1];
    const gap = right.center - left.center;
    if (gap >= minGap && gap <= maxGap && edgeCoverage(top.center, left.center, right.center) > .55 && edgeCoverage(bottom.center, left.center, right.center) > .35) cells.push({ left, right });
  }
  cells.sort((a, b) => a.left.center - b.left.center).slice(0, 42).forEach((cell, index) => {
    const number = 42 - index;
    slots.push({ code: `W${String(number).padStart(2, "0")}`, rect: clampRect({ x: cell.left.center, y: top.center, width: cell.right.center - cell.left.center, height: bottom.center - top.center }, width, height) });
  });
  return { label: "W", orientation: "horizontal", confidence: Math.min(1, slots.length / 42), slots };
}

function binaryComponents(mask: Uint8Array, width: number, height: number): Component[] {
  const seen = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components: Component[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let area = 0;
    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      area += 1;
      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbors) {
        if (next < 0 || next >= mask.length || seen[next] || !mask[next]) continue;
        const nx = next % width;
        if (Math.abs(nx - x) > 1) continue;
        seen[next] = 1;
        queue[tail++] = next;
      }
    }
    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    components.push({ x: minX, y: minY, width: componentWidth, height: componentHeight, area, fill: area / (componentWidth * componentHeight) });
  }
  return components;
}

function detectPillars(source: PixelSource): MapPillar[] {
  const step = source.width >= 1600 ? 2 : 1;
  const width = Math.floor(source.width / step);
  const height = Math.floor(source.height / step);
  const black = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sourceIndex = ((y * step) * source.width + x * step) * 4;
    if (isDark(source.data, sourceIndex, 80)) black[y * width + x] = 1;
  }
  const eroded = new Uint8Array(black.length);
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    let solid = 1;
    for (let dy = -1; dy <= 1 && solid; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (!black[(y + dy) * width + x + dx]) { solid = 0; break; }
    eroded[y * width + x] = solid;
  }
  const candidates = binaryComponents(eroded, width, height).filter((component) => {
    const ratio = component.width / component.height;
    return component.width >= width * .004 && component.height >= height * .006 && component.width <= width * .03 && component.height <= height * .03 && component.fill > .55 && ratio >= .35 && ratio <= 2.8;
  });
  const bands: Component[][] = [];
  candidates.sort((a, b) => a.y - b.y || a.x - b.x).forEach((component) => {
    const center = component.y + component.height / 2;
    const band = bands.find((items) => Math.abs(items[0].y + items[0].height / 2 - center) < height * .025);
    if (band) band.push(component);
    else bands.push([component]);
  });
  const padding = step * 2;
  return bands.filter((band) => band.length >= 2).flat().sort((a, b) => a.y - b.y || a.x - b.x).map((component, index) => ({
    id: `pillar-${index + 1}`,
    x: Math.max(0, component.x * step - padding),
    y: Math.max(0, component.y * step - padding),
    width: component.width * step + padding * 2,
    height: component.height * step + padding * 2,
  }));
}

function detectAccessPoints(source: PixelSource): MapAccessPoint[] {
  const step = source.width >= 1600 ? 2 : 1;
  const width = Math.floor(source.width / step);
  const height = Math.floor(source.height / step);
  const red = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = ((y * step) * source.width + x * step) * 4;
    const r = source.data[index];
    const g = source.data[index + 1];
    const b = source.data[index + 2];
    if (r > 110 && r > g * 1.35 && r > b * 1.25 && g < 150) red[y * width + x] = 1;
  }
  const arrows = binaryComponents(red, width, height).filter((component) => component.area > 6 && component.height > component.width * 2 && component.height > height * .02);
  const top = arrows.filter((arrow) => arrow.y + arrow.height / 2 < height / 2).sort((a, b) => a.x - b.x);
  const bottom = arrows.filter((arrow) => arrow.y + arrow.height / 2 >= height / 2).sort((a, b) => a.x - b.x);
  const bottomLabels = ["快速入場／貴賓入口", "電子福袋入口 2", "電子福袋入口", "一般入口"];
  return [
    ...top.map((arrow, index) => ({ id: `exit-${index + 1}`, kind: "exit" as const, direction: "north" as const, x: (arrow.x + arrow.width / 2) * step, y: (arrow.y + arrow.height / 2) * step, label: "活動出口" })),
    ...bottom.map((arrow, index) => ({ id: `entrance-${index + 1}`, kind: "entrance" as const, direction: "north" as const, x: (arrow.x + arrow.width / 2) * step, y: (arrow.y + arrow.height / 2) * step, label: bottomLabels[index] ?? `入口 ${index + 1}` })),
  ];
}

export function recognizeFF47Map(source: PixelSource): MapRecognitionReport {
  const { width, height } = source;
  const warnings: string[] = [];
  const emptyLayout: EventMapLayout = { version: EVENT_MAP_VERSION, template: "FF47", width, height, floor: { x: 0, y: 0, width: Math.max(1, width), height: Math.max(1, height) }, rows: [], pillars: [], accessPoints: [], landmarks: [] };
  if (width < 800 || height < 500) return { layout: emptyLayout, confidence: 0, warnings: ["圖片解析度太低；請使用寬度至少 800px 的原始配置圖。"], diagnostics: { rowCount: 0, slotCount: 0, pillarCount: 0, accessPointCount: 0 } };

  const upperLines = verticalLines(source, .235, .485);
  const lowerLines = verticalLines(source, .56, .815);
  const upper = groupTriples(upperLines, width);
  const lower = groupTriples(lowerLines, width);
  const upperGroups = upper.triples.slice(0, UPPER_LABELS.length);
  const lowerGroups = lower.triples.slice(0, LOWER_LABELS.length);
  const upperHorizontal = upperGroups.length ? horizontalLines(source, upperGroups.at(-2) ?? upperGroups[0], .22, .5) : [];
  const lowerHorizontal = lowerGroups.length ? horizontalLines(source, lowerGroups[0], .54, .83) : [];
  const rows: BoothRow[] = [];
  const upperSpan = height * (.485 - .235);
  upperGroups.forEach((group, index) => rows.push(verticalRow(UPPER_LABELS[index], group, upperHorizontal, width, height, rowConfidence(group, upperSpan))));
  const lowerSpan = height * (.815 - .56);
  lowerGroups.forEach((group, index) => rows.push(verticalRow(LOWER_LABELS[index], group, lowerHorizontal, width, height, rowConfidence(group, lowerSpan))));

  const lastLower = lowerGroups.at(-1);
  const aLines = lastLower ? findSingleColumn(lowerLines, lower.used, lastLower.right.center, width) : null;
  if (aLines && lowerHorizontal.length === 23) {
    const slots: BoothSlot[] = [];
    for (let number = 1; number <= 22; number += 1) {
      const index = 22 - number;
      slots.push({ code: `A${String(number).padStart(2, "0")}`, rect: clampRect({ x: aLines[0].center, y: lowerHorizontal[index].center, width: aLines[1].center - aLines[0].center, height: lowerHorizontal[index + 1].center - lowerHorizontal[index].center }, width, height) });
    }
    rows.push({ label: "A", orientation: "vertical", confidence: Math.min(1, (aLines[0].score + aLines[1].score) / (lowerSpan * 2)), slots });
  }
  rows.push(detectWRow(source));
  rows.sort((a, b) => a.label.localeCompare(b.label));

  const pillars = detectPillars(source);
  const accessPoints = detectAccessPoints(source);
  const floor = pillars.length ? {
    x: Math.min(...pillars.map((pillar) => pillar.x)),
    y: Math.min(...pillars.map((pillar) => pillar.y)),
    width: Math.max(...pillars.map((pillar) => pillar.x + pillar.width)) - Math.min(...pillars.map((pillar) => pillar.x)),
    height: Math.max(...pillars.map((pillar) => pillar.y + pillar.height)) - Math.min(...pillars.map((pillar) => pillar.y)),
  } : { x: width * .04, y: height * .13, width: width * .89, height: height * .74 };
  const layout: EventMapLayout = { version: EVENT_MAP_VERSION, template: "FF47", width, height, floor, rows, pillars, accessPoints, landmarks: [] };
  const slotCount = rows.reduce((total, row) => total + row.slots.length, 0);
  if (rows.length !== 23) warnings.push(`只辨識到 ${rows.length}/23 個 A–W 排。`);
  if (slotCount !== 988) warnings.push(`只辨識到 ${slotCount}/988 個一般攤位格。`);
  if (pillars.length !== 28) warnings.push(`辨識到 ${pillars.length} 根柱子，預期為 28。`);
  if (accessPoints.length !== 5) warnings.push(`辨識到 ${accessPoints.length} 個出入口，預期為 5。`);
  if (!layout.landmarks.length) warnings.push(LANDMARK_RECOGNITION_WARNING);

  const validation = validateLayout(layout);
  if (!validation.ok) warnings.push(...validation.errors);
  const rowCoverage = Math.min(1, rows.length / 23);
  const slotCoverage = Math.min(1, slotCount / 988);
  const pillarCoverage = Math.min(1, pillars.length / 28);
  const accessCoverage = Math.min(1, accessPoints.length / 5);
  const lineQuality = rows.length ? rows.reduce((total, row) => total + row.confidence, 0) / rows.length : 0;
  const confidence = Math.round((rowCoverage * .2 + slotCoverage * .3 + pillarCoverage * .15 + accessCoverage * .15 + lineQuality * .2) * 100) / 100;
  if (confidence < .85) warnings.push("辨識信心不足，請確認圖片沒有裁切、旋轉或嚴重壓縮。" );
  return { layout, confidence, warnings, diagnostics: { rowCount: rows.length, slotCount, pillarCount: pillars.length, accessPointCount: accessPoints.length } };
}
