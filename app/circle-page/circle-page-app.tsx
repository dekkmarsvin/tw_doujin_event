"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createCatalogPublication } from "../catalog-publication";
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

  return <>
    <CircleContent state={state} circle={circle} onRetry={() => { void publication.retry(eventId); }} />
    <section className={styles.planning} aria-labelledby="circle-page-planning">
      <h2 id="circle-page-planning">收藏與行程</h2>
      {planning.storageError && <p className={styles.error} role="alert">{planning.storageError}</p>}
      <div className={styles.actions}>
        <button type="button" className={favorite ? styles.saved : ""} disabled={!writable} onClick={toggleFavoriteHere}>
          <UiIcon name="heart" />{favorite ? "取消收藏" : "收藏社團"}
        </button>
        {days.map(({ day, label }) => <button key={String(day)} type="button" className={planned(day) ? styles.planned : ""} disabled={!writable} onClick={() => togglePlan(day, label)}>
          {planned(day) ? `從 ${label}行程移除` : `加入 ${label}行程`}
        </button>)}
        {state.status === "ready" && days.length === 0 && <button type="button" disabled>加入行程</button>}
      </div>
      {state.status === "ready" && days.length === 0 && <p className={styles.muted}>這個社團目前沒有可前往的攤位。</p>}
      <div className={styles.feedback} role="status" aria-live="polite">
        {undo ? <><span>已取消收藏。</span><button type="button" onClick={() => {
          planning.update((current) => restoreFavorite(current, undo));
          setUndo(null);
          setNotice("已復原收藏。");
        }}>復原收藏</button></> : notice}
      </div>
    </section>
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
      <div className={styles.skeleton} aria-hidden="true"><span /><span /><span /></div>
    </section>;
  }
  if (state.overlayStatus === "unavailable") {
    return <section className={styles.content} aria-labelledby="circle-page-content">
      <h2 id="circle-page-content">社團介紹</h2>
      <p className={styles.unavailable}>社團介紹暫時無法顯示。<button type="button" onClick={onRetry}>重新讀取</button></p>
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

  return <section className={styles.content} aria-labelledby="circle-page-content">
    <h2 id="circle-page-content">社團介紹</h2>
    {/* The sale sheet first: it is what a shared link is opened for. Each page
        is shown whole at up to its own size — the page itself can be zoomed —
        and its size is reserved before it arrives. */}
    {pages.length > 0 && <>
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
    </>}
    {picture && (broken.has(picture.url)
      ? <p className={styles.muted}>圖片暫時無法顯示。</p>
      : <figure className={styles.picture}>
        <img src={picture.url} alt={picture.alt} referrerPolicy="no-referrer" onError={() => markBroken(picture.url)} />
        {/* Provenance is optional on a circle's own upload (ADR-0053): a link
            when there is one, the credit alone when not, nothing otherwise. */}
        {picture.sourceUrl
          ? <figcaption><a href={picture.sourceUrl} target="_blank" rel="noreferrer">{picture.provider ? `${picture.provider} · ` : ""}原始來源</a></figcaption>
          : picture.provider ? <figcaption>{picture.provider}</figcaption> : null}
      </figure>)}
    {circle.saleInfo && <>
      <h3>販售資訊</h3>
      <p className={styles.saleInfo}>{circle.saleInfo}</p>
    </>}
    {details.length > 0 && <dl className={styles.details}>
      {details.map(({ label, values, list }) => <div key={label}>
        <dt>{label}</dt>
        <dd>{list ? values.map((value) => <span key={value} className={styles.tag}>{value}</span>) : values[0]}</dd>
      </div>)}
    </dl>}
    {circle.externalLinks.length > 0 && <>
      <h3>更多資訊</h3>
      <ul className={styles.links}>
        {circle.externalLinks.map((link) => <li key={`${link.kind}-${link.provider}-${link.url}`}>
          <a href={link.url} target="_blank" rel="noreferrer"><span>{link.provider}</span><small>{LINK_KIND_LABEL[link.kind]}</small><UiIcon name="external" /></a>
        </li>)}
      </ul>
    </>}
    <p className={styles.source}>{authored.provider} · {sourceDateLabel(authored)}</p>
  </section>;
}
