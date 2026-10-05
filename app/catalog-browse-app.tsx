import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EventDefinition } from "./event-catalog";
import { venueAssignmentForArea } from "./event-catalog";
import { dayDateLabel, eventCalendar, eventDayCalendarDate, shortDate } from "./event-calendar";
import { placementStatusLabel } from "./circle-records";
import { DEFAULT_ADVANCED_CIRCLE_SEARCH, normalizeWorkTopics } from "./circle-search";
import { circleOptionLabel } from "./circle-overrides";
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
import { PUBLIC_HEADER_MESSAGES, publicLoginHref } from "./public-header";
import { localizedHref } from "./i18n/locale";
import { LanguageSwitcher } from "./i18n/language-switcher";
import { useDocumentLanguage, useLocale, useMessages } from "./i18n/locale-context";
import { CATALOG_BROWSE_MESSAGES } from "./catalog-browse-app.messages";
import { UiIcon } from "./ui-icons";
import { sharePublicContent } from "./public-share";
import type { PublicFilterDescriptor } from "./public-circle-search";
import styles from "./catalog-browse-app.module.css";

export default function CatalogBrowseApp({ event, onChooseEvent }: { event: EventDefinition; onChooseEvent?: () => void }) {
  const publication = useCircleCatalog(event.id);
  const planning = useReaderPlanning();
  const { locale } = useLocale();
  const t = useMessages(CATALOG_BROWSE_MESSAGES);
  const header = useMessages(PUBLIC_HEADER_MESSAGES);
  useDocumentLanguage();
  const [state, setState] = useState(() => parseCatalogBrowseUrl(event, new URL(window.location.href)));
  const [initial] = useState(() => readBrowseHistory(window.history.state, window.location.href));
  const [shown, setShown] = useState(initial.shown);
  const [textShown, setTextShown] = useState(initial.textShown);
  const [restoration, setRestoration] = useState({ y: initial.y });
  const restoring = useRef(true);
  const [restored, setRestored] = useState<object | null>(null);
  const [moreText, setMoreText] = useState<HTMLButtonElement | null>(null);
  const [moreTopics, setMoreTopics] = useState(false);
  const [notice, setNotice] = useState("");
  const [manualShare, setManualShare] = useState("");
  const url = catalogBrowseUrl(event, state, window.location.origin, locale);
  const key = url.toString();
  const mapUrl = useMemo(() => switchReaderViewUrl(event, new URL(key)), [event, key]);
  const ready = publication.status === "ready" && publication.overlayStatus === "applied";
  const projection = useMemo(() => projectCatalogBrowse(event, publication.catalog.records, state, locale), [event, publication.catalog, state, locale]);
  const savePosition = useCallback(() => {
    if (!restoring.current) saveBrowseHistory({ key, shown, textShown, y: window.scrollY });
  }, [key, shown, textShown]);

  useEffect(() => {
    const metadata = pageMetadata(event, undefined, [], locale);
    applyReaderMetadata({ ...metadata, title: t("metaTitle", { name: event.name }), description: t("metaDescription", { name: event.name }) });
  }, [event, locale, t]);
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
    if (!ready || restored === restoration) return;
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
        window.scrollTo(0, restoration.y);
        setRestored(restoration);
        restoring.current = false;
        savePosition();
      });
    });
    return () => { window.cancelAnimationFrame(first); window.cancelAnimationFrame(second); };
  }, [ready, restored, restoration, savePosition]);
  useEffect(() => {
    // Reaching the end of the circles without a sheet loads their next batch.
    // They carry no pictures, so sheet cards keep their explicit button
    // (ADR-0075). Waiting for the scroll to be restored keeps a new search at
    // its first batch.
    if (!moreText || restored !== restoration || typeof IntersectionObserver === "undefined") return;
    // A new observer reports at once, so a screen taller than one batch
    // keeps filling until the button is out of reach.
    const observer = new IntersectionObserver(([entry]) => {
      // Keyboard focus in the list is a reader tabbing toward the button;
      // loading ahead of it would push the button, and whatever follows the
      // list, one batch further away on every Tab.
      const focused = document.activeElement;
      if (focused && moreText.parentElement?.contains(focused) && focused.matches(":focus-visible")) return;
      if (entry?.isIntersecting) setTextShown((n) => n + BROWSE_BATCH_SIZE);
    }, { rootMargin: "0px 0px 240px 0px" });
    observer.observe(moreText);
    return () => observer.disconnect();
  }, [moreText, restored, restoration, textShown]);
  useEffect(() => {
    // Scroll events and automatic batches can exhaust WebKit's history quota.
    // Save after scrolling settles; explicit navigation still saves immediately.
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(savePosition, 500);
    };
    const flush = () => { window.clearTimeout(timer); savePosition(); };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("pagehide", flush);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("pagehide", flush);
    };
  }, [savePosition]);
  const change = (next: CatalogBrowseState, replace = false) => {
    savePosition();
    const nextUrl = catalogBrowseUrl(event, next, window.location.origin, locale);
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
    const condition = [state.query.trim(), ...projection.filters.map((filter) => filter.label)].filter(Boolean).join(t("listSeparator"));
    const text = condition ? t("shareTextFiltered", { name: event.name, condition }) : t("shareText", { name: event.name });
    const result = await sharePublicContent({ title: t("shareTitle", { name: event.name }), text, url: key });
    setNotice(result === "copied" ? t("copied") : "");
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
      <div className={styles.identity}><div className={`brand ${styles.brand}`}><span aria-hidden="true">場</span>場刊 Map</div>{/* As on the map: the event name leads back to the chooser only when there is another event to choose. */}{onChooseEvent ? <a className={styles.event} href={localizedHref("/", locale)} onClick={(pressed) => { if (!ordinaryLinkClick(pressed)) return; pressed.preventDefault(); savePosition(); onChooseEvent(); }}><span>{event.name}<small>{eventCalendar(event, locale).label}</small></span><span className={styles.eventSwitch}>{t("switchEvent")}<UiIcon name="chevron-right" /></span></a> : <div className={styles.event}><span>{event.name}<small>{eventCalendar(event, locale).label}</small></span></div>}<ReaderViewTabs className={styles.viewSwitch} event={event} view="browse" url={url} beforeNavigate={savePosition} /><PlanningTools eventId={event.id} /><LanguageSwitcher className={styles.languageSwitcher} narrow /><a className={`site-header-login reader-login ${styles.readerLogin}`} href={localizedHref(publicLoginHref({ eventId: event.id }), locale)}>{header("login")}</a></div>
    </header>
    <main className={styles.main}>
      <h1 className={styles.srOnly}>{t("heading", { name: event.name })}</h1>
      <div className={styles.search}><UiIcon name="search" /><input aria-label={t("search")} placeholder={t("search")} value={state.query} onChange={(e) => change({ ...state, query: e.target.value }, true)} /></div>
      <div className={styles.scope}>
        <label><span className={styles.srOnly}>{t("eventDay")}</span><select aria-label={t("eventDay")} value={state.day === null ? "" : String(state.day)} onChange={(e) => change({ ...state, day: event.days.find((day) => String(day.id) === e.target.value)?.id ?? null })}>
          <option value="">{t("allDays")}</option>{event.days.map((day) => { const iso = locale === "zh-Hant" ? null : eventDayCalendarDate(event, day.id); return <option key={day.id} value={String(day.id)}>{iso ? dayDateLabel(iso, locale) : day.dateLabel}</option>; })}
        </select></label>
        <label><span className={styles.srOnly}>{t("venue")}</span><select aria-label={t("venue")} value={state.venueSpaceId ?? ""} onChange={(e) => change({ ...state, venueSpaceId: e.target.value || null })}>
          <option value="">{t("allVenues")}</option>{event.venueAssignments.map((space) => <option key={space.venueSpaceId} value={space.venueSpaceId}>{space.venueName} · {space.venueSpaceName}</option>)}
        </select></label>
        <AdvancedCircleSearchControls value={state.advancedSearch} workSuggestions={ready ? projection.topics : []}
          categories={event.genres} category={state.genre}
          onApply={(advancedSearch, genre) => change({ ...state, advancedSearch, genre: genre ?? state.genre })} />
      </div>
      {ready && projection.topics.length > 0 && <div className={styles.topics} aria-label={t("topics")}>
        {(moreTopics ? projection.topics : projection.topics.slice(0, 2)).map((topic) => { const pressed = normalizeWorkTopics(state.advancedSearch.workTopics).includes(topic.value); return <button key={topic.value} type="button" aria-pressed={pressed} onClick={() => chooseTopic(topic.value)}>{pressed && <UiIcon name="check" />}{topic.value}<small>{topic.count}</small></button>; })}
        {projection.topics.length > 2 && <button type="button" aria-expanded={moreTopics} onClick={() => setMoreTopics(!moreTopics)}>{moreTopics ? t("lessTopics") : t("moreTopics")}</button>}
      </div>}
      {hasFilters && <div className={styles.filters} aria-label={t("appliedFilters")}>
        {state.query.trim() && <button onClick={() => change({ ...state, query: "" })}><span>{t("queryChip", { query: state.query })}</span><UiIcon name="close" /></button>}
        {projection.filters.map((filter) => <button key={filter.id} onClick={() => removeFilter(filter)} aria-label={t("removeFilter", { label: filter.label })}><span>{filter.label}</span><UiIcon name="close" /></button>)}
        <button onClick={() => change({ ...state, query: "", genre: event.genres[0], advancedSearch: DEFAULT_ADVANCED_CIRCLE_SEARCH })}>{t("clearAll")}</button>
      </div>}
      {planning.storageError && <p className={styles.error} role="alert">{planning.storageError}</p>}
      <div className={styles.resultHeader}>
        <div aria-live="polite">{ready ? <><h2>{t("withCatalog", { count: projection.withCatalog.length })}</h2><span>{t("matching", { circles: projection.circleCount, placements: projection.placementCount })}</span></> : !failed && <span>{t("loadingCircles")}</span>}</div>
        {ready && <button type="button" onClick={() => void share()}>{t("share")}</button>}
      </div>
      {notice && <p role="status">{notice}</p>}
      {manualShare && <label className={styles.manualShare}>{t("copyManually")}<textarea readOnly value={manualShare} onFocus={(e) => e.target.select()} /><small>{t("liveResults")}</small></label>}
      {!ready && !failed && <div className={styles.grid} aria-label={t("loadingCatalogs")} aria-busy="true">{[0, 1, 2].map((n) => <div key={n} className={styles.skeleton} />)}</div>}
      {failed && <section className={styles.empty} role="status"><h2>{publication.status === "error" ? t("eventDataFailed") : t("circleDataFailed")}</h2><button onClick={() => void publication.retry()}>{t("retry")}</button><a href={localizedHref(readerLink(event), locale)}>{t("backToMap")}</a></section>}
      {ready && <>
        {projection.circleCount === 0 ? <section className={styles.empty}><h2>{t("noMatch")}</h2><p>{t("noMatchHint")}</p></section> : <>
          {projection.withCatalog.length === 0 && <section className={styles.empty}><h2>{hasFilters ? t("noCatalogFiltered") : allScope ? t("noCatalogEvent") : t("noCatalogScope")}</h2><a href={localizedHref(readerLink(event), locale)}>{t("backToMap")}</a></section>}
          <div className={styles.grid}>{cards(projection.withCatalog, shown)}</div>
          {shown < projection.withCatalog.length && <button className={styles.more} onClick={() => setShown((n) => n + BROWSE_BATCH_SIZE)}>{t("moreCatalogs", { shown: Math.min(shown, projection.withCatalog.length), total: projection.withCatalog.length })}</button>}
          {projection.withoutCatalog.length > 0 && <section id="without-catalog" className={styles.without}><h2>{t(projection.withCatalog.length ? "withoutCatalogMore" : "withoutCatalog", { count: projection.withoutCatalog.length })}</h2>
            <div className={styles.textList}>{cards(projection.withoutCatalog, textShown)}</div>
            {textShown < projection.withoutCatalog.length && <button ref={setMoreText} className={styles.more} onClick={() => setTextShown((n) => n + BROWSE_BATCH_SIZE)}>{t("moreCircles")}</button>}
          </section>}
        </>}
      </>}
    </main>
    {/* Phones: the same bottom navigation as the map. 探索 returns to the map at rest,
        行程 opens it on today's plan, and 逛品書 again goes back to the top. */}
    <nav className={styles.mobileNav} aria-label={t("readingMode")}>
      <a className={tabStyles.tab} href={mapUrl.toString()} onClick={(pressed) => {
        if (!ordinaryLinkClick(pressed)) return;
        pressed.preventDefault(); savePosition(); navigateReader(mapUrl);
      }}><UiIcon name="search" /><span>{t("explore")}</span></a>
      <a className={tabStyles.tab} href={mapUrl.toString()} onClick={(pressed) => {
        if (!ordinaryLinkClick(pressed)) return;
        pressed.preventDefault(); savePosition(); openMapOnPlan(mapUrl);
      }}><UiIcon name="check-square" /><span>{t("plan")}</span></a>
      <a className={tabStyles.tab} href={key} aria-current="page" onClick={(pressed) => {
        if (!ordinaryLinkClick(pressed)) return;
        pressed.preventDefault(); window.scrollTo({ top: 0 });
      }}><UiIcon name="book" /><span>{t("browseTab")}</span></a>
    </nav>
    {planning.favoriteUndo && <div className={styles.undo} role="status"><span>{t("unfavorited", { name: planning.favoriteUndo.circleName })}</span><button onClick={() => {
      const undo = planning.favoriteUndo;
      if (undo) planning.update((current) => restoreFavorite(current, undo.favorite));
      planning.setFavoriteUndo(null);
    }}>{t("restoreFavorite")}</button><button aria-label={t("closeUndo")} onClick={() => planning.setFavoriteUndo(null)}><UiIcon name="close" /></button></div>}
  </div>;
}

function BrowseCard({ event, card, favorite, writable, onFavorite, beforeNavigate }: {
  event: EventDefinition; card: CatalogBrowseCard; favorite: boolean; writable: boolean; onFavorite: () => void; beforeNavigate: () => void;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const { locale } = useLocale();
  const t = useMessages(CATALOG_BROWSE_MESSAGES);
  const preview = card.catalog[0];
  const size = preview?.width && preview.height ? catalogPreviewSize(preview.width, preview.height) : undefined;
  const href = localizedHref(circlePath(event.id, card.circle.id), locale);
  return <article className={styles.card} data-circle-id={card.circle.id}>
    {preview && <a className={styles.preview} href={href} onClick={beforeNavigate} aria-label={t("openCirclePage", { name: card.circle.name })}>
      {preview.previewUrl && failedImage !== preview.previewUrl ? <img src={preview.previewUrl} alt={t("previewAlt", { name: card.circle.name })} width={size?.width} height={size?.height} loading="lazy" decoding="async" onError={() => setFailedImage(preview.previewUrl!)} /> : <span>{t("previewFailed")}</span>}
    </a>}
    <div className={styles.cardBody}>
      {preview && <small className={styles.pages}>{t("pages", { count: card.catalog.length })}</small>}
      <div className={styles.cardTitle}><h3><a href={href} onClick={beforeNavigate}>{card.circle.name}</a></h3><button aria-label={t(favorite ? "unfavoriteNamed" : "favoriteNamed", { name: card.circle.name })} aria-pressed={favorite} disabled={!writable} onClick={onFavorite}><UiIcon name="heart" /><span>{favorite ? t("favorited") : t("favorite")}</span></button></div>
      {(card.circle.referencedWorks.length > 0 || card.circle.ageRatings.length > 0) && <div className={styles.tags}>{card.circle.referencedWorks.map((topic) => <span key={topic}>{topic}</span>)}{card.circle.ageRatings.map((rating) => <span key={rating} className={styles.rating}>{circleOptionLabel(rating, locale)}</span>)}</div>}
      <ul className={styles.placements} aria-label={t("booths")}>{card.placements.map((record) => {
        const date = eventDayCalendarDate(event, record.day);
        const when = date ? shortDate(date, locale) : event.days.find((day) => String(day.id) === String(record.day))?.dateLabel ?? String(record.day);
        const space = venueAssignmentForArea(event, record.hall);
        const label = `${when} ${record.code}`;
        return <li key={record.recordId}>{record.placement.status === "active"
          ? <a href={localizedHref(readerLink(event, record.placement), locale)} onClick={(pressed) => { beforeNavigate(); if (ordinaryLinkClick(pressed)) { pressed.preventDefault(); navigateReader(new URL(pressed.currentTarget.href)); } }}><b>{label}</b><small>{event.venueAssignments.length > 1 ? `${space.venueName} · ${space.venueSpaceName} · ` : ""}{t("viewOnMap")}</small></a>
          : <span><b>{label}</b><small>{placementStatusLabel(record.placement.status, locale)}</small></span>}</li>;
      })}</ul>
    </div>
  </article>;
}
