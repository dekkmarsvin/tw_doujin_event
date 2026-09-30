import type { BoothRow, EventMapLayout, MapRect } from "./event-map";
import { boundingBox } from "./map-layout-editor-selection";

export type CopyDirection = "right" | "left" | "down" | "up";
export const ROW_LABEL_SEQUENCES = { alphabet: [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"], branches: [..."子丑寅卯辰巳午未申酉戌亥"] };

export function copyRowLabels(sequence: keyof typeof ROW_LABEL_SEQUENCES, start: string, count: number): string[] {
  const labels = ROW_LABEL_SEQUENCES[sequence];
  const index = labels.indexOf(start);
  return index < 0 || !Number.isInteger(count) || count < 1 || count > labels.length ? [] : labels.slice(index, index + count);
}

/** A preset sequence ends (Z, 亥). Say how far it reaches from `start`
 * instead of letting the short list read as names the user forgot to fill. */
export function copyRowLimitError(sequence: keyof typeof ROW_LABEL_SEQUENCES, start: string, count: number): string | null {
  const labels = ROW_LABEL_SEQUENCES[sequence];
  const remaining = labels.length - labels.indexOf(start);
  if (labels.indexOf(start) < 0 || !Number.isInteger(count) || count <= remaining) return null;
  const range = sequence === "alphabet" ? `A–Z 從 ${start} 起` : `十二地支從${start}起`;
  return `${range}最多 ${remaining} 排；請減少份數或改用自訂排名。`;
}

/** Translating by a multiple of the step can land a shared edge one unit in the
 * last place inside its neighbour: 1/7 + 3 × 3/13 starts before 1/7 + 2 × 3/13 +
 * 3/13 ends. The save check (`map-contribution-draft.ts`) accepts a shared edge
 * and rejects any true intersection, so put such an edge back on its neighbour,
 * as `seamlessSpans` does for sizes, instead of reporting an overlap nobody drew. */
function settleSeam(rect: MapRect, occupied: readonly MapRect[], horizontal: boolean) {
  const [at, size, across, span] = horizontal ? ["x", "width", "y", "height"] as const : ["y", "height", "x", "width"] as const;
  for (let guard = 0; guard < 4; guard += 1) {
    const neighbour = occupied.find(other => {
      const along = Math.min(rect[at] + rect[size], other[at] + other[size]) - Math.max(rect[at], other[at]);
      const beside = Math.min(rect[across] + rect[span], other[across] + other[span]) - Math.max(rect[across], other[across]);
      return beside > 0 && along > 0 && along <= Math.max(1, Math.abs(other[at]), Math.abs(other[at] + other[size])) * 1e-9;
    });
    if (!neighbour) return;
    if (rect[at] > neighbour[at]) rect[at] = neighbour[at] + neighbour[size];
    else {
      rect[at] = neighbour[at] - rect[size];
      for (let step = 0; step < 4 && rect[at] + rect[size] > neighbour[at]; step += 1) rect[size] -= Math.abs(rect[size]) * Number.EPSILON;
    }
  }
}

/** Preview an entire batch without changing either input. Never clamp a copy,
 * invent a suffix, or partially accept a sequence: the displayed codes and
 * spacing are exactly what will be saved. Keep every segment's geometry. */
export function planRowCopies(source: BoothRow, layout: EventMapLayout, options: { count: number; labels: string[]; direction: CopyDirection; gap: number }) {
  const fail = (error: string) => ({ ok: false as const, rows: [] as BoothRow[], error });
  const { count, direction, gap } = options;
  if (!Number.isInteger(count) || count < 1 || count > 100) return fail("複製份數須為 1–100。 ".trim());
  if (!Number.isFinite(gap) || gap < 0) return fail("排與排之間的間距須為零或正數。");
  if (!source.slots.length) return fail("先選取同一排的攤位。");
  const labels = options.labels.map(label => label.trim());
  if (labels.length !== count || labels.some(label => !label)) return fail("請為每一份填入排名，數量須與複製份數相同。");
  const takenLabels = new Set(layout.rows.map(row => row.label));
  for (const label of labels) {
    if (takenLabels.has(label)) return fail(`排名「${label}」重複，請修改排名。`);
    takenLabels.add(label);
  }
  if (!source.label || source.slots.some(slot => !slot.code.startsWith(source.label))) return fail("所選攤位的代碼須以原排名開頭；請先調整排段代碼前綴。");
  const box = boundingBox(source.slots.map(slot => slot.rect));
  const horizontal = direction === "left" || direction === "right";
  const step = ((horizontal ? box.width : box.height) + gap) * (direction === "left" || direction === "up" ? -1 : 1);
  const takenCodes = new Set(layout.rows.flatMap(row => row.slots.map(slot => slot.code)));
  const occupied = layout.rows.flatMap(row => row.slots.map(slot => slot.rect));
  const rows: BoothRow[] = [];
  for (const [index, label] of labels.entries()) {
    const slots = source.slots.map(slot => ({ ...slot, code: label + slot.code.slice(source.label.length), rect: { ...slot.rect, x: slot.rect.x + (horizontal ? step * (index + 1) : 0), y: slot.rect.y + (horizontal ? 0 : step * (index + 1)) } }));
    for (const slot of slots) {
      if (takenCodes.has(slot.code)) return fail(`攤位代碼 ${slot.code} 重複。`);
      takenCodes.add(slot.code);
      const r = slot.rect;
      settleSeam(r, occupied, horizontal);
      if (r.x < 0 || r.y < 0 || r.x + r.width > layout.width || r.y + r.height > layout.height) return fail(`${label} 排超出畫布；請減少份數、間距或改變方向。`);
      if (occupied.some(b => r.x < b.x + b.width && b.x < r.x + r.width && r.y < b.y + b.height && b.y < r.y + r.height)) return fail(`${slot.code} 與既有攤位重疊；請調整方向或間距。`);
      occupied.push(r);
    }
    rows.push({ ...source, label, slots });
  }
  return { ok: true as const, rows, error: "" };
}
