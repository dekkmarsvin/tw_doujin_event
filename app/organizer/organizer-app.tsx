"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { OrganizerAmendmentPanel } from "./organizer-amendment-panel";
import { OrganizerApplicationsPanel } from "./organizer-applications-panel";
import { OrganizerClaimsPanel } from "./organizer-claims-panel";
import { OrganizerTakedownPanel } from "./organizer-takedown-panel";
import { OrganizerWorkspaceHeader } from "./organizer-workspace-header";
import { useOrganizerPendingClaims } from "./use-organizer-pending-claims";
import { groupOrganizerEvents, latestOrganizerEdition } from "../organizer-event-groups";
import { ReviewPanel } from "./organizer-review-panel";
import { OrganizerMapPanel } from "./organizer-map-panel";
import { ImportPanel } from "./organizer-import-panel";
import { DraftForm } from "./organizer-draft-form";
import { MembersPanel } from "./organizer-members-panel";
import { PortalError, readSession, readTurnstileSitekey, requestLoginLink, signOut, verifyLoginToken, type PortalSession } from "../circle-editor-client";
import { createOrganizerEvent, completeOrganizerOnboarding, listOrganizerEvents, readOrganizerEvent, saveOrganizerWorkspacePreference, startOrganizerAmendment, type OrganizerEventDetail, type OrganizerEventSummary, type OrganizerMapLocation } from "../organizer-client";
import { type OrganizerVenueCatalog } from "../organizer-venue-catalog";

import { type OrganizerReferenceCatalog, validateOrganizerReferences } from "../organizer-reference-catalog";
import { organizerIssueTarget, RequiredMark, type FieldRequest } from "./organizer-field-guidance";
import { type OrganizerEventDraft } from "../organizer-event";
import { ORGANIZER_GUIDED_TASKS, ORGANIZER_WORKSPACE_SECTIONS, type OrganizerGuidedTask, type OrganizerWorkspaceSection } from "../organizer-workspace";

import { TurnstileWidget } from "../circle-portal/turnstile-widget";
import { SessionDeadline, useSessionExpiry } from "../circle-portal/session-status";
import { AccountNotificationSettings } from "../account-notification-settings";
import { ContactLink, WorkspaceEntries, WorkspaceSwitch } from "../workspace-nav";


import { UiIcon } from "../ui-icons";

import { useModalFocus } from "../use-modal-focus";
import styles from "./organizer.module.css";

import { GUIDED_LABEL, IDLE, STATUS_LABEL, message, organizerGuidedDraftIssues, organizerIssueMessage, organizerSectionLabel, organizerSectionStateLabel, takeLoginToken, useDesktopViewport, type Notice, type PendingNavigation } from "./organizer-shared";

export default function OrganizerApp() {
  const [session, setSession] = useState<PortalSession | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<Notice>(IDLE);
  const isDesktop = useDesktopViewport();
  const expireSession = useCallback(() => {
    setSession(null);
    setNotice({ kind: "error", message: "登入已到期，請重新登入。" });
  }, []);
  useSessionExpiry(session, expireSession);

  useEffect(() => {
    const token = takeLoginToken();
    const destination = new URL(window.location.href);
    if (!token && destination.searchParams.has("reauth")) {
      destination.searchParams.delete("reauth");
      window.history.replaceState(null, "", destination);
      queueMicrotask(() => setReady(true));
      return;
    }
    // An account with nothing to do here is still signed in: dropping the
    // session would put it back in front of a sign-in form it already passed.
    void (token ? verifyLoginToken(token) : readSession())
      .then(setSession)
      .catch((error: unknown) => {
        setSession(null);
        if (token) setNotice({ kind: "error", message: message(error) });
      })
      .finally(() => setReady(true));
  }, []);

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><h1>主辦單位工作區</h1><p>場刊 Map 活動資料建置</p></div>
      {session && <div className={styles.identity}>
        <WorkspaceSwitch current="organizer" />
        <span>{session.email}{session.isAdmin ? "・網站管理者" : ""}</span>
        {session.isAdmin && <a href="/admin">管理</a>}
        <SessionDeadline session={session} />
        <AccountNotificationSettings key={session.email} session={session} className={styles.ghost} />
        <ContactLink url={session.contactUrl} />
        <button type="button" className={styles.ghost} onClick={() => void signOut().finally(() => setSession(null))}>登出</button>
      </div>}
    </header>
    {notice.kind !== "idle" && <p role="status" className={notice.kind === "error" ? styles.error : styles.notice}>{notice.message}</p>}
    {!ready ? <main className={styles.centerCard}><p>載入工作區…</p></main>
      : !session ? <main>
        <WorkspaceEntries current="organizer" className={styles.signInEntries} />
        <section className={styles.centerCard}>
          <h2>主辦單位登入</h2>
          <p>使用 email 取得 15 分鐘內有效的一次性登入連結。</p>
          <OrganizerLoginLink />
        </section>
      </main>
        : !session.isAdmin && !session.hasOrganizerAccess && !session.canApplyForEvent && !session.hasEventApplications
          ? <main><OrganizerNoAccess session={session} /></main>
        : !session.isAdmin && !session.hasOrganizerAccess ? <main className={styles.applicationMain}><OrganizerApplicationsPanel session={session} /></main>
        : isDesktop ? <OrganizerWorkspace session={session} />
          : new URLSearchParams(window.location.search).has("candidate") && !new URLSearchParams(window.location.search).has("application")
            ? <main className={styles.applicationMain}><MobileNotificationResult /></main>
          : session.isAdmin || session.canApplyForEvent || session.hasEventApplications ? <main className={styles.applicationMain}>
            <p>活動資料與地圖編輯請改用桌機。</p>
            <OrganizerApplicationsPanel session={session} />
          </main> : <main><NarrowScreenBlocker onSignedOut={() => setSession(null)} /></main>}
  </div>;
}

function MobileNotificationResult() {
  const [detail, setDetail] = useState<OrganizerEventDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    const candidateId = new URLSearchParams(window.location.search).get("candidate") ?? "";
    void readOrganizerEvent(candidateId).then(value => { if (current) setDetail(value); })
      .catch(() => { if (current) setError("找不到信件指定的工作區，或此帳號已無權限。"); });
    return () => { current = false; };
  }, []);
  return <section className={styles.centerCard}>
    {error ? <p role="alert">{error}</p> : detail ? <><h2>{detail.event.tentativeName}</h2>
      <p>目前狀態：{STATUS_LABEL[detail.event.status]}</p>
      {detail.publication && <p>發布狀態：{detail.publication.status === "published" ? "已公開" : detail.publication.status === "failed" ? "發布未完成" : "正在處理"}</p>}
      <p>{new URLSearchParams(window.location.search).get("section") === "members"
        ? "成員管理請改用桌機。請在桌機開啟同一個連結，接續這個工作區。"
        : "活動資料與地圖編輯請改用桌機。請在桌機開啟同一個連結，接續這個工作區。"}</p></> : <p role="status">載入結果…</p>}
    <p className={styles.linkActions}><a href="/organizer">返回主辦單位工作區</a></p>
  </section>;
}

function NarrowScreenBlocker({ onSignedOut }: { onSignedOut: () => void }) {
  return <section className={styles.centerCard}>
    <h2>請改用桌機</h2>
    <p>活動資料與地圖編輯需要較寬的畫面。</p>
    <button type="button" className={styles.ghost} onClick={() => void signOut().finally(onSignedOut)}>登出</button>
  </section>;
}

/**
 * The organizer's one-time link. `email` fixes the address to the account
 * already signed in, which only needs a link of this audience: signing in
 * through one is what accepts a pending organizer invitation.
 */
function OrganizerLoginLink({ email: signedInEmail }: { email?: string }) {
  const [email, setEmail] = useState(signedInEmail ?? "");
  const [sitekey, setSitekey] = useState<string | null>(null);
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [notice, setNotice] = useState<Notice>(IDLE);
  useEffect(() => { void readTurnstileSitekey().then(setSitekey).catch((error) => setNotice({ kind: "error", message: message(error) })); }, []);
  const unavailable = useCallback(() => setNotice({ kind: "error", message: "真人驗證載入失敗，請檢查網路後重新整理。" }), []);

  return <>
    <form className={styles.stack} onSubmit={(event) => {
      event.preventDefault();
      if (!humanToken) return;
      setNotice({ kind: "busy", message: "寄送中…" });
      void requestLoginLink(email, humanToken, "organizer")
        .then(() => setNotice({ kind: "ok", message: "若帳號可使用，登入連結已寄出。" }))
        .catch((error: unknown) => setNotice({ kind: "error", message: message(error) }))
        .finally(() => { setHumanToken(null); setGeneration((value) => value + 1); });
    }}>
      {signedInEmail ? <p>寄到 {signedInEmail}</p> : <>
        <label htmlFor="organizer-email">Email</label>
        <input id="organizer-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </>}
      {sitekey && <TurnstileWidget key={generation} sitekey={sitekey} onToken={setHumanToken} onUnavailable={unavailable} />}
      <button type="submit" disabled={!humanToken || notice.kind === "busy"}>寄出登入連結</button>
    </form>
    <p className={styles.finePrint}>登入前請閱讀<a href="/privacy">隱私權與資料使用告知</a>。</p>
    {notice.kind !== "idle" && <p role="status" className={notice.kind === "error" ? styles.error : styles.notice}>{notice.message}</p>}
  </>;
}

/**
 * Signed in, with no event, no application and no way to apply (#439). Said
 * once, with the ways back; never the sign-in form again, which would only
 * send the same account round the same loop.
 *
 * The one thing a link can still change is an organizer invitation, accepted
 * only by signing in through an organizer link. Its own link lasts 15 minutes,
 * so an invitee who came in through `/circle` can ask for another here — and
 * only when they say so, so the verification is not loaded for everyone else.
 */
function OrganizerNoAccess({ session }: { session: PortalSession }) {
  const [asking, setAsking] = useState(false);
  return <section className={styles.centerCard} aria-labelledby="organizer-no-access">
    <h2 id="organizer-no-access">此帳號沒有主辦工作區權限</h2>
    <p>目前未開放新活動申請。</p>
    <p className={styles.linkActions}><a href="/circle">返回社團資料</a><a href="/">返回活動列表</a></p>
    <div className={styles.invitation}>
      {asking ? <>
        <h3>寄送主辦登入連結</h3>
        <OrganizerLoginLink email={session.email} />
      </> : <p>收到主辦邀請？<button type="button" className={styles.ghost} onClick={() => setAsking(true)}>寄送主辦登入連結</button></p>}
    </div>
  </section>;
}

function OrganizerWorkspace({ session }: { session: PortalSession }) {
  const [entry] = useState(() => new URLSearchParams(window.location.search));
  const [applicationsOpen, setApplicationsOpen] = useState(() => entry.has("application"));
  const [events, setEvents] = useState<OrganizerEventSummary[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const resumeKey = `organizer.resumeCandidate:${session.email}`;
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (entry.has("candidate")) return entry.get("candidate");
    try { return localStorage.getItem(resumeKey); } catch { return null; }
  });
  const currentSelection = useRef(selectedId);
  useEffect(() => { currentSelection.current = selectedId; }, [selectedId]);
  const [publicationReadError, setPublicationReadError] = useState<{ candidateId: string; needsLogin: boolean } | null>(null);
  const [pollGeneration, setPollGeneration] = useState(0);
  const [detail, setDetail] = useState<OrganizerEventDetail | null>(null);
  const [fieldRequest, setFieldRequest] = useState<FieldRequest | null>(null);
  const [section, setSection] = useState<OrganizerWorkspaceSection>("event");
  const [guidedTask, setGuidedTask] = useState<OrganizerGuidedTask>("identity_source");
  const [showAllTasks, setShowAllTasks] = useState(false);
  // Collapsed, the list gives its width to the workspace. Wide editing surfaces
  // -- the map above all -- are what that width is for.
  const [eventListOpen, setEventListOpen] = useState(true);
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});
  const [surface, setSurface] = useState<"data" | "members" | "claims" | "takedown">(() =>
    entry.has("candidate") && entry.get("section") === "members" ? "members" : "data");
  const { pendingClaims, onQueueLoaded } = useOrganizerPendingClaims(
    detail?.claimReviewAvailable ? detail.event.id : null, detail?.event.eventId ?? null, surface === "claims",
  );
  // Async navigation (including a published-baseline read) must consult the
  // current panel's edits, not the dirty state captured when the request began.
  const dirty = useRef(false);
  const setDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [notice, setNotice] = useState<Notice>(IDLE);
  // The activity whose basic settings were just finished, until the reader
  // moves or acts. Kept here because moving is decided here.
  const [handoff, setHandoff] = useState<string | null>(null);
  const [startingAmendment, setStartingAmendment] = useState(false);
  const [navigationSaving, setNavigationSaving] = useState(false);
  const [navigationSaveRefused, setNavigationSaveRefused] = useState(false);
  const draftSave = useRef<(() => Promise<boolean>) | null>(null);
  const navigationDialog = useRef<HTMLElement | null>(null);
  const selectionInitialized = useRef(false);
  useModalFocus(Boolean(pendingNavigation), navigationDialog, () => setPendingNavigation(null));

  const reloadList = useCallback(async () => {
    const next = (await listOrganizerEvents()).events;
    setEvents(next);
    setListLoaded(true);
    if (!selectionInitialized.current) {
      selectionInitialized.current = true;
      if (entry.has("candidate") && !next.some(item => item.id === entry.get("candidate"))) {
        setSelectedId(null);
        setNotice({ kind: "error", message: "找不到信件指定的工作區，或此帳號已無權限。請從活動列表選擇可使用的活動。" });
      } else setSelectedId((current) => entry.has("candidate") ? current : latestOrganizerEdition(next, current) ?? latestOrganizerEdition(next));
      return next;
    }
    const missingMemberTarget = entry.has("candidate") && entry.get("section") === "members" && currentSelection.current === entry.get("candidate")
      && !next.some(item => item.id === entry.get("candidate"));
    if (missingMemberTarget) setNotice({ kind: "error", message: "找不到信件指定的工作區，或此帳號已無權限。請從活動列表選擇可使用的活動。" });
    setSelectedId((current) => current === null ? null : missingMemberTarget ? null
      : next.some((item) => item.id === current) ? current : latestOrganizerEdition(next));
    return next;
  }, [entry]);
  const reloadDetail = useCallback(async (
    candidateId: string,
    isCurrent: () => boolean = () => true,
    location: "restore" | "keep" | "suggested" = "restore",
  ) => {
    const next = await readOrganizerEvent(candidateId);
    if (!isCurrent()) return null;
    setPublicationReadError(null);
    setPollGeneration((value) => value + 1);
    setDetail(next);
    // Resume navigation only when opening an activity. A save refresh may
    // arrive after the user has moved to another section; its older workspace
    // preference must not move them back or close the all-tasks view.
    if (location === "restore") {
      const fromLetter = entry.get("candidate") === candidateId && entry.get("section") === "review";
      setSection(fromLetter ? "review" : next.workspace.resume.section);
      setGuidedTask(next.workspace.resume.guidedTask);
      setShowAllTasks(fromLetter);
    }
    // Finishing the basic settings opens the binder on the work that comes
    // next. Set in the same pass as the detail, so the binder's first frame is
    // already that section rather than the form just completed.
    if (location === "suggested") {
      setSection(next.workspace.readiness.suggestedNextSection);
      setShowAllTasks(false);
    }
    return next;
  }, [entry]);
  useEffect(() => { queueMicrotask(() => { void reloadList().catch((error) => setNotice({ kind: "error", message: message(error) })); }); }, [reloadList]);
  useEffect(() => {
    // Validate a remembered selection against the list before reading it. A
    // response from an activity we have since left must not replace this one.
    if (!listLoaded) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (selectedId) void reloadDetail(selectedId, () => active).catch((error) => {
        if (active) setNotice({ kind: "error", message: message(error) });
      });
      else setDetail(null);
    });
    return () => { active = false; };
  }, [listLoaded, reloadDetail, selectedId]);
  useEffect(() => {
    try {
      if (selectedId) localStorage.setItem(resumeKey, selectedId);
      else localStorage.removeItem(resumeKey);
    } catch { /* Remembering the selection is optional; keep the workspace usable. */ }
  }, [selectedId, resumeKey]);
  const publicationStatus = detail?.publication?.status;
  useEffect(() => {
    if (!selectedId || !publicationStatus || !["queued", "publishing"].includes(publicationStatus)) return;
    let active = true;
    let inFlight = false;
    let failures = 0;
    const timer = window.setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void readOrganizerEvent(selectedId).then((next) => {
        if (active) {
          failures = 0;
          setPublicationReadError(null);
          setDetail(next);
          setEvents((items) => items.map((item) => item.id === next.event.id ? { ...item, ...next.event } : item));
        }
      }).catch((error) => {
        if (!active) return;
        const needsLogin = error instanceof PortalError && error.status === 401;
        setPublicationReadError({ candidateId: selectedId, needsLogin });
        if (needsLogin || ++failures >= 3) window.clearInterval(timer);
      }).finally(() => { inFlight = false; });
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedId, publicationStatus, pollGeneration]);

  /* The two reads answer different questions and neither needs the other's
   * result, so they go out together: a save waits for this whole refresh
   * before it stops reporting itself as busy, and chaining them put a needless
   * round trip inside that wait. A selection the list no longer carries is
   * still corrected, because reloadList's own update re-runs the detail
   * effect. */
  const refresh = useCallback(async () => {
    const list = reloadList();
    // A panel's action can answer after the reader has opened another
    // activity -- the check in 檢查與發布 starts by itself on entry -- and that
    // answer must not put the activity they left back on screen.
    const candidateId = selectedId;
    await Promise.all([list, candidateId ? reloadDetail(candidateId, () => currentSelection.current === candidateId, "keep").catch(async (error) => {
      // Removing one's own owner grant may make this detail unavailable.
      // The refreshed list already selects an accessible activity or clears it.
      if (error instanceof PortalError && error.status === 404
        && !(await list).some((event) => event.id === candidateId)) return;
      throw error;
    }) : Promise.resolve()]);
  }, [reloadDetail, reloadList, selectedId]);

  const persistLocation = useCallback(async (
    candidateId: string,
    nextTask: OrganizerGuidedTask,
    nextSection: OrganizerWorkspaceSection,
  ) => {
    await saveOrganizerWorkspacePreference(candidateId, { guidedTask: nextTask, lastSection: nextSection });
  }, []);

  /* The button that finished onboarding unmounts with the guided station, so
   * its own result has nowhere to stand. The binder opens on the suggested
   * section instead, with one line there saying what happened and where the
   * rest of the work now lives. That section is also remembered, so the next
   * visit resumes at it rather than at the first of the three finished forms.
   *
   * Completing is a new action, so it clears the workspace notice as it starts,
   * as advancing a guided step does: a failed preference save from an earlier
   * step would otherwise stay above the handoff, failure and success on one
   * screen describing different moments. */
  const completeOnboarding = useCallback(async (candidateId: string, version: number) => {
    setNotice(IDLE);
    await completeOrganizerOnboarding(candidateId, version);
    setHandoff(candidateId);
    const [, next] = await Promise.all([reloadList(), reloadDetail(candidateId, undefined, "suggested")]);
    if (!next) return;
    void persistLocation(candidateId, next.workspace.resume.guidedTask, next.workspace.readiness.suggestedNextSection)
      .catch((error) => setNotice({ kind: "error", message: message(error) }));
  }, [persistLocation, reloadDetail, reloadList]);

  const finishNavigation = (request: PendingNavigation) => {
    setNotice(IDLE);
    setHandoff(null);
    setPendingNavigation(null);
    setDirty(false);
    draftSave.current = null;
    request.run();
  };
  const requestNavigation = (description: string, run: () => void) => {
    const request = { description, run };
    setNavigationSaveRefused(false);
    if (dirty.current) setPendingNavigation(request);
    else finishNavigation(request);
  };
  const saveAndNavigate = async () => {
    if (!pendingNavigation || !draftSave.current) return;
    const request = pendingNavigation;
    // The dialog stays up for the whole save; without a busy state its buttons
    // read as unpressed for the couple of seconds the write and the two reads
    // behind it take, and a second press would save the same draft twice.
    setNavigationSaving(true);
    setNavigationSaveRefused(false);
    try {
      // A refused save leaves the dialog covering the panel that says why,
      // so pressing 儲存並切換 read as nothing happening at all. The reason
      // lives behind this dialog; the press at least admits it was refused.
      if (await draftSave.current()) finishNavigation(request);
      else setNavigationSaveRefused(true);
    } finally {
      setNavigationSaving(false);
    }
  };

  const chooseEvent = (candidateId: string) => {
    requestNavigation("切換活動", () => {
      setApplicationsOpen(false); setSurface("data");
      if (candidateId !== selectedId) { setDetail(null); setSelectedId(candidateId); }
    });
  };

  const chooseSection = (nextSection: OrganizerWorkspaceSection, target?: string) => {
    if (!detail) return;
    if (nextSection === section && target && (detail.workspace.mode !== "guided" || showAllTasks)) {
      setFieldRequest({ candidateId: detail.event.id, section: nextSection, target });
      return;
    }
    requestNavigation("切換項目", () => {
      setSurface("data");
      setFieldRequest(target ? { candidateId: detail.event.id, section: nextSection, target } : null);
      setSection(nextSection);
      if (detail.workspace.mode === "guided") setShowAllTasks(true);
      void persistLocation(detail.event.id, guidedTask, nextSection)
        .catch((error) => setNotice({ kind: "error", message: message(error) }));
    });
  };

  const chooseGuidedTask = (nextTask: OrganizerGuidedTask) => {
    if (!detail) return;
    requestNavigation("切換步驟", () => {
      setGuidedTask(nextTask);
      void persistLocation(detail.event.id, nextTask, section)
        .catch((error) => setNotice({ kind: "error", message: message(error) }));
    });
  };
  const advanceGuidedTask = (nextTask: OrganizerGuidedTask) => {
    if (!detail) return;
    setNotice(IDLE);
    setDirty(false);
    setGuidedTask(nextTask);
    void persistLocation(detail.event.id, nextTask, section)
      .catch((error) => setNotice({ kind: "error", message: message(error) }));
  };

  if (applicationsOpen) return <main className={styles.applicationMain}>
    <button type="button" className={styles.ghost} onClick={() => setApplicationsOpen(false)}>返回活動工作區</button>
    <OrganizerApplicationsPanel session={session} onReviewed={async () => { await reloadList(); }} />
  </main>;

  const groups = groupOrganizerEvents(events);
  const selectedGroup = groups.find(group => group.editions.some(event => event.id === selectedId));

  return <main className={eventListOpen ? styles.shell : `${styles.shell} ${styles.shellNarrow}`}>
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHead}>
        {eventListOpen && <div className={styles.sidebarTitle}><h2>活動列表</h2><p>切換活動與查看狀態</p></div>}
        <button
          type="button"
          className={`${styles.ghost} ${styles.sidebarToggle}`}
          aria-expanded={eventListOpen}
          aria-controls="organizer-event-list"
          aria-label={eventListOpen ? "收合活動列表" : "展開活動列表"}
          onClick={() => setEventListOpen(!eventListOpen)}
        ><UiIcon name={eventListOpen ? "chevron-left" : "chevron-right"} /></button>
      </div>
      <div id="organizer-event-list" hidden={!eventListOpen}>
        {(session.isAdmin || session.canApplyForEvent || session.hasEventApplications) && <button type="button" className={styles.ghost}
          onClick={() => requestNavigation("查看活動申請", () => setApplicationsOpen(true))}>活動申請</button>}
        {session.isAdmin && <CreateEntry
          onStarted={() => setNotice(IDLE)}
          onCreated={async (id) => { await reloadList(); setSelectedId(id); }}
          onInvitationFailed={(delivery, email) => setNotice({ kind: "error", message:
            (delivery === "failed" ? "活動已建立，邀請信未寄出。" : "活動已建立，無法確認邀請信是否寄出。")
            + (email.normalize("NFKC").trim().toLowerCase() === session.email ? "" : "請到「成員與權限」重寄負責人邀請信。") })}
        />}
        <nav aria-label="活動列表" className={styles.eventList}>
          {groups.map(group => {
            const active = group.id === selectedGroup?.id;
            const expanded = expandedEvents[group.id] ?? active;
            return <div key={group.id} className={styles.eventGroup}>
              <button type="button" aria-expanded={expanded} aria-controls={`event-group-${group.latest.id}`}
                className={active ? styles.eventActive : styles.eventButton} onClick={() => {
                  if (expanded) setExpandedEvents(current => ({ ...current, [group.id]: false }));
                  else requestNavigation("切換活動", () => {
                    setExpandedEvents(current => ({ ...current, [group.id]: true }));
                    setApplicationsOpen(false); setSurface("data");
                    if (selectedId !== group.latest.id) { setDetail(null); setSelectedId(group.latest.id); }
                  });
                }}>
                <span className={styles.eventGroupName} data-expanded={expanded}><UiIcon name="chevron-right" />{group.name}</span>
                <small>第 {group.latest.edition ?? 1} 版・{STATUS_LABEL[group.latest.status]}</small>
              </button>
              <div id={`event-group-${group.latest.id}`} hidden={!expanded} className={styles.eventGroupActions}>
                <label className={styles.editionSelect}>版本<select aria-label={active ? "活動版本" : `${group.name}版本`} value={active ? selectedId ?? group.latest.id : group.latest.id} onChange={event => {
                  const candidateId = event.target.value;
                  requestNavigation("切換版本", () => { if (!active) setSurface("data"); setDetail(null); setSelectedId(candidateId); });
                }}>
                  {group.editions.map((edition, index) => <option key={edition.id} value={edition.id}>第 {edition.edition ?? group.editions.length - index} 版{index === 0 ? "（最新）" : ""}・{STATUS_LABEL[edition.status]}</option>)}
                </select></label>
                <button type="button" className={styles.ghost} aria-current={active && surface === "data" ? "page" : undefined}
                  onClick={() => {
                    if (active) requestNavigation("開啟活動資料", () => setSurface("data"));
                    else chooseEvent(group.latest.id);
                  }}>活動資料</button>
                {active && detail?.claimReviewAvailable && <>
                  <button type="button" className={styles.ghost} aria-current={surface === "claims" ? "page" : undefined}
                    onClick={() => requestNavigation("查看社團認領", () => setSurface("claims"))}>社團認領</button>
                  <button type="button" className={styles.ghost} aria-current={surface === "takedown" ? "page" : undefined}
                    onClick={() => requestNavigation("撤下補充資料", () => setSurface("takedown"))}>撤下補充資料</button>
                </>}
              </div>
            </div>;
          })}
        </nav>
      </div>
    </aside>
    <section className={styles.workspace}>
      {notice.kind !== "idle" && <p role="status" className={notice.kind === "error" ? styles.error : styles.notice}>{notice.message}</p>}
      {detail && <OrganizerWorkspaceHeader detail={detail} pendingClaims={pendingClaims}
        current={surface === "members" || surface === "claims" ? surface
          : surface === "data" && section === "review" && (detail.workspace.mode !== "guided" || showAllTasks) ? "review" : null}
        onOpen={(target) => {
          if (target === "review") chooseSection("review");
          else requestNavigation(target === "claims" ? "查看社團認領" : "開啟成員與權限", () => setSurface(target));
        }} />}
      {surface === "data" && detail?.event.status === "published" && (detail.event.role === "owner" || session.isAdmin) && <div className={styles.guideBanner}>
        <div><strong>修正已發布名單</strong><p>建立修正草稿，原本的公開活動會持續提供，直到新版核准並完成發布。</p></div>
        <button type="button" disabled={startingAmendment} onClick={() => {
          setStartingAmendment(true); setNotice({ kind: "busy", message: "正在核對已發布版本…" });
          void startOrganizerAmendment(detail.event.id, detail.event.version).then(async (result) => {
            // Select the created candidate even if remembering its initial tab fails.
            await saveOrganizerWorkspacePreference(result.candidateId, { lastSection: "import", guidedTask: "identity_source" }).catch(() => {});
            await reloadList();
            requestNavigation("開啟已建立的修正候選", () => setSelectedId(result.candidateId));
            setNotice(IDLE);
          }).catch((error) => setNotice({ kind: "error", message: message(error) })).finally(() => setStartingAmendment(false));
        }}>{startingAmendment ? "核對中…" : "開始修正已發布活動"}</button>
      </div>}
      {publicationReadError?.candidateId === selectedId && publicationReadError && <div role="alert" className={styles.error}>
        <p>{publicationReadError.needsLogin ? "登入已失效，無法更新發布進度。" : "暫時無法讀取發布進度。"}目前顯示的是上次讀取的進度。</p>
        {publicationReadError.needsLogin ? <a href="/organizer?reauth=1">重新登入並返回活動</a>
          : <button type="button" onClick={() => { void refresh().catch((error) => setNotice({ kind: "error", message: message(error) })); }}>重新讀取進度</button>}
      </div>}
      {/* An empty list used to be told to open something from a list that has
          nothing in it. The line now names the one thing that can be done from
          here, and for someone who cannot create activities that is waiting
          for an invitation, not pressing a button they do not have (#225). */}
      {!detail && selectedId ? <div className={styles.empty}><p role="status">載入活動…</p></div> : !detail ? <div className={styles.empty}>
        <h2>{events.length === 0 ? "還沒有活動" : "選擇活動"}</h2>
        <p>{events.length > 0 ? "從左側開啟活動，開始準備送審資料。"
          : session.isAdmin ? "建立新活動後，活動會出現在左側。"
            : "收到主辦邀請後，活動會出現在左側。"}</p>
      </div>
        : surface === "members" ? <MembersPanel key={detail.event.id} session={session} detail={detail} onChanged={refresh} onClose={() => setSurface("data")} />
        : surface !== "data" && detail.claimReviewAvailable && detail.event.eventId
          ? surface === "claims" ? <OrganizerClaimsPanel key={detail.event.id} candidateId={detail.event.id} eventId={detail.event.eventId} onQueueLoaded={onQueueLoaded} />
            : <OrganizerTakedownPanel key={detail.event.id} candidateId={detail.event.id} eventId={detail.event.eventId} />
          : <WorkspaceSurface
          key={detail.event.id}
          session={session}
          detail={detail}
          section={section}
          guidedTask={guidedTask}
          showAllTasks={showAllTasks}
          onSection={chooseSection}
          fieldRequest={fieldRequest?.candidateId === detail.event.id ? fieldRequest : null}
          onGuidedTask={chooseGuidedTask}
          onGuidedTaskSaved={advanceGuidedTask}
          onShowAll={() => requestNavigation("查看全部項目", () => setShowAllTasks(true))}
          onReturnToGuide={() => requestNavigation("回到基本設定", () => setShowAllTasks(false))}
          onLeave={() => { setNotice(IDLE); setDirty(false); setSelectedId(null); }}
          onCompleteOnboarding={(version) => completeOnboarding(detail.event.id, version)}
          handoff={handoff === detail.event.id}
          onHandoffDone={() => setHandoff(null)}
          onChanged={refresh}
          onDirtyChange={setDirty}
          onDraftSaveReady={(save) => { draftSave.current = save; }}
          persistLocation={persistLocation}
        />}
      {pendingNavigation && <div className={styles.dialogBackdrop}>
        <section ref={navigationDialog} className={styles.navigationDialog} role="dialog" aria-modal="true" aria-labelledby="unsaved-title" aria-describedby="unsaved-description" tabIndex={-1}>
          <h3 id="unsaved-title">尚有未儲存變更</h3>
          <p id="unsaved-description">要先儲存目前的修改，再{pendingNavigation.description}嗎？</p>
          <div className={styles.dialogActions}>
            <button type="button" disabled={navigationSaving} onClick={() => { void saveAndNavigate(); }}>{navigationSaving ? "儲存中…" : "儲存並切換"}</button>
            <button type="button" className={styles.secondary} disabled={navigationSaving} onClick={() => finishNavigation(pendingNavigation)}>放棄</button>
            <button type="button" className={styles.ghost} disabled={navigationSaving} onClick={() => setPendingNavigation(null)}>取消</button>
          </div>
          {navigationSaveRefused && <p role="alert" className={styles.error}>沒有儲存成功。請按「取消」回到表單，照上面列出的說明處理後再試一次。</p>}
        </section>
      </div>}
    </section>
  </main>;
}

function WorkspaceSurface({
  session, detail, section, guidedTask, showAllTasks, onSection, onGuidedTask, onGuidedTaskSaved, fieldRequest,
  onShowAll, onReturnToGuide, onLeave, onCompleteOnboarding, handoff, onHandoffDone, onChanged, onDirtyChange, onDraftSaveReady, persistLocation,
}: {
  session: PortalSession;
  detail: OrganizerEventDetail;
  section: OrganizerWorkspaceSection;
  guidedTask: OrganizerGuidedTask;
  showAllTasks: boolean;
  fieldRequest: FieldRequest | null;
  onSection: (section: OrganizerWorkspaceSection, target?: string) => void;
  onGuidedTask: (task: OrganizerGuidedTask) => void;
  onGuidedTaskSaved: (task: OrganizerGuidedTask) => void;
  onShowAll: () => void;
  onReturnToGuide: () => void;
  onLeave: () => void;
  onCompleteOnboarding: (version: number) => Promise<void>;
  /** The basic settings were just finished and the reader has not moved yet. */
  handoff: boolean;
  onHandoffDone: () => void;
  onChanged: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onDraftSaveReady: (save: (() => Promise<boolean>) | null) => void;
  persistLocation: (candidateId: string, task: OrganizerGuidedTask, section: OrganizerWorkspaceSection) => Promise<void>;
}) {
  const guided = detail.workspace.mode === "guided" && !showAllTasks;
  const wideRoster = section === "import" && detail.event.operation !== "AMEND";
  const [liveDraft, setLiveDraft] = useState(detail.draft);
  const [liveReferences, setLiveReferences] = useState(detail.referenceCatalog);
  const [liveVenueCatalog, setLiveVenueCatalog] = useState(detail.venueCatalog);
  const [mapLocation, setMapLocation] = useState<OrganizerMapLocation | null>(null);
  const [liveDirty, setLiveDirty] = useState(false);
  const activeLiveSection = section === "venue" ? "venue" : section === "event" ? "event" : undefined;
  return <>
    {!guided && wideRoster && <div className={styles.workspaceHead}><RosterNavigation detail={detail} current={section} onSection={onSection} /></div>}
    {guided ? <div className={styles.guidedOnly}>
      <GuidedTaskStation
        detail={detail}
        task={guidedTask}
        onTask={onGuidedTask}
        onTaskSaved={onGuidedTaskSaved}
        onShowAll={onShowAll}
        onLeave={onLeave}
        onComplete={onCompleteOnboarding}
        onChanged={onChanged}
        onDirtyChange={onDirtyChange}
        onDraftSaveReady={onDraftSaveReady}
        onLiveDraftStateChange={(nextDraft, dirty, catalog, references) => { setLiveReferences(references); setLiveDraft(nextDraft); setLiveVenueCatalog(catalog); setLiveDirty(dirty); }}
        persistLocation={persistLocation}
      />
    </div> : <>
      {detail.workspace.mode === "guided" && <div className={styles.guideBanner}>
        <div><strong>你正在查看全部項目</strong><p>下次登入仍會回到上次的基本設定步驟。</p></div>
        <button type="button" className={styles.secondary} onClick={onReturnToGuide}>回到基本設定</button>
      </div>}
      <div className={wideRoster ? styles.workspaceRoster : styles.workspaceGrid}>
        {/* The wrapper is always here, so the panel keeps its place in the tree
            when the handoff line comes and goes. Any control pressed in the
            panel is a new action, and the line describes the one before it. */}
        <div
          className={styles.workspaceMain}
          onChangeCapture={handoff ? onHandoffDone : undefined}
          onClickCapture={handoff ? (event) => { if ((event.target as Element).closest("button, a, input, select, textarea, summary")) onHandoffDone(); } : undefined}
        >
          {handoff && <OnboardingHandoff detail={detail} section={section} />}
          {/* Editable panels keep their action feedback across their own saves.
              檢查與發布 still resets when the candidate version changes. */}
          <StepContent
            key={`${detail.event.id}:${section}${["event", "venue", "map"].includes(section) || (section === "import" && detail.event.operation !== "AMEND") ? "" : `:${detail.event.version}`}`}
            session={session}
            detail={detail}
            section={section}
            fieldRequest={fieldRequest?.section === section ? fieldRequest : null}
            onSection={onSection}
            mapLocation={mapLocation?.candidateId === detail.event.id ? mapLocation : null}
            onLocate={location => { setMapLocation(location); onSection("map"); }}
            onChanged={onChanged}
            onDirtyChange={onDirtyChange}
            onDraftSaveReady={onDraftSaveReady}
            onDraftStateChange={(nextDraft, dirty, catalog, references) => { setLiveReferences(references); setLiveDraft(nextDraft); setLiveVenueCatalog(catalog); setLiveDirty(dirty); }}
          />
        </div>
        {!wideRoster && <ReadinessRail detail={detail} current={section} onSection={onSection} liveDraft={liveDraft} liveReferences={liveReferences} liveVenueCatalog={liveVenueCatalog} liveDirty={liveDirty} liveSection={activeLiveSection} />}
      </div>
    </>}
  </>;
}

/** The one moment the navigation changes shape: three numbered steps give way
 * to the five sections in 準備進度. Said once, on the section the reader was
 * brought to, and gone as soon as they move or act. The button that led here
 * has just unmounted, so focus comes here: a keyboard reader is not dropped to
 * the top of the document, and a reader who scrolled down to press it sees
 * this line rather than the middle of the next panel. */
function OnboardingHandoff({ detail, section }: { detail: OrganizerEventDetail; section: OrganizerWorkspaceSection }) {
  const line = useRef<HTMLDivElement | null>(null);
  useEffect(() => { line.current?.focus(); }, []);
  return <div ref={line} tabIndex={-1} role="status" className={styles.handoff}>
    <strong>基本設定完成</strong>
    <p>{section === "import"
      ? "接下來匯入攤位名單。其餘項目從右上「準備進度」進入。"
      : `接下來處理「${organizerSectionLabel(detail, section)}」。其餘項目從右側「準備進度」進入。`}</p>
  </div>;
}

function GuidedTaskStation({
  detail, task, onTask, onTaskSaved, onShowAll, onLeave, onComplete, onChanged, onDirtyChange, onDraftSaveReady, onLiveDraftStateChange, persistLocation,
}: {
  detail: OrganizerEventDetail;
  task: OrganizerGuidedTask;
  onTask: (task: OrganizerGuidedTask) => void;
  onTaskSaved: (task: OrganizerGuidedTask) => void;
  onShowAll: () => void;
  onLeave: () => void;
  onComplete: (version: number) => Promise<void>;
  onChanged: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onDraftSaveReady: (save: (() => Promise<boolean>) | null) => void;
  onLiveDraftStateChange: (draft: OrganizerEventDraft, dirty: boolean, catalog: OrganizerVenueCatalog, references: OrganizerReferenceCatalog) => void;
  persistLocation: (candidateId: string, task: OrganizerGuidedTask, section: OrganizerWorkspaceSection) => Promise<void>;
}) {
  /* The station keeps only the dirty flag now that progress is counted from
   * the stored draft: the live draft still travels up, because the rail the
   * reader sees after onboarding is built from it. */
  const [liveDirty, setLiveDirty] = useState(false);
  const taskIndex = ORGANIZER_GUIDED_TASKS.indexOf(task);
  const completed = ORGANIZER_GUIDED_TASKS.filter((item) => organizerGuidedDraftIssues(detail.draft, item, detail.venueCatalog).length === 0).length;
  const nextTask = ORGANIZER_GUIDED_TASKS[taskIndex + 1] ?? null;
  const section = task === "venue" ? "venue" : "event";

  const afterPrimarySave = async (version: number) => {
    if (nextTask) {
      await persistLocation(detail.event.id, nextTask, section);
      onTaskSaved(nextTask);
      return;
    }
    // The button stays busy through all of this, and a failure is reported
    // beside it by the form; success is the binder opening on the next section.
    await onComplete(version);
  };

  return <section className={styles.guidedStation}>
    <div className={styles.guidedHead}>
      <div><h3>先完成基本設定</h3><p>這三項填完，就能開始匯入攤位、製作地圖與送審。</p></div>
      <div className={styles.progressText}><strong>已完成 {completed}/3</strong><progress max={3} value={completed} aria-label={`已完成 ${completed} 個，共 3 個基本設定步驟`} /></div>
    </div>
    <ol className={styles.guidedSteps} aria-label="基本設定步驟">
      {ORGANIZER_GUIDED_TASKS.map((item, index) => {
        const done = organizerGuidedDraftIssues(detail.draft, item, detail.venueCatalog).length === 0;
        const state = liveDirty && item === task ? "尚未儲存" : done ? "已完成" : item === task ? "目前步驟" : "尚未完成";
        return <li key={item}><button type="button" aria-current={item === task ? "step" : undefined} onClick={() => onTask(item)}>
          <span>{index + 1}</span><span>{GUIDED_LABEL[item]}<small>{state}</small></span>
        </button></li>;
      })}
    </ol>
    <DraftForm
      key={task}
      detail={detail}
      section={section}
      guidedTask={task}
      saveLabel={nextTask ? "儲存並繼續" : "完成基本設定"}
      secondarySaveLabel="儲存並離開"
      onSaved={afterPrimarySave}
      onSecondarySaved={async () => { await persistLocation(detail.event.id, task, section); onLeave(); }}
      onChanged={onChanged}
      onDirtyChange={onDirtyChange}
      onSaveReady={onDraftSaveReady}
      onDraftStateChange={(nextDraft, dirty, catalog, references) => { setLiveDirty(dirty); onLiveDraftStateChange(nextDraft, dirty, catalog, references); }}
    />
    <div className={styles.exploreRow}><button type="button" className={styles.textButton} onClick={onShowAll}>查看全部項目</button><span>可以先看後面的項目，不會影響目前進度。</span></div>
  </section>;
}

function RosterNavigation({ detail, current, onSection }: { detail: OrganizerEventDetail; current: OrganizerWorkspaceSection; onSection: (section: OrganizerWorkspaceSection, target?: string) => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false; };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open && menu.current.contains(document.activeElement)) {
        event.preventDefault(); menu.current.open = false; menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, []);
  const { completed, total, suggestedNextSection } = detail.workspace.readiness;
  /* The table takes the rail's column, so the one step that matters most here
   * -- leaving a finished roster for the map -- stands beside the heading
   * instead of inside the menu. Unsaved roster edits go through the same
   * save-or-discard prompt as any other move. */
  return <div className={styles.rosterProgress}>
    <details ref={menu} className={styles.rosterNavigation}><summary>準備進度 {completed}/{total}</summary>
      <ReadinessRail detail={detail} current={current} showNextAction={false} onSection={(section, target) => { if (menu.current) menu.current.open = false; onSection(section, target); }} />
    </details>
    {suggestedNextSection !== current && <button type="button" onClick={() => onSection(suggestedNextSection)}>下一步：{organizerSectionLabel(detail, suggestedNextSection)}</button>}
  </div>;
}

function ReadinessRail({ detail, current, onSection, compact = false, showNextAction = true, liveDraft, liveReferences, liveVenueCatalog, liveDirty = false, liveSection }: {
  detail: OrganizerEventDetail;
  /** The section open beside the rail. */
  current: OrganizerWorkspaceSection;
  onSection: (section: OrganizerWorkspaceSection, target?: string) => void;
  compact?: boolean;
  /** Off where the next step already stands outside the rail. */
  showNextAction?: boolean;
  liveDraft?: OrganizerEventDraft;
  liveReferences?: OrganizerReferenceCatalog;
  liveVenueCatalog?: OrganizerVenueCatalog;
  liveDirty?: boolean;
  liveSection?: "event" | "venue";
}) {
  const readiness = detail.workspace.readiness;
  const catalog = liveVenueCatalog ?? detail.venueCatalog;
  const liveEventIssues = liveDraft && liveDirty
    ? [...organizerGuidedDraftIssues(liveDraft, "identity_source", catalog), ...organizerGuidedDraftIssues(liveDraft, "days", catalog), ...validateOrganizerReferences(liveDraft, liveReferences ?? detail.referenceCatalog ?? { organizers: [], categories: [] })]
    : [];
  const liveVenueIssues = liveDraft && liveDirty ? organizerGuidedDraftIssues(liveDraft, "venue", catalog) : [];
  const liveIssues = [...liveEventIssues, ...liveVenueIssues];
  const blockers = liveDraft && liveDirty && liveSection
    ? [
      ...liveIssues.map((issue) => ({ section: issue.step === "venue" ? "venue" as const : "event" as const, code: issue.code, message: issue.message, target: issue.target })),
      ...((liveSection === "venue" ? liveVenueIssues : liveEventIssues).length > 0
        ? []
        : [{
          section: liveSection,
          code: `unsaved_${liveSection}`,
          message: liveSection === "venue" ? "場館與場地已選好，尚未儲存。" : "活動基本資料已修改，尚未儲存。",
        }]),
    ]
    /* The rail reports what is wrong, not everything that is not yet done. A
     * section nobody has started is neutral, and the complete list of blocking
     * issues belongs to 檢查與發布, where it is asked for rather than carried
     * alongside every other screen. The live branch above is exempt: it is about
     * the section being edited right now, which is by definition engaged with
     * (#221 4.4, 4.5). */
    : readiness.blockers.filter((blocker) => readiness.sections
      .some((section) => section.id === blocker.section && section.state === "needs_attention"));
  const visibleBlockers = blockers.slice(0, compact ? 3 : 5);
  const currentSavedState = liveSection
    ? readiness.sections.find((item) => item.id === liveSection)?.state
    : undefined;
  const completed = liveDirty && currentSavedState === "complete" ? readiness.completed - 1 : readiness.completed;
  const nextSection = liveDirty && liveSection ? liveSection : readiness.suggestedNextSection;
  const liveSectionIndex = liveSection ? ORGANIZER_WORKSPACE_SECTIONS.indexOf(liveSection) : -1;
  // Already standing on the next step, the button would send the reader to
  // the panel beside it and visibly do nothing; the marked row says it instead.
  const showNext = nextSection !== current;
  return <aside className={styles.readiness} aria-label="活動準備進度">
    <div className={styles.readinessHead}><h3>準備進度</h3><strong>{completed}/{readiness.total}</strong></div>
    <p>最後儲存 {new Date(detail.event.updatedAt).toLocaleString("zh-TW")}</p>
    {showNext && showNextAction && <button type="button" className={styles.nextAction} onClick={() => onSection(nextSection)}>
      下一步：{organizerSectionLabel(detail, nextSection)}
    </button>}
    {/* Named, because this is now the only way to reach a section: the strip
        that used to carry 活動項目 above the panel was a second copy of this
        list, kept in step by hand (#221 1.1). The open section is marked, so
        the list also answers where the reader is. */}
    <div className={styles.readinessList} role="group" aria-label="活動項目">{readiness.sections.map((item) => <button type="button" key={item.id} aria-current={item.id === current ? "page" : undefined} onClick={() => onSection(item.id)}>
      <span>{organizerSectionLabel(detail, item.id)}</span><small data-state={item.state}>{liveDirty && liveSection
        ? item.id === liveSection ? "尚未儲存" : ORGANIZER_WORKSPACE_SECTIONS.indexOf(item.id) > liveSectionIndex ? "需先儲存" : organizerSectionStateLabel(detail, item)
        : organizerSectionStateLabel(detail, item)}</small>
    </button>)}</div>
    <div className={styles.blockerList}><h4>待修正清單</h4>{visibleBlockers.length === 0 ? <p>{showNext ? "沒有需要修正的項目；還沒開始的工作看上面的下一步。" : "沒有需要修正的項目。"}</p> : visibleBlockers.map((blocker, index) => <button type="button" key={`${blocker.section}-${blocker.code}-${index}`} onClick={() => onSection(blocker.section, organizerIssueTarget(blocker, liveDraft ?? detail.draft))}>
      <strong>{organizerSectionLabel(detail, blocker.section)}</strong><span>{organizerIssueMessage(blocker, catalog, liveDraft ?? detail.draft)}</span>
    </button>)}</div>
    {blockers.length > visibleBlockers.length && <p>另有 {blockers.length - visibleBlockers.length} 項，請到對應項目處理。</p>}
  </aside>;
}

function CreateEntry({ onStarted, onCreated, onInvitationFailed }: {
  onStarted: () => void;
  onCreated: (id: string) => Promise<void>;
  onInvitationFailed: (delivery: "sent" | "failed" | "unknown", email: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<Notice>(IDLE);
  if (!open) return <button type="button" className={styles.createButton} onClick={() => setOpen(true)}>建立新活動</button>;
  return <form className={styles.createForm} onSubmit={(event) => {
    event.preventDefault();
    onStarted();
    setNotice({ kind: "busy", message: "建立中…" });
    void createOrganizerEvent(name, email).then(async ({ candidateId, invitationSent, invitationDelivery }) => {
      setName(""); setEmail(""); setOpen(false);
      await onCreated(candidateId);
      // The activity is created either way. Saying only that it worked would
      // leave the owner waiting for mail that never arrives.
      if (!invitationSent) onInvitationFailed(invitationDelivery, email);
    }).catch((error) => setNotice({ kind: "error", message: message(error) }));
  }}>
    <label><span>暫定名稱<RequiredMark /></span><input aria-label="暫定名稱" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label><span>負責人 Email<RequiredMark /></span><input aria-label="負責人 Email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <div className={styles.row}><button type="submit">建立並邀請</button><button type="button" className={styles.ghost} onClick={() => setOpen(false)}>取消</button></div>
    {notice.kind === "error" && <p className={styles.error}>{notice.message}</p>}
  </form>;
}

function StepContent({ session, detail, section, onSection, onChanged, onDirtyChange, onDraftSaveReady, onDraftStateChange, mapLocation, onLocate, fieldRequest }: {
  session: PortalSession;
  detail: OrganizerEventDetail;
  section: OrganizerWorkspaceSection;
  /* A section whose prerequisite lives in another one has to be able to send
   * the reader there: 「先匯入這個活動日的攤位名單」 is only useful with a way to
   * go and do it (#221 Phase 5). */
  onSection: (section: OrganizerWorkspaceSection, target?: string) => void;
  onChanged: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onDraftSaveReady: (save: (() => Promise<boolean>) | null) => void;
  onDraftStateChange: (draft: OrganizerEventDraft, dirty: boolean, catalog: OrganizerVenueCatalog, references: OrganizerReferenceCatalog) => void;
  mapLocation: OrganizerMapLocation | null;
  fieldRequest: FieldRequest | null;
  onLocate: (location: OrganizerMapLocation) => void;
}) {
  if (section === "event" || section === "venue") return <DraftForm detail={detail} section={section} fieldRequest={fieldRequest} onChanged={onChanged} onDirtyChange={onDirtyChange} onSaveReady={onDraftSaveReady} onDraftStateChange={onDraftStateChange} />;
  if (section === "import") return detail.event.operation === "AMEND"
    ? <OrganizerAmendmentPanel detail={detail} onChanged={onChanged} onDirtyChange={onDirtyChange} onSaveReady={onDraftSaveReady} />
    : <ImportPanel detail={detail} onChanged={onChanged} onSection={onSection} onDirtyChange={onDirtyChange} onSaveReady={onDraftSaveReady} onLocate={onLocate} />;
  if (section === "map") return <OrganizerMapPanel detail={detail} onChanged={onChanged} onSection={onSection} location={mapLocation} onDirtyChange={onDirtyChange} onSaveReady={onDraftSaveReady} />;
  return <ReviewPanel session={session} detail={detail} onChanged={onChanged} onSection={onSection} />;
}

