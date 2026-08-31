import { validateEventMapLayout, type EventMapLayout, type LayoutValidation, type MapOrientation } from "./event-map";

export type MapTemplateRowShape = { label: string; orientation: MapOrientation; slots: number };
export type MapTemplateShape = {
  rows: readonly MapTemplateRowShape[];
  pillars: number;
  accessPoints: number;
};

/** The one description of what a complete FF47 floor looks like. The checks
 * below read it, and the template registry hands it to the authoring UI so a
 * preview cannot drift from what validation actually demands. */
export const FF47_TEMPLATE_SHAPE: MapTemplateShape = {
  rows: "ABCDEFGHIJKLMNOPQRSTUVW".split("").map((label) => ({
    label,
    orientation: label === "W" ? "horizontal" as const : "vertical" as const,
    slots: label === "A" ? 22 : label === "W" ? 42 : 44,
  })),
  pillars: 28,
  accessPoints: 5,
};

const FF47_SLOT_TOTAL = FF47_TEMPLATE_SHAPE.rows.reduce((total, row) => total + row.slots, 0);

/** Event-specific geometry checks. Shared map code dispatches here through the
 * template registry and does not know the FF47 row or fixture dimensions. */
export function validateLayout(value: unknown): LayoutValidation {
  const base = validateEventMapLayout(value);
  const errors = [...base.errors];
  if (!value || typeof value !== "object") return { ok: false, errors };
  const layout = value as Partial<EventMapLayout>;
  if (layout.template !== "FF47") errors.push("FF47 辨識結果必須使用 FF47 template。" );
  if (Array.isArray(layout.pillars) && layout.pillars.length !== FF47_TEMPLATE_SHAPE.pillars) errors.push(`完整 FF47 layout 應有 ${FF47_TEMPLATE_SHAPE.pillars} 根柱子，目前為 ${layout.pillars.length}。`);
  if (Array.isArray(layout.accessPoints) && layout.accessPoints.length !== FF47_TEMPLATE_SHAPE.accessPoints) errors.push(`完整 FF47 layout 應有 ${FF47_TEMPLATE_SHAPE.accessPoints} 個出入口，目前為 ${layout.accessPoints.length}。`);
  if (Array.isArray(layout.rows)) {
    const rows = new Map(layout.rows.map((row) => [row.label, row]));
    FF47_TEMPLATE_SHAPE.rows.forEach(({ label, orientation, slots }) => {
      const row = rows.get(label);
      if (!row) { errors.push(`缺少 ${label} 排。`); return; }
      if (row.orientation !== orientation) errors.push(`${label} 排方向必須是 ${orientation}。`);
      if (!Array.isArray(row.slots) || row.slots.length !== slots) errors.push(`${label} 排應有 ${slots} 格。`);
      row.slots?.forEach((slot) => { if (!slot.code.startsWith(label)) errors.push(`${slot.code} 不屬於 ${label} 排。`); });
    });
    const slotCount = layout.rows.reduce((total, row) => total + (row.slots?.length ?? 0), 0);
    if (slotCount !== FF47_SLOT_TOTAL) errors.push(`完整 FF47 layout 應有 ${FF47_SLOT_TOTAL} 格，目前為 ${slotCount}。`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}
