import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EventDefinition } from "./event-catalog";
import { venueAssignmentForArea } from "./event-catalog";
import { eventDayCalendarDate, shortDate } from "./event-calendar";
import { placementStatusLabel } from "./circle-records";
import { DEFAULT_ADVANCED_CIRCLE_SEARCH, normalizeWorkTopics } from "./circle-search";
import { catalogPreviewSize } from "./catalog-image-prepare";
import { catalogBrowseUrl, parseCatalogBrowseUrl, switchReaderViewUrl, type CatalogBrowseState } from "./catalog-browse-url";
import { projectCatalogBrowse, type CatalogBrowseCard } from "./catalog-browse-projection";
import { BROWSE_BATCH_SIZE, readBrowseHistory, saveBrowseHistory } from "./catalog-browse-history";
import { useCircleCatalog } from "./use-circle-catalog";
import { useReaderPlanning } from "./reader-planning";
import { restoreFavorite, toggleFavorite } from "./planning-store";
import { applyReaderMetadata, circlePath, pageMetadata, readerLink } from "./seo";
import ReaderViewTabs, { navigateReader, openMapOnPlan, ordinaryLinkClick } from "./reader-navigation";
import tabStyles from "./reader-mobile-tabs.module.css";
import AdvancedCircleSearchControls from "./advanced-circle-search";
import PlanningTools from "./planning-tools";
import { UiIcon } from "./ui-icons";
import { sharePublicContent } from "./public-share";
import type { PublicFilterDescriptor } from "./public-circle-search";
import styles from "./catalog-browse-app.module.css";

export default function CatalogBrowseApp({ event, onChooseEvent }: { event: EventDefinition; onChooseEvent?: () => void }) {
  const publication = useCircleCatalog(event.id);
  const planning = useReaderPlanning();
  const [state, setState] = useState(() => parseCatalogBrowseUrl(event, new URL(window.location.href)));
  const [initial] = useState(() => readBrowseHistory(window.history.state, window.location.href));
  const [shown, setShown] = useState(initial.shown);
  const [textShown, setTextShown] = useState(initial.textShown);
  const [restoration, setRestoration] = useState({ y: initial.y });
  const restoring = useRef(true);
  const restored = useRef<object | null>(null);
  const [moreTopics, setMoreTopics] = useState(false);
  const [notice, setNotice] = useState("");
  const [manualShare, setManualShare] = useState("");
  const url = catalogBrowseUrl(event, state, window.location.origin);
  const key = url.toString();
  const mapUrl = useMemo(() => switchReaderViewUrl(event, new URL(key)), [event, key]);
  const ready = publication.status === "ready" && publication.overlayStatus === "applied";
  const projection = useMemo(() => projectCatalogBrowse(event, publication.catalog.records, state), [event, publication.catalog, state]);
  const savePosition = useCallback(() => {
    if (!restoring.current) saveBrowseHistory({ key, shown, textShown, y: window.scrollY });
  }, [key, shown, textShown]);

  useEffect(() => {
    const metadata = pageMetadata(event);
    applyReaderMetadata({ ...metadata, title: `${event.name} 逛品書｜場刊 Map`, description: `瀏覽${event.name}的品書，依作品與題材找社團、收藏並查看攤位。` });
  }, [event]);
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const restore = () => {
      if (new URL(window.location.href).searchParams.get("view") !== "browse") return;
      const saved = readBrowseHistory(window.history.state, window.location.href);
      restoring.current = true;
      setState(parseCatalogBrowseUrl(event, new URL(window.location.href)));
      setShown(saved.shown); setTextShown(saved.textShown); setRestoration({ y: saved.y });
      setManualShare(""); setNotice("");
    };
    window.addEventListener("popstate", restore);
    return () => { window.history.scrollRestoration = previous; window.removeEventListener("popstate", restore); };
  }, [event]);
  useEffect(() => {
    // Normalize imported links without carrying private parameters into browse.
    if (window.location.href !== key && new URL(window.location.href).searchParams.get("view") === "browse") {
      window.history.replaceState({ ...window.history.state }, "", key);
    }
  }, [key]);
  useEffect(() => {
    if (!ready || restored.current === restoration) return;
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
        window.scrollTo(0, restoration.y);
        restored.current = restoration;
        restoring.current = false;
        savePosition();
      });
    });
    return () => { window.cancelAnimationFrame(first); window.cancelAnimationFrame(second); };
  }, [ready, restoration, savePosition]);
  useEffect(() => {
    window.addEventListener("scroll", savePosition, { passive: true });
    window.addEventListener("pagehide", savePosition);
    return () => { savePosition(); window.removeEventListener("scroll", savePosition); window.removeEventListener("pagehide", savePosition); };
  }, [savePosition]);
  const change = (next: CatalogBrowseState, replace = false) => {
    savePosition();
    const nextUrl = catalogBrowseUrl(event, next, window.location.origin);
    window.history[replace ? "replaceState" : "pushState"]({ ...window.history.state, catalogBrowse: undefined }, "", nextUrl);
    restoring.current = true;
    setState(next); setShown(BROWSE_BATCH_SIZE); setTextShown(BROWSE_BATCH_SIZE);
    setRestoration({ y: 0 }); setManualShare(""); setNotice("");
  };
  const removeFilter = (filter: PublicFilterDescriptor) => {
    const advanced = { ...state.advancedSearch };
    if (filter.kind === "genre") return change({ ...state, genre: event.genres[0] });
    if (filter.kind === "creator") advanced.creatorType = "ALL";
    if (filter.kind === "work") advanced.workTopics = advanced.workTopics.filter((topic) => topic !== filter.value);
    if (filter.kind === "work-exclude") advanced.excludedWorkTopics = advanced.excludedWorkTopics.filter((topic) => topic !== filter.value);
    if (filter.kind === "work-type") advanced.workType = "ALL";
    if (filter.kind === "adult") advanced.adultContent = "ALL";
    change({ ...state, advancedSearch: advanced });
  };
  const chooseTopic = (value: string) => {
    const topics = normalizeWorkTopics(state.advancedSearch.workTopics);
    change({ ...state, advancedSearch: {
      ...state.advancedSearch,
      workTopics: topics.includes(value) ? topics.filter((topic) => topic !== value) : normalizeWorkTopics([...topics, value]),
      excludedWorkTopics: normalizeWorkTopics(state.advancedSearch.excludedWorkTopics).filter((topic) => topic !== value),
    } });
  };
  const share = async () => {
    const condition = [state.query.trim(), ...projection.filters.map((filter) => filter.label)].filter(Boolean).join("、");
    const text = `${event.name}${condition ? `｜${condition}` : ""}的品書`;
    const result = await sharePublicContent({ title: `${event.name} 逛品書`, text, url: key });
    setNotice(result === "copied" ? "已複製分享文字與連結。" : "");
    setManualShare(result === "manual" ? `${text}\n${key}` : "");
  };
  const favoriteIds = new Set(planning.document.favorites.filter((item) => item.eventId === event.id).map((item) => item.circleId));
  const toggle = (card: CatalogBrowseCard) => {
    const favorite = planning.document.favorites.find((item) => item.eventId === event.id && item.circleId === card.circle.id);
    planning.update((current) => toggleFavorite(current, event.id, card.circle.id));
    planning.setFavoriteUndo(favorite ? { favorite, circleName: card.circle.name } : null);
  };
  const cards = (items: CatalogBrowseCard[], count: number) => items.slice(0, count).map((card) => <BrowseCard
    key={card.circle.id} card={card} event={event} favorite={favoriteIds.has(card.circle.id)}
    writable={planning.ready && planning.unsupportedRaw === null} onFavorite={() => toggle(card)} beforeNavigate={savePosition}
  />);
  const hasFilters = Boolean(state.query.trim() || projection.filters.length);
  const failed = publication.status === "error" || publication.overlayStatus === "unavailable";
  const allScope = state.day === null && state.venueSpaceId === null;
  return <div className={styles.page}>
    <header className={styles.header}>
      <div className={styles.identity}><div className={`brand ${styles.brand}`}><span aria-hidden="true">場</span>場刊 Map</div>{/* As on the map: the event name leads back to the chooser only when there is another event to choose. */}{onChooseEvent ? <a className={styles.event} href="/" onClick={(pressed) => { if (!ordinaryLinkClick(pressed)) return; pressed.preventDefault(); savePosition(); onChooseEvent(); }}><span>{event.name}<small>{event.dateRangeLabel}</small></span><span className={styles.eventSwitch}>切換活動<UiIcon name="chevron-right" /></span></a> : <div className={styles.event}><span>{event.name}<small>{event.dateRangeLabel}</small></span></div>}<ReaderViewTabs className={styles.viewSwitch} event={event} view="browse" url={url} beforeNavigate={savePosition} /><PlanningTools eventId={event.id} /></div>
    </header>
    <main className={styles.main}>
      <h1 className={styles.srOnly}>{event.name} 逛品書</h1>
      <div className={styles.search}><UiIcon name="search" /><input aria-label="搜尋作品、題材或社團" placeholder="搜尋作品、題材或社團" value={state.query} onChange={(e) => change({ ...state, query: e.target.value }, true)} /></div>
      <div className={styles.scope}>
        <label><span className={styles.srOnly}>活動日期</span><select aria-label="活動日期" value={state.day === null ? "" : String(state.day)} onChange={(e) => change({ ...state, day: event.days.find((day) => String(day.id) === e.target.value)?.id ?? null })}>
          <option value="">全部日期</option>{event.days.map((day) => <option key={day.id} value={String(day.id)}>{day.dateLabel}</option>)}
        </select></label>
        <label><span className={styles.srOnly}>場地</span><select aria-label="場地" value={state.venueSpaceId ?? ""} onChange={(e) => change({ ...state, venueSpaceId: e.target.value || null })}>
          <option value="">全部場地</option>{event.venueAssignments.map((space) => <option key={space.venueSpaceId} value={space.venueSpaceId}>{space.venueName} · {space.venueSpaceName}</option>)}
        </select></label>
        <AdvancedCircleSearchControls value={state.advancedSearch} workSuggestions={ready ? projection.topics : []}
          categories={event.genres} category={state.genre}
          onApply={(advancedSearch, genre) => change({ ...state, advancedSearch, genre: genre ?? state.genre })} />
      </div>
      {ready && projection.topics.length > 0 && <div className={styles.topics} aria-label="作品與題材">
        {(moreTopics ? projection.topics : projection.topics.slice(0, 2)).map((topic) => { const pressed = normalizeWorkTopics(state.advancedSearch.workTopics).includes(topic.value); return <button key={topic.value} type="button" aria-pressed={pressed} onClick={() => chooseTopic(topic.value)}>{pressed && <UiIcon name="check" />}{topic.value}<small>{topic.count}</small></button>; })}
        {projection.topics.length > 2 && <button type="button" aria-expanded={moreTopics} onClick={() => setMoreTopics(!moreTopics)}>{moreTopics ? "收起題材" : "更多題材"}</button>}
      </div>}
      {hasFilters && <div className={styles.filters} aria-label="已套用條件">
        {state.query.trim() && <button onClick={() => change({ ...state, query: "" })}><span>搜尋：{state.query}</span><UiIcon name="close" /></button>}
        {projection.filters.map((filter) => <button key={filter.id} onClick={() => removeFilter(filter)} aria-label={`移除條件：${filter.label}`}><span>{filter.label}</span><UiIcon name="close" /></button>)}
        <button onClick={() => change({ ...state, query: "", genre: event.genres[0], advancedSearch: DEFAULT_ADVANCED_CIRCLE_SEARCH })}>全部清除</button>
      </div>}
      {planning.storageError && <p className={styles.error} role="alert">{planning.storageError}</p>}
      <div className={styles.resultHeader}>
        <div aria-live="polite">{ready ? <><h2>{projection.withCatalog.length} 個社團有品書</h2><span>{projection.circleCount} 個社團符合 · {projection.placementCount} 筆攤位配置</span></> : !failed && <span>正在讀取社團資料…</span>}</div>
        {ready && <button type="button" onClick={() => void share()}>分享</button>}
      </div>
      {notice && <p role="status">{notice}</p>}
      {manualShare && <label className={styles.manualShare}>請複製分享文字與連結<textarea readOnly value={manualShare} onFocus={(e) => e.target.select()} /><small>結果依社團目前公開的內容更新。</small></label>}
      {!ready && !failed && <div className={styles.grid} aria-label="正在讀取品書" aria-busy="true">{[0, 1, 2].map((n) => <div key={n} className={styles.skeleton} />)}</div>}
      {failed && <section className={styles.empty} role="status"><h2>{publication.status === "error" ? "活動資料暫時無法讀取" : "社團填寫的內容暫時無法讀取"}</h2><button onClick={() => void publication.retry()}>重新讀取</button><a href={readerLink(event)}>回到地圖搜尋</a></section>}
      {ready && <>
        {projection.withoutCatalog.length > 0 && projection.withCatalog.length > 0 && <a className={styles.withoutLink} href="#without-catalog" onClick={(pressed) => {
          if (ordinaryLinkClick(pressed)) { pressed.preventDefault(); document.getElementById("without-catalog")?.scrollIntoView({ block: "start" }); }
        }}>另有 {projection.withoutCatalog.length} 個社團沒有提供品書</a>}
        {projection.circleCount === 0 ? <section className={styles.empty}><h2>沒有符合條件的社團</h2><p>可移除搜尋條件，或調整日期與場地。</p></section> : <>
          {projection.withCatalog.length === 0 && <section className={styles.empty}><h2>{hasFilters ? "符合條件的社團尚未提供品書" : allScope ? "這場目前還沒有社團提供品書" : "目前範圍沒有品書"}</h2><a href={readerLink(event)}>回到地圖搜尋</a></section>}
          <div className={styles.grid}>{cards(projection.withCatalog, shown)}</div>
          {shown < projection.withCatalog.length && <button className={styles.more} onClick={() => setShown((n) => n + BROWSE_BATCH_SIZE)}>載入更多品書（已顯示 {Math.min(shown, projection.withCatalog.length)}／{projection.withCatalog.length}）</button>}
          {projection.withoutCatalog.length > 0 && <section id="without-catalog" className={styles.without}><h2>{projection.withCatalog.length ? "另有 " : ""}{projection.withoutCatalog.length} 個社團符合條件，但沒有提供品書</h2>
            <div className={styles.textList}>{cards(projection.withoutCatalog, textShown)}</div>
            {textShown < projection.withoutCatalog.length && <button className={styles.more} onClick={() => setTextShown((n) => n + BROWSE_BATCH_SIZE)}>載入更多社團</button>}
          </section>}
        </>}
      </>}
    </main>
    {/* Phones: the same bottom navigation as the map. 探索 returns to the map at rest,
        行程 opens it on today's plan, and 逛品書 again goes back to the top. */}
    <nav className={styles.mobileNav} aria-label="閱讀方式">
      <a className={tabStyles.tab} href={mapUrl.toString()} onClick={(pressed) => {
        if (!ordinaryLinkClick(pressed)) return;
        pressed.preventDefault(); savePosition(); navigateReader(mapUrl);
      }}><UiIcon name="search" /><span>探索</span></a>
      <a className={tabStyles.tab} href={mapUrl.toString()} onClick={(pressed) => {
        if (!ordinaryLinkClick(pressed)) return;
        pressed.preventDefault(); savePosition(); openMapOnPlan(mapUrl);
      }}><UiIcon name="check-square" /><span>行程</span></a>
      <a className={tabStyles.tab} href={key} aria-current="page" onClick={(pressed) => {
        if (!ordinaryLinkClick(pressed)) return;
        pressed.preventDefault(); window.scrollTo({ top: 0 });
      }}><UiIcon name="book" /><span>逛品書</span></a>
    </nav>
    {planning.favoriteUndo && <div className={styles.undo} role="status"><span>已取消收藏「{planning.favoriteUndo.circleName}」</span><button onClick={() => {
      const undo = planning.favoriteUndo;
      if (undo) planning.update((current) => restoreFavorite(current, undo.favorite));
      planning.setFavoriteUndo(null);
    }}>復原收藏</button><button aria-label="關閉收藏復原提示" onClick={() => planning.setFavoriteUndo(null)}><UiIcon name="close" /></button></div>}
  </div>;
}

function BrowseCard({ event, card, favorite, writable, onFavorite, beforeNavigate }: {
  event: EventDefinition; card: CatalogBrowseCard; favorite: boolean; writable: boolean; onFavorite: () => void; beforeNavigate: () => void;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const preview = card.catalog[0];
  const size = preview?.width && preview.height ? catalogPreviewSize(preview.width, preview.height) : undefined;
  const href = circlePath(event.id, card.circle.id);
  return <article className={styles.card} data-circle-id={card.circle.id}>
    {preview && <a className={styles.preview} href={href} onClick={beforeNavigate} aria-label={`查看 ${card.circle.name} 的完整品書與出展頁`}>
      {preview.previewUrl && failedImage !== preview.previewUrl ? <img src={preview.previewUrl} alt={`${card.circle.name} 品書預覽`} width={size?.width} height={size?.height} loading="lazy" decoding="async" onError={() => setFailedImage(preview.previewUrl!)} /> : <span>品書預覽暫時無法顯示，查看出展頁</span>}
    </a>}
    <div className={styles.cardBody}>
      {preview && <small className={styles.pages}>共 {card.catalog.length} 張 · 由社團填寫</small>}
      <div className={styles.cardTitle}><h3><a href={href} onClick={beforeNavigate}>{card.circle.name}</a></h3><button aria-label={`${favorite ? "取消收藏" : "收藏"} ${card.circle.name}`} aria-pressed={favorite} disabled={!writable} onClick={onFavorite}><UiIcon name="heart" /><span>{favorite ? "已收藏" : "收藏"}</span></button></div>
      {(card.circle.referencedWorks.length > 0 || card.circle.ageRatings.length > 0) && <div className={styles.tags}>{card.circle.referencedWorks.map((topic) => <span key={topic}>{topic}</span>)}{card.circle.ageRatings.map((rating) => <span key={rating} className={styles.rating}>{rating}</span>)}</div>}
      <ul className={styles.placements} aria-label="參展攤位">{card.placements.map((record) => {
        const date = eventDayCalendarDate(event, record.day);
        const when = date ? shortDate(date) : event.days.find((day) => String(day.id) === String(record.day))?.dateLabel ?? String(record.day);
        const space = venueAssignmentForArea(event, record.hall);
        const label = `${when} ${record.code}`;
        return <li key={record.recordId}>{record.placement.status === "active"
          ? <a href={readerLink(event, record.placement)} onClick={(pressed) => { beforeNavigate(); if (ordinaryLinkClick(pressed)) { pressed.preventDefault(); navigateReader(new URL(pressed.currentTarget.href)); } }}><b>{label}</b><small>{event.venueAssignments.length > 1 ? `${space.venueName} · ${space.venueSpaceName} · ` : ""}在地圖查看</small></a>
          : <span><b>{label}</b><small>{placementStatusLabel(record.placement.status)}</small></span>}</li>;
      })}</ul>
    </div>
  </article>;
}
