import { useCallback, useEffect, useState } from "react";
import { readSession, signOut, type PortalSession } from "../circle-editor-client";
import { getPublishedEvent, PUBLISHED_EVENTS } from "../event-catalog";
import { nearestEvent, taipeiDate } from "../event-calendar";
import { adminLoginEntry } from "../notification-navigation";
import { SessionDeadline, useSessionExpiry } from "../circle-portal/session-status";
import { AdminRoster } from "./admin-panels";
import { AdminAccountPanel } from "./admin-account-panel";
import { AdminCirclePanel } from "./admin-circle-panel";
import { AdminMapReviewPanel } from "./admin-map-review-panel";
import { AdminNotificationPanel } from "./admin-notification-panel";
import { AdminReviewQueue } from "./admin-review-queue";
import { AdminReferencePanel, type ReferenceView } from "./admin-reference-panel";
import { AdminSiteSettingsPanel } from "./admin-site-settings-panel";
import { AdminOverview, AdminPublicationPanel, AdminEventPanel } from "./admin-overview";
import { adminHref, readAdminRoute, type AdminRoute, type AdminSection } from "./admin-navigation";
import styles from "../circle-portal/portal.module.css";
import ui from "./admin-app.module.css";

const labels: Record<AdminSection, string> = { overview: "管理總覽", events: "活動管理", circles: "社團管理", accounts: "帳號管理", data: "資料管理", settings: "網站設定", notifications: "我的通知設定" };

export default function AdminApp() {
  const [route, setRoute] = useState(() => readAdminRoute(new URL(window.location.href)));
  const [session, setSession] = useState<PortalSession | null>(null);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [today] = useState(() => taipeiDate(Date.now()));
  const [navigationOpen, setNavigationOpen] = useState(() => window.matchMedia("(min-width: 960px)").matches);
  const expire = useCallback(() => { setSession(null); setMessage("登入已到期，請重新登入。"); }, []);
  useSessionExpiry(session, expire);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 960px)");
    const resize = (event: MediaQueryListEvent) => setNavigationOpen(event.matches);
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    let current = true;
    void readSession().then(answer => { if (current) setSession(answer); })
      .catch(() => { if (current) setSession(null); })
      .finally(() => { if (current) setReady(true); });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    const sync = () => setRoute(readAdminRoute(new URL(window.location.href)));
    window.addEventListener("popstate", sync); window.addEventListener("hashchange", sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener("hashchange", sync); };
  }, []);
  const replaceRoute = (change: Partial<AdminRoute>) => {
    const next = { ...route, ...change };
    window.history.replaceState(window.history.state, "", adminHref(next.section, next)); setRoute(next);
  };
  const event = route.event ? getPublishedEvent(route.event) : nearestEvent(PUBLISHED_EVENTS, today) ?? PUBLISHED_EVENTS[0];
  const scoped = route.section === "circles" || (route.section === "events" && route.view === "maps");
  const unavailable = route.unavailable || (scoped && !event);
  const tabs = route.section === "events" ? [["list", "活動總表"], ["publication", "審核與發布"], ["maps", "地圖投稿"]]
    : route.section === "circles" ? [["claims", "認領審核"], ["search", "社團查詢"]]
      : route.section === "accounts" ? [["search", "帳號查詢"], ["admins", "網站管理者"]] : [];
  return <div className={`${styles.page} ${ui.workspace}`}>
    <header className={styles.masthead}><h1>網站管理</h1>
      {session && <div className={styles.accountBar}>
        <p className={styles.identityWho}><span>{session.email}</span><SessionDeadline session={session} /></p>
        <details className={ui.accountMenu}><summary>我的帳號</summary><div>
          <a href={adminHref("notifications")}>我的通知設定</a><a href="/circle">社團資料</a><a href="/organizer">主辦工作區</a>
          <button type="button" onClick={() => void signOut().then(() => { setSession(null); setMessage(""); }).catch(() => setMessage("登出失敗，請稍後再試。"))}>登出</button>
        </div></details>
      </div>}
    </header>
    {message && <p className={styles.error} role="status">{message}</p>}
    {!ready ? <p className={styles.notice}>載入中…</p> : !session ? <section className={styles.card}><h2>請先登入</h2><a href={adminLoginEntry(window.location.href)}>前往社團入口登入</a></section>
      : !session.isAdmin ? <section className={styles.card}><h2>需要管理者權限</h2><p>目前帳號無法使用網站管理功能。</p><a href="/circle">返回社團入口</a></section>
        : <div className={`${ui.layout} ${styles.workspace}`}>
          <nav aria-label="管理項目"><details className={ui.navigation} open={navigationOpen} onToggle={event => setNavigationOpen(event.currentTarget.open)}><summary>{labels[route.section]}</summary>
            {(["overview", "events", "circles", "accounts", "data", "settings"] as const).map(section => <a key={section} href={adminHref(section)} aria-current={route.section === section ? "page" : undefined}>{labels[section]}</a>)}
          </details></nav>
          <main className={ui.content}>
            {route.section !== "overview" && <div className={ui.title}><h2>{labels[route.section]}</h2></div>}
            {tabs.length > 0 && <nav className={ui.tabs} aria-label={`${labels[route.section]}頁籤`}>{tabs.map(([view, label]) => <a key={view} href={adminHref(route.section, { view, ...(route.section === "accounts" ? { email: route.email } : { event: route.event }) })} aria-current={route.view === view ? "page" : undefined}>{label}</a>)}</nav>}
            {unavailable ? <section className={styles.card}><h3>無法開啟指定頁面</h3><p>這個入口或活動目前無法使用。</p><a href="/admin">返回管理總覽</a></section>
              : route.section === "overview" ? <AdminOverview />
                : route.section === "events" ? route.view === "list" ? <AdminEventPanel /> : route.view === "publication" ? <AdminPublicationPanel />
                  : <AdminMapReviewPanel event={event!} initialDraftId={route.draft} onEventChange={id => replaceRoute({ event: id, draft: "" })} onSelectDraft={draft => replaceRoute({ event: event!.id, draft })} />
                  : route.section === "circles" ? route.view === "claims" ? <AdminReviewQueue key={`${route.event}:${route.claim}`} initialEventId={route.event} initialClaimId={route.claim} onEventChange={id => replaceRoute({ event: id, claim: "" })} />
                    : <AdminCirclePanel key={event!.id} event={event!} initialQuery={route.q} circleId={route.circle}
                      onEventChange={id => replaceRoute({ event: id, q: "", circle: "" })} onSearchChange={q => replaceRoute({ event: event!.id, q, circle: "" })}
                      onSelectCircle={circle => replaceRoute({ event: event!.id, circle })} />
                    : route.section === "accounts" ? route.view === "admins" ? <AdminRoster /> : <AdminAccountPanel key={route.email} initialEmail={route.email}
                      onSearchChange={email => replaceRoute({ email, event: "" })} />
                      : route.section === "data" ? <AdminReferencePanel initialView={route.view as ReferenceView} onViewChange={view => replaceRoute({ view })} />
                        : route.section === "settings" ? <AdminSiteSettingsPanel /> : <AdminNotificationPanel email={session.email} />}
          </main>
        </div>}
  </div>;
}
