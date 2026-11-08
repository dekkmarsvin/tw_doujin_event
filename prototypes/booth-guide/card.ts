import type { MapPoint, MapRect } from "../../app/event-map";

export type CardSettings = {
  format: "landscape" | "square" | "portrait";
  title: string; subtitle: string; account: string; booth: string; entrance: string;
  color: string; background: string; lineWidth: number; duration: number;
  marker: "dot" | "arrow"; showConnector: boolean; showQr: boolean; closeup: boolean;
  pictureFit: "contain" | "cover";
};
export type CardScene = {
  settings: CardSettings; map: HTMLImageElement; mapSize: { width: number; height: number };
  picture: HTMLImageElement | null; qr: boolean[][];
  start: MapPoint | null; target: MapPoint; waypoints: MapPoint[]; route: boolean;
};
export const CARD_SIZES = { landscape: [1200, 675], square: [1080, 1080], portrait: [1080, 1350] } as const;

export function routePoints(scene: CardScene): MapPoint[] {
  return scene.start ? [scene.start, ...scene.waypoints, scene.target] : [];
}

export function pointOnRoute(points: readonly MapPoint[], progress: number): MapPoint | null {
  if (!points.length) return null;
  const lengths = points.slice(1).map((point, i) => Math.hypot(point.x - points[i].x, point.y - points[i].y));
  let remaining = lengths.reduce((sum, value) => sum + value, 0) * Math.max(0, Math.min(1, progress));
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i];
    if (length > 0 && remaining <= length) {
      const t = remaining / length;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
    }
    remaining -= length;
  }
  return points.at(-1)!;
}

export function cardGeometry(scene: CardScene) {
  const [width, height] = CARD_SIZES[scene.settings.format];
  const horizontal = scene.settings.format === "landscape";
  const hasPicture = !!scene.picture;
  const footer = scene.settings.showQr ? (scene.qr.length + 8) * 3 + 28 : 78;
  const picture: MapRect = horizontal
    ? { x: 38, y: 145, width: 275, height: height - 145 - footer }
    : { x: 38, y: 141, width: 250, height: 230 };
  const mapBox: MapRect = horizontal
    ? { x: hasPicture ? 340 : 38, y: 145, width: width - (hasPicture ? 378 : 76), height: height - 145 - footer }
    : { x: 38, y: hasPicture ? 400 : 145, width: width - 76, height: height - (hasPicture ? 400 : 145) - footer };
  let crop: MapRect = { x: 0, y: 0, ...scene.mapSize };
  if (scene.settings.closeup) {
    const points = [scene.target, ...(scene.start ? [scene.start] : []), ...scene.waypoints];
    const margin = Math.max(scene.mapSize.width, scene.mapSize.height) * .07;
    const x = Math.max(0, Math.min(...points.map(point => point.x)) - margin);
    const y = Math.max(0, Math.min(...points.map(point => point.y)) - margin);
    crop = { x, y, width: Math.min(scene.mapSize.width, Math.max(...points.map(point => point.x)) + margin) - x,
      height: Math.min(scene.mapSize.height, Math.max(...points.map(point => point.y)) + margin) - y };
  }
  const scale = Math.min(mapBox.width / crop.width, mapBox.height / crop.height);
  const map = { x: mapBox.x + (mapBox.width - crop.width * scale) / 2, y: mapBox.y + (mapBox.height - crop.height * scale) / 2,
    width: crop.width * scale, height: crop.height * scale };
  const project = (point: MapPoint) => ({ x: map.x + (point.x - crop.x) * scale, y: map.y + (point.y - crop.y) * scale });
  return { width, height, picture, mapBox, map, crop, scale, project };
}

export function cardPointToMap(scene: CardScene, point: MapPoint): MapPoint | null {
  const { map, crop, scale } = cardGeometry(scene);
  if (point.x < map.x || point.x > map.x + map.width || point.y < map.y || point.y > map.y + map.height) return null;
  return { x: crop.x + (point.x - map.x) / scale, y: crop.y + (point.y - map.y) / scale };
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number, size: number, weight = 600) {
  ctx.font = `${weight} ${size}px "Microsoft JhengHei", "Noto Sans TC", sans-serif`;
  while (ctx.measureText(value).width > maxWidth && size > 14) { size -= 1; ctx.font = `${weight} ${size}px "Microsoft JhengHei", sans-serif`; }
  if (ctx.measureText(value).width > maxWidth) {
    while (value.length && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
    value += "…";
  }
  ctx.fillText(value, x, y);
}

export function drawCard(canvas: HTMLCanvasElement, scene: CardScene, progress: number | null = null, editing = false) {
  const g = cardGeometry(scene), ctx = canvas.getContext("2d")!;
  if (canvas.width !== g.width || canvas.height !== g.height) { canvas.width = g.width; canvas.height = g.height; }
  ctx.clearRect(0, 0, g.width, g.height);
  ctx.fillStyle = scene.settings.background; ctx.fillRect(0, 0, g.width, g.height);
  ctx.fillStyle = scene.settings.color; ctx.fillRect(38, 32, 40, 5);
  ctx.fillStyle = "#172e2b";
  text(ctx, scene.settings.title || "來攤位找我", 38, 83, g.width - 76, 35, 800);
  ctx.fillStyle = "#4c625e";
  text(ctx, scene.settings.subtitle, 38, 118, g.width - 76, 20);
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect(g.mapBox.x - 8, g.mapBox.y - 8, g.mapBox.width + 16, g.mapBox.height + 16, 14); ctx.fill();
  ctx.drawImage(scene.map, g.crop.x, g.crop.y, g.crop.width, g.crop.height, g.map.x, g.map.y, g.map.width, g.map.height);
  if (scene.picture) {
    const p = g.picture, img = scene.picture;
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect(p.x - 7, p.y - 7, p.width + 14, p.height + 14, 10); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y, p.width, p.height); ctx.clip();
    const ratio = scene.settings.pictureFit === "cover" ? Math.max(p.width / img.width, p.height / img.height) : Math.min(p.width / img.width, p.height / img.height);
    ctx.drawImage(img, p.x + (p.width - img.width * ratio) / 2, p.y + (p.height - img.height * ratio) / 2, img.width * ratio, img.height * ratio); ctx.restore();
    if (scene.settings.format !== "landscape") {
      ctx.fillStyle = scene.settings.color; text(ctx, scene.settings.booth, 325, 208, g.width - 363, 56, 800);
      ctx.fillStyle = "#4c625e"; text(ctx, scene.settings.account, 325, 255, g.width - 363, 22);
      text(ctx, scene.settings.entrance ? `從${scene.settings.entrance}出發` : "在地圖上找到我", 325, 296, g.width - 363, 20);
    }
  }
  const target = g.project(scene.target);
  if (scene.picture && scene.settings.showConnector) {
    ctx.strokeStyle = scene.settings.color; ctx.lineWidth = 2; ctx.setLineDash([7, 7]); ctx.beginPath();
    ctx.moveTo(g.picture.x + g.picture.width, g.picture.y + g.picture.height * .7); ctx.lineTo(target.x, target.y); ctx.stroke(); ctx.setLineDash([]);
  }
  const points = routePoints(scene);
  if (scene.route && points.length >= 2) {
    ctx.lineWidth = scene.settings.lineWidth + 4; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); points.map(g.project).forEach((p, i) => { if (!i) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.strokeStyle = "#ffffffdd"; ctx.stroke(); ctx.lineWidth = scene.settings.lineWidth; ctx.strokeStyle = scene.settings.color; ctx.stroke();
    if (progress !== null) {
      const point = pointOnRoute(points, progress)!; const p = g.project(point);
      ctx.fillStyle = scene.settings.color; ctx.strokeStyle = "#fff"; ctx.lineWidth = 3;
      ctx.beginPath();
      if (scene.settings.marker === "arrow") {
        const ahead = g.project(pointOnRoute(points, Math.min(1, progress + .01))!);
        const behind = g.project(pointOnRoute(points, Math.max(0, progress - .01))!);
        const angle = Math.atan2(ahead.y - behind.y, ahead.x - behind.x);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle); ctx.moveTo(13, 0); ctx.lineTo(-9, -9); ctx.lineTo(-5, 0); ctx.lineTo(-9, 9); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      } else { ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
  }
  if (scene.start) {
    const p = g.project(scene.start); ctx.fillStyle = "#fff"; ctx.strokeStyle = scene.settings.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#203b35"; text(ctx, "起點", Math.max(g.mapBox.x, Math.min(p.x + 14, g.mapBox.x + g.mapBox.width - 55)), Math.max(g.mapBox.y + 20, p.y - 11), 60, 17);
  }
  ctx.fillStyle = "#fff"; ctx.strokeStyle = scene.settings.color; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(target.x, target.y, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = scene.settings.color; ctx.beginPath(); ctx.arc(target.x, target.y, 5, 0, Math.PI * 2); ctx.fill();
  if (editing) scene.waypoints.forEach((point, i) => {
    const p = g.project(point); ctx.fillStyle = "#fff"; ctx.strokeStyle = scene.settings.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#172e2b";
    ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.fillText(String(i + 1), p.x, p.y + 4); ctx.textAlign = "left";
  });
  const footerY = g.mapBox.y + g.mapBox.height + 39;
  ctx.fillStyle = scene.settings.color; text(ctx, `${scene.settings.booth}  ·  ${scene.settings.account || "在這裡等你"}`, 38, footerY, g.width - 265, 21, 700);
  drawQr(ctx, scene, g.width, g.height);
  ctx.fillStyle = "#62716b"; ctx.font = "13px sans-serif"; ctx.textAlign = "right";
  ctx.fillText("場刊 Map", g.width - (scene.settings.showQr ? (scene.qr.length + 8) * 3 + 53 : 38), g.height - 31); ctx.textAlign = "left";
  return g;
}

/** Four-module quiet zone and integer pixels at the final PNG/GIF resolution. */
function drawQr(ctx: CanvasRenderingContext2D, scene: CardScene, width: number, height: number, outputScale = 1) {
  if (!scene.settings.showQr) return;
  const modules = scene.qr.length, cell = Math.max(2, Math.floor(3 * outputScale));
  const side = (modules + 8) * cell, right = Math.round(38 * outputScale), bottom = Math.round(14 * outputScale);
  const x = width - right - side, y = height - bottom - side;
  // Erase the scaled copy before painting the crisp final-resolution code.
  const reserved = Math.ceil((modules + 8) * 3 * outputScale);
  ctx.fillStyle = scene.settings.background; ctx.fillRect(width - right - reserved - 1, height - bottom - reserved - 1, reserved + 2, reserved + 2);
  ctx.fillStyle = "#fff"; ctx.fillRect(x, y, side, side); ctx.fillStyle = "#000";
  scene.qr.forEach((row, r) => row.forEach((dark, c) => { if (dark) ctx.fillRect(x + (c + 4) * cell, y + (r + 4) * cell, cell, cell); }));
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("圖片無法讀取，請換一張 JPG、PNG 或 WebP。")); image.src = url; });
}

/** Freeze the actual shared SVG renderer, including its resolved CSS, for canvas export. */
export async function snapshotMap(svg: SVGSVGElement, width: number, height: number) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...svg.querySelectorAll("*")];
  const clones = [clone, ...clone.querySelectorAll("*")];
  const properties = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline", "paint-order", "vector-effect", "visibility"];
  originals.forEach((element, i) => {
    const computed = getComputedStyle(element);
    clones[i].setAttribute("style", properties.map(property => `${property}:${computed.getPropertyValue(property)}`).join(";"));
  });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); clone.setAttribute("width", String(width)); clone.setAttribute("height", String(height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" }));
  try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportPng(scene: CardScene) {
  const canvas = document.createElement("canvas"); drawCard(canvas, scene);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("圖片製作失敗，請重試。")), "image/png"));
  downloadBlob(blob, `${scene.settings.booth}-攤位導引.png`);
}

export async function exportGif(scene: CardScene, report: (percent: number) => void) {
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  const full = document.createElement("canvas"), frame = document.createElement("canvas");
  const [width, height] = CARD_SIZES[scene.settings.format];
  const ratio = Math.min(1, 900 / Math.max(width, height));
  frame.width = Math.round(width * ratio); frame.height = Math.round(height * ratio);
  const ctx = frame.getContext("2d", { willReadFrequently: true })!, gif = GIFEncoder();
  const frames = scene.settings.duration * 12;
  for (let i = 0; i < frames; i++) {
    drawCard(full, scene, Math.min(1, i / Math.max(1, (frames - 1) * .8)));
    ctx.drawImage(full, 0, 0, frame.width, frame.height);
    drawQr(ctx, scene, frame.width, frame.height, ratio);
    const { data } = ctx.getImageData(0, 0, frame.width, frame.height);
    const palette = quantize(data, 256), index = applyPalette(data, palette);
    gif.writeFrame(index, frame.width, frame.height, { palette, delay: i % 3 === 0 ? 90 : 80, repeat: 0 });
    report(Math.round((i + 1) / frames * 100));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  gif.finish(); downloadBlob(new Blob([gif.bytes()], { type: "image/gif" }), `${scene.settings.booth}-攤位導引.gif`);
}
