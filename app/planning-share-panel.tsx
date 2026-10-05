"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getCircleCatalog } from "./circle-records";
import { dayDateLabel, eventDayCalendarDate } from "./event-calendar";
import { PUBLISHED_EVENTS } from "./event-catalog";
import type { ApiFailure } from "./i18n/api-error";
import { localizedHref, type Locale } from "./i18n/locale";
import { useLocale, useMessages } from "./i18n/locale-context";
import { defineMessages } from "./i18n/messages";
import type { EventDayKey, PlanningDocument } from "./planning-store";
import { addSharedToPlan, projectSharedItinerary, resolveSharedList, SHARE_MAX_ITEMS, type ShareSnapshot } from "./planning-share";
import { createShortLink, readShortLink, shareFailureMessage } from "./planning-share-client";
import { sharePublicContent } from "./public-share";
import { useCircleCatalog } from "./use-circle-catalog";
import { useModalFocus } from "./use-modal-focus";
import { UiIcon } from "./ui-icons";
import styles from "./planning-tools.module.css";

const MESSAGES = defineMessages({
  "zh-Hant": {
    close: "關閉{title}",
    qr: "短網址 QR Code",
    shareTitle: "{name} 逛攤清單",
    copied: "已複製連結。",
    manual: "請手動複製上方連結。",
    shareDialog: "分享行程",
    shareIntro: "建立短網址，傳到自己的手機或分享給朋友。只包含攤位與日期，不含備註、群組、購買項目與預算；連結可被轉傳，活動結束 30 天後失效。",
    nothingToShare: "這場活動還沒有行程可以分享。",
    willShare: "將分享 {count} 個",
    tooMany: "一次最多分享 {max} 個，請取消勾選 {over} 個。",
    creating: "建立中…",
    create: "建立短網址",
    shortLink: "短網址",
    copyOrShare: "複製或分享",
    sharedDialog: "分享的行程",
    loading: "正在讀取分享的行程…",
    missing: "這個分享連結不存在或已過期。",
    browseEvents: "查看場刊 Map 的活動",
    expired: "這個分享連結已過期。",
    viewEvent: "查看 {name}",
    eventNotPublic: "這份行程的活動目前沒有公開。",
    otherEvent: "這份行程是「{name}」的攤位。",
    openOtherEvent: "到 {name} 查看",
    previewNote: "先看看再決定；按下加入前不會改動你的行程。",
    catalogLoading: "正在讀取活動資料…",
    catalogFailed: "活動資料讀取失敗，暫時無法核對這份行程。",
    moved: "已改到 {days}，不會加入",
    withdrawn: "已取消參加，不會加入",
    notFound: "目前找不到這個社團，不會加入",
    addToPlan: "加入我的行程",
    blocked: "這台裝置有無法讀取的舊資料，請先在「資料管理」處理。",
  },
  en: {
    close: "Close {title}",
    qr: "Short link QR code",
    shareTitle: "{name} booth list",
    copied: "Link copied.",
    manual: "Copy the link above manually.",
    shareDialog: "Share plan",
    shareIntro: "Create a short link to send to your phone or share with friends. It includes only booths and dates, not notes, groups, items to buy or budgets. Anyone with the link can pass it on; it stops working 30 days after the event ends.",
    nothingToShare: "There is no plan to share for this event yet.",
    willShare: ({ count }) => count === 1 ? "Sharing 1 booth" : `Sharing ${count} booths`,
    tooMany: ({ max, over }) => `You can share up to ${max} at a time. Untick ${over}.`,
    creating: "Creating…",
    create: "Create short link",
    shortLink: "Short link",
    copyOrShare: "Copy or share",
    sharedDialog: "Shared plan",
    loading: "Loading the shared plan…",
    missing: "This share link does not exist or has expired.",
    browseEvents: "See events on 場刊 Map",
    expired: "This share link has expired.",
    viewEvent: "View {name}",
    eventNotPublic: "The event for this plan is not public right now.",
    otherEvent: "This plan is for booths at “{name}”.",
    openOtherEvent: "View in {name}",
    previewNote: "Take a look first. Your plan does not change until you add these.",
    catalogLoading: "Loading event data…",
    catalogFailed: "Event data failed to load, so this plan cannot be checked right now.",
    moved: "Moved to {days}; will not be added",
    withdrawn: "Cancelled attendance; will not be added",
    notFound: "This circle cannot be found right now; will not be added",
    addToPlan: "Add to my plan",
    blocked: "This device has older data that cannot be read. Deal with it in “Manage data” first.",
  },
  ja: {
    close: "{title}を閉じる",
    qr: "短縮URLのQRコード",
    shareTitle: "{name} 巡回リスト",
    copied: "リンクをコピーしました。",
    manual: "上のリンクを手動でコピーしてください。",
    shareDialog: "巡回プランを共有",
    shareIntro: "短縮URLを作成して、自分のスマートフォンに送ったり友人と共有したりできます。含まれるのはスペースと日付だけで、メモ、グループ、購入メモ、予算は含まれません。リンクは転送でき、イベント終了の30日後に無効になります。",
    nothingToShare: "このイベントには共有できる巡回プランがまだありません。",
    willShare: "{count} 件を共有",
    tooMany: "一度に共有できるのは {max} 件までです。{over} 件のチェックを外してください。",
    creating: "作成中…",
    create: "短縮URLを作成",
    shortLink: "短縮URL",
    copyOrShare: "コピー・共有",
    sharedDialog: "共有された巡回プラン",
    loading: "共有された巡回プランを読み込んでいます…",
    missing: "この共有リンクは存在しないか、有効期限が切れています。",
    browseEvents: "場刊 Map のイベントを見る",
    expired: "この共有リンクは有効期限が切れています。",
    viewEvent: "{name}を見る",
    eventNotPublic: "この巡回プランのイベントは現在公開されていません。",
    otherEvent: "この巡回プランは「{name}」のスペースです。",
    openOtherEvent: "{name}で見る",
    previewNote: "まず内容を確認できます。追加するまで巡回プランは変更されません。",
    catalogLoading: "イベントデータを読み込んでいます…",
    catalogFailed: "イベントデータを読み込めなかったため、この巡回プランを確認できません。",
    moved: "{days}に変更されたため、追加されません",
    withdrawn: "参加取り消しのため、追加されません",
    notFound: "このサークルが見つからないため、追加されません",
    addToPlan: "巡回プランに追加",
    blocked: "この端末に読み取れない古いデータがあります。先に「データ管理」で対応してください。",
  },
});

/** Read once, before the reader rebuilds its URL from its own whitelist (ADR-0079). */
const initialShareId = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("share");
/** Closed once means consumed: switching between map and browse remounts the dialog. */
let shareDismissed = false;

const eventOf = (eventId: string) => PUBLISHED_EVENTS.find((event) => event.id === eventId);
/** An itinerary day as `DAY 1（8月21日・五）`; other languages write the date from the calendar. */
export function planningDayLabel(eventId: string, day: EventDayKey, locale: Locale) {
  const event = eventOf(eventId);
  const found = event?.days.find((item) => String(item.id) === String(day));
  if (!event || !found) return `DAY ${day}`;
  if (locale === "zh-Hant") return `${found.label}（${found.dateLabel}）`;
  const date = eventDayCalendarDate(event, found.id);
  return `${found.label} · ${date ? dayDateLabel(date, locale) : found.dateLabel}`;
}
const itemKey = (item: { circleId: string; day: EventDayKey }) => `${item.circleId}\u0000${item.day}`;

function Dialog({ title, labelId, onClose, children }: { title: string; labelId: string; onClose: () => void; children: ReactNode }) {
  const t = useMessages(MESSAGES);
  const ref = useRef<HTMLElement | null>(null);
  useModalFocus(true, ref, onClose);
  return createPortal(<div className={styles.backdrop} role="presentation" onPointerDown={(pressed) => { if (pressed.target === pressed.currentTarget) onClose(); }}>
    <section ref={ref} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={labelId} tabIndex={-1}>
      <header><div><h2 id={labelId}>{title}</h2></div><button onClick={onClose} aria-label={t("close", { title })}><UiIcon name="close" /></button></header>
      {children}
    </section>
  </div>, document.body);
}

/** The short link as a QR code drawn in the browser; the QR module loads only once a link exists. */
function ShortLinkQr({ url }: { url: string }) {
  const t = useMessages(MESSAGES);
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let active = true;
    void import("qrcode-generator").then(({ default: qrcode }) => {
      const qr = qrcode(0, "M");
      qr.addData(url);
      qr.make();
      if (active) setSvg(qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }));
    }).catch(() => { if (active) setSvg(""); });
    return () => { active = false; };
  }, [url]);
  // Markup generated by the QR library for our own short URL, never user input.
  return svg ? <div className={styles.shareQr} role="img" aria-label={t("qr")} dangerouslySetInnerHTML={{ __html: svg }} /> : null;
}

/** 分享行程: pick itinerary items of this event, create a short link, copy / share / show its QR code. */
export function ShareItineraryDialog({ eventId, document, onClose }: { eventId: string; document: PlanningDocument; onClose: () => void }) {
  const t = useMessages(MESSAGES);
  const { locale } = useLocale();
  const catalog = getCircleCatalog(eventId);
  const name = (circleId: string) => {
    const record = catalog.recordsByCircleId.get(circleId)?.[0];
    return record ? `${record.placement.boothCode} ${record.circle.name}` : circleId;
  };
  const candidates = document.visitPlans.filter((entry) => entry.eventId === eventId)
    .map((entry) => ({ circleId: entry.circleId, day: entry.day, label: `${planningDayLabel(eventId, entry.day, locale)} · ${name(entry.circleId)}` }));
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());
  const [state, setState] = useState<{ kind: "idle" } | { kind: "creating" } | { kind: "ready"; url: string } | { kind: "error"; failure: ApiFailure }>({ kind: "idle" });
  const [message, setMessage] = useState<"copied" | "manual" | null>(null);
  const selected = candidates.filter((item) => !unchecked.has(itemKey(item)));

  function toggle(key: string) {
    setState({ kind: "idle" }); setMessage(null);
    setUnchecked((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  async function create() {
    setState({ kind: "creating" });
    const snapshot = projectSharedItinerary(document, eventId, selected.map(({ circleId, day }) => ({ circleId, day })));
    const result = await createShortLink(snapshot);
    setState(result.ok ? { kind: "ready", url: result.url } : { kind: "error", failure: result.failure });
  }
  async function share(url: string) {
    const result = await sharePublicContent({ title: t("shareTitle", { name: eventOf(eventId)?.name ?? eventId }), url });
    setMessage(result === "copied" || result === "manual" ? result : null);
  }

  return <Dialog title={t("shareDialog")} labelId="share-itinerary-title" onClose={onClose}>
    <section className={styles.section}>
      <div><p>{t("shareIntro")}</p></div>
      {candidates.length === 0 ? <p>{t("nothingToShare")}</p> : <>
        <fieldset className={styles.sharePick}>
          <legend>{t("willShare", { count: selected.length })}</legend>
          {/* Locked while creating, so the link always matches what is ticked. */}
          {candidates.map((item) => <label key={itemKey(item)}><input type="checkbox" disabled={state.kind === "creating"} checked={!unchecked.has(itemKey(item))} onChange={() => toggle(itemKey(item))} />{item.label}</label>)}
        </fieldset>
        {selected.length > SHARE_MAX_ITEMS && <p className={styles.errorText}>{t("tooMany", { max: SHARE_MAX_ITEMS, over: selected.length - SHARE_MAX_ITEMS })}</p>}
        {state.kind !== "ready" && <div className={styles.confirmActions}>
          <button className={styles.primary} disabled={state.kind === "creating" || selected.length === 0 || selected.length > SHARE_MAX_ITEMS} onClick={() => void create()}>{state.kind === "creating" ? t("creating") : t("create")}</button>
        </div>}
        {state.kind === "error" && <p className={styles.errorText} role="alert">{shareFailureMessage(state.failure, locale)}</p>}
        {state.kind === "ready" && <div className={styles.shareResult}>
          <div className={styles.shareLink}>
            <input readOnly aria-label={t("shortLink")} value={localizedHref(state.url, locale)} onFocus={(focused) => focused.currentTarget.select()} />
            <button onClick={() => void share(localizedHref(state.url, locale))}>{t("copyOrShare")}</button>
          </div>
          <ShortLinkQr url={localizedHref(state.url, locale)} />
          {message && <p className={styles.okText} role="status">{t(message)}</p>}
        </div>}
      </>}
    </section>
  </Dialog>;
}

type Opened =
  | { kind: "loading" }
  | { kind: "ok"; snapshot: ShareSnapshot }
  | { kind: "expired"; eventId: string | null }
  | { kind: "missing" }
  | { kind: "error"; failure: ApiFailure };

/** A short link opened in the reader (`?share=<id>`): read-only until 加入我的行程 (#415, ADR-0079). */
export function SharedItineraryDialog({ eventId, update, blocked }: {
  eventId: string;
  update: (change: (current: PlanningDocument) => PlanningDocument) => void;
  blocked: boolean;
}) {
  const t = useMessages(MESSAGES);
  const { locale } = useLocale();
  const [shareId, setShareId] = useState(() => (shareDismissed ? null : initialShareId));
  const [opened, setOpened] = useState<Opened>({ kind: "loading" });
  useEffect(() => {
    if (!shareId) return;
    let active = true;
    void readShortLink(shareId).then((result) => {
      if (active) setOpened(result.kind === "ok" ? { kind: "ok", snapshot: result.snapshot } : result.kind === "error" ? { kind: "error", failure: result.failure } : result);
    });
    return () => { active = false; };
  }, [shareId]);
  if (!shareId) return null;
  const close = () => {
    shareDismissed = true;
    setShareId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("share");
    window.history.replaceState(window.history.state, "", url);
  };
  const expiredEvent = opened.kind === "expired" && opened.eventId ? eventOf(opened.eventId) : undefined;
  return <Dialog title={t("sharedDialog")} labelId="shared-itinerary-title" onClose={close}>
    {opened.kind === "loading" && <p className={styles.notice} role="status">{t("loading")}</p>}
    {opened.kind === "missing" && <div className={styles.section}><p>{t("missing")}</p><a className={styles.linkButton} href={localizedHref("/", locale)}>{t("browseEvents")}</a></div>}
    {opened.kind === "expired" && <div className={styles.section}><p>{t("expired")}</p>{expiredEvent && <a className={styles.linkButton} href={localizedHref(`/?event=${encodeURIComponent(expiredEvent.id)}`, locale)}>{t("viewEvent", { name: expiredEvent.name })}</a>}</div>}
    {opened.kind === "error" && <p className={styles.errorText} role="alert">{shareFailureMessage(opened.failure, locale)}</p>}
    {opened.kind === "ok" && <SharedItineraryBody snapshot={opened.snapshot} shareId={shareId} eventId={eventId} update={update} blocked={blocked} onAdded={close} />}
  </Dialog>;
}

function SharedItineraryBody({ snapshot, shareId, eventId, update, blocked, onAdded }: {
  snapshot: ShareSnapshot; shareId: string; eventId: string;
  update: (change: (current: PlanningDocument) => PlanningDocument) => void; blocked: boolean;
  /** Closes the preview once added; the 行程 count is the confirmation. */
  onAdded: () => void;
}) {
  const t = useMessages(MESSAGES);
  const { locale } = useLocale();
  // Re-render when the event's catalog arrives, so items are not judged against an empty one.
  useCircleCatalog(snapshot.eventId);
  const event = eventOf(snapshot.eventId);
  const resolved = resolveSharedList(snapshot);
  if (!event) return <p className={styles.errorText} role="alert">{t("eventNotPublic")}</p>;
  if (snapshot.eventId !== eventId) return <div className={styles.section}><p>{t("otherEvent", { name: event.name })}</p>
    <a className={styles.linkButton} href={localizedHref(`/?event=${encodeURIComponent(snapshot.eventId)}&share=${encodeURIComponent(shareId)}`, locale)}>{t("openOtherEvent", { name: event.name })}</a></div>;
  const available = resolved.items.filter((item) => item.state === "available").map(({ circleId, day }) => ({ circleId, day }));
  return <>
    <p className={styles.notice}>{t("previewNote")}</p>
    {resolved.status !== "ready" && <p className={styles.notice} role="status">{resolved.status === "loading" ? t("catalogLoading") : t("catalogFailed")}</p>}
    <ol className={styles.sharedItems}>{resolved.items.map((item) => <li key={itemKey(item)}>
      <b>{item.records[0] ? `${item.records[0].placement.boothCode} ${item.circle?.name ?? ""}` : item.circleId}</b>
      <small>{item.state === "available" ? planningDayLabel(snapshot.eventId, item.day, locale)
        : item.state === "moved" ? t("moved", { days: item.days.map((value) => planningDayLabel(snapshot.eventId, value, locale)).join(locale === "en" ? ", " : "、") })
          : item.state === "withdrawn" ? t("withdrawn") : t("notFound")}</small>
    </li>)}</ol>
    {resolved.status === "ready" && <div className={styles.section}>
      <div className={styles.confirmActions}>
        <button className={styles.primary} disabled={blocked || available.length === 0} onClick={() => {
          update((current) => addSharedToPlan(current, snapshot.eventId, available).document);
          onAdded();
        }}>{t("addToPlan")}</button>
      </div>
      {blocked && <p className={styles.errorText}>{t("blocked")}</p>}
    </div>}
  </>;
}
