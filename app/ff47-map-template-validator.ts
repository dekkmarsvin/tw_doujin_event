import { validateEventMapLayout, type EventMapLayout, type LayoutValidation, type MapOrientation } from "./event-map";

/** Event-specific geometry checks. Shared map code dispatches here through the
 * template registry and does not know the FF47 row or fixture dimensions. */
export function validateLayout(value: unknown): LayoutValidation {
  const base = validateEventMapLayout(value);
  const errors = [...base.errors];
  if (!value || typeof value !== "object") return { ok: false, errors };
  const layout = value as Partial<EventMapLayout>;
  if (layout.template !== "FF47") errors.push("FF47 辨識結果必須使用 FF47 template。" );
  if (Array.isArray(layout.pillars) && layout.pillars.length !== 28) errors.push(`完整 FF47 layout 應有 28 根柱子，目前為 ${layout.pillars.length}。`);
  if (Array.isArray(layout.accessPoints) && layout.accessPoints.length !== 5) errors.push(`完整 FF47 layout 應有 5 個出入口，目前為 ${layout.accessPoints.length}。`);
  if (Array.isArray(layout.rows)) {
    const expectedLabels = "ABCDEFGHIJKLMNOPQRSTUVW".split("");
    const rows = new Map(layout.rows.map((row) => [row.label, row]));
    expectedLabels.forEach((label) => {
      const row = rows.get(label);
      if (!row) { errors.push(`缺少 ${label} 排。`); return; }
      const expectedOrientation: MapOrientation = label === "W" ? "horizontal" : "vertical";
      if (row.orientation !== expectedOrientation) errors.push(`${label} 排方向必須是 ${expectedOrientation}。`);
      const expectedSlots = label === "A" ? 22 : label === "W" ? 42 : 44;
      if (!Array.isArray(row.slots) || row.slots.length !== expectedSlots) errors.push(`${label} 排應有 ${expectedSlots} 格。`);
      row.slots?.forEach((slot) => { if (!slot.code.startsWith(label)) errors.push(`${slot.code} 不屬於 ${label} 排。`); });
    });
    const slotCount = layout.rows.reduce((total, row) => total + (row.slots?.length ?? 0), 0);
    if (slotCount !== 988) errors.push(`完整 FF47 layout 應有 988 格，目前為 ${slotCount}。`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}
