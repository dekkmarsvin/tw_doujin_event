import { useCallback, useEffect, useRef, useState } from "react";
import { listOrganizerEvents, type OrganizerEventSummary } from "../organizer-client";
import { PUBLISHED_EVENTS, getPublishedEvent } from "../event-catalog";
import { eventsByProximity, taipeiDate } from "../event-calendar";
import { adminHref } from "./admin-navigation";
import { useAdminReviewQueue } from "./use-admin-review-queue";
import { useAdminSiteStatus } from "./use-admin-site-status";
import { adminDate, publicationProgress, ServiceResults } from "./admin-service-status";
import styles from "../circle-portal/portal.module.css";
import ui from "./admin-app.module.css";

export function AdminOverview() {
  const queue = useAdminReviewQueue();
  return <AdminDashboard queueState={queue} />;
}
export function AdminPublicationPanel() { return <AdminDashboard />; }

function AdminDashboard({ queueState }: { queueState?: ReturnType<typeof useAdminReviewQueue> }) {
  const overview = !!queueState;
  const operations = useAdminSiteStatus();
  const [candidates, setCandidates] = useState<OrganizerEventSummary[] | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [today] = useState(() => taipeiDate(Date.now()));
  const sequence = useRef({ value: 0 });
  const loadCandidates = useCallback(async () => {
    const request = ++sequence.current.value;
    try {
      const answer = await listOrganizerEvents();
      if (request !== sequence.current.value) return;
      setCandidates(answer.events.filter(item => item.status === "submitted").sort((a, b) => (a.createdAt ?? a.updatedAt) - (b.createdAt ?? b.updatedAt)));
      setError(""); setUpdatedAt(Date.now());
    } catch (failure) { if (request === sequence.current.value) setError(failure instanceof Error ? failure.message : "無法取得活動內容送審。"); }
  }, []);
  useEffect(() => { const requests = sequence.current; queueMicrotask(() => void loadCandidates()); return () => { ++requests.value; }; }, [loadCandidates]);
  const refresh = () => { queueState?.refresh(true); void operations.load(); void loadCandidates(); };
  const queue = queueState?.queue;
  const counts = queue?.claimCounts ?? [];
  const { data } = operations;
  const knownEvents = eventsByProximity(PUBLISHED_EVENTS, today);
  return <>
    {/* Under 活動管理 the 審核與發布 tab already names this view; only the overview titles itself. */}
    <div className={ui.title}>{overview && <h2 id="overview-heading">管理總覽</h2>}
      <button type="button" className={styles.secondaryButton} onClick={refresh} disabled={queueState?.loading}>重新整理</button></div>
    {overview && <div className={ui.summary} aria-label="待審工作">
      <a href="/organizer?application">活動申請<strong>{queue ? queue.organizer.applications : "—"}</strong></a>
      <a href={adminHref("events", { view: "publication" })}>活動內容<strong>{queue ? queue.organizer.submissions : "—"}</strong></a>
      <a href={adminHref("circles", { view: "claims" })}>社團認領<strong>{queue?.pendingClaimCount ?? "—"}</strong></a>
      <a href={adminHref("events", { view: "maps" })}>地圖投稿<strong>{queue ? queue.mapDrafts.reduce((sum, item) => sum + item.submitted, 0) : "—"}</strong></a>
    </div>}
    <div className={ui.dashboard} id={overview ? "overview" : undefined}>
      <div>
        <section className={styles.card} aria-labelledby="tasks-heading"><h3 id="tasks-heading">需要處理</h3>
          {queueState?.loadError && <><p className={styles.error} role="alert">待審摘要更新失敗：{queueState.loadError}</p>
            {queueState.updatedAt && <p className={ui.status}>待審摘要更新於 {adminDate(queueState.updatedAt)}</p>}</>}
          <ul className={ui.rows}>
            {overview && queue && queue.organizer.applications > 0 && <li><div><strong>活動申請</strong><small>{queue.organizer.applications} 件待審</small></div><a href="/organizer?application">前往審核</a></li>}
            {candidates?.map(item => <li key={item.id}><div><strong>{item.tentativeName}</strong><small>活動內容待審{item.edition ? ` · 第 ${item.edition} 版` : ""}</small></div>
              <a href={`/organizer?candidate=${encodeURIComponent(item.id)}&section=review`}>前往審核</a></li>)}
            {overview && counts.filter(item => item.pending > 0).map(item => <li key={`claim:${item.eventId}`}><div><strong>{getPublishedEvent(item.eventId)?.name ?? item.eventId}</strong><small>社團認領 {item.pending} 件</small></div>
              <a href={adminHref("circles", { view: "claims", event: item.eventId })}>審核認領</a></li>)}
            {overview && queue?.mapDrafts.filter(item => item.submitted > 0).map(item => <li key={`map:${item.eventId}`}><div><strong>{getPublishedEvent(item.eventId)?.name ?? item.eventId}</strong><small>地圖投稿 {item.submitted} 件</small></div>
              <a href={adminHref("events", { view: "maps", event: item.eventId })}>查看草稿</a></li>)}
          </ul>
          {!candidates && !error && <p>活動內容載入中…</p>}
          {error && <><p className={styles.error} role="alert">活動內容更新失敗：{error}</p>{updatedAt && <p className={ui.status}>活動內容更新於 {adminDate(updatedAt)}</p>}</>}
          {candidates?.length === 0 && !error && <p>目前沒有待審活動內容。</p>}
          {!overview && <p><a href="/organizer?application">活動申請審核</a> · <a href="/organizer">前往主辦工作區</a></p>}
        </section>
        <section className={styles.card} aria-labelledby="publication-jobs-heading"><h3 id="publication-jobs-heading">發布作業</h3>
          {!data ? <p>{operations.error ? "無法取得發布作業。" : "載入中…"}</p> : <>
            <ul className={ui.rows}>{data.publicationActivities.map(job => <li key={job.id}><div><strong>{job.eventName}</strong><small>{publicationProgress(job, data.settings.publicationEnabled)}</small></div>
              <a href={`/organizer?candidate=${encodeURIComponent(job.candidateId)}&section=review`}>查看進度</a></li>)}</ul>
            {data.publicationActivities.length === 0 && <p>目前沒有排程或進行中的發布作業。</p>}
          </>}
        </section>
        {overview && <section className={styles.card} aria-labelledby="published-heading"><h3 id="published-heading">已公開活動</h3>
          <PublishedEvents entries={knownEvents.filter(entry => entry.group !== "past")} />
          {knownEvents.some(entry => entry.group === "past") && knownEvents.some(entry => entry.group !== "past") && <p className={ui.groupDivider}>已結束</p>}
          <PublishedEvents entries={knownEvents.filter(entry => entry.group === "past")} />
        </section>}
      </div>
      <div>
        <section className={styles.card} aria-labelledby="operations-heading"><h3 id="operations-heading">營運狀態</h3>
          {data ? <dl className={ui.facts}>
            <div><dt>活動申請</dt><dd>{{ closed: "暫停申請", invite_only: "僅限邀請", public: "公開申請" }[data.settings.organizerApplicationMode]}</dd></div>
            <div><dt>發布作業</dt><dd>{data.settings.publicationEnabled ? "運作中" : "已暫停"}</dd></div>
            <div><dt>帳號通知</dt><dd>{data.settings.accountNotificationsEnabled ? "開啟" : "已關閉"}</dd></div>
            <div><dt>待審通知</dt><dd>{data.settings.adminReviewNotificationsEnabled ? "開啟" : "已關閉"}</dd></div>
          </dl> : <p>{operations.error ? "無法取得營運設定。" : "載入中…"}</p>}
          {data?.publicationMode === "disabled" && <p>此環境未啟用發布能力。</p>}
          <p><a href={adminHref("settings")}>前往網站設定</a></p>
          {operations.error && <><p className={styles.error} role="alert">營運狀態更新失敗：{operations.error}</p>
            {operations.updatedAt && <p className={ui.status}>營運狀態更新於 {adminDate(operations.updatedAt)}</p>}</>}
        </section>
        <section className={styles.card} aria-labelledby="services-heading"><h3 id="services-heading">服務檢查</h3>
          {data ? <ServiceResults data={data} checking={operations.checking} /> : <p>無法確認</p>}
          <button type="button" disabled={!data || operations.checking} onClick={() => void operations.checkServices()}>{operations.checking ? "檢查中…" : "檢查服務"}</button>
        </section>
      </div>
    </div>
  </>;
}

function PublishedEvents({ entries }: { entries: ReturnType<typeof eventsByProximity> }) {
  if (!entries.length) return null;
  return <ul className={ui.rows}>{entries.map(({ event, label }) => <li key={event.id}><div><strong>{event.name}</strong><small>{label} · 已公開</small></div>
    <a href={`/events/${encodeURIComponent(event.id)}/`}>查看公開頁</a></li>)}</ul>;
}
