import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { createRoot } from "react-dom/client";
import qrcode from "qrcode-generator";
import AccessibleEventMapRenderer from "../../app/accessible-event-map-renderer";
import { PUBLISHED_EVENTS, type EventDefinition } from "../../app/event-catalog";
import { type CircleCatalogPayload } from "../../app/circle-records";
import { type EventMapLayout, type MapPoint } from "../../app/event-map";
import { loadStaticCircleCatalog } from "../../app/static-circle-catalog-client";
import { loadStaticEventMap } from "../../app/static-event-map-client";
import { dayDateLabel, eventDayCalendarDate } from "../../app/event-calendar";
import { PUBLIC_ORIGIN } from "../../app/seo";
import { cardGeometry, cardPointToMap, CARD_SIZES, drawCard, exportGif, exportPng, loadImage, snapshotMap, type CardScene, type CardSettings } from "./card";
import "./style.css";

type Placement = CircleCatalogPayload["placements"][number];
type Resource = { catalog: CircleCatalogPayload; layout: EventMapLayout };
const COLORS = ["#d34972", "#286b5c", "#3675bd", "#8b5db3", "#c36a24"];
const BACKGROUNDS = ["#f5f1e8", "#e8f3f0", "#eaf0fa", "#f6eaf1", "#ffffff"];

function App() {
  const [eventId, setEventId] = useState(PUBLISHED_EVENTS[0].id);
  const event = PUBLISHED_EVENTS.find(item => item.id === eventId)!;
  return <>
    <header className="site-header"><a href="/" className="brand">場刊<span>Map</span></a><span className="divider" /><strong>攤位導引圖</strong><span className="prototype-badge">功能原型</span></header>
    <main><div className="page-heading"><div><p className="eyebrow">MAKE YOUR BOOTH EASY TO FIND</p><h1>讓大家，一眼找到你。</h1><p>選好攤位、畫一條路，把這次出展變成一張圖。</p></div><span className="local-note">圖片在這台裝置製作</span></div>
      <Scope key={event.id} event={event} onEvent={setEventId} />
    </main>
  </>;
}

function Scope({ event, onEvent }: { event: EventDefinition; onEvent: (id: string) => void }) {
  const [day, setDay] = useState(event.days[0].id);
  const [venueId, setVenueId] = useState(event.venueAssignments[0].venueSpaceId);
  const [resource, setResource] = useState<{ scope: string; data: Resource } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const scope = `${event.id}/${day}/${venueId}`;
  const venue = event.venueAssignments.find(item => item.venueSpaceId === venueId)!;
  useEffect(() => {
    let active = true;
    Promise.all([loadStaticCircleCatalog(event.id), loadStaticEventMap(event.id, { periodKey: String(day), venueSpaceId: venueId })])
      .then(([catalog, map]) => { if (active) setResource({ scope, data: { catalog: catalog.payload, layout: map.layout } }); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "資料無法讀取。"); });
    return () => { active = false; };
  }, [event.id, day, venueId, scope, attempt]);
  const data = resource?.scope === scope ? resource.data : null;
  return <>
    <div className="scope-bar">
      <label>活動<select aria-label="活動" value={event.id} onChange={e => onEvent(e.target.value)}>{PUBLISHED_EVENTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>日期<select aria-label="日期" value={day} onChange={e => { setError(""); setDay(event.days.find(item => String(item.id) === e.target.value)!.id); }}>{event.days.map(item => <option key={item.id} value={item.id}>{eventDayCalendarDate(event, item.id) ? dayDateLabel(eventDayCalendarDate(event, item.id)!) : item.dateLabel}</option>)}</select></label>
      <label>場地<select aria-label="場地" value={venueId} onChange={e => { setError(""); setVenueId(e.target.value); }}>{event.venueAssignments.map(item => <option key={item.venueSpaceId} value={item.venueSpaceId}>{item.venueSpaceName}</option>)}</select></label>
    </div>
    {error ? <div className="load-error" role="alert">{error}<button onClick={() => { setError(""); setAttempt(value => value + 1); }}>重新讀取</button></div>
      : data ? <ChooseCircle key={scope} event={event} day={day} venueId={venueId} data={data} areas={venue.areaIds} /> : <p className="loading" role="status">正在準備活動地圖…</p>}
  </>;
}

function ChooseCircle({ event, day, venueId, data, areas }: { event: EventDefinition; day: string | number; venueId: string; data: Resource; areas: readonly string[] }) {
  const codes = useMemo(() => new Set(data.layout.rows.flatMap(row => row.slots.map(slot => slot.code))), [data.layout]);
  const placements = data.catalog.placements.filter(item => item.day === day && areas.includes(item.area) && item.status === "active" && codes.has(item.boothCode));
  const [id, setId] = useState(placements[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const names = new Map(data.catalog.circles.map(circle => [circle.id, circle.name]));
  const placement = placements.find(item => item.id === id);
  const filtered = placements.filter(item => `${item.boothCode} ${names.get(item.circleId)}`.toLowerCase().includes(query.trim().toLowerCase()));
  if (!placement) return <p className="loading">這個日期與場地沒有可製作導引圖的攤位。</p>;
  const choose = <div className="field-group"><label htmlFor="circle-search">找自己的攤位</label><input id="circle-search" placeholder="搜尋社團名稱或攤位號" value={query} onChange={e => setQuery(e.target.value)} />
    <select aria-label="社團與攤位" value={id} onChange={e => setId(e.target.value)}>
      {!filtered.some(item => item.id === id) && <option value={id}>{placement.boothCode} · {names.get(placement.circleId)}</option>}
      {filtered.map(item => <option key={item.id} value={item.id}>{item.boothCode} · {names.get(item.circleId)}</option>)}
    </select>{query && <small>{filtered.length ? `找到 ${filtered.length} 筆攤位` : "沒有符合的攤位，請換個關鍵字。"}</small>}</div>;
  return <Editor key={id} event={event} day={day} venueId={venueId} layout={data.layout} placement={placement} name={names.get(placement.circleId)!} choose={choose} />;
}

function Editor({ event, day, venueId, layout, placement, name, choose }: { event: EventDefinition; day: string | number; venueId: string; layout: EventMapLayout; placement: Placement; name: string; choose: React.ReactNode }) {
  const slot = layout.rows.flatMap(row => row.slots).find(item => item.code === placement.boothCode)!;
  const target = useMemo(() => ({ x: slot.rect.x + slot.rect.width / 2, y: slot.rect.y + slot.rect.height / 2 }), [slot]);
  const entrances = layout.accessPoints.filter(item => item.kind !== "exit");
  const [entranceId, setEntranceId] = useState(entrances[0]?.id ?? "custom");
  const [customStart, setCustomStart] = useState<MapPoint | null>(null);
  const entrance = entrances.find(item => item.id === entranceId);
  const start = entrance ? { x: entrance.x, y: entrance.y } : customStart;
  const [waypoints, setWaypoints] = useState<MapPoint[]>([]);
  const [route, setRoute] = useState(false);
  const [mode, setMode] = useState<"view" | "draw" | "start">("view");
  const [playing, setPlaying] = useState(false);
  const [settings, setSettings] = useState<CardSettings>(() => ({
    format: "landscape", title: name, subtitle: `${event.name} ｜ ${eventDayCalendarDate(event, day) ? dayDateLabel(eventDayCalendarDate(event, day)!) : event.days.find(item => item.id === day)!.dateLabel} ｜ ${event.venueAssignments.find(item => item.venueSpaceId === venueId)!.venueSpaceName}`,
    account: "", booth: placement.boothCode, entrance: entrance?.label ?? "", color: COLORS[0], background: BACKGROUNDS[0], lineWidth: 4, duration: 4,
    marker: "dot", showConnector: false, showQr: true, closeup: false, pictureFit: "contain",
  }));
  const [mapImage, setMapImage] = useState<HTMLImageElement | null>(null);
  const [picture, setPicture] = useState<HTMLImageElement | null>(null);
  const [qr, setQr] = useState<HTMLImageElement | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [pictureBusy, setPictureBusy] = useState(false);
  const mapSource = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ index: number; moved: boolean } | null>(null);
  const imageSequence = useRef(0);
  const update = <K extends keyof CardSettings>(key: K, value: CardSettings[K]) => setSettings(current => ({ ...current, [key]: value }));
  useEffect(() => {
    let active = true;
    const svg = mapSource.current?.querySelector("svg");
    if (svg) void snapshotMap(svg, layout.width, layout.height).then(image => { if (active) setMapImage(image); }).catch(() => { if (active) setNotice("地圖圖片無法準備，請重新整理。"); });
    const code = qrcode(0, "M");
    const url = new URL(PUBLIC_ORIGIN); url.search = new URLSearchParams({ event: event.id, day: String(day), venueSpaceId: venueId, selectedCircle: placement.circleId, selectedBooth: placement.boothCode }).toString();
    code.addData(url.href); code.make();
    void loadImage(code.createDataURL(4, 4)).then(image => { if (active) setQr(image); });
    return () => { active = false; };
  }, [layout, event.id, day, venueId, placement.circleId, placement.boothCode]);
  const scene: CardScene | null = mapImage ? { settings: { ...settings, entrance: entrance?.label ?? "指定起點" }, map: mapImage, mapSize: layout, picture, qr, start, target, waypoints, route } : null;
  // All preview frames and both file formats go through the same drawing function.
  useEffect(() => {
    if (!scene || !canvas.current) return;
    let frame = 0;
    const began = performance.now();
    const render = () => {
      const progress = playing ? Math.min(1, ((performance.now() - began) % (settings.duration * 1000)) / (settings.duration * 800)) : null;
      drawCard(canvas.current!, scene, progress, mode === "draw");
      if (playing) frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  });
  async function choosePicture(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setNotice("請選擇 JPG、PNG 或 WebP 圖片。"); return; }
    const sequence = ++imageSequence.current, url = URL.createObjectURL(file);
    setPictureBusy(true); setNotice("");
    try { const image = await loadImage(url); if (imageSequence.current === sequence) setPicture(image); }
    catch (reason) { if (imageSequence.current === sequence) setNotice((reason as Error).message); }
    finally { URL.revokeObjectURL(url); if (imageSequence.current === sequence) setPictureBusy(false); }
  }
  function canvasPoint(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * e.currentTarget.width / rect.width, y: (e.clientY - rect.top) * e.currentTarget.height / rect.height };
  }
  function pointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (!scene || mode === "view" || busy !== null) return;
    const point = canvasPoint(e), mapped = cardPointToMap(scene, point);
    if (!mapped) return;
    setPlaying(false); e.currentTarget.setPointerCapture(e.pointerId);
    if (mode === "start") { setCustomStart(mapped); setMode("draw"); setRoute(false); setWaypoints([]); return; }
    const { project } = cardGeometry(scene);
    const index = waypoints.findIndex(item => { const p = project(item); return Math.hypot(p.x - point.x, p.y - point.y) < 22; });
    if (index >= 0) drag.current = { index, moved: false };
    else { setWaypoints(current => [...current, mapped]); setRoute(true); }
  }
  function pointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!drag.current || !scene) return;
    const point = cardPointToMap(scene, canvasPoint(e)); if (!point) return;
    const index = drag.current.index; drag.current.moved = true;
    setWaypoints(current => current.map((item, i) => i === index ? point : item));
  }
  async function download(kind: "png" | "gif") {
    if (!scene || busy !== null) return;
    setPlaying(false); setMode("view"); setNotice(""); setBusy(0);
    try { if (kind === "png") await exportPng(scene); else await exportGif(scene, setBusy); setNotice(`${kind.toUpperCase()} 已下載。`); }
    catch (reason) { setNotice(`下載失敗：${(reason as Error).message}`); }
    finally { setBusy(null); }
  }
  const disabled = busy !== null;
  const [width, height] = CARD_SIZES[settings.format];
  return <div className="workspace">
    <aside className="editor-panel"><fieldset disabled={disabled} className="editor-fields">
      <section><h2><span>01</span>出展資訊</h2>{choose}
        <label>卡片標題<input value={settings.title} maxLength={80} onChange={e => update("title", e.target.value)} /></label>
        <label>日期與場地<input value={settings.subtitle} maxLength={160} onChange={e => update("subtitle", e.target.value)} /></label>
        <label>社群帳號或短句<input placeholder="例如 @your_circle ／ 新刊等你來" value={settings.account} maxLength={60} onChange={e => update("account", e.target.value)} /></label>
        <div className="image-controls"><label className="upload-button">{pictureBusy ? "圖片讀取中…" : picture ? "更換社團圖片" : "＋ 加入社團圖片"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void choosePicture(e.target.files?.[0]); e.target.value = ""; }} /></label>{picture && <button className="text-button" onClick={() => { imageSequence.current++; setPictureBusy(false); setPicture(null); }}>移除</button>}</div>
        {picture && <label>圖片呈現<select value={settings.pictureFit} onChange={e => update("pictureFit", e.target.value as CardSettings["pictureFit"])}><option value="contain">完整顯示</option><option value="cover">填滿並置中裁切</option></select></label>}
      </section>
      <section><h2><span>02</span>入口到攤位</h2>
        <label>從哪裡出發<select aria-label="起點" value={entranceId} onChange={e => { setEntranceId(e.target.value); setWaypoints([]); setRoute(false); setPlaying(false); setMode(e.target.value === "custom" ? "start" : "view"); }}>
          {entrances.map(item => <option key={item.id} value={item.id}>{item.label || "入口"}</option>)}<option value="custom">在地圖上指定</option></select></label>
        <div className="button-row"><button className={mode === "draw" ? "active" : ""} onClick={() => { setPlaying(false); setMode(!start ? "start" : mode === "draw" ? "view" : "draw"); }}>{mode === "draw" ? "完成路線" : "畫路線"}</button><button disabled={!waypoints.length} onClick={() => { setWaypoints(current => current.slice(0, -1)); if (waypoints.length <= 1) { setRoute(false); setPlaying(false); } }}>退一步</button><button disabled={!route && !waypoints.length} onClick={() => { setWaypoints([]); setRoute(false); setPlaying(false); }}>清除</button></div>
        <p className="hint">{mode === "start" ? "在右側地圖點選起點。" : mode === "draw" ? "沿走道點選轉彎處；拖曳圓點可調整位置。" : route ? `${waypoints.length} 個轉彎點，可再次編輯。` : "手動畫出入口到攤位的路線。"}</p>
        <label className="check"><input type="checkbox" checked={settings.closeup} onChange={e => update("closeup", e.target.checked)} />放大路線範圍</label>
      </section>
      <section><h2><span>03</span>卡片樣式</h2>
        <div className="segmented" aria-label="卡片比例">{([["landscape", "橫式", "16:9"], ["square", "正方形", "1:1"], ["portrait", "直式", "4:5"]] as const).map(([id, label, ratio]) => <button key={id} aria-pressed={settings.format === id} onClick={() => update("format", id)}>{label}<small>{ratio}</small></button>)}</div>
        <div className="swatch-row"><span>路線顏色</span>{COLORS.map(color => <button key={color} className="swatch" style={{ background: color }} aria-label={`路線顏色 ${color}`} aria-pressed={settings.color === color} onClick={() => update("color", color)} />)}<input aria-label="自訂路線顏色" type="color" value={settings.color} onChange={e => update("color", e.target.value)} /></div>
        <div className="swatch-row"><span>背景顏色</span>{BACKGROUNDS.map(color => <button key={color} className="swatch" style={{ background: color }} aria-label={`背景顏色 ${color}`} aria-pressed={settings.background === color} onClick={() => update("background", color)} />)}</div>
        <details><summary>更多設定</summary>
          <label>路線粗細<input type="range" min="2" max="9" value={settings.lineWidth} onChange={e => update("lineWidth", Number(e.target.value))} /></label>
          <label className="check"><input type="checkbox" checked={settings.showConnector} onChange={e => update("showConnector", e.target.checked)} />圖片連到攤位的虛線</label>
          <label className="check"><input type="checkbox" checked={settings.showQr} onChange={e => update("showQr", e.target.checked)} />顯示攤位連結 QR Code</label>
        </details>
      </section>
      <section><h2><span>04</span>動圖設定</h2><div className="two-cols"><label>移動標記<select value={settings.marker} onChange={e => update("marker", e.target.value as CardSettings["marker"])}><option value="dot">圓點</option><option value="arrow">箭頭</option></select></label><label>一輪時間<select value={settings.duration} onChange={e => update("duration", Number(e.target.value))}><option value="3">3 秒</option><option value="4">4 秒</option><option value="6">6 秒</option></select></label></div></section>
    </fieldset></aside>
    <div className="preview-column"><div className="preview-sticky">
      <div className="preview-toolbar"><div><span className="status-dot" />即時預覽 <small>{width} × {height}</small></div><button disabled={!route || disabled} aria-pressed={playing} onClick={() => { setMode("view"); setPlaying(current => !current); }}>{playing ? "暫停" : "播放動圖"}</button></div>
      <div className={`preview-board ${mode !== "view" ? "drawing" : ""}`}>
        {!mapImage && <p role="status">正在繪製地圖…</p>}
        <canvas ref={canvas} width={width} height={height} aria-label="攤位導引圖預覽；使用畫路線後可點選轉彎點" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} style={{ touchAction: mode === "view" ? "auto" : "none", width: `min(100%, ${75 * width / height}vh)` }} />
      </div>
      <p className="preview-hint">{mode === "draw" ? "編輯中的編號圓點不會出現在下載圖片。" : mode === "start" ? "點一下地圖，設定出發位置。" : "PNG 保留完整路線；GIF 會沿著你畫的路線移動。"}</p>
      <div className="export-bar"><div><strong>準備分享你的攤位</strong><p>GIF 最長邊 900 px，循環播放。</p></div><div className="export-actions"><button disabled={!scene || disabled || pictureBusy} onClick={() => void download("png")}>下載 PNG</button><button className="primary" disabled={!scene || !route || disabled || pictureBusy} onClick={() => void download("gif")}>下載 GIF <span>↗</span></button></div></div>
      {busy !== null && <div className="progress" role="status"><progress max={100} value={busy} />正在製作檔案… {busy}%</div>}
      <p className="feedback" role="status">{notice}</p>
    </div></div>
    <div ref={mapSource} className="map-source" aria-hidden="true" inert style={{ width: layout.width, height: layout.height }}><AccessibleEventMapRenderer eventName={event.name} layout={layout} slots={{}} onSelect={() => undefined} /></div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<App />);
