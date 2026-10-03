import { AdminReferencePanel } from "./admin-reference-panel";
import { AdminSiteSettingsPanel } from "./admin-site-settings-panel";
import referenceStyles from './admin-reference-panel.module.css';
import { useCallback, useEffect, useState } from "react";
import { readSession, setPortalEventId, signOut, type PortalSession } from "../circle-editor-client";
import { getPublishedEvent, PUBLISHED_EVENTS } from "../event-catalog";
import { nearestEvent, taipeiDate } from "../event-calendar";
import { SessionDeadline, useSessionExpiry } from "../circle-portal/session-status";
import { AdminEventSelect, AdminRoster, AdminTakedownPanel } from "./admin-panels";
import { AdminMapReviewPanel } from "./admin-map-review-panel";
import { AdminNotificationPanel } from "./admin-notification-panel";
import { AdminReviewQueue } from "./admin-review-queue";
import styles from "../circle-portal/portal.module.css";

/** Only a link that means one event names it, such as a review digest's. */
function namedEventId() {
  return getPublishedEvent(new URLSearchParams(window.location.search).get("event") ?? "")?.id ?? "";
}

/** Where the event-scoped sections open when the link named no event. */
function initialEventId() {
  return (getPublishedEvent(namedEventId()) ?? nearestEvent(PUBLISHED_EVENTS, taipeiDate(Date.now())) ?? PUBLISHED_EVENTS[0]).id;
}

/**
 * The page opens on every event's review work at once; only the sections that
 * act inside one event — map review and takedown — carry an event picker of
 * their own. A link that names an event pre-filters the claim queue and opens
 * the map review on it, which is what a review digest's link asks for.
 */
export default function AdminApp() {
  const sharedReferences = new URLSearchParams(window.location.search).get("section") === "references";
  const siteSettings = new URLSearchParams(window.location.search).get("section") === "settings";
  const separateSection = sharedReferences || siteSettings;
  const [session, setSession] = useState<PortalSession | null>(null);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [claimFilter] = useState(namedEventId);
  const [eventId, setEventId] = useState(initialEventId);
  const event = getPublishedEvent(eventId) ?? PUBLISHED_EVENTS[0];
  const expire = useCallback(() => {
    setSession(null);
    setMessage("登入已到期，請前往社團入口重新登入。");
  }, []);
  useSessionExpiry(session, expire);

  // The page-wide scope is the map review's event; the claim queue and the
  // takedown form name their own. Set before session resolution mounts any
  // management panel.
  useEffect(() => {
    setPortalEventId(event.id);
  }, [event.id]);
  useEffect(() => {
    let current = true;
    void readSession().then(answer => { if (current) setSession(answer); })
      .catch(() => { if (current) setSession(null); })
      .finally(() => { if (current) setReady(true); });
    return () => { current = false; };
  }, []);

  const chooseMapEvent = (id: string) => {
    setPortalEventId(id);
    setEventId(id);
  };
  const openMaps = (id: string) => {
    chooseMapEvent(id);
    document.getElementById("map-review")?.scrollIntoView({ block: "start" });
  };

  return <div className={`${styles.page} ${styles.adminPage} ${sharedReferences ? referenceStyles.workspace : ''}`}>
    <header className={styles.masthead}>
      <div><h1>網站管理</h1>
        <p className={styles.backLink}><a href="/circle">社團入口</a> · <a href="/organizer">主辦工作區</a></p>
      </div>
      {session && <div className={styles.accountBar}>
        <p className={styles.identityWho}><span>{session.email}{session.isAdmin ? "・管理者" : ""}</span><SessionDeadline session={session} /></p>
        <button type="button" onClick={() => void signOut().then(() => { setSession(null); setMessage(""); }).catch(() => setMessage("登出失敗，請稍後再試。"))}>登出</button>
      </div>}
    </header>
    {message && <p className={styles.error} role="status">{message}</p>}
    {!ready ? <p className={styles.notice}>載入中…</p>
      : !session ? <section className={styles.card}><h2>請先登入</h2><p>使用既有管理者帳號在社團入口登入，再從「管理」返回此處。</p><a href="/circle">前往社團入口登入</a></section>
        : !session.isAdmin ? <section className={styles.card}><h2>需要管理者權限</h2><p>目前帳號無法使用網站管理功能。</p><a href="/circle">返回社團入口</a></section>
          : <>
            <nav className={`${styles.card} ${styles.backLink}`} aria-label="管理項目">
              <a href="/admin?section=settings" aria-current={siteSettings ? "page" : undefined}>網站設定</a> · <a href="/admin?section=references">共用資料</a> · <a href={separateSection ? "/admin#overview" : "#overview"}>待審總覽</a> · <a href={separateSection ? "/admin#admin" : "#admin"}>社團認領</a> · <a href={separateSection ? "/admin#map-review" : "#map-review"}>地圖草稿審閱</a> · <a href={separateSection ? "/admin#takedown" : "#takedown"}>撤下補充資料</a> · <a href={separateSection ? "/admin#accounts" : "#accounts"}>管理者名單</a> · <a href={separateSection ? "/admin#review-notifications" : "#review-notifications"}>待審通知</a>
            </nav>
            {siteSettings ? <AdminSiteSettingsPanel /> : sharedReferences ? <AdminReferencePanel /> : <>
            <AdminReviewQueue initialEventId={claimFilter} onOpenMaps={openMaps} />
            <AdminMapReviewPanel event={event} picker={<AdminEventSelect id="map-review-event" value={event.id} onChange={chooseMapEvent} />} />
            <AdminTakedownPanel initialEventId={event.id} />
            <AdminRoster />
            <AdminNotificationPanel email={session.email} />
            </>}
          </>}
  </div>;
}
