"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BOOTHS, GENRES } from "./ff47-booths";


export default function Home() {
  const [day, setDay] = useState<1 | 2 | 3>(1), [hall, setHall] = useState<"ALL" | "A" | "B">("ALL"), [genre, setGenre] = useState("全部類別");
  const [query, setQuery] = useState(""), [favoriteOnly, setFavoriteOnly] = useState(false), [favorites, setFavorites] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>("1-a01"), [nextStop, setNextStop] = useState<string | null>(null);
  const [zoom, setZoom] = useState(.55), [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  useEffect(() => { try { setFavorites(JSON.parse(localStorage.getItem("event-map-favorites") || "[]")); } catch {} }, []);
  useEffect(() => { localStorage.setItem("event-map-favorites", JSON.stringify(favorites)); }, [favorites]);
  const filtered = useMemo(() => BOOTHS.filter((booth) => {
    const needle = query.trim().toLowerCase(), haystack = [booth.code, booth.name, booth.pen, booth.genre, booth.work, ...booth.tags].join(" ").toLowerCase();
    return booth.day === day && (hall === "ALL" || booth.hall === hall) && (genre === "全部類別" || booth.genre === genre) && (!favoriteOnly || favorites.includes(booth.id)) && (!needle || haystack.includes(needle));
  }), [day, hall, genre, query, favoriteOnly, favorites]);
  const selected = BOOTHS.find((booth) => booth.id === selectedId) ?? null;
  const toggleFavorite = (id: string) => setFavorites((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  const reset = () => { setZoom(.55); setOffset({ x: 0, y: 0 }); };

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span aria-hidden="true">場</span><div><b>場刊 MAP</b><small>同人展逛攤地圖</small></div></div>
      <div className="event"><i>活動</i><div><b>Fancy Frontier 47</b><small>8.21–23 · 花博公園爭艷館</small></div></div>
      <label className="search"><span aria-hidden="true">⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋社團、攤位或作品" aria-label="搜尋社團、攤位或作品" /><kbd>⌘ K</kbd></label>
      <button className="help" aria-label="使用說明">?</button>
    </header>
    <section className="toolbar" aria-label="日期與場館篩選">
      <div className="days">{([1, 2, 3] as const).map((value) => <button key={value} className={day === value ? "active" : ""} onClick={() => setDay(value)}><b>DAY {value}</b><span>8月{[21, 22, 23][value - 1]}日・{["五", "六", "日"][value - 1]}</span></button>)}</div>
      <div className="mobile-halls">{(["ALL", "A", "B"] as const).map((value) => <button key={value} className={hall === value ? "active" : ""} onClick={() => setHall(value)}>{value === "ALL" ? "全館" : value === "A" ? "A–K 區" : "L–U 區"}</button>)}</div>
      <div className="open-hours"><span />場館開放 10:30–17:00</div>
    </section>
    <div className="workspace">
      <aside className="filters">
        <div className="filter-title"><b>篩選攤位</b><button onClick={() => { setGenre("全部類別"); setFavoriteOnly(false); setQuery(""); }}>清除</button></div>
        <fieldset><legend>展區</legend><div className="segments">{(["ALL", "A", "B"] as const).map((value) => <button key={value} className={hall === value ? "active" : ""} onClick={() => setHall(value)}>{value === "ALL" ? "全部" : value === "A" ? "A–K" : "L–U"}</button>)}</div></fieldset>
        <fieldset><legend>創作類別</legend><div className="genres">{GENRES.map((value) => <button key={value} className={genre === value ? "active" : ""} onClick={() => setGenre(value)}><i className={`dot dot-${value}`} />{value}<small>{BOOTHS.filter((b) => b.day === day && (value === "全部類別" || b.genre === value)).length}</small></button>)}</div></fieldset>
        <label className="favorite-only"><input type="checkbox" checked={favoriteOnly} onChange={(e) => setFavoriteOnly(e.target.checked)} /><i>♥</i><span><b>只看收藏</b><small>已收藏 {favorites.length} 個攤位</small></span></label>
        <div className="guide"><b>快速上手</b><p>拖曳地圖移動位置，點選攤位查看新刊與社團資訊。</p><small>地圖資料最後更新於 8月5日</small></div>
      </aside>
      <section className="map-region" aria-label="攤位地圖">
        <div className="map-title"><div><small>FLOOR MAP</small><h1>花博公園爭艷館 <em>{hall === "ALL" ? "全館" : `${hall} 區`}</em></h1></div><p><b>{filtered.length}</b> 個符合條件的攤位</p></div>
        {nextStop && <div className="route"><span>↗</span><div><small>下一站</small><b>{BOOTHS.find((b) => b.id === nextStop)?.code} · {BOOTHS.find((b) => b.id === nextStop)?.name}</b></div><button onClick={() => setNextStop(null)} aria-label="清除下一站">×</button></div>}
        <div className="map" onPointerDown={(e) => { if ((e.target as HTMLElement).closest("button")) return; drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={(e) => { if (drag.current) setOffset({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
          <div className="floor" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}>
            <div className="hall-shape" /><div className="zone zone-a">A–K 區<small>北側展區</small></div><div className="zone zone-b">L–U 區<small>南側展區</small></div><div className="center-aisle"><span>中央通道</span></div><div className="cross-aisle" />
            <div className="entrance">入口<small>ENTRANCE</small></div><div className="exit exit-left">EXIT</div><div className="exit exit-right">EXIT</div>
            {filtered.map((booth) => <button key={booth.id} style={{ left: `${booth.x}%`, top: `${booth.y}%` }} className={`booth ${booth.tone} ${selectedId === booth.id ? "selected" : ""} ${favorites.includes(booth.id) ? "fav" : ""} ${nextStop === booth.id ? "next" : ""}`} onClick={() => setSelectedId(booth.id)} aria-label={`${booth.code} ${booth.name}，${booth.genre}`}><span>{booth.code}</span><b>{booth.name}</b><i>♥</i></button>)}
            {!filtered.length && <div className="empty"><b>沒有符合條件的攤位</b><span>試試其他類別或清除搜尋文字</span></div>}
          </div>
          <div className="controls" aria-label="地圖縮放控制"><button onClick={() => setZoom((v) => Math.min(1.2, +(v + .1).toFixed(2)))} aria-label="放大地圖">＋</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((v) => Math.max(.35, +(v - .1).toFixed(2)))} aria-label="縮小地圖">−</button><button onClick={reset} aria-label="重設地圖位置">⌾</button></div><div className="compass"><small>N</small>↑</div>
        </div>
      </section>
      {selected && <aside className="details" aria-label="攤位詳情">
        <button className="close" onClick={() => setSelectedId(null)} aria-label="關閉攤位詳情">×</button><div className={`cover ${selected.tone}`}><span>{selected.code}</span><b>{selected.work}</b><small>NEW RELEASE</small></div>
        <div className="detail-body"><div className="badges"><span>{selected.code}</span><i>{selected.hall} 區</i><button className={favorites.includes(selected.id) ? "saved" : ""} onClick={() => toggleFavorite(selected.id)} aria-label={favorites.includes(selected.id) ? "取消收藏" : "收藏攤位"}>♥</button></div><h2>{selected.name}</h2><p className="genre-name">{selected.genre}</p><div className="tags">{selected.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
          <div className="work"><small>本次主打</small><b>{selected.work}</b><p>{selected.note}</p></div><div className="actions"><button className="primary" onClick={() => setNextStop(selected.id)}>{nextStop === selected.id ? "已設為下一站" : "設為下一站"}<span>↗</span></button><button onClick={() => toggleFavorite(selected.id)}>{favorites.includes(selected.id) ? "已收藏" : "加入收藏"}</button></div><p className="hint">攤位資訊由社團提供，品項與庫存以現場為準。</p>
        </div>
      </aside>}
    </div>
  </main>;
}


