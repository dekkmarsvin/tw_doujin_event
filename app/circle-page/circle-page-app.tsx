"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createCatalogPublication } from "../catalog-publication";
import { CIRCLE_PAGE_ACTIONS_ID, CIRCLE_PAGE_PLAN_DAY_ATTRIBUTE } from "../circle-page-data";
import { CIRCLE_OVERRIDE_LIST_FIELDS } from "../circle-overrides";
import { LINK_KIND_LABEL, sourceDateLabel } from "../circle-presentation";
import { representativeMedia, type CircleCatalogPayload } from "../circle-records";
import { visitableDays } from "../circle-share";
import { getEventDefinition } from "../event-catalog";
import {
  addToVisitPlan, removeFromVisitPlan, restoreFavorite, toggleFavorite, type EventDayKey, type FavoriteRecord,
} from "../planning-store";
import { loadStaticCircleOverrides } from "../static-circle-overrides-client";
import { UiIcon } from "../ui-icons";
import { usePlanning } from "../use-planning";
import styles from "./circle-page.module.css";

/** Same windows as the reader: a plan change is announced, an unfavourite can be undone. */
const NOTICE_MS = 4000;
const UNDO_MS = 7000;
/** The measured height of the favourite and share bar; the stylesheet reserves it on a phone. */
const ACTION_BAR_HEIGHT = "--circle-action-bar-height";

/**
 * A circle's introduction page, once its script runs.
 *
 * The static HTML already names the circle and lists every placement, so this
 * only adds what cannot be static: the circle's own content, which can be
 * withdrawn at any time and so is read live, and the reader's planning
 * actions. Both go through the reader's own seams — the publication module
 * projects the overlay exactly as the map does, and the planning store is the
 * one the map reads — so nothing here is a second copy of either.
 */
export default function CirclePageApp({ data }: { data: CircleCatalogPayload }) {
  const eventId = data.eventId;
  const circleId = data.circles[0].id;
  const event = getEventDefinition(eventId);
  // The page's own slice is the base; only the overlay goes to the network.
  const [publication] = useState(() => createCatalogPublication({
    loadBase: async () => ({ payload: data, cacheControl: null, etag: null }),
    loadOverlay: loadStaticCircleOverrides,
  }));
  useEffect(() => { void publication.load(eventId); }, [eventId, publication]);
  const subscribe = useCallback((listener: () => void) => publication.subscribe(eventId, listener), [eventId, publication]);
  const snapshot = useCallback(() => publication.getSnapshot(eventId), [eventId, publication]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const planning = usePlanning(eventId, state.status === "ready");

  const records = state.catalog.recordsByCircleId.get(circleId);
  const circle = records?.[0]?.circle;
  const days = useMemo(() => event && records ? visitableDays(event, records.map((record) => record.placement)) : [], [event, records]);

  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<FavoriteRecord | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), NOTICE_MS);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    if (!undo) return;
    const timeout = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(timeout);
  }, [undo]);

  // The places the static page left for the actions: one bar under the name,
  // and one slot on the first card of each day the circle can be visited.
  const [targets] = useState(() => ({
    bar: document.getElementById(CIRCLE_PAGE_ACTIONS_ID),
    days: [...document.querySelectorAll<HTMLElement>(`[${CIRCLE_PAGE_PLAN_DAY_ATTRIBUTE}]`)]
      .map((element) => ({ element, key: element.getAttribute(CIRCLE_PAGE_PLAN_DAY_ATTRIBUTE) ?? "" })),
  }));

  // On a phone the bar is pinned over the page, and its height is not fixed:
  // an error, an undo line or enlarged text all make it taller. The page keeps
  // exactly that much room below its last line, so nothing ends up under it.
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!bar) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty(ACTION_BAR_HEIGHT, `${Math.ceil(bar.getBoundingClientRect().height)}px`));
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty(ACTION_BAR_HEIGHT);
    };
  }, [bar]);

  if (!event) return null;
  const favorite = planning.document.favorites.find((item) => item.eventId === eventId && item.circleId === circleId) ?? null;
  const planned = (day: EventDayKey) => planning.document.visitPlans.some((item) => item.eventId === eventId && item.day === day && item.circleId === circleId);
  const writable = planning.ready && planning.unsupportedRaw === null;

  const toggleFavoriteHere = () => {
    planning.update((current) => toggleFavorite(current, eventId, circleId));
    setUndo(favorite);
    setNotice(favorite ? "" : "已收藏。");
  };
  const togglePlan = (day: EventDayKey, label: string) => {
    const wasPlanned = planned(day);
    planning.update((current) => wasPlanned ? removeFromVisitPlan(current, eventId, day, circleId) : addToVisitPlan(current, eventId, day, circleId));
    setUndo(null);
    setNotice(wasPlanned ? `已從 ${label}行程移除。` : `已加入 ${label}行程。`);
  };
  // The page's own address, as the reader has it: this origin, no query.
  const share = () => {
    const url = `${window.location.origin}${window.location.pathname}`;
    const copy = () => Promise.resolve().then(() => navigator.clipboard.writeText(url))
      .then(() => setNotice("已複製連結。"), () => setNotice("無法自動複製，請從網址列複製。"));
    setUndo(null);
    if (typeof navigator.share === "function") {
      void navigator.share({ title: document.title, url })
        // Closing the share sheet is a choice, not a failure.
        .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) void copy(); });
    } else void copy();
  };

  return <>
    {targets.bar && createPortal(<div ref={setBar} className={styles.actionBar} role="group" aria-label="收藏與分享">
      {planning.storageError && <p className={styles.error} role="alert">{planning.storageError}</p>}
      <div className={styles.feedback} role="status" aria-live="polite">
        {undo ? <><span>已取消收藏。</span><button type="button" onClick={() => {
          planning.update((current) => restoreFavorite(current, undo));
          setUndo(null);
          setNotice("已復原收藏。");
        }}>復原收藏</button></> : notice}
      </div>
      <div className={styles.barButtons}>
        <button type="button" className={favorite ? styles.saved : ""} disabled={!writable} onClick={toggleFavoriteHere}>
          <UiIcon name="heart" />{favorite ? "取消收藏" : "收藏社團"}
        </button>
        <button type="button" onClick={share}>分享</button>
      </div>
    </div>, targets.bar)}
    {targets.days.map(({ element, key }) => {
      const day = days.find((candidate) => String(candidate.day) === key);
      if (!day) return null;
      const isPlanned = planned(day.day);
      const text = isPlanned ? "從這天行程移除" : "加入這天行程";
      // The card already names the date; the accessible name says it too, so
      // the button still makes sense heard on its own.
      return createPortal(<button
        type="button" className={isPlanned ? styles.planned : styles.plan} disabled={!writable}
        aria-label={`${text}（${day.label}）`} onClick={() => togglePlan(day.day, day.label)}
      >{text}</button>, element, key);
    })}
    <CircleContent state={state} circle={circle} onRetry={() => { void publication.retry(eventId); }} />
  </>;
}

type CatalogSnapshot = ReturnType<ReturnType<typeof createCatalogPublication>["getSnapshot"]>;
type PageCircle = NonNullable<CatalogSnapshot["catalog"]["circles"][number]>;

/**
 * What the circle wrote, or why it cannot be shown. A failed read is never
 * rendered as an empty section: that would read as "this circle wrote
 * nothing", which is not what happened.
 */
function CircleContent({ state, circle, onRetry }: { state: CatalogSnapshot; circle?: PageCircle; onRetry: () => void }) {
  // Addresses whose bytes never arrived; each one fails alone.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const markBroken = (url: string) => setBroken((current) => new Set([...current, url]));
  if (state.status !== "ready" || state.overlayStatus === "idle" || state.overlayStatus === "loading") {
    return <section className={styles.content} aria-busy="true" aria-label="社團介紹">
      <span className={styles.visuallyHidden}>正在讀取社團介紹…</span>
      <div className={`${styles.card} ${styles.skeleton}`} aria-hidden="true"><span /><span /><span /></div>
    </section>;
  }
  if (state.overlayStatus === "unavailable") {
    return <section className={styles.content} aria-labelledby="circle-page-content">
      <h2 id="circle-page-content">社團介紹</h2>
      <p className={`${styles.card} ${styles.unavailable}`}>社團介紹暫時無法顯示。<button type="button" onClick={onRetry}>重新讀取</button></p>
    </section>;
  }
  const authored = circle?.sources.find((source) => source.contentType === "circle");
  if (!circle || !authored) return null;

  const picture = representativeMedia(circle.media);
  const pages = circle.media.filter((item) => item.kind === "catalog");
  // One value reads as text; a list reads as tags. Labels are the editor's own,
  // so an author finds each answer under the name they filled it in under.
  const details = [
    { label: "筆名", values: circle.pen ? [circle.pen] : [], list: false },
    { label: "社團主題", values: circle.circleCategory ? [circle.circleCategory] : [], list: false },
    ...CIRCLE_OVERRIDE_LIST_FIELDS.map(({ key, label }) => ({ label, values: circle[key], list: true })),
  ].filter(({ values }) => values.length > 0);
  if (!picture && pages.length === 0 && !circle.saleInfo && details.length === 0 && circle.externalLinks.length === 0) return null;

  // Each kind of content is its own card; the sale sheet and the links run
  // the full width, the shorter cards pair up where there is room.
  return <section className={styles.content} aria-labelledby="circle-page-content">
    <h2 id="circle-page-content">社團介紹</h2>
    <div className={styles.cards}>
      {/* The sale sheet first: it is what a shared link is opened for. Each
          page is shown whole at up to its own size — the page itself can be
          zoomed — and its size is reserved before it arrives. */}
      {pages.length > 0 && <div className={`${styles.card} ${styles.wide}`}>
        <h3>本次品書</h3>
        <ol className={styles.catalog}>
          {pages.map((page, index) => <li key={page.id}>
            {broken.has(page.url)
              ? <p className={styles.muted}>第 {index + 1} 張品書暫時無法顯示。</p>
              : <figure className={styles.page}>
                <img
                  src={page.url} alt={page.alt} width={page.width} height={page.height}
                  loading={index === 0 ? undefined : "lazy"} referrerPolicy="no-referrer" onError={() => markBroken(page.url)}
                />
                <figcaption><a href={page.url} target="_blank" rel="noreferrer">開啟原圖</a></figcaption>
              </figure>}
          </li>)}
        </ol>
      </div>}
      {circle.saleInfo && <div className={styles.card}>
        <h3>販售資訊</h3>
        <p className={styles.saleInfo}>{circle.saleInfo}</p>
      </div>}
      {details.length > 0 && <div className={styles.card}>
        <h3>作者與作品</h3>
        <dl className={styles.details}>
          {details.map(({ label, values, list }) => <div key={label}>
            <dt>{label}</dt>
            <dd>{list ? values.map((value) => <span key={value} className={styles.tag}>{value}</span>) : values[0]}</dd>
          </div>)}
        </dl>
      </div>}
      {picture && <div className={styles.card}>
        <h3>代表圖</h3>
        {broken.has(picture.url)
          ? <p className={styles.muted}>圖片暫時無法顯示。</p>
          : <figure className={styles.picture}>
            <img src={picture.url} alt={picture.alt} referrerPolicy="no-referrer" onError={() => markBroken(picture.url)} />
            {/* Provenance is optional on a circle's own upload (ADR-0053): a
                link when there is one, the credit alone when not, nothing otherwise. */}
            {picture.sourceUrl
              ? <figcaption><a href={picture.sourceUrl} target="_blank" rel="noreferrer">{picture.provider ? `${picture.provider} · ` : ""}原始來源</a></figcaption>
              : picture.provider ? <figcaption>{picture.provider}</figcaption> : null}
          </figure>}
      </div>}
      {circle.externalLinks.length > 0 && <div className={`${styles.card} ${styles.wide}`}>
        <h3>更多資訊</h3>
        <ul className={styles.links}>
          {circle.externalLinks.map((link) => <li key={`${link.kind}-${link.provider}-${link.url}`}>
            <a href={link.url} target="_blank" rel="noreferrer"><span>{link.provider}</span><small>{LINK_KIND_LABEL[link.kind]}</small><UiIcon name="external" /></a>
          </li>)}
        </ul>
      </div>}
    </div>
    <p className={styles.source}>{authored.provider} · {sourceDateLabel(authored)}</p>
  </section>;
}
