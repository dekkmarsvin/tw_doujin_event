"use client";
import { sharePublicContent } from "../public-share";
import { localizedHref } from "../i18n/locale";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createCatalogPublication } from "../catalog-publication";
import { CIRCLE_PAGE_ACTIONS_ID, CIRCLE_PAGE_PLAN_DAY_ATTRIBUTE } from "../circle-page-data";
import { CIRCLE_OVERRIDE_LIST_FIELDS } from "../circle-overrides";
import { linkKindLabel, sourceDateLabel } from "../circle-presentation";
import { mediaAltLabel, representativeMedia, sourceProviderLabel, type CircleCatalogPayload } from "../circle-records";
import { circleOptionLabel } from "../circle-overrides";
import { dayDateLabel } from "../event-calendar";
import { useLocale, useMessages } from "../i18n/locale-context";
import { defineMessages } from "../i18n/messages";
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

const MESSAGES = defineMessages({
  "zh-Hant": {
    favorited: "已收藏。", planRemoved: "已從 {day}行程移除。", planAdded: "已加入 {day}行程。", copied: "已複製連結。", copyManually: "無法自動複製，請從網址列複製。",
    actions: "收藏與分享", unfavorited: "已取消收藏。", restored: "已復原收藏。", restore: "復原收藏", unfavorite: "取消收藏", favorite: "收藏社團", share: "分享",
    removeDay: "從這天行程移除", addDay: "加入這天行程", dayAction: "{action}（{day}）",
    content: "社團介紹", loading: "正在讀取社團介紹…", unavailable: "社團介紹暫時無法顯示。", retry: "重新讀取",
    pen: "筆名", category: "社團主題", referencedWorks: "作品／題材", creatorTypes: "創作內容", workTypes: "作品取向", ageRatings: "年齡分級", specialTags: "內容標籤",
    openOriginal: "開啟原圖：{alt}", sale: "販售資訊", details: "作者與作品", picture: "代表圖", pictureFailed: "圖片暫時無法顯示。", source: "原始來源",
    catalog: "本次品書", pageFailed: "第 {index} 張品書暫時無法顯示。", more: "更多資訊",
  },
  en: {
    favorited: "Saved to favorites.", planRemoved: "Removed from the {day} plan.", planAdded: "Added to the {day} plan.", copied: "Link copied.", copyManually: "Couldn’t copy automatically — copy it from the address bar.",
    actions: "Favorite and share", unfavorited: "Removed from favorites.", restored: "Favorite restored.", restore: "Undo", unfavorite: "Remove favorite", favorite: "Favorite", share: "Share",
    removeDay: "Remove from this day’s plan", addDay: "Add to this day’s plan", dayAction: "{action} ({day})",
    content: "About this circle", loading: "Loading the circle’s details…", unavailable: "The circle’s details can’t be shown right now.", retry: "Try again",
    pen: "Pen name", category: "Circle genre", referencedWorks: "Works / topics", creatorTypes: "Creator type", workTypes: "Orientation", ageRatings: "Age rating", specialTags: "Content tags",
    openOriginal: "Open original image: {alt}", sale: "Sales info", details: "Creators and works", picture: "Featured image", pictureFailed: "The image can’t be shown right now.", source: "Original source",
    catalog: "Item list", pageFailed: "Page {index} of the item list can’t be shown right now.", more: "More info",
  },
  ja: {
    favorited: "お気に入りに追加しました。", planRemoved: "{day}のプランから外しました。", planAdded: "{day}のプランに追加しました。", copied: "リンクをコピーしました。", copyManually: "自動でコピーできませんでした。アドレスバーからコピーしてください。",
    actions: "お気に入りと共有", unfavorited: "お気に入りから外しました。", restored: "お気に入りを元に戻しました。", restore: "元に戻す", unfavorite: "お気に入りから外す", favorite: "お気に入りに追加", share: "共有",
    removeDay: "この日のプランから外す", addDay: "この日のプランに追加", dayAction: "{action}（{day}）",
    content: "サークル紹介", loading: "サークル紹介を読み込み中…", unavailable: "サークル紹介を表示できません。", retry: "再読み込み",
    pen: "ペンネーム", category: "サークルジャンル", referencedWorks: "作品・ジャンル", creatorTypes: "創作内容", workTypes: "作品の傾向", ageRatings: "年齢区分", specialTags: "内容タグ",
    openOriginal: "元の画像を開く：{alt}", sale: "頒布情報", details: "作者と作品", picture: "代表画像", pictureFailed: "画像を表示できません。", source: "元の出典",
    catalog: "今回のお品書き", pageFailed: "お品書き {index} 枚目を表示できません。", more: "その他の情報",
  },
});

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
  const { locale } = useLocale();
  const t = useMessages(MESSAGES);

  const records = state.catalog.recordsByCircleId.get(circleId);
  const circle = records?.[0]?.circle;
  const days = useMemo(() => event && records ? visitableDays(event, records.map((record) => record.placement)) : [], [event, records]);

  const [notice, setNotice] = useState<{ key: "favorited" | "restored" | "planRemoved" | "planAdded" | "copied" | "copyManually"; day?: EventDayKey } | null>(null);
  const [undo, setUndo] = useState<FavoriteRecord | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), NOTICE_MS);
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
  const noticeDay = days.find((day) => day.day === notice?.day);
  const noticeDayLabel = noticeDay ? locale === "zh-Hant" || !noticeDay.date ? noticeDay.label : dayDateLabel(noticeDay.date, locale) : "";

  const toggleFavoriteHere = () => {
    planning.update((current) => toggleFavorite(current, eventId, circleId));
    setUndo(favorite);
    setNotice(favorite ? null : { key: "favorited" });
  };
  const togglePlan = (day: EventDayKey) => {
    const wasPlanned = planned(day);
    planning.update((current) => wasPlanned ? removeFromVisitPlan(current, eventId, day, circleId) : addToVisitPlan(current, eventId, day, circleId));
    setUndo(null);
    setNotice({ key: wasPlanned ? "planRemoved" : "planAdded", day });
  };
  // Share only the public path and interface language, without other query state.
  const share = () => {
    const url = `${window.location.origin}${localizedHref(window.location.pathname, locale)}`;
    setUndo(null);
    void sharePublicContent({ title: document.title, url }).then((result) => {
      if (result === "copied") setNotice({ key: "copied" });
      if (result === "manual") setNotice({ key: "copyManually" });
    });
  };

  return <>
    {targets.bar && createPortal(<div ref={setBar} className={styles.actionBar} role="group" aria-label={t("actions")}>
      {planning.storageError && <p className={styles.error} role="alert">{planning.storageError}</p>}
      <div className={styles.feedback} role="status" aria-live="polite">
        {undo ? <><span>{t("unfavorited")}</span><button type="button" onClick={() => {
          planning.update((current) => restoreFavorite(current, undo));
          setUndo(null);
          setNotice({ key: "restored" });
        }}>{t("restore")}</button></> : notice && t(notice.key, { day: noticeDayLabel })}
      </div>
      <div className={styles.barButtons}>
        <button type="button" className={favorite ? styles.saved : ""} disabled={!writable} onClick={toggleFavoriteHere}>
          <UiIcon name="heart" />{favorite ? t("unfavorite") : t("favorite")}
        </button>
        <button type="button" onClick={share}>{t("share")}</button>
      </div>
    </div>, targets.bar)}
    {targets.days.map(({ element, key }) => {
      const day = days.find((candidate) => String(candidate.day) === key);
      if (!day) return null;
      const isPlanned = planned(day.day);
      const text = isPlanned ? t("removeDay") : t("addDay");
      const label = locale === "zh-Hant" || !day.date ? day.label : dayDateLabel(day.date, locale);
      // The card already names the date; the accessible name says it too, so
      // the button still makes sense heard on its own.
      return createPortal(<button
        type="button" className={isPlanned ? styles.planned : styles.plan} disabled={!writable}
        aria-label={t("dayAction", { action: text, day: label })} onClick={() => togglePlan(day.day)}
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
  const { locale } = useLocale();
  const t = useMessages(MESSAGES);
  // Addresses whose bytes never arrived; each one fails alone.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const markBroken = (url: string) => setBroken((current) => new Set([...current, url]));
  if (state.status !== "ready" || state.overlayStatus === "idle" || state.overlayStatus === "loading") {
    return <section className={styles.content} aria-busy="true" aria-label={t("content")}>
      <span className={styles.visuallyHidden}>{t("loading")}</span>
      <div className={`${styles.card} ${styles.skeleton}`} aria-hidden="true"><span /><span /><span /></div>
    </section>;
  }
  if (state.overlayStatus === "unavailable") {
    return <section className={styles.content} aria-labelledby="circle-page-content">
      <h2 id="circle-page-content">{t("content")}</h2>
      <p className={`${styles.card} ${styles.unavailable}`}>{t("unavailable")}<button type="button" onClick={onRetry}>{t("retry")}</button></p>
    </section>;
  }
  const authored = circle?.sources.find((source) => source.contentType === "circle");
  if (!circle || !authored) return null;

  const picture = representativeMedia(circle.media);
  const pages = circle.media.filter((item) => item.kind === "catalog");
  // One value reads as text; a list reads as tags. Labels are the editor's own,
  // so an author finds each answer under the name they filled it in under.
  const details = [
    { label: t("pen"), values: circle.pen ? [circle.pen] : [], list: false, fixed: false },
    { label: t("category"), values: circle.circleCategory ? [circle.circleCategory] : [], list: false, fixed: false },
    ...CIRCLE_OVERRIDE_LIST_FIELDS.map(({ key }) => ({ label: t(key), values: circle[key], list: true,
      fixed: key === "creatorTypes" || key === "workTypes" || key === "ageRatings" })),
  ].filter(({ values }) => values.length > 0);
  if (!picture && pages.length === 0 && !circle.saleInfo && details.length === 0 && circle.externalLinks.length === 0) return null;

  // A picture is its own way to the full-size file: tapping it opens the
  // original, where the browser can zoom. No separate link to hunt for.
  const zoomable = (media: { url: string; alt: string; kind: "thumbnail" | "catalog" }, image: ReactNode) =>
    <a className={styles.zoom} href={media.url} target="_blank" rel="noreferrer" aria-label={t("openOriginal", { alt: mediaAltLabel(media, locale) })}>{image}</a>;
  const saleCard = circle.saleInfo ? <div className={styles.card}>
    <h3>{t("sale")}</h3>
    <p className={styles.saleInfo}>{circle.saleInfo}</p>
  </div> : null;
  const detailsCard = details.length > 0 ? <div className={styles.card} key="details">
    <h3>{t("details")}</h3>
    <dl className={styles.details}>
      {details.map(({ label, values, list, fixed }) => <div key={label}>
        <dt>{label}</dt>
        <dd>{list ? values.map((value) => <span key={value} className={styles.tag}>{fixed ? circleOptionLabel(value, locale) : value}</span>) : values[0]}</dd>
      </div>)}
    </dl>
  </div> : null;
  const pictureCard = picture ? <div className={styles.card} key="picture">
    <h3>{t("picture")}</h3>
    {broken.has(picture.url)
      ? <p className={styles.muted}>{t("pictureFailed")}</p>
      : <figure className={styles.picture}>
        {zoomable(picture, <img src={picture.url} alt={mediaAltLabel(picture, locale)} referrerPolicy="no-referrer" onError={() => markBroken(picture.url)} />)}
        {/* Provenance is optional on a circle's own upload (ADR-0053): a
            link when there is one, the credit alone when not, nothing otherwise. */}
        {picture.sourceUrl
          ? <figcaption><a href={picture.sourceUrl} target="_blank" rel="noreferrer">{picture.provider ? `${picture.provider} · ` : ""}{t("source")}</a></figcaption>
          : picture.provider ? <figcaption>{picture.provider}</figcaption> : null}
      </figure>}
  </div> : null;
  const aside = [detailsCard, pictureCard].filter(Boolean);

  // The sale sheet and the links run the full width. Between them the sale
  // text is one column and the short cards stack in the other, each column as
  // tall as its own content — a short card is never stretched to match a
  // long one.
  return <section className={styles.content} aria-labelledby="circle-page-content">
    <h2 id="circle-page-content">{t("content")}</h2>
    <div className={styles.stack}>
      {/* The sale sheet first: it is what a shared link is opened for. Each
          page is shown whole at up to its own size and its size is reserved
          before it arrives. */}
      {pages.length > 0 && <div className={styles.card}>
        <h3>{t("catalog")}</h3>
        <ol className={styles.catalog}>
          {pages.map((page, index) => <li key={page.id}>
            {broken.has(page.url)
              ? <p className={styles.muted}>{t("pageFailed", { index: index + 1 })}</p>
              : zoomable(page, <img
                src={page.url} alt={mediaAltLabel(page, locale)} width={page.width} height={page.height}
                loading={index === 0 ? undefined : "lazy"} referrerPolicy="no-referrer" onError={() => markBroken(page.url)}
              />)}
          </li>)}
        </ol>
      </div>}
      {(saleCard || aside.length > 0) && <div className={styles.columns}>
        {saleCard && <div className={styles.column}>{saleCard}</div>}
        {aside.length > 0 && <div className={styles.column}>{aside}</div>}
      </div>}
      {circle.externalLinks.length > 0 && <div className={styles.card}>
        <h3>{t("more")}</h3>
        <ul className={styles.links}>
          {circle.externalLinks.map((link) => <li key={`${link.kind}-${link.provider}-${link.url}`}>
            <a href={link.url} target="_blank" rel="noreferrer"><span>{link.provider}</span><small>{linkKindLabel(link.kind, locale)}</small><UiIcon name="external" /></a>
          </li>)}
        </ul>
      </div>}
    </div>
    <p className={styles.source}>{sourceProviderLabel(authored, locale)} · {sourceDateLabel(authored, locale)}</p>
  </section>;
}
