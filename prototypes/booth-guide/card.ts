import { rowLabelPlacement, type EventMapLayout, type MapPoint, type MapRect } from "../../app/event-map";

export type CardSettings = {
  format: "landscape" | "square" | "portrait";
  title: string; subtitle: string; account: string; booth: string; entrance: string;
  color: string; background: string; lineWidth: number; duration: number;
  marker: "dot" | "arrow"; showConnector: boolean; showQr: boolean; closeup: boolean;
  pictureFit: "contain" | "cover";
};
export type CardScene = {
  settings: CardSettings; map: HTMLImageElement; mapSize: EventMapLayout;
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
  const picture: MapRect = horizontal
    ? { x: 38, y: 145, width: 275, height: height - 195 }
    : { x: 38, y: 38, width: 228, height: 228 };
  const mapBox: MapRect = horizontal
    ? { x: hasPicture ? 340 : 38, y: 145, width: width - (hasPicture ? 378 : 76), height: height - 195 }
    : { x: 38, y: hasPicture ? 324 : 252, width: width - 76, height: height - (hasPicture ? 364 : 292) };
  let crop: MapRect = { x: 0, y: 0, width: scene.mapSize.width, height: scene.mapSize.height };
  if (scene.settings.closeup) {
    const points = [scene.target, ...(scene.start ? [scene.start] : []), ...scene.waypoints];
    const margin = Math.max(scene.mapSize.width, scene.mapSize.height) * .055;
    // Keep the names of the rows around the route, even when their heads are
    // farther away than the route itself. A strip of anonymous tables is not a map.
    const routeBounds = pointBounds(points, margin);
    for (const row of scene.mapSize.rows) {
      if (row.slots.some(slot => overlaps(slot.rect, routeBounds))) {
        const label = rowLabelPlacement(row); if (label) points.push(label);
      }
    }
    const x = Math.max(0, Math.min(...points.map(point => point.x)) - margin);
    const y = Math.max(0, Math.min(...points.map(point => point.y)) - margin);
    crop = { x, y, width: Math.min(scene.mapSize.width, Math.max(...points.map(point => point.x)) + margin) - x,
      height: Math.min(scene.mapSize.height, Math.max(...points.map(point => point.y)) + margin) - y };
    // Use surplus room for more surrounding map context instead of empty bars.
    const aspect = mapBox.width / mapBox.height;
    const cropWidth = Math.min(scene.mapSize.width, Math.max(crop.width, crop.height * aspect));
    const cropHeight = Math.min(scene.mapSize.height, Math.max(crop.height, crop.width / aspect));
    crop = { x: Math.max(0, Math.min(scene.mapSize.width - cropWidth, crop.x - (cropWidth - crop.width) / 2)),
      y: Math.max(0, Math.min(scene.mapSize.height - cropHeight, crop.y - (cropHeight - crop.height) / 2)), width: cropWidth, height: cropHeight };
  }
  const fit = (frame: MapRect) => {
    const scale = Math.min(frame.width / crop.width, frame.height / crop.height);
    const map = { x: frame.x + (frame.width - crop.width * scale) / 2, y: frame.y + (frame.height - crop.height * scale) / 2,
      width: crop.width * scale, height: crop.height * scale };
    const project = (point: MapPoint) => ({ x: map.x + (point.x - crop.x) * scale, y: map.y + (point.y - crop.y) * scale });
    const labels: { text: string; rect: MapRect; kind: "row" | "entrance" | "booth" }[] = [];
    const route = scene.route ? routePoints(scene).map(project) : [];
    const addLabel = (value: string, point: MapPoint, kind: typeof labels[number]["kind"]) => {
      if (!inside(point, crop)) return;
      const p = project(point), w = Math.min(frame.width, value.length * (kind === "row" ? 25 : 21) + 22);
      const preferred = { x: p.x - w / 2, y: p.y + (kind === "entrance" ? 18 : kind === "row" ? -28 : -50) };
      const positions = [preferred, { x: p.x + 24, y: p.y - 18 }, { x: p.x - w - 24, y: p.y - 18 },
        { x: p.x - w / 2, y: p.y - 76 }, { x: p.x - w / 2, y: p.y + 24 }];
      const candidates = positions.map(position => ({ x: Math.max(frame.x, Math.min(frame.x + frame.width - w, position.x)),
        y: Math.max(frame.y, Math.min(frame.y + frame.height - 36, position.y)), width: w, height: 36 }));
      const free = candidates.filter(rect => !labels.some(label => overlaps(rect, label.rect)));
      const rect = free.find(candidate => {
        const padding = { x: candidate.x - 12, y: candidate.y - 12, width: candidate.width + 24, height: candidate.height + 24 };
        return !route.slice(1).some((end, i) => segmentHitsRect(route[i], end, padding));
      });
      // The destination is also named in the card header; don't cover a row
      // heading or route just to repeat its booth number on a crowded map.
      if (rect || (kind !== "booth" && free[0])) labels.push({ text: value, kind, rect: rect ?? free[0] });
    };
    scene.mapSize.rows.forEach(row => { const p = rowLabelPlacement(row); if (p) addLabel(row.label, p, "row"); });
    if (scene.start) addLabel(scene.settings.entrance, scene.start, "entrance");
    addLabel(scene.settings.booth, scene.target, "booth");
    return { map, scale, project, labels };
  };
  let fitted = fit(mapBox);
  const qrSide = (scene.qr.length + 8) * 3;
  const qrWidth = qrSide + 16, qrHeight = qrSide + 16;
  let qrBox: MapRect | null = null;
  if (scene.settings.showQr) {
    const projectRect = (r: MapRect): MapRect => ({ ...fitted.project(r), width: r.width * fitted.scale, height: r.height * fitted.scale });
    const protectedRects = [
      ...scene.mapSize.rows.flatMap(row => row.slots.map(slot => projectRect(slot.rect))),
      ...scene.mapSize.landmarks.map(item => projectRect(item.rect)),
      ...scene.mapSize.pillars.map(projectRect),
      ...fitted.labels.map(label => label.rect),
      ...scene.mapSize.accessPoints.map(point => ({ ...fitted.project(point), width: 1, height: 1 })),
      ...[scene.target, ...(scene.start ? [scene.start] : [])].map(point => ({ ...fitted.project(point), width: 1, height: 1 })),
    ];
    const route = scene.route ? routePoints(scene).map(fitted.project) : [];
    const candidates = [
      { x: mapBox.x + mapBox.width - qrWidth, y: mapBox.y + mapBox.height - qrHeight },
      { x: mapBox.x, y: mapBox.y + mapBox.height - qrHeight },
      { x: mapBox.x + mapBox.width - qrWidth, y: mapBox.y },
      { x: mapBox.x, y: mapBox.y },
    ].map(point => ({ ...point, width: qrWidth, height: qrHeight }));
    qrBox = candidates.find(candidate => {
      const padded = { x: candidate.x - 16, y: candidate.y - 16, width: candidate.width + 32, height: candidate.height + 32 };
      return !protectedRects.some(rect => overlaps(padded, rect)) && !route.slice(1).some((point, i) => segmentHitsRect(route[i], point, padded));
    }) ?? null;
    if (!qrBox) {
      // Crowded corners: make room inside the map card instead of covering a reference.
      fitted = fit({ ...mapBox, height: mapBox.height - qrHeight - 20 });
      qrBox = { x: mapBox.x + mapBox.width - qrWidth - 12, y: mapBox.y + mapBox.height - qrHeight - 8, width: qrWidth, height: qrHeight };
    }
  }
  return { width, height, picture, mapBox, crop, ...fitted, qrBox };
}

function inside(p: MapPoint, r: MapRect) { return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height; }
function overlaps(a: MapRect, b: MapRect) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
function pointBounds(points: MapPoint[], margin: number): MapRect {
  const x = Math.min(...points.map(p => p.x)) - margin, y = Math.min(...points.map(p => p.y)) - margin;
  return { x, y, width: Math.max(...points.map(p => p.x)) + margin - x, height: Math.max(...points.map(p => p.y)) + margin - y };
}
function segmentHitsRect(a: MapPoint, b: MapPoint, rect: MapRect) {
  let low = 0, high = 1;
  for (const axis of ["x", "y"] as const) {
    const d = b[axis] - a[axis], min = rect[axis], max = min + rect[axis === "x" ? "width" : "height"];
    if (d === 0) { if (a[axis] < min || a[axis] > max) return false; }
    else { const t1 = (min - a[axis]) / d, t2 = (max - a[axis]) / d; low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2)); }
  }
  return low <= high;
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
  const horizontal = scene.settings.format === "landscape";
  const titleX = !horizontal && scene.picture ? 300 : 38;
  ctx.fillStyle = scene.settings.color; ctx.fillRect(titleX, 32, 40, 5);
  ctx.fillStyle = "#172e2b";
  text(ctx, scene.settings.title || "來攤位找我", titleX, 80, g.width - titleX - 38, 35, 800);
  ctx.fillStyle = "#4c625e";
  text(ctx, scene.settings.subtitle, titleX, 116, g.width - titleX - 38, 20);
  if (!horizontal) {
    ctx.fillStyle = scene.settings.color; text(ctx, scene.settings.booth, titleX, 192, g.width - titleX - 38, 64, 800);
    ctx.fillStyle = "#4c625e"; text(ctx, `從${scene.settings.entrance}出發`, titleX, 235, g.width - titleX - 38, 24);
    if (scene.picture) text(ctx, scene.settings.account, 38, 296, g.width - 76, 22);
    else text(ctx, scene.settings.account, 310, 188, g.width - 348, 22);
  }
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect(g.mapBox.x - 8, g.mapBox.y - 8, g.mapBox.width + 16, g.mapBox.height + 16, 14); ctx.fill();
  ctx.drawImage(scene.map, g.crop.x, g.crop.y, g.crop.width, g.crop.height, g.map.x, g.map.y, g.map.width, g.map.height);
  if (scene.picture) {
    const p = g.picture, img = scene.picture;
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect(p.x - 7, p.y - 7, p.width + 14, p.height + 14, 10); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y, p.width, p.height); ctx.clip();
    const ratio = scene.settings.pictureFit === "cover" ? Math.max(p.width / img.width, p.height / img.height) : Math.min(p.width / img.width, p.height / img.height);
    ctx.drawImage(img, p.x + (p.width - img.width * ratio) / 2, p.y + (p.height - img.height * ratio) / 2, img.width * ratio, img.height * ratio); ctx.restore();
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
  }
  ctx.fillStyle = "#fff"; ctx.strokeStyle = scene.settings.color; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(target.x, target.y, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = scene.settings.color; ctx.beginPath(); ctx.arc(target.x, target.y, 5, 0, Math.PI * 2); ctx.fill();
  for (const label of g.labels) {
    const r = label.rect;
    ctx.fillStyle = "#fffffff2"; ctx.beginPath(); ctx.roundRect(r.x, r.y, r.width, r.height, 6); ctx.fill();
    ctx.fillStyle = label.kind === "booth" ? scene.settings.color : "#203b35";
    ctx.font = `700 ${label.kind === "row" ? 25 : 21}px "Microsoft JhengHei", sans-serif`; ctx.textAlign = "center";
    ctx.fillText(label.text, r.x + r.width / 2, r.y + 26, r.width - 10); ctx.textAlign = "left";
  }
  if (editing) scene.waypoints.forEach((point, i) => {
    const p = g.project(point); ctx.fillStyle = "#fff"; ctx.strokeStyle = scene.settings.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#172e2b";
    ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.fillText(String(i + 1), p.x, p.y + 4); ctx.textAlign = "left";
  });
  if (horizontal) { ctx.fillStyle = scene.settings.color; text(ctx, `${scene.settings.booth}  ·  ${scene.settings.account || "在這裡等你"}`, 38, g.height - 19, g.width - 200, 21, 700); }
  drawQr(ctx, scene, g.qrBox);
  ctx.fillStyle = "#62716b"; ctx.font = "13px sans-serif"; ctx.textAlign = "right";
  ctx.fillText("場刊 Map", g.width - 38, g.height - 16); ctx.textAlign = "left";
  return g;
}

/** Four-module quiet zone and integer pixels at the final PNG/GIF resolution. */
function drawQr(ctx: CanvasRenderingContext2D, scene: CardScene, box: MapRect | null, outputScale = 1) {
  if (!box) return;
  const modules = scene.qr.length, cell = Math.max(2, Math.floor(3 * outputScale));
  const side = (modules + 8) * cell;
  const panel = { x: Math.round(box.x * outputScale), y: Math.round(box.y * outputScale), width: Math.round(box.width * outputScale), height: Math.round(box.height * outputScale) };
  const x = Math.round(panel.x + (panel.width - side) / 2), y = Math.round(panel.y + 8 * outputScale);
  // Repaint the opaque panel and integer module grid after GIF downsampling.
  ctx.fillStyle = "#fff"; ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
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
    const geometry = drawCard(full, scene, Math.min(1, i / Math.max(1, (frames - 1) * .8)));
    ctx.drawImage(full, 0, 0, frame.width, frame.height);
    drawQr(ctx, scene, geometry.qrBox, ratio);
    const { data } = ctx.getImageData(0, 0, frame.width, frame.height);
    const palette = quantize(data, 256), index = applyPalette(data, palette);
    gif.writeFrame(index, frame.width, frame.height, { palette, delay: i % 3 === 0 ? 90 : 80, repeat: 0 });
    report(Math.round((i + 1) / frames * 100));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  gif.finish(); downloadBlob(new Blob([gif.bytes()], { type: "image/gif" }), `${scene.settings.booth}-攤位導引.gif`);
}
