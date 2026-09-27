import { CATALOG_IMAGE_RULES } from "./circle-overrides";

/**
 * The readable image's size: the original when it is within the pixel
 * budget, otherwise scaled down to it, never enlarged. A cap on pixels rather
 * than on the long edge keeps a tall strip at the width its small print needs.
 * Flooring each side keeps the product under the cap the upload route checks.
 */
export function catalogImageSize(width: number, height: number) {
  if (width * height <= CATALOG_IMAGE_RULES.maxPixels) return { width, height };
  const scale = Math.sqrt(CATALOG_IMAGE_RULES.maxPixels / (width * height));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/**
 * The card preview: a fixed width (never enlarged) and at most the height cap,
 * keeping the top of a sheet taller than that. `sourceHeight` is how much of
 * the original, in its own pixels, the preview shows.
 */
export function catalogPreviewSize(width: number, height: number) {
  const scale = Math.min(1, CATALOG_IMAGE_RULES.previewWidth / width);
  const previewWidth = Math.max(1, Math.round(width * scale));
  const previewHeight = Math.max(1, Math.min(CATALOG_IMAGE_RULES.previewMaxHeight, Math.round(height * scale)));
  return { width: previewWidth, height: previewHeight, sourceHeight: Math.min(height, Math.round(previewHeight / scale)) };
}

/** Why a chosen file cannot become a sale-sheet page, or null. PDF and PSD are named, since they are what print shops hand over. */
export function catalogFileProblem(file: { name: string; type: string }) {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "PDF 請先匯出成 JPG 或 PNG 再上傳。";
  if (type === "image/vnd.adobe.photoshop" || name.endsWith(".psd")) return "PSD 請先匯出成 JPG 或 PNG 再上傳。";
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return "品書圖片請使用 JPG、PNG 或 WebP。";
  return null;
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

/**
 * Decode without a `blob:` address: the portal's CSP admits `data:` and
 * `https:` images only. `createImageBitmap` reads the file directly and
 * applies the photo's orientation; a `data:` address is the fallback for an
 * engine that cannot.
 */
async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Fall through to the element path, which some engines decode more of.
    }
  }
  const address = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = address;
  await image.decode();
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => undefined };
}

function encode(image: Decoded, width: number, height: number, sourceHeight: number, quality: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("這個瀏覽器無法處理圖片，請改用其他瀏覽器。"));
  // A white page under any transparency: JPEG has none, and a dark reader
  // background would otherwise show through the edges.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image.source, 0, 0, image.width, sourceHeight, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("無法處理這張圖片，請改用 JPG 或 PNG。")),
    "image/jpeg", quality,
  ));
}

/**
 * Turn a chosen file into the two JPEGs the upload route accepts. Drawing onto
 * a canvas applies the photo's orientation and leaves every metadata block —
 * EXIF, XMP, IPTC — behind, so nothing but pixels is published.
 */
export async function prepareCatalogImage(file: File) {
  let image: Decoded;
  try {
    image = await decode(file);
  } catch {
    throw new Error("無法讀取這張圖片，請改用 JPG 或 PNG。");
  }
  try {
    const { width, height } = image;
    const size = catalogImageSize(width, height);
    // Rarely needed: a dense sheet at the pixel cap is about 1 MiB. A lower
    // quality is still readable where a refused upload is not.
    let full: Blob | null = null;
    for (const quality of [CATALOG_IMAGE_RULES.quality, 0.8, 0.72]) {
      full = await encode(image, size.width, size.height, height, quality);
      if (full.size <= CATALOG_IMAGE_RULES.maxBytes) break;
    }
    if (!full || full.size > CATALOG_IMAGE_RULES.maxBytes) throw new Error("這張圖片縮小後仍超過大小上限，請分成多張上傳。");
    const preview = catalogPreviewSize(width, height);
    return {
      full,
      preview: await encode(image, preview.width, preview.height, preview.sourceHeight, CATALOG_IMAGE_RULES.previewQuality),
      readable: Math.min(size.width, size.height) >= CATALOG_IMAGE_RULES.readableShortEdge,
    };
  } finally {
    image.release();
  }
}
