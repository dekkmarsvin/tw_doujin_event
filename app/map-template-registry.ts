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

export function recognizeMapTemplate(template: string, source: PixelSource) {
  const recognize = TEMPLATE_RECOGNIZERS.get(template);
  if (!recognize) throw new Error(`地圖模板 ${template} 尚未提供圖片辨識 adapter。`);
  return recognize(source);
}
