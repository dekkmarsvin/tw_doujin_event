import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { PUBLISHED_EVENTS, type EventDefinition } from "../../app/event-catalog";
import { type CircleCatalogPayload } from "../../app/circle-records";
import { type EventMapLayout } from "../../app/event-map";
import { loadStaticCircleCatalog } from "../../app/static-circle-catalog-client";
import { loadStaticEventMap } from "../../app/static-event-map-client";
import { dayDateLabel, eventDayCalendarDate } from "../../app/event-calendar";
import Editor from "../../app/booth-guide/editor";
import "../../app/booth-guide/style.css";

type Resource = { catalog: CircleCatalogPayload; layout: EventMapLayout };

function App() {
  const [eventId, setEventId] = useState(PUBLISHED_EVENTS[0].id);
  const event = PUBLISHED_EVENTS.find(item => item.id === eventId)!;
  return <div className="booth-guide">
    <header className="site-header"><a href="/" className="brand">場刊<span>Map</span></a><span className="divider" /><strong>攤位導引圖</strong><span className="prototype-badge">功能原型</span></header>
    <main><div className="page-heading"><div><p className="eyebrow">MAKE YOUR BOOTH EASY TO FIND</p><h1>讓大家，一眼找到你。</h1><p>選好攤位、畫一條路，把這次出展變成一張圖。</p></div><span className="local-note">圖片在這台裝置製作</span></div>
      <Scope key={event.id} event={event} onEvent={setEventId} />
    </main>
  </div>;
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

createRoot(document.getElementById("root")!).render(<App />);
