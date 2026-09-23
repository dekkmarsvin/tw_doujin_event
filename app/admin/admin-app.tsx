import { Fragment, useCallback, useEffect, useState } from "react";
import { readSession, setPortalEventId, signOut, type PortalSession } from "../circle-editor-client";
import { getPublishedEvent, PUBLISHED_EVENTS } from "../event-catalog";
import { SessionDeadline, useSessionExpiry } from "../circle-portal/session-status";
import { AdminPanel } from "./admin-panels";
import { AdminMapReviewPanel } from "./admin-map-review-panel";
import { AdminNotificationPanel } from "./admin-notification-panel";
import styles from "../circle-portal/portal.module.css";

function initialEventId() {
  const named = new URLSearchParams(window.location.search).get("event") ?? "";
  return (getPublishedEvent(named) ?? PUBLISHED_EVENTS[0]).id;
}

export default function AdminApp() {
  const [session, setSession] = useState<PortalSession | null>(null);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [eventId, setEventId] = useState(initialEventId);
  const event = getPublishedEvent(eventId) ?? PUBLISHED_EVENTS[0];
  const expire = useCallback(() => {
    setSession(null);
    setMessage("登入已到期，請前往社團入口重新登入。");
  }, []);
  useSessionExpiry(session, expire);

  // Set the event before session resolution mounts any management panels.
  useEffect(() => {
    setPortalEventId(event.id);
    const url = new URL(window.location.href);
    url.searchParams.set("event", event.id);
    window.history.replaceState(null, "", url);
  }, [event.id]);
  useEffect(() => {
    let current = true;
    void readSession().then(answer => { if (current) setSession(answer); })
      .catch(() => { if (current) setSession(null); })
      .finally(() => { if (current) setReady(true); });
    return () => { current = false; };
  }, []);

  const circleHref = `/circle?event=${encodeURIComponent(event.id)}`;
  return <div className={styles.page}>
    <header className={styles.masthead}>
      <div><h1>網站管理</h1><p>{event.name}・{event.dateRangeLabel}</p>
        <p className={styles.backLink}><a href={circleHref}>社團入口</a> · <a href="/organizer">主辦工作區</a></p>
      </div>
      {session && <div className={styles.identity}>
        <span>{session.email}{session.isAdmin ? "・管理者" : ""}</span>
        <SessionDeadline session={session} />
        <button type="button" onClick={() => void signOut().then(() => { setSession(null); setMessage(""); }).catch(() => setMessage("登出失敗，請稍後再試。"))}>登出</button>
      </div>}
    </header>
    {message && <p className={styles.error} role="status">{message}</p>}
    {!ready ? <p className={styles.notice}>載入中…</p>
      : !session ? <section className={styles.card}><h2>請先登入</h2><p>使用既有管理者帳號在社團入口登入，再從「管理」返回此處。</p><a href={circleHref}>前往社團入口登入</a></section>
        : !session.isAdmin ? <section className={styles.card}><h2>需要管理者權限</h2><p>目前帳號無法使用網站管理功能。</p><a href={circleHref}>返回社團入口</a></section>
          : <>
            {PUBLISHED_EVENTS.length > 1 && <section className={styles.card}>
              <label htmlFor="admin-event">管理活動</label>
              <select id="admin-event" value={event.id} onChange={change => {
                setPortalEventId(change.target.value);
                setEventId(change.target.value);
              }}>{PUBLISHED_EVENTS.map(item => <option key={item.id} value={item.id}>{item.name}・{item.dateRangeLabel}</option>)}</select>
            </section>}
            <nav className={`${styles.card} ${styles.backLink}`} aria-label="管理項目"><a href="#admin">認領、補充資料與帳號</a> · <a href="#map-review">地圖草稿審閱</a> · <a href="#review-notifications">待審通知</a></nav>
            <AdminNotificationPanel email={session.email} />
            <Fragment key={event.id}><AdminPanel event={event} /><AdminMapReviewPanel event={event} /></Fragment>
          </>}
  </div>;
}
