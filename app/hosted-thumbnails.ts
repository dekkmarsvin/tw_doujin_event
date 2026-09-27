import { CATALOG_IMAGE_RULES, isHttpsUrl, type CircleCatalogImage, type CircleOverrideFields, type CircleOverrideThumbnail } from "./circle-overrides";

export const HOSTED_THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;
const R2_DELETE_BATCH_SIZE = 1000;

const FORMATS = [
  { mime: "image/jpeg", extension: "jpg", matches: (bytes: Uint8Array) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { mime: "image/png", extension: "png", matches: (bytes: Uint8Array) => bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value) },
  { mime: "image/webp", extension: "webp", matches: (bytes: Uint8Array) => bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP" },
] as const;

export type HostedThumbnailStore = {
  url(key: string): string;
  list(prefix: string): Promise<string[]>;
  put(key: string, value: ArrayBuffer, contentType: string): Promise<void>;
  delete(keys: string | string[]): Promise<void>;
};

/** Workers R2 accepts at most 1000 object keys in one delete call. Keep the
 * boundary here so every cleanup path behaves the same way when a busy event
 * creates more than one page of objects. */
export async function deleteObjectKeys(
  store: Pick<HostedThumbnailStore, "delete">,
  keys: readonly string[],
) {
  for (let index = 0; index < keys.length; index += R2_DELETE_BATCH_SIZE) {
    await store.delete(keys.slice(index, index + R2_DELETE_BATCH_SIZE));
  }
}

function detectHostedThumbnailFormat(bytes: Uint8Array) {
  return FORMATS.find((format) => format.matches(bytes)) ?? null;
}

export async function sha256Hex(value: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", value))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * A circle uploading its own artwork is the source; there is no other page to
 * point at, so the two provenance fields are optional here (ADR-0053). They are
 * still validated when filled — a credit for someone else's work is worth
 * keeping accurate.
 */
export async function prepareHostedThumbnail(input: {
  eventId: string;
  circleId: string;
  file: File;
  sourceUrl?: string;
  provider?: string;
}) {
  if (input.file.size === 0 || input.file.size > HOSTED_THUMBNAIL_MAX_BYTES) {
    throw new Error("代表圖必須大於 0 bytes，且不可超過 5 MiB。");
  }
  const sourceUrl = (input.sourceUrl ?? "").trim();
  if (sourceUrl && !isHttpsUrl(sourceUrl)) throw new Error("圖片出處頁面若要填寫，必須是 https 網址。");
  const provider = (input.provider ?? "").normalize("NFKC").trim();
  if (provider.length > 60) throw new Error("來源標示最多 60 字。");

  const value = await input.file.arrayBuffer();
  const format = detectHostedThumbnailFormat(new Uint8Array(value));
  if (!format || input.file.type.toLowerCase() !== format.mime) {
    throw new Error("代表圖只接受內容與 MIME 一致的 JPEG、PNG 或 WebP。");
  }
  const hash = await sha256Hex(value);
  const key = `events/${encodeURIComponent(input.eventId)}/circles/${encodeURIComponent(input.circleId)}/${hash}.${format.extension}`;
  return { key, value, contentType: format.mime, sourceUrl, provider };
}

export function hostedThumbnailFields(store: HostedThumbnailStore, prepared: Awaited<ReturnType<typeof prepareHostedThumbnail>>): CircleOverrideThumbnail {
  return { url: store.url(prepared.key), sourceUrl: prepared.sourceUrl, provider: prepared.provider };
}

/** Every object a circle's authored content can own in one event lives here. */
export function circleObjectPrefix(eventId: string, circleId: string) {
  return `events/${encodeURIComponent(eventId)}/circles/${encodeURIComponent(circleId)}/`;
}

/**
 * Sale-sheet images sit one level down, so the single-picture rules of the
 * thumbnail — which replace whatever else is directly under the circle — can
 * never reach them, while every whole-circle deletion still does.
 */
export function catalogObjectPrefix(eventId: string, circleId: string) {
  return `${circleObjectPrefix(eventId, circleId)}catalog/`;
}

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The object key behind a hosted sale-sheet URL, or null when it is not one of this circle's. */
export function catalogKeyOf(store: Pick<HostedThumbnailStore, "url">, url: string, eventId: string, circleId: string) {
  const origin = store.url("");
  if (!url.startsWith(origin)) return null;
  const key = url.slice(origin.length);
  return new RegExp(`^${escapePattern(catalogObjectPrefix(eventId, circleId))}[a-f0-9]{64}\\.jpg$`).test(key) ? key : null;
}

/** Keys of every object the fields reference as sale-sheet images. */
export function catalogKeysOf(store: Pick<HostedThumbnailStore, "url">, fields: CircleOverrideFields | null | undefined, eventId: string, circleId: string) {
  return (fields?.catalogImages ?? []).flatMap((image) => [image.url, image.previewUrl]).map((url) => catalogKeyOf(store, url, eventId, circleId));
}

/**
 * Width and height from a baseline or progressive JPEG's frame header, read
 * without decoding: the upload route has no image library and needs none to
 * hold a sale sheet to its pixel budget.
 */
export function jpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) { at += 1; continue; }
    // Markers that stand alone carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { at += 2; continue; }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (frame) {
      if (at + 8 >= bytes.length) return null;
      const height = (bytes[at + 5] << 8) | bytes[at + 6];
      const width = (bytes[at + 7] << 8) | bytes[at + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (marker === 0xda || length < 2) return null;
    at += 2 + length;
  }
  return null;
}

/**
 * Check one prepared sale-sheet page and its card preview. The browser does
 * the resizing (the Worker never re-encodes, as for thumbnails); this holds the
 * result to the same rules so a client that skipped the step cannot publish a
 * print-resolution file or a preview a card would have to scale down.
 */
export async function prepareHostedCatalogImage(input: { eventId: string; circleId: string; file: File; preview: File }) {
  const read = async (file: File, maxBytes: number, what: string) => {
    if (file.size === 0 || file.size > maxBytes) throw new Error(`${what}超過大小上限，請重新選擇檔案。`);
    const value = await file.arrayBuffer();
    const bytes = new Uint8Array(value);
    const dimensions = jpegDimensions(bytes);
    if (file.type.toLowerCase() !== "image/jpeg" || !dimensions) throw new Error(`${what}格式無效，請重新選擇檔案。`);
    return { value, dimensions, hash: await sha256Hex(value) };
  };
  const full = await read(input.file, CATALOG_IMAGE_RULES.maxBytes, "品書圖片");
  const preview = await read(input.preview, CATALOG_IMAGE_RULES.previewMaxBytes, "品書預覽圖");
  // The same two limits the field accepts, so a page staged here can be saved.
  if (full.dimensions.width * full.dimensions.height > CATALOG_IMAGE_RULES.maxPixels
    || Math.max(full.dimensions.width, full.dimensions.height) > CATALOG_IMAGE_RULES.maxDimension) {
    throw new Error("品書圖片尺寸超過上限，請重新選擇檔案。");
  }
  if (preview.dimensions.width > CATALOG_IMAGE_RULES.previewWidth || preview.dimensions.height > CATALOG_IMAGE_RULES.previewMaxHeight) {
    throw new Error("品書預覽圖尺寸超過上限，請重新選擇檔案。");
  }
  const prefix = catalogObjectPrefix(input.eventId, input.circleId);
  return {
    full: { key: `${prefix}${full.hash}.jpg`, value: full.value },
    preview: { key: `${prefix}${preview.hash}.jpg`, value: preview.value },
    width: full.dimensions.width,
    height: full.dimensions.height,
  };
}

export function hostedCatalogImage(store: Pick<HostedThumbnailStore, "url">, prepared: Awaited<ReturnType<typeof prepareHostedCatalogImage>>): CircleCatalogImage {
  return { url: store.url(prepared.full.key), previewUrl: store.url(prepared.preview.key), width: prepared.width, height: prepared.height };
}
