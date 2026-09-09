export type MapLabelPresentation = { screenScale: number; targetPx: number; minimumPx: number; paddingPx: number };

/** Conservatively allocate one em per character; rendering never measures DOM. */
export function mapLabelFontSize(size: { width: number; height: number }, text: string, media: boolean, presentation: MapLabelPresentation): number | null {
  const { screenScale, targetPx, minimumPx, paddingPx } = presentation;
  if (![screenScale, targetPx, minimumPx, paddingPx, size.width, size.height].every(Number.isFinite) || screenScale <= 0) return null;
  const width = Math.max(0, size.width * screenScale - paddingPx * 2);
  const height = Math.max(0, size.height * (media ? .3 : 1) * screenScale - paddingPx * 2);
  const fontPx = Math.min(targetPx, width / Math.max(1, [...text].length), height / 1.2);
  return fontPx >= minimumPx ? fontPx / screenScale : null;
}
