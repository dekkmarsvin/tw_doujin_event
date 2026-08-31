import { validateEventMapLayout, type LayoutValidation } from "./event-map";
import { validateLayout as validateFf47Layout } from "./ff47-map-template-validator";
import { recognizeFF47Map, type PixelSource } from "./map-recognition";

const TEMPLATE_VALIDATORS: ReadonlyMap<string, (value: unknown) => LayoutValidation> = new Map([
  ["FF47", validateFf47Layout],
]);
const TEMPLATE_RECOGNIZERS = new Map([["FF47", recognizeFF47Map]]);
const TEMPLATE_METADATA = new Map([
  ["FF47", { rowLabel: "A–W 排", expectedRows: 23, slotLabel: "攤位格", expectedSlots: 988 }],
]);

export type MapTemplateOption = { id: string; label: string; summary: string };

/** The templates the organizer picks between. A stored value outside this list
 * still works — the generic validator accepts it — so callers offer it as an
 * extra option rather than silently rewriting saved data. */
const TEMPLATE_OPTIONS: readonly MapTemplateOption[] = [
  {
    id: "TAIWAN_GENERIC_V1",
    label: "通用版型",
    summary: "上傳配置圖後手動描摹攤位，排列方式不受固定規格限制。",
  },
  {
    id: "FF47",
    label: "FF47 爭艷館版型",
    summary: "上傳配置圖可自動辨識攤位，存檔時依這個版型檢查攤位排與數量。",
  },
];

export function listMapTemplateOptions() {
  return TEMPLATE_OPTIONS;
}

export type MapTemplateMetadata = {
  rowLabel: string;
  expectedRows: number | null;
  slotLabel: string;
  expectedSlots: number | null;
};

export function getMapTemplateMetadata(template: string): MapTemplateMetadata {
  return TEMPLATE_METADATA.get(template) ?? { rowLabel: "攤位排", expectedRows: null, slotLabel: "攤位格", expectedSlots: null };
}

export function validateMapTemplateLayout(template: string, value: unknown) {
  return (TEMPLATE_VALIDATORS.get(template) ?? validateEventMapLayout)(value);
}

/** Recognition is an optional accelerator, not a precondition for authoring.
 * Callers ask first so a template without an adapter falls back to tracing the
 * uploaded plan by hand instead of failing the import outright. */
export function hasMapTemplateRecognizer(template: string) {
  return TEMPLATE_RECOGNIZERS.has(template);
}

export function recognizeMapTemplate(template: string, source: PixelSource) {
  const recognize = TEMPLATE_RECOGNIZERS.get(template);
  if (!recognize) throw new Error(`地圖模板 ${template} 不支援自動辨識。`);
  return recognize(source);
}
