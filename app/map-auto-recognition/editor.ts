import { validateEventMapLayout, type MapRect } from "../event-map";
import { buildLayout, type LayoutReport } from "./build-layout";
import { recognizeBoothGrid } from "./recognize";
export const MAX_RECOGNITION_PIXELS = 7_000_000;
export type RecognitionInput = {
  image: { width: number; height: number; data: Uint8Array };
  sourceRect: MapRect;
  sourceSize: { width: number; height: number };
  targetSize: { width: number; height: number };
  template: string;
  boothList: string;
};

/** Crop coordinates belong to the source image; the editor may use another
 * canvas size. Transform once, keeping its existing background and content. */
export function recognizeEditorDraft(input: RecognitionInput): LayoutReport {
  const { image, sourceRect, sourceSize, targetSize } = input;
  if (image.width * image.height > MAX_RECOGNITION_PIXELS) throw new Error("辨識範圍超過 700 萬像素，請框選較小範圍。");
  const report = buildLayout(recognizeBoothGrid(image), { template: input.template, boothList: input.boothList });
  const sx = targetSize.width / sourceSize.width, sy = targetSize.height / sourceSize.height;
  const point = (x: number, y: number) => ({ x: (sourceRect.x + x) * sx, y: (sourceRect.y + y) * sy });
  const rect = (value: MapRect): MapRect => ({ ...point(value.x, value.y), width: value.width * sx, height: value.height * sy });
  const layout = report.layout;
  layout.width = targetSize.width; layout.height = targetSize.height;
  layout.floor = rect(layout.floor);
  layout.rows.forEach(row => row.slots.forEach(slot => { slot.rect = rect(slot.rect); }));
  layout.pillars = layout.pillars.map(pillar => ({ ...pillar, ...rect(pillar) }));
  layout.accessPoints = layout.accessPoints.map(door => ({ ...door, ...point(door.x, door.y) }));
  layout.landmarks.forEach(area => { area.rect = rect(area.rect); });
  const validation = validateEventMapLayout(layout);
  return { ...report, valid: validation.ok, errors: validation.errors };
}


