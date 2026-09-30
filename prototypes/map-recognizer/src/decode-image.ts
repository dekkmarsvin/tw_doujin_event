/**
 * Turns an uploaded floor plan into RGBA pixels inside a Worker.
 *
 * Workers have no canvas and no native image library, so both formats are
 * decoded in plain JS: PNG with the platform's own `DecompressionStream`
 * (no dependency), baseline and progressive JPEG with jpeg-js. Transparent
 * pixels are composited onto white, because a plan's empty background is what
 * a transparent PNG means.
 */
import decodeJpeg from "jpeg-js/lib/decoder.js";

import type { RasterImage } from "../../../app/map-auto-recognition/raster";
export type { RasterImage } from "../../../app/map-auto-recognition/raster";

/** A 128 MB isolate holds the RGBA copy plus the recognizer's per-pixel
 * working arrays (about 13 bytes a pixel in all), so larger plans are refused
 * rather than risking an out-of-memory reset halfway through. */
export const MAX_PIXELS = 7_000_000;
const PIXEL_LIMIT_MESSAGE = `圖片超過 ${(MAX_PIXELS / 1e6).toFixed(0)} 百萬像素，請縮小後再上傳。`;

export class UnsupportedImageError extends Error {}

export async function decodeImage(bytes: Uint8Array): Promise<RasterImage> {
  if (isPng(bytes)) return decodePng(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return decodeJpegImage(bytes);
  throw new UnsupportedImageError("只支援 PNG 或 JPEG 配置圖。");
}

function checkSize(width: number, height: number) {
  if (!(width > 0 && height > 0)) throw new UnsupportedImageError("圖片尺寸無效。");
  if (width * height > MAX_PIXELS) {
    throw new UnsupportedImageError(PIXEL_LIMIT_MESSAGE);
  }
}

function decodeJpegImage(bytes: Uint8Array): RasterImage {
  let image;
  try {
    image = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_PIXELS / 1e6, maxMemoryUsageInMB: 96 });
  } catch (error) {
    // jpeg-js rejects oversized frames before returning dimensions to checkSize.
    if (error instanceof Error && error.message.startsWith("maxResolutionInMP limit exceeded")) {
      throw new UnsupportedImageError(PIXEL_LIMIT_MESSAGE);
    }
    throw error;
  }
  checkSize(image.width, image.height);
  return { width: image.width, height: image.height, data: image.data };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array) {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodePng(bytes: Uint8Array): Promise<RasterImage> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = view.getUint32(chunk.byteOffset - bytes.byteOffset);
      height = view.getUint32(chunk.byteOffset - bytes.byteOffset + 4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      if (chunk[12] !== 0) throw new UnsupportedImageError("不支援交錯（interlaced）PNG，請另存為一般 PNG。");
      checkSize(width, height);
    } else if (type === "PLTE") palette = chunk;
    else if (type === "tRNS") transparency = chunk;
    else if (type === "IDAT") idat.push(chunk);
    else if (type === "IEND") break;
  }
  if (!width || !idat.length) throw new UnsupportedImageError("PNG 缺少影像資料。");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels || ![1, 2, 4, 8, 16].includes(bitDepth)) throw new UnsupportedImageError("不支援這種 PNG 色彩格式。");

  const compressed = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of idat) {
    compressed.set(part, cursor);
    cursor += part.length;
  }
  const raw = await inflate(compressed);
  const bitsPerPixel = channels * bitDepth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < (stride + 1) * height) throw new UnsupportedImageError("PNG 影像資料不完整。");

  const out = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  let current = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bpp ? current[i - bpp] : 0;
      const up = previous[i];
      const upLeft = i >= bpp ? previous[i - bpp] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - up);
        const pc = Math.abs(estimate - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      current[i] = value & 0xff;
    }
    // Fast path for the common 8-bit RGB/RGBA plans: no per-sample closure.
    if (bitDepth === 8 && (colorType === 2 || colorType === 6)) {
      const rowStart = y * width * 4;
      for (let x = 0; x < width; x += 1) {
        const source = x * channels;
        const target = rowStart + x * 4;
        const a = colorType === 6 ? current[source + 3] : 255;
        if (a === 255) {
          out[target] = current[source];
          out[target + 1] = current[source + 1];
          out[target + 2] = current[source + 2];
        } else {
          out[target] = ((current[source] * a + 255 * (255 - a)) / 255) | 0;
          out[target + 1] = ((current[source + 1] * a + 255 * (255 - a)) / 255) | 0;
          out[target + 2] = ((current[source + 2] * a + 255 * (255 - a)) / 255) | 0;
        }
        out[target + 3] = 255;
      }
      [previous, current] = [current, previous];
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      const sample = (channel: number) => {
        if (bitDepth === 8) return current[x * channels + channel];
        if (bitDepth === 16) return current[(x * channels + channel) * 2];
        const bitOffset = x * bitDepth;
        const bits = (current[bitOffset >> 3] >> (8 - bitDepth - (bitOffset & 7))) & ((1 << bitDepth) - 1);
        return colorType === 3 ? bits : Math.round((bits * 255) / ((1 << bitDepth) - 1));
      };
      let r: number;
      let g: number;
      let b: number;
      let a = 255;
      if (colorType === 3) {
        const index = sample(0);
        r = palette?.[index * 3] ?? 0;
        g = palette?.[index * 3 + 1] ?? 0;
        b = palette?.[index * 3 + 2] ?? 0;
        a = transparency && index < transparency.length ? transparency[index] : 255;
      } else if (colorType === 0 || colorType === 4) {
        r = g = b = sample(0);
        if (colorType === 4) a = sample(1);
      } else {
        r = sample(0);
        g = sample(1);
        b = sample(2);
        if (colorType === 6) a = sample(3);
      }
      const target = (y * width + x) * 4;
      // Composite onto white: a transparent plan background is empty floor.
      out[target] = Math.round((r * a + 255 * (255 - a)) / 255);
      out[target + 1] = Math.round((g * a + 255 * (255 - a)) / 255);
      out[target + 2] = Math.round((b * a + 255 * (255 - a)) / 255);
      out[target + 3] = 255;
    }
    [previous, current] = [current, previous];
  }
  return { width, height, data: out };
}

/** The part of a plan inside `rect`, for sheets that draw several halls:
 * each hall is its own map (one per event day × venue space), recognised on
 * its own with its own booth list. */
export function cropImage(image: RasterImage, rect: { x: number; y: number; width: number; height: number }): RasterImage {
  const x = Math.max(0, Math.min(image.width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(image.height - 1, Math.round(rect.y)));
  const width = Math.max(1, Math.min(image.width - x, Math.round(rect.width)));
  const height = Math.max(1, Math.min(image.height - y, Math.round(rect.height)));
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data };
}
