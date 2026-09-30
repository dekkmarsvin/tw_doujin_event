import { deflateSync } from "node:zlib";
const FONT = {
  0: ["111", "101", "101", "101", "111"], 1: ["010", "110", "010", "010", "111"], 2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"], 4: ["101", "101", "111", "001", "001"], 5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"], 7: ["111", "001", "010", "010", "010"], 8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"],
};

function canvas(width, height, [r, g, b] = [255, 255, 255]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set([r, g, b, 255], i * 4);
  return { width, height, data };
}

function fill(image, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) image.data.set([...color, 255], (yy * image.width + xx) * 4);
}

/** Digits at 2× scale (6×10 each, 2 px apart), centred on (cx, cy). */
function text(image, value, cx, cy, color = [20, 20, 20]) {
  const width = value.length * 8 - 2;
  let x = Math.round(cx - width / 2);
  const y = Math.round(cy - 5);
  for (const digit of value) {
    FONT[digit].forEach((line, row) => [...line].forEach((bit, column) => { if (bit === "1") fill(image, x + column * 2, y + row * 2, 2, 2, color); }));
    x += 8;
  }
}

/** A ruled block of `columns × rows` cells with 2 px black walls. `label`
 * returns the number printed in a cell, or null to leave it blank. */
function ruledBlock(image, x0, y0, columns, rows, cellW, cellH, label) {
  for (let c = 0; c <= columns; c += 1) fill(image, x0 + c * cellW, y0, 2, rows * cellH + 2, [0, 0, 0]);
  for (let r = 0; r <= rows; r += 1) fill(image, x0, y0 + r * cellH, columns * cellW + 2, 2, [0, 0, 0]);
  for (let c = 0; c < columns; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const value = label(c, r);
      if (value !== null) text(image, value, x0 + c * cellW + 1 + cellW / 2, y0 + r * cellH + 1 + cellH / 2);
    }
  }
}

/** FF-style numbering: 1 at the bottom right, up the right column, then
 * down the left column. */
const uTurn = (rows) => (c, r) => String(c === 1 ? rows - r : rows + 1 + r);

function ruledPlan({ blankTopLeftOfA = false } = {}) {
  const image = canvas(420, 260);
  ruledBlock(image, 300, 80, 2, 8, 30, 18, (c, r) => (blankTopLeftOfA && c === 0 && r === 0 ? null : uTurn(8)(c, r)));
  ruledBlock(image, 200, 80, 2, 8, 30, 18, uTurn(8));
  ruledBlock(image, 200, 20, 6, 1, 20, 32, (c) => String(6 - c));
  return image;
}

const centreOf = (layout, code) => {
  const slot = layout.rows.flatMap((row) => row.slots).find((candidate) => candidate.code === code);
  return slot && { x: slot.rect.x + slot.rect.width / 2, y: slot.rect.y + slot.rect.height / 2 };
};
const near = (point, x, y, tolerance = 6) => point && Math.abs(point.x - x) <= tolerance && Math.abs(point.y - y) <= tolerance;

function encodePng({ width, height, data }, { cycleFilters = false } = {}) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, "ascii");
    Buffer.from(body).copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  const pixel = (x, y, ch) => (x < 0 || y < 0 ? 0 : data[(y * width + x) * 4 + ch]);
  for (let y = 0; y < height; y += 1) {
    const filter = cycleFilters ? y % 5 : 0;
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < width; x += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        const value = pixel(x, y, ch);
        const left = pixel(x - 1, y, ch);
        const up = pixel(x, y - 1, ch);
        const upLeft = pixel(x - 1, y - 1, ch);
        const paeth = (() => { const p = left + up - upLeft; const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft); return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft; })();
        const predicted = [0, left, up, (left + up) >> 1, paeth][filter];
        raw[y * (stride + 1) + 1 + x * 3 + ch] = (value - predicted) & 0xff;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

export { canvas, fill, text, ruledPlan, centreOf, near, encodePng };
