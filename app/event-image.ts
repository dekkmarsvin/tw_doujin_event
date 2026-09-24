/** 活動圖片 (#396, ADR-0070).
 *
 * An organizer may attach one picture to an event. It stays private until the
 * event is approved: the upload is kept under the candidate in the private map
 * evidence bucket, and approval copies it into the public thumbnail bucket
 * under a name made of its own SHA-256. That name is known from the moment of
 * upload, so the draft, the approval snapshot and the published event.json can
 * all carry the final public address without ever reading a clock or the
 * network when the publication is built.
 */
import { sha256Hex } from "./hosted-thumbnails";
import { mapImageDimensions } from "./map-contribution-files";

export const EVENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Google's minimum for an event's image; the ratio is left to the organizer. */
export const EVENT_IMAGE_MIN_WIDTH = 1200;

const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
export type EventImageContentType = keyof typeof TYPES;

/** What a draft and an approval carry. `url` is where approval will put it. */
export type EventImage = { url: string; sha256: string; contentType: EventImageContentType; width: number; height: number };
/** What a published event.json carries: enough to name and size the picture. */
export type PublishedEventImage = { url: string; width: number; height: number };

const SHA256 = /^[0-9a-f]{64}$/u;
const CANDIDATE_ID = /^[a-z0-9][a-z0-9-]*$/u;

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const dimension = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/** https, or plain http on the loopback origin the local portal serves its
 * bucket from. A published event.json is still held to https on its own. */
function imageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname));
  } catch { return false; }
}

/** The public bucket key. Content-addressed, so copying it twice is harmless. */
export function eventImagePublicKey(image: Pick<EventImage, "sha256" | "contentType">) {
  return `event-images/${image.sha256}.${TYPES[image.contentType]}`;
}

/** The private upload, kept with the candidate until it is replaced. */
export function organizerEventImageObjectKey(candidateId: string, image: Pick<EventImage, "sha256" | "contentType">) {
  if (!CANDIDATE_ID.test(candidateId)) throw new Error("candidateId is invalid.");
  return `organizer-event-images/${candidateId}/${image.sha256}.${TYPES[image.contentType]}`;
}

export function organizerEventImagePrefix(candidateId: string) {
  if (!CANDIDATE_ID.test(candidateId)) throw new Error("candidateId is invalid.");
  return `organizer-event-images/${candidateId}/`;
}

/** Shape only; whether the bytes exist is checked where a store is at hand. */
export function parseEventImage(value: unknown): EventImage | null {
  if (!record(value) || Object.keys(value).some((key) => !["url", "sha256", "contentType", "width", "height"].includes(key))) return null;
  if (!imageUrl(value.url) || typeof value.sha256 !== "string" || !SHA256.test(value.sha256)
    || typeof value.contentType !== "string" || !Object.hasOwn(TYPES, value.contentType)
    || !dimension(value.width) || !dimension(value.height)) return null;
  const image = { url: value.url, sha256: value.sha256, contentType: value.contentType as EventImageContentType, width: value.width, height: value.height };
  // The address is derived from the bytes, never chosen: a draft cannot point
  // the published event at some other object in the bucket.
  if (!image.url.endsWith(`/${eventImagePublicKey(image)}`)) return null;
  return image;
}

/** The two facts that name a stored picture, from untrusted input such as a query string. */
export function eventImageKeyParts(sha256: unknown, contentType: unknown): Pick<EventImage, "sha256" | "contentType"> | null {
  return typeof sha256 === "string" && SHA256.test(sha256) && typeof contentType === "string" && Object.hasOwn(TYPES, contentType)
    ? { sha256, contentType: contentType as EventImageContentType } : null;
}

export function sameEventImage(a: EventImage | null | undefined, b: EventImage | null | undefined) {
  return (a ?? null) === (b ?? null) || (!!a && !!b && a.url === b.url && a.sha256 === b.sha256
    && a.contentType === b.contentType && a.width === b.width && a.height === b.height);
}

export function publishedEventImage(image: EventImage): PublishedEventImage {
  return { url: image.url, width: image.width, height: image.height };
}

/** Checks an upload and describes it. `publicUrl` maps a bucket key to its address. */
export async function prepareEventImage(file: File, publicUrl: (key: string) => string) {
  if (file.size <= 0 || file.size > EVENT_IMAGE_MAX_BYTES) throw new Error("活動圖片必須大於 0 bytes，且不可超過 5 MiB。");
  const bytes = await file.arrayBuffer();
  const described = await describeEventImageBytes(file.type, bytes);
  const image: EventImage = { ...described, url: publicUrl(eventImagePublicKey(described)) };
  return { bytes, image };
}

/** The same checks for bytes already stored, so a save or an approval can
 * confirm that what a draft claims about a picture is what the bucket holds. */
export async function describeEventImageBytes(type: string, bytes: ArrayBuffer) {
  if (!Object.hasOwn(TYPES, type)) throw new Error("活動圖片只接受 JPEG、PNG 或 WebP。");
  const dimensions = await mapImageDimensions(type, new Uint8Array(bytes));
  if (!dimensions) throw new Error("活動圖片只接受 JPEG、PNG 或 WebP。");
  if (dimensions.width < EVENT_IMAGE_MIN_WIDTH) throw new Error(`活動圖片寬度至少要 ${EVENT_IMAGE_MIN_WIDTH} px，這張是 ${dimensions.width} px。`);
  return { sha256: await sha256Hex(bytes), contentType: type as EventImageContentType, width: dimensions.width, height: dimensions.height };
}
