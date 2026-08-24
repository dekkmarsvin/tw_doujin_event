import { isHttpsUrl, type CircleOverrideThumbnail } from "./circle-overrides";

export const HOSTED_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
export const R2_DELETE_BATCH_SIZE = 1000;

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

export function detectHostedThumbnailFormat(bytes: Uint8Array) {
  return FORMATS.find((format) => format.matches(bytes)) ?? null;
}

export async function sha256Hex(value: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", value))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function prepareHostedThumbnail(input: {
  eventId: string;
  circleId: string;
  file: File;
  sourceUrl: string;
  provider: string;
}) {
  if (input.file.size === 0 || input.file.size > HOSTED_THUMBNAIL_MAX_BYTES) {
    throw new Error("代表圖必須大於 0 bytes，且不可超過 2 MiB。");
  }
  if (!isHttpsUrl(input.sourceUrl)) throw new Error("圖片出處頁面必須是 https 網址。");
  const provider = input.provider.normalize("NFKC").trim();
  if (!provider || provider.length > 60) throw new Error("來源標示必須為 1 到 60 字。");

  const value = await input.file.arrayBuffer();
  const format = detectHostedThumbnailFormat(new Uint8Array(value));
  if (!format || input.file.type.toLowerCase() !== format.mime) {
    throw new Error("代表圖只接受內容與 MIME 一致的 JPEG、PNG 或 WebP。");
  }
  const hash = await sha256Hex(value);
  const key = `events/${encodeURIComponent(input.eventId)}/circles/${encodeURIComponent(input.circleId)}/${hash}.${format.extension}`;
  return { key, value, contentType: format.mime, sourceUrl: input.sourceUrl, provider };
}

export function hostedThumbnailFields(store: HostedThumbnailStore, prepared: Awaited<ReturnType<typeof prepareHostedThumbnail>>): CircleOverrideThumbnail {
  return { url: store.url(prepared.key), sourceUrl: prepared.sourceUrl, provider: prepared.provider };
}
