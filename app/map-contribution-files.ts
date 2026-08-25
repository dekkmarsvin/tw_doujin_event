import { sha256Hex } from "./hosted-thumbnails";

export const MAP_CONTRIBUTION_MAX_BYTES = 20 * 1024 * 1024;
export const MAP_CONTRIBUTION_MAX_PDF_PAGES = 20;
export const MAP_CONTRIBUTION_MAX_IMAGE_PIXELS = 16_000_000;
export const MAP_CONTRIBUTION_MAX_DECOMPRESSED_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAP_CONTRIBUTION_MAX_IMAGE_DIMENSION = 8_192;

export type PreparedMapContributionFile = {
  bytes: ArrayBuffer;
  contentType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  extension: "jpg" | "png" | "webp" | "pdf";
  sha256: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  pageCount: number | null;
  sourceUrl: string;
  documentDate: string;
  pageNumber: number | null;
};

export type MapContributionFileStore = {
  put: (key: string, value: ArrayBuffer, contentType: string) => Promise<void>;
  get: (key: string) => Promise<{ body: ReadableStream; contentType?: string } | null>;
  delete: (key: string | string[]) => Promise<void>;
};

function validHttps(value: string) {
  try { return value.startsWith("https://") && new URL(value).protocol === "https:"; } catch { return false; }
}

function validDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const [year, month, day] = [yearText, monthText, dayText].map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

async function pngDimensions(bytes: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 57 || !signature.every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let sawIdat = false;
  let sawIend = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) return null;
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      bitDepth = bytes[offset + 16];
      colorType = bytes[offset + 17];
      if (bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) return null;
    } else if (type === "IHDR") return null;
    if (type === "IDAT") sawIdat = true;
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length) return null;
      sawIend = true;
      break;
    }
    offset = end;
  }
  const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType);
  const validDepths = colorType === 3 ? [1, 2, 4, 8] : colorType === 0 ? [1, 2, 4, 8, 16] : [8, 16];
  if (!sawIend || !sawIdat || !channels || !validDepths.includes(bitDepth)
    || width < 1 || height < 1 || width > MAP_CONTRIBUTION_MAX_IMAGE_DIMENSION
    || height > MAP_CONTRIBUTION_MAX_IMAGE_DIMENSION
    || width * height > MAP_CONTRIBUTION_MAX_IMAGE_PIXELS) return null;
  const rowBytes = Math.ceil(width * channels * bitDepth / 8);
  const expected = height * (rowBytes + 1);
  if (expected > MAP_CONTRIBUTION_MAX_DECOMPRESSED_IMAGE_BYTES) return null;
  return { width, height };
}

function jpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let dimensions: { width: number; height: number } | null = null;
  let sawScan = false;
  let entropyBytes = 0;
  while (offset + 2 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9) return offset === bytes.length && sawScan && entropyBytes > 0 ? dimensions : null;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > bytes.length) return null;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (marker === 0xc0) {
      if (length < 7) return null;
      dimensions = { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
      if (dimensions.width < 1 || dimensions.height < 1
        || dimensions.width > MAP_CONTRIBUTION_MAX_IMAGE_DIMENSION
        || dimensions.height > MAP_CONTRIBUTION_MAX_IMAGE_DIMENSION
        || dimensions.width * dimensions.height > MAP_CONTRIBUTION_MAX_IMAGE_PIXELS) return null;
    }
    if (marker === 0xda) {
      sawScan = true;
      offset += length;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { entropyBytes += 1; offset += 1; continue; }
        if (offset + 1 >= bytes.length) return null;
        const next = bytes[offset + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { entropyBytes += 1; offset += 2; continue; }
        break;
      }
      continue;
    }
    offset += length;
  }
  return null;
}

function uint24le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpDimensions(bytes: Uint8Array) {
  if (bytes.length < 30 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF"
    || String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) return null;
  let offset = 12;
  let canvas: { width: number; height: number } | null = null;
  let image: { width: number; height: number } | null = null;
  while (offset + 8 <= bytes.length) {
    const chunk = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    const data = offset + 8;
    const end = data + length;
    if (end > bytes.length) return null;
    if (chunk === "VP8X" && length === 10) {
      if ((bytes[data] & 0x02) !== 0) return null;
      canvas = { width: uint24le(bytes, data + 4) + 1, height: uint24le(bytes, data + 7) + 1 };
    }
    if (chunk === "ANIM" || chunk === "ANMF") return null;
    if (chunk === "VP8L" && length >= 5 && bytes[data] === 0x2f) {
      const bits = bytes[data + 1] | (bytes[data + 2] << 8) | (bytes[data + 3] << 16) | (bytes[data + 4] << 24);
      image = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8 " && length >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      image = { width: (bytes[data + 6] | (bytes[data + 7] << 8)) & 0x3fff, height: (bytes[data + 8] | (bytes[data + 9] << 8)) & 0x3fff };
    }
    offset = end + (length & 1);
  }
  if (offset !== bytes.length || !image || image.width > MAP_CONTRIBUTION_MAX_IMAGE_DIMENSION
    || image.height > MAP_CONTRIBUTION_MAX_IMAGE_DIMENSION
    || image.width * image.height > MAP_CONTRIBUTION_MAX_IMAGE_PIXELS) return null;
  if (canvas && (canvas.width !== image.width || canvas.height !== image.height)) return null;
  return image;
}

function pdfPageCount(bytes: Uint8Array) {
  const original = new TextDecoder("latin1").decode(bytes);
  const text = original.replace(/#([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  const start = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  if (!text.startsWith("%PDF-") || !start) return null;
  const xrefOffset = Number(start[1]);
  if (!Number.isSafeInteger(xrefOffset) || text.slice(xrefOffset, xrefOffset + 4) !== "xref") return null;
  const trailer = text.slice(xrefOffset, start.index);
  if (!/trailer\s*<<[\s\S]*\/Root\s+\d+\s+\d+\s+R[\s\S]*>>/.test(trailer)) return null;
  // Object streams can hide dictionaries from a bounded structural scan, so
  // this conservative profile rejects them instead of guessing at contents.
  if (/\/ObjStm\b/.test(text) || /\/(?:Encrypt|JavaScript|JS|OpenAction|AA|EmbeddedFiles?|Launch|RichMedia)\b/.test(text)) {
    throw new Error("PDF 不得包含加密、動作、腳本或附件。");
  }
  const body = text.slice(0, xrefOffset);
  const pages = body.match(/\d+\s+\d+\s+obj[\s\S]*?\/Type\s*\/Page\b[\s\S]*?endobj/g)?.length ?? 0;
  return pages >= 1 && pages <= MAP_CONTRIBUTION_MAX_PDF_PAGES ? pages : null;
}

export async function prepareMapContributionFile(input: {
  file: File;
  sourceUrl: string;
  documentDate: string;
  pageNumber?: number | null;
}): Promise<PreparedMapContributionFile> {
  if (!validHttps(input.sourceUrl)) throw new Error("官方來源 URL 必須使用 HTTPS。");
  if (!validDate(input.documentDate)) throw new Error("文件日期必須是有效的 YYYY-MM-DD。");
  if (input.file.size <= 0 || input.file.size > MAP_CONTRIBUTION_MAX_BYTES) throw new Error("單檔必須介於 1 byte 與 20 MiB 之間。");
  const bytes = await input.file.arrayBuffer();
  const view = new Uint8Array(bytes);
  const pageNumber = input.pageNumber ?? null;
  let extension: PreparedMapContributionFile["extension"];
  let width: number | null = null;
  let height: number | null = null;
  let pageCount: number | null = null;

  if (input.file.type === "image/png") {
    const dimensions = await pngDimensions(view);
    if (!dimensions) throw new Error("只接受容器完整、非交錯且宣告像素資料不超過 32 MiB 的 PNG。");
    ({ width, height } = dimensions); extension = "png";
  } else if (input.file.type === "image/jpeg") {
    const dimensions = jpegDimensions(view);
    if (!dimensions) throw new Error("只接受結構完整的 baseline JPEG（不接受 progressive JPEG）。");
    ({ width, height } = dimensions); extension = "jpg";
  } else if (input.file.type === "image/webp") {
    const dimensions = webpDimensions(view);
    if (!dimensions) throw new Error("只接受結構完整的靜態 WebP（不接受動畫 WebP）。");
    ({ width, height } = dimensions); extension = "webp";
  } else if (input.file.type === "application/pdf") {
    pageCount = pdfPageCount(view);
    if (!pageCount) throw new Error(`只接受 classic xref、未加密且不含 object stream 的 PDF，頁數須為 1–${MAP_CONTRIBUTION_MAX_PDF_PAGES} 頁。`);
    if (pageNumber !== null && (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount)) {
      throw new Error("PDF 頁碼不在文件頁數範圍內。");
    }
    extension = "pdf";
  } else {
    throw new Error("只接受 JPEG、PNG、WebP 或 PDF。");
  }
  if (extension !== "pdf" && pageNumber !== null) throw new Error("只有 PDF 可以指定頁碼。");

  return {
    bytes,
    contentType: input.file.type as PreparedMapContributionFile["contentType"],
    extension,
    sha256: await sha256Hex(bytes),
    sizeBytes: input.file.size,
    width,
    height,
    pageCount,
    sourceUrl: input.sourceUrl,
    documentDate: input.documentDate,
    pageNumber,
  };
}

export function mapContributionObjectKey(input: { eventId: string; draftId: string; fileId: string; extension: string }) {
  for (const [label, value] of Object.entries(input)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error(`${label} is invalid.`);
  }
  return `map-contributions/${input.eventId}/${input.draftId}/${input.fileId}.${input.extension}`;
}
