import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import qrcode from "qrcode-generator";
import AccessibleEventMapRenderer from "../accessible-event-map-renderer";
import { type EventDefinition } from "../event-catalog";
import { type CircleCatalogPayload } from "../circle-records";
import { type EventMapLayout, type MapPoint } from "../event-map";
import { dayDateLabel, eventDayCalendarDate } from "../event-calendar";
import { PUBLIC_ORIGIN } from "../seo";
import { cardGeometry, cardPointToMap, CARD_SIZES, drawCard, exportGif, exportPng, loadImage, readPicture, snapshotMap, type CardScene, type CardSettings } from "./card";
import "./style.css";
import { useLocale } from "../i18n/locale-context";
import { useGuideText } from "./messages";

type Placement = CircleCatalogPayload["placements"][number];
const COLORS = ["#d34972", "#286b5c", "#3675bd", "#8b5db3", "#c36a24"];
const BACKGROUNDS = ["#f5f1e8", "#e8f3f0", "#eaf0fa", "#f6eaf1", "#ffffff"];

export default function BoothGuideEditor({ event, day, venueId, layout, placement, name, choose, pictureUrl, pictureReadUrl }: { event: EventDefinition; day: string | number; venueId: string; layout: EventMapLayout; placement: Placement; name: string; choose: React.ReactNode; pictureUrl?: string; pictureReadUrl?: string }) {
  const t = useGuideText();
  const { locale } = useLocale();
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
    format: "portrait", title: name, subtitle: `${event.name} ｜ ${eventDayCalendarDate(event, day) ? dayDateLabel(eventDayCalendarDate(event, day)!, locale) : event.days.find(item => item.id === day)!.dateLabel} ｜ ${event.venueAssignments.find(item => item.venueSpaceId === venueId)!.venueSpaceName}`,
    account: "", booth: placement.boothCode, entrance: entrance?.label ?? "", color: COLORS[0], background: BACKGROUNDS[0], lineWidth: 4, duration: 4,
    marker: "dot", showConnector: false, showQr: true, closeup: true, pictureFit: "contain",
  }));
  const [mapImage, setMapImage] = useState<HTMLImageElement | null>(null);
  const [picture, setPicture] = useState<HTMLImageElement | null>(null);
  const qr = useMemo(() => {
    const code = qrcode(0, "M");
    const url = new URL(PUBLIC_ORIGIN); url.search = new URLSearchParams({ event: event.id, day: String(day), venueSpaceId: venueId, selectedCircle: placement.circleId, selectedBooth: placement.boothCode }).toString();
    code.addData(url.href); code.make();
    return Array.from({ length: code.getModuleCount() }, (_, row) => Array.from({ length: code.getModuleCount() }, (_, col) => code.isDark(row, col)));
  }, [event.id, day, venueId, placement.circleId, placement.boothCode]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [pictureBusy, setPictureBusy] = useState(Boolean(pictureUrl));
  const mapSource = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ index: number; moved: boolean } | null>(null);
  const imageSequence = useRef(0);
  const update = <K extends keyof CardSettings>(key: K, value: CardSettings[K]) => setSettings(current => ({ ...current, [key]: value }));
  useEffect(() => {
    let active = true;
    const svg = mapSource.current?.querySelector("svg");
    if (svg) void snapshotMap(svg, layout.width, layout.height).then(image => { if (active) setMapImage(image); }).catch(() => { if (active) setNotice(t("地圖圖片無法準備，請重新整理。")); });
    return () => { active = false; };
  }, [layout, event.id, day, venueId, placement.circleId, placement.boothCode, t]);
  const scene: CardScene | null = mapImage ? { settings: { ...settings, entrance: entrance?.label ?? t("指定起點"), fromEntrance: t("從{entrance}出發", { entrance: entrance?.label ?? t("指定起點") }) }, map: mapImage, mapSize: layout, picture, qr, start, target, waypoints, route } : null;
  useEffect(() => {
    if (!pictureUrl) return;
    let active = true;
    const sequence = ++imageSequence.current;
    void loadImage(pictureReadUrl ?? pictureUrl, true)
      .catch(error => pictureReadUrl ? loadImage(pictureUrl, true) : Promise.reject(error))
      .then(image => { if (active && sequence === imageSequence.current) setPicture(image); })
      .catch(() => { if (active && sequence === imageSequence.current) setNotice("代表圖無法讀取，請選擇裝置上的圖片。"); })
      .finally(() => { if (active && sequence === imageSequence.current) setPictureBusy(false); });
    return () => { active = false; };
  }, [pictureUrl, pictureReadUrl]);
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
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setNotice(t("請選擇 JPG、PNG 或 WebP 圖片。")); return; }
    const sequence = ++imageSequence.current;
    setPictureBusy(true); setNotice("");
    try { const image = await loadImage(await readPicture(file)); if (imageSequence.current === sequence) setPicture(image); }
    catch (reason) { if (imageSequence.current === sequence) setNotice(t((reason as Error).message)); }
    finally { if (imageSequence.current === sequence) setPictureBusy(false); }
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
    try { if (kind === "png") await exportPng(scene); else await exportGif(scene, setBusy); setNotice(t("{format} 已下載。", { format: kind.toUpperCase() })); }
    catch { setNotice(t("下載失敗，請重試。")); }
    finally { setBusy(null); }
  }
  const disabled = busy !== null;
  const [width, height] = CARD_SIZES[settings.format];
  return <div className="workspace">
    <aside className="editor-panel"><fieldset disabled={disabled} className="editor-fields">
      <section><h2><span>01</span>{t("出展資訊")}</h2>{choose}
        <label>{t("卡片標題")}<input value={settings.title} maxLength={80} onChange={e => update("title", e.target.value)} /></label>
        <label>{t("日期與場地")}<input value={settings.subtitle} maxLength={160} onChange={e => update("subtitle", e.target.value)} /></label>
        <label>{t("社群帳號或短句")}<input placeholder={t("例如 @your_circle ／ 新刊等你來")} value={settings.account} maxLength={60} onChange={e => update("account", e.target.value)} /></label>
        <div className="image-controls"><label className="upload-button">{pictureBusy ? t("圖片讀取中…") : picture ? t("更換社團圖片") : t("＋ 加入社團圖片")}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void choosePicture(e.target.files?.[0]); e.target.value = ""; }} /></label>{picture && <button type="button" className="text-button" onClick={() => { imageSequence.current++; setPictureBusy(false); setPicture(null); }}>{t("移除")}</button>}</div>
        {picture && <label>{t("圖片呈現")}<select value={settings.pictureFit} onChange={e => update("pictureFit", e.target.value as CardSettings["pictureFit"])}><option value="contain">{t("完整顯示")}</option><option value="cover">{t("填滿並置中裁切")}</option></select></label>}
      </section>
      <section><h2><span>02</span>{t("入口到攤位")}</h2>
        <label>{t("從哪裡出發")}<select aria-label={t("起點")} value={entranceId} onChange={e => { setEntranceId(e.target.value); setWaypoints([]); setRoute(false); setPlaying(false); setMode(e.target.value === "custom" ? "start" : "view"); }}>
          {entrances.map(item => <option key={item.id} value={item.id}>{item.label || t("入口")}</option>)}<option value="custom">{t("在地圖上指定")}</option></select></label>
        <div className="button-row"><button type="button" className={mode === "draw" ? "active" : ""} onClick={() => { setPlaying(false); setMode(!start ? "start" : mode === "draw" ? "view" : "draw"); }}>{mode === "draw" ? t("完成路線") : t("畫路線")}</button><button type="button" disabled={!waypoints.length} onClick={() => { setWaypoints(current => current.slice(0, -1)); if (waypoints.length <= 1) { setRoute(false); setPlaying(false); } }}>{t("退一步")}</button><button type="button" disabled={!route && !waypoints.length} onClick={() => { setWaypoints([]); setRoute(false); setPlaying(false); }}>{t("清除")}</button></div>
        <p className="hint">{mode === "start" ? t("在地圖上點選起點。") : mode === "draw" ? t("沿走道點選轉彎處；拖曳圓點可調整位置。") : route ? t("{count} 個轉彎點，可再次編輯。", { count: waypoints.length }) : t("手動畫出入口到攤位的路線。")}</p>
        <label className="check"><input type="checkbox" checked={settings.closeup} onChange={e => update("closeup", e.target.checked)} />{t("放大路線範圍")}</label>
      </section>
      <section><h2><span>03</span>{t("卡片樣式")}</h2>
        <div className="segmented" aria-label={t("卡片比例")}>{([["landscape", t("橫式"), "16:9"], ["square", t("正方形"), "1:1"], ["portrait", t("直式"), "4:5"]] as const).map(([id, label, ratio]) => <button type="button" key={id} aria-pressed={settings.format === id} onClick={() => update("format", id)}>{label}<small>{ratio}</small></button>)}</div>
        <div className="swatch-row"><span>{t("路線顏色")}</span>{COLORS.map(color => <button type="button" key={color} className="swatch" style={{ background: color }} aria-label={`${t("路線顏色")} ${color}`} aria-pressed={settings.color === color} onClick={() => update("color", color)} />)}<input aria-label={t("自訂路線顏色")} type="color" value={settings.color} onChange={e => update("color", e.target.value)} /></div>
        <div className="swatch-row"><span>{t("背景顏色")}</span>{BACKGROUNDS.map(color => <button type="button" key={color} className="swatch" style={{ background: color }} aria-label={`${t("背景顏色")} ${color}`} aria-pressed={settings.background === color} onClick={() => update("background", color)} />)}</div>
        <details><summary>{t("更多設定")}</summary>
          <label>{t("路線粗細")}<input type="range" min="2" max="9" value={settings.lineWidth} onChange={e => update("lineWidth", Number(e.target.value))} /></label>
          <label className="check"><input type="checkbox" checked={settings.showConnector} onChange={e => update("showConnector", e.target.checked)} />{t("圖片連到攤位的虛線")}</label>
          <label className="check"><input type="checkbox" checked={settings.showQr} onChange={e => update("showQr", e.target.checked)} />{t("顯示攤位連結 QR Code")}</label>
        </details>
      </section>
      <section><h2><span>04</span>{t("動圖設定")}</h2><div className="two-cols"><label>{t("移動標記")}<select value={settings.marker} onChange={e => update("marker", e.target.value as CardSettings["marker"])}><option value="dot">{t("圓點")}</option><option value="arrow">{t("箭頭")}</option></select></label><label>{t("一輪時間")}<select value={settings.duration} onChange={e => update("duration", Number(e.target.value))}><option value="3">{t("3 秒")}</option><option value="4">{t("4 秒")}</option><option value="6">{t("6 秒")}</option></select></label></div></section>
    </fieldset></aside>
    <div className="preview-column"><div className="preview-sticky">
      <div className="preview-toolbar"><div><span className="status-dot" />{t("即時預覽")}<small>{width} × {height}</small></div><button type="button" disabled={!route || disabled} aria-pressed={playing} onClick={() => { setMode("view"); setPlaying(current => !current); }}>{playing ? t("暫停") : t("播放動圖")}</button></div>
      <div className={`preview-board ${mode !== "view" ? "drawing" : ""}`}>
        {!mapImage && <p role="status">{t("正在繪製地圖…")}</p>}
        <canvas ref={canvas} width={width} height={height} aria-label={t("攤位導引圖預覽；使用畫路線後可點選轉彎點")} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} style={{ touchAction: mode === "view" ? "auto" : "none", width: `min(100%, ${75 * width / height}vh)` }} />
      </div>
      <p className="preview-hint">{mode === "draw" ? t("編輯中的編號圓點不會出現在下載圖片。") : mode === "start" ? t("點一下地圖，設定出發位置。") : t("PNG 保留完整路線；GIF 會沿著你畫的路線移動。")}</p>
      <div className="export-bar"><div><strong>{t("準備分享你的攤位")}</strong><p>{t("GIF 最長邊 900 px，循環播放。")}</p></div><div className="export-actions"><button type="button" disabled={!scene || disabled || pictureBusy} onClick={() => void download("png")}>{t("下載 PNG")}</button><button type="button" className="primary" disabled={!scene || !route || disabled || pictureBusy} onClick={() => void download("gif")}>{t("下載 GIF")}<span>↗</span></button></div></div>
      {busy !== null && <div className="progress" role="status"><progress max={100} value={busy} />{t("正在製作檔案…")}{busy}%</div>}
      <p className="feedback" role="status">{t(notice)}</p>
    </div></div>
    <div ref={mapSource} className="map-source" aria-hidden="true" inert style={{ width: layout.width, height: layout.height }}><AccessibleEventMapRenderer eventName={event.name} layout={layout} slots={{}} onSelect={() => undefined} /></div>
  </div>;
}
