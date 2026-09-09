export type MapLabelPresentation = { screenScale: number; targetPx: number; paddingPx: number };

/** Share of a slot's height the label may use once its thumbnail is showing. */
export const MAP_MEDIA_LABEL_BAND = .38;

/** Conservatively allocate one em per character; rendering never measures DOM. */
export function mapLabelFontSize(size: { width: number; height: number }, text: string, media: boolean, presentation: MapLabelPresentation): number | null {
  const { screenScale, targetPx, paddingPx } = presentation;
  if (![screenScale, targetPx, paddingPx, size.width, size.height].every(Number.isFinite) || screenScale <= 0) return null;
  // The code always renders; only the band it has to fit into changes with
  // media, and on a tiny band the padding gives way rather than erasing it.
  const usable = (extent: number) => Math.max(extent - paddingPx * 2, extent / 2);
  const width = usable(size.width * screenScale);
  const height = usable(size.height * (media ? MAP_MEDIA_LABEL_BAND : 1) * screenScale);
  const fontPx = Math.min(targetPx, width / Math.max(1, [...text].length), height / 1.2);
  return fontPx / screenScale;
}
