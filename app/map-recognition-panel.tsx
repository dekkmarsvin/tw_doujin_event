import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { EventMapLayout, MapRect } from "./event-map";
import type { LayoutReport } from "./map-auto-recognition/build-layout";
import type { RecognitionInput } from "./map-auto-recognition/editor";
import { adoptRecognitionDraft, recognitionChoiceKey, type RecognitionChoice } from "./map-recognition-draft";
import styles from "./map-recognition-panel.module.css";

type Props = { layout: EventMapLayout; backgroundImageUrl: string; boothCodes: readonly string[]; onApply: (layout: EventMapLayout) => void };
type Candidate = { choice: RecognitionChoice; title: string; detail: string; rect: MapRect; provisional?: boolean };
const bounds = (rects: MapRect[]): MapRect => {
  const x = Math.min(...rects.map(rect => rect.x)), y = Math.min(...rects.map(rect => rect.y));
  return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x, height: Math.max(...rects.map(rect => rect.y + rect.height)) - y };
};

/** Preview stays outside the saved layout. Cancel workers when their context
 * changes, and recheck conflicts before the editor records one undo step. */
export default function MapRecognitionPanel({ layout, backgroundImageUrl, boothCodes, onApply }: Props) {
  const roster = boothCodes.join("\n");
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(roster);
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<MapRect | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ base: EventMapLayout; report: LayoutReport } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [showNumbers, setShowNumbers] = useState(true);
  const [baseLayout, setBaseLayout] = useState(layout);
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const cancel = () => { generation.current++; worker.current?.terminate(); worker.current = null; setBusy(false); };
  const invalidate = () => { cancel(); setPreview(null); setSelected([]); setFocus(null); setMessage(""); };
  if (baseLayout !== layout) {
    setBaseLayout(layout); setBusy(false); setPreview(null); setSelected([]); setFocus(null);
  }
  useEffect(() => {
    // These refs own computation, not DOM nodes; cleanup invalidates the live job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { generation.current++; worker.current?.terminate(); worker.current = null; };
  }, [layout]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const image = new Image();
    image.onload = () => { if (active) setSource(image); };
    image.onerror = () => { if (active) setMessage("配置圖讀取失敗，請重新上傳配置圖。"); };
    image.src = backgroundImageUrl;
    return () => { active = false; image.onload = null; image.onerror = null; };
  }, [backgroundImageUrl, open]);
  const report = preview?.base === layout ? preview.report : null;
  const candidates = useMemo((): Candidate[] => !report ? [] : [
    ...report.layout.rows.map((row, index) => ({ choice: { kind: "row" as const, index }, title: `${row.label} 排 · ${row.slots.length} 攤`, detail: report.rows[index]?.numbering ?? "請核對編號方向", rect: bounds(row.slots.map(slot => slot.rect)), provisional: row.label.startsWith("?") })),
    ...report.layout.pillars.map((rect, index) => ({ choice: { kind: "pillar" as const, index }, title: `柱子 ${index + 1}`, detail: "核對位置與大小", rect })),
    ...report.layout.accessPoints.map((door, index) => ({ choice: { kind: "access" as const, index }, title: `出入口 ${index + 1}`, detail: "採用後請核對類型與方向", rect: { x: door.x - 10, y: door.y - 10, width: 20, height: 20 } })),
    ...report.layout.landmarks.map((area, index) => ({ choice: { kind: "landmark" as const, index }, title: `區域 ${index + 1}（待命名）`, detail: "採用後請填寫名稱與類型", rect: area.rect })),
  ], [report]);
  const conflicts = useMemo(() => new Map(candidates.map(item => {
    const result = adoptRecognitionDraft(layout, report!.layout, [item.choice]);
    return [recognitionChoiceKey(item.choice), result.ok ? "" : result.errors.join(" ")];
  })), [candidates, layout, report]);
  const proposedCodes = new Set(report?.layout.rows.flatMap(row => row.slots.map(slot => slot.code)) ?? []);
  const matchedRows = report?.layout.rows.filter(row => !row.label.startsWith("?")) ?? [];
  const provisionalSlots = report?.layout.rows.filter(row => row.label.startsWith("?")).reduce((sum, row) => sum + row.slots.length, 0) ?? 0;
  const existingCodes = new Set(layout.rows.flatMap(row => row.slots.map(slot => slot.code)));
  const missing = boothCodes.filter(code => !proposedCodes.has(code) && !existingCodes.has(code));
  const chosen = candidates.filter(item => selected.includes(recognitionChoiceKey(item.choice)));
  const focused = candidates.find(item => recognitionChoiceKey(item.choice) === focus)?.rect;
  const view = focused && !selecting ? { x: focused.x - 20, y: focused.y - 20, width: focused.width + 40, height: focused.height + 40 } : { x: 0, y: 0, width: layout.width, height: layout.height };
  const run = () => {
    invalidate(); setSelecting(false);
    if (!source) return;
    const rect = crop ?? { x: 0, y: 0, width: source.naturalWidth, height: source.naturalHeight };
    if (rect.width * rect.height > 7_000_000) { setMessage("辨識範圍超過 700 萬像素，請框選較小範圍。"); return; }
    const token = generation.current;
    try {
      const canvas = document.createElement("canvas"); canvas.width = rect.width; canvas.height = rect.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("無法讀取圖片");
      context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      const data = context.getImageData(0, 0, rect.width, rect.height).data;
      const input: RecognitionInput = { image: { width: rect.width, height: rect.height, data: new Uint8Array(data.buffer) }, sourceRect: rect, sourceSize: { width: source.naturalWidth, height: source.naturalHeight }, targetSize: layout, template: layout.template, boothList: list };
      const task = new Worker(new URL("./map-recognition.worker.ts", import.meta.url), { type: "module" });
      worker.current = task; setBusy(true);
      task.onmessage = (event: MessageEvent<{ report?: LayoutReport; error?: string }>) => {
        if (token !== generation.current) return;
        task.terminate(); worker.current = null; setBusy(false);
        if (event.data.report?.valid) { setPreview({ base: layout, report: event.data.report }); setMessage("請逐排核對位置、排號與編號方向，再勾選採用。"); }
        else setMessage(event.data.error ?? "辨識結果無法建立地圖，請縮小範圍後再試。");
      };
      task.onerror = () => { if (token === generation.current) { cancel(); setMessage("辨識中斷，請縮小範圍後再試。"); } };
      task.postMessage(input, [data.buffer]);
    } catch { cancel(); setMessage("無法辨識這張圖片，請重新上傳或縮小範圍後再試。"); }
  };
  const point = (event: PointerEvent<SVGSVGElement>) => {
    const node = svg.current!, matrix = node.getScreenCTM();
    const p = node.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    const mapped = matrix ? p.matrixTransform(matrix.inverse()) : p;
    return { x: Math.max(0, Math.min(source!.naturalWidth, mapped.x / layout.width * source!.naturalWidth)), y: Math.max(0, Math.min(source!.naturalHeight, mapped.y / layout.height * source!.naturalHeight)) };
  };
  const moveCrop = (event: PointerEvent<SVGSVGElement>) => {
    if (!selecting || !source || drag.current?.id !== event.pointerId) return;
    const start = drag.current, end = point(event);
    const x = Math.floor(Math.min(start.x, end.x)), y = Math.floor(Math.min(start.y, end.y));
    setCrop({ x, y, width: Math.max(1, Math.ceil(Math.max(start.x, end.x)) - x), height: Math.max(1, Math.ceil(Math.max(start.y, end.y)) - y) });
  };
  const apply = () => {
    if (!report || busy) return;
    const result = adoptRecognitionDraft(layout, report.layout, chosen.map(item => item.choice));
    if (!result.ok) { setMessage(result.errors.join(" ")); return; }
    invalidate(); setMessage(`已加入 ${chosen.length} 項，可用「復原」一次撤回。`); onApply(result.layout);
  };
  // Keep this group's keyboard actions away from the surrounding canvas shortcuts.
  // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
  return <div className={styles.panel} role="group" aria-label="配置圖辨識" onKeyDown={event => event.stopPropagation()}>
    <button type="button" aria-expanded={open} onClick={() => { invalidate(); setSource(null); setCrop(null); setSelecting(false); setOpen(!open); }}>自動建立草稿（實驗）</button>
    {open && <div className={styles.body}>
      <p>依配置圖與攤位清單推測位置。攤位數相符仍可能排錯方向，請核對後採用。</p>
      <div className={styles.controls}>
        <button type="button" disabled={!source || busy} aria-pressed={selecting} onClick={() => { invalidate(); setSelecting(!selecting); }}>框選辨識範圍</button>
        <button type="button" disabled={!source || busy} onClick={() => { invalidate(); setCrop(null); setSelecting(false); }}>使用整張圖</button>
        <span>{source ? `${source.naturalWidth} × ${source.naturalHeight} 像素` : "讀取配置圖中…"}{crop ? ` · 範圍 ${crop.width} × ${crop.height}` : ""}</span>
        <button type="button" disabled={!source || busy || !list.trim()} onClick={run}>{busy ? "辨識中…" : "辨識配置圖"}</button>
        {busy && <button type="button" onClick={() => { invalidate(); setMessage("已取消辨識。"); }}>取消辨識</button>}
      </div>
      <details><summary>辨識用攤位清單（{boothCodes.length} 個活動攤位）</summary>
        <p>已帶入目前活動日與場地的清單。框選局部時請只保留該範圍的攤位；修改此處不會變更活動名單。</p>
        <label>攤位代碼或範圍<textarea value={list} rows={4} onChange={event => { invalidate(); setList(event.target.value); }} /></label>
        <button type="button" onClick={() => { invalidate(); setList(roster); }}>重新帶入活動清單</button>
      </details>
      {message && <p role="status">{message}</p>}
      {selecting && <p>在下方配置圖拖曳框選，或輸入原圖像素範圍。</p>}
      {source && selecting && <div className={styles.controls}>{(["x", "y", "width", "height"] as const).map((axis, index) => <label key={axis}>{["左側", "上緣", "寬度", "高度"][index]}<input type="number" min={index < 2 ? 0 : 1} value={(crop ?? { x: 0, y: 0, width: source.naturalWidth, height: source.naturalHeight })[axis]} onChange={event => {
        const next = { ...(crop ?? { x: 0, y: 0, width: source.naturalWidth, height: source.naturalHeight }), [axis]: Math.max(index < 2 ? 0 : 1, Math.round(Number(event.target.value))) };
        next.x = Math.min(next.x, source.naturalWidth - 1); next.y = Math.min(next.y, source.naturalHeight - 1);
        next.width = Math.min(next.width, source.naturalWidth - next.x); next.height = Math.min(next.height, source.naturalHeight - next.y); setCrop(next);
      }} /></label>)}</div>}
      <div className={styles.review}>
        <div><div className={styles.controls}><button type="button" onClick={() => setFocus(null)}>查看全圖</button><label><input type="checkbox" checked={showNumbers} onChange={event => setShowNumbers(event.target.checked)} />顯示推測編號</label></div>
          <svg ref={svg} className={selecting ? styles.crop : styles.preview} role="img" aria-label="辨識草稿預覽" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} onPointerDown={event => { if (!selecting || !source || event.button !== 0) return; event.preventDefault(); drag.current = { ...point(event), id: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={moveCrop} onPointerUp={event => { moveCrop(event); drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }}>
            <image href={backgroundImageUrl} x="0" y="0" width={layout.width} height={layout.height} preserveAspectRatio="none" />
            {!selecting && report?.layout.rows.map((row, index) => <g key={index} opacity={focus && focus !== `row:${index}` ? .2 : 1}>{row.slots.map(slot => <g key={slot.code}><rect {...slot.rect} fill={showNumbers ? "#ffffffdf" : "none"} stroke="#087c99" strokeWidth={.8} />{showNumbers && <text x={slot.rect.x + slot.rect.width / 2} y={slot.rect.y + slot.rect.height / 2} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(slot.rect.height * .7, slot.rect.width / (slot.code.length * .65))} fill="#064858">{slot.code}</text>}</g>)}</g>)}
            {focused && <rect {...focused} fill="none" stroke="#b94c0b" strokeWidth={2} />}
            {crop && source && <rect x={crop.x / source.naturalWidth * layout.width} y={crop.y / source.naturalHeight * layout.height} width={crop.width / source.naturalWidth * layout.width} height={crop.height / source.naturalHeight * layout.height} fill="#087c9920" stroke="#087c99" strokeWidth={2} />}
          </svg>
        </div>
        {report && <div className={styles.checklist}>
          <p>已配對 {matchedRows.length} 排 · {matchedRows.reduce((n, row) => n + row.slots.length, 0)} 攤{provisionalSlots > 0 ? ` · 未配對 ${provisionalSlots} 格` : ""} · 已勾選 {selected.length} 項</p><p>只加入勾選項目；既有攤位與設施會保留。</p>
          {candidates.map(item => { const key = recognitionChoiceKey(item.choice), conflict = conflicts.get(key); return <div key={key} className={styles.item}>
            <div><button type="button" aria-pressed={focus === key} onClick={() => { setSelecting(false); setFocus(key); }}>查看 {item.title}</button><label><input type="checkbox" disabled={!!conflict} aria-label={`已核對 ${item.title}`} checked={selected.includes(key)} onChange={event => setSelected(event.target.checked ? [...selected, key] : selected.filter(value => value !== key))} />已核對</label></div>
            <small>{item.provisional ? "未配對，採用後需重新編號。" : item.detail}</small>{conflict && <p className={styles.error}>{conflict}</p>}
          </div>; })}
        </div>}
      </div>
      {report && <>
        {!!missing.length && <details><summary>尚未涵蓋的活動攤位（{missing.length}）</summary><p>{missing.join("、")}</p></details>}
        {!!report.warnings.length && <details><summary>辨識提醒（{report.warnings.length}）</summary><ul>{report.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        <div className={styles.controls}><button type="button" disabled={!selected.length || busy} onClick={apply}>採用已核對項目（{selected.length}）</button><button type="button" onClick={invalidate}>捨棄辨識結果</button></div>
      </>}
    </div>}
  </div>;
}
