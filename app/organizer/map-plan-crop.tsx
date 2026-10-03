import { useRef, useState, type PointerEvent } from "react";
import type { MapRect } from "../event-map";
import { useModalFocus } from "../use-modal-focus";
import styles from "./organizer.module.css";
import cropStyles from "./map-plan-crop.module.css";

/** The original stays local until a scope has been chosen. Every selection is
 * measured in source pixels, including images larger than the preview. */
export function MapPlanCrop({ source, width, height, busy, error, onApply, onCancel }: {
  source: string; width: number; height: number; busy: boolean; error: string;
  onApply: (rect: MapRect) => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLElement | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<MapRect>({ x: 0, y: 0, width, height });
  useModalFocus(true, dialog, () => { if (!busy) onCancel(); });
  const point = (event: PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget, matrix = svg.getScreenCTM();
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix?.inverse());
    return { x: Math.max(0, Math.min(width, Math.round(p.x))), y: Math.max(0, Math.min(height, Math.round(p.y))) };
  };
  const field = (key: keyof MapRect, value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    setRect(old => {
      const next = { ...old, [key]: Math.round(n) };
      next.x = Math.max(0, Math.min(width - 1, next.x));
      next.y = Math.max(0, Math.min(height - 1, next.y));
      next.width = Math.max(1, Math.min(width - next.x, next.width));
      next.height = Math.max(1, Math.min(height - next.y, next.height));
      return next;
    });
  };
  return <div className={styles.dialogBackdrop}>
    <section ref={dialog} className={`${styles.navigationDialog} ${cropStyles.dialog}`} role="dialog" aria-modal="true" aria-labelledby="crop-plan-title" tabIndex={-1}>
      <h3 id="crop-plan-title">框選目前場地</h3>
      <p>拖曳框選要保留的範圍，或使用整張圖。</p>
      <svg className={cropStyles.preview} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="配置圖裁切預覽"
        onPointerDown={event => { if (busy || event.button !== 0) return; start.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (!start.current || busy) return; const end = point(event), a = start.current; setRect({ x: Math.min(width - 1, a.x, end.x), y: Math.min(height - 1, a.y, end.y), width: Math.max(1, Math.abs(end.x - a.x)), height: Math.max(1, Math.abs(end.y - a.y)) }); }}
        onPointerUp={event => { start.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { start.current = null; }}>
        <image href={source} width={width} height={height} />
        <path d={`M0,0H${width}V${height}H0Z M${rect.x},${rect.y}v${rect.height}h${rect.width}v-${rect.height}Z`} fill="black" fillOpacity=".45" fillRule="evenodd" />
        <rect {...rect} fill="none" stroke="#166e61" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className={cropStyles.fields}>{([['x', '左側 X'], ['y', '上側 Y'], ['width', '裁切寬度'], ['height', '裁切高度']] as const).map(([key, label]) =>
        <label key={key}>{label}<input type="number" min={key === 'x' || key === 'y' ? 0 : 1} max={key === 'x' || key === 'width' ? width : height} value={rect[key]} disabled={busy} onChange={event => field(key, event.target.value)} /></label>)}</div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.dialogActions}>
        <button type="button" disabled={busy} onClick={() => onApply(rect)}>{busy ? "處理中…" : "使用框選範圍"}</button>
        <button type="button" disabled={busy} className={styles.ghost} onClick={() => onApply({ x: 0, y: 0, width, height })}>使用整張圖</button>
        <button type="button" disabled={busy} className={styles.ghost} onClick={onCancel}>取消</button>
      </div>
    </section>
  </div>;
}

export async function cropMapPlan(file: File, image: HTMLImageElement, rect: MapRect): Promise<File> {
  if (rect.x === 0 && rect.y === 0 && rect.width === image.naturalWidth && rect.height === image.naturalHeight) return file;
  const canvas = document.createElement("canvas");
  canvas.width = rect.width; canvas.height = rect.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("瀏覽器無法裁切配置圖。");
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("配置圖裁切失敗。")), file.type, .95));
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + (blob.type === "image/jpeg" ? ".jpg" : blob.type === "image/webp" ? ".webp" : ".png"), { type: blob.type });
}
