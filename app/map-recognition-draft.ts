import { validateEventMapLayout, type EventMapLayout, type MapRect } from "./event-map";
export type RecognitionChoice = { kind: "row" | "pillar" | "access" | "landmark"; index: number };
export const recognitionChoiceKey = (choice: RecognitionChoice) => `${choice.kind}:${choice.index}`;
const intersects = (a: MapRect, b: MapRect) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > .01
  && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > .01;

/** Additive adoption only. Never replace an existing code, geometry, floor,
 * facility, guide, or area region. Reject a conflicting selection atomically. */
export function adoptRecognitionDraft(current: EventMapLayout, proposal: EventMapLayout, choices: readonly RecognitionChoice[]):
  { ok: true; layout: EventMapLayout } | { ok: false; errors: string[] } {
  if (!choices.length) return { ok: false, errors: ["請先勾選已核對的排或設施。"] };
  if (current.width !== proposal.width || current.height !== proposal.height || current.template !== proposal.template) {
    return { ok: false, errors: ["地圖範圍已改變，請重新辨識。"] };
  }
  const next = structuredClone(current);
  const errors: string[] = [];
  const seen = new Set<string>();
  const idFor = (ids: string[], prefix: string) => { let n = 1; while (ids.includes(`${prefix}-${n}`)) n++; return `${prefix}-${n}`; };
  for (const choice of choices) {
    const key = recognitionChoiceKey(choice);
    if (seen.has(key)) continue;
    seen.add(key);
    if (choice.kind === "row") {
      const row = proposal.rows[choice.index];
      if (!row) { errors.push("辨識排已失效，請重新辨識。"); continue; }
      const existing = next.rows.flatMap(item => item.slots);
      const duplicate = row.slots.find(slot => existing.some(item => item.code === slot.code));
      const overlap = row.slots.find(slot => existing.some(item => intersects(item.rect, slot.rect)));
      if (duplicate || overlap) {
        errors.push(`${row.label} 排${duplicate ? `的 ${duplicate.code} 已在地圖上` : "與已畫攤位重疊"}；需要調整時請使用排段工具。`);
        continue;
      }
      const same = next.rows.find(item => item.label === row.label);
      if (same) same.slots.push(...structuredClone(row.slots));
      else next.rows.push(structuredClone(row));
    } else if (choice.kind === "pillar") {
      const value = proposal.pillars[choice.index];
      if (!value) { errors.push("辨識柱子已失效。"); continue; }
      if (next.pillars.some(pillar => intersects(pillar, value))) { errors.push("辨識柱子與已畫柱子重疊。"); continue; }
      next.pillars.push({ ...value, id: idFor(next.pillars.map(p => p.id), "recognized-pillar") });
    } else if (choice.kind === "access") {
      const value = proposal.accessPoints[choice.index];
      if (!value) { errors.push("辨識出入口已失效。"); continue; }
      if (next.accessPoints.some(door => Math.hypot(door.x - value.x, door.y - value.y) < 5)) { errors.push("辨識出入口附近已有出入口。"); continue; }
      next.accessPoints.push({ ...value, id: idFor(next.accessPoints.map(p => p.id), "recognized-door") });
    } else {
      const value = proposal.landmarks[choice.index];
      if (!value) { errors.push("辨識區域已失效。"); continue; }
      if (next.landmarks.some(area => intersects(area.rect, value.rect))) { errors.push("辨識區域與已畫區域重疊。"); continue; }
      next.landmarks.push({ ...structuredClone(value), id: idFor(next.landmarks.map(p => p.id), "recognized-area") });
    }
  }
  const validation = validateEventMapLayout(next);
  if (!validation.ok) errors.push(...validation.errors);
  return errors.length ? { ok: false, errors } : { ok: true, layout: next };
}
