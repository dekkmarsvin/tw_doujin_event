/**
 * Upload in, draft map out: decode, optionally crop to one hall, recognise
 * the booth grid, name the booths from the booth list, and draw the result.
 * Pure computation over the request body, so it runs the same in a Worker, in
 * Node and in a browser tab.
 */
import { buildLayout, layoutSummary, type LayoutReport } from "./build-layout";
import { cropImage, decodeImage, type RasterImage } from "./decode-image";
import { recognizeBoothGrid } from "./recognize";
import { renderLayoutSvg } from "./render-svg";

export type PipelineOptions = {
  boothList?: string;
  /** One hall of a sheet that draws several: x, y, width, height in pixels. */
  crop?: { x: number; y: number; width: number; height: number } | null;
  template?: string;
};

export type PipelineResult = {
  report: Omit<LayoutReport, "layout">;
  layout: LayoutReport["layout"];
  summary: ReturnType<typeof layoutSummary>;
  svg: string;
  image: { width: number; height: number; offsetX: number; offsetY: number };
  timingsMs: Record<string, number>;
};

export async function recognizePlan(bytes: Uint8Array, options: PipelineOptions = {}): Promise<PipelineResult> {
  const timings: Record<string, number> = {};
  let mark = performance.now();
  const lap = (name: string) => { const now = performance.now(); timings[name] = Math.round(now - mark); mark = now; };
  let image: RasterImage = await decodeImage(bytes);
  lap("decode");
  const crop = options.crop ?? null;
  if (crop) image = cropImage(image, crop);
  const recognition = recognizeBoothGrid(image);
  lap("recognize");
  const { layout, ...report } = buildLayout(recognition, { boothList: options.boothList, template: options.template });
  lap("layout");
  const svg = renderLayoutSvg(layout);
  lap("render");
  return {
    report,
    layout,
    summary: layoutSummary({ layout, ...report }),
    svg,
    image: { width: image.width, height: image.height, offsetX: crop ? Math.round(crop.x) : 0, offsetY: crop ? Math.round(crop.y) : 0 },
    timingsMs: timings,
  };
}

/** Parses "x,y,width,height" as typed into a form. */
export function parseCrop(value: string | null | undefined): PipelineOptions["crop"] {
  if (!value?.trim()) return null;
  const numbers = value.split(/[\s,，]+/u).filter(Boolean).map(Number);
  if (numbers.length !== 4 || numbers.some((v) => !Number.isFinite(v) || v < 0) || numbers[2] < 1 || numbers[3] < 1) return null;
  return { x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3] };
}
