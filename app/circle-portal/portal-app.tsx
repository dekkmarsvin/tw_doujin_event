"use client";

import { localizedHref } from "../i18n/locale";
import { LanguageSwitcher } from "../i18n/language-switcher";
import { useAccountPreferences } from "./use-account-preferences";
import { usePortalText, portalNotice, noticeError, type PortalNotice } from "./portal-i18n";
import { useLocale, useDocumentLanguage } from "../i18n/locale-context";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createClaim, deleteMyAccount, deleteMyOverride, listMyClaims, readMyOverride,
  previewOverride, readSession, readClaimCircle, setPostEventVisibility, runChallenge, saveOverride, searchCircles, signOut, uploadThumbnail, verifyLoginToken, withdrawClaim,
  setPortalEventId,
  type CircleMatch, type ClaimSummary, type PortalSession,
} from "../circle-editor-client";
import {
  AGE_RATING_OPTIONS, CIRCLE_OVERRIDE_LIST_FIELDS, CREATOR_TYPE_OPTIONS, LINK_KINDS, OVERRIDE_LIMITS, WORK_TYPE_OPTIONS,
  circleOverrideFieldMode, clearCircleOverrideField, inheritCircleOverrideField, circleOptionLabel,
  type CircleOverrideFieldKey, type CircleOverrideFields, type CircleOverrideThumbnail,
} from "../circle-overrides";
import { linkUrlProblem, thumbnailUrlProblem, THUMBNAIL_NOT_AN_IMAGE } from "../circle-override-messages";
import { CircleDetails } from "../event-workspace-panels";
import { linkKindLabel } from "../circle-presentation";
import { useModalFocus } from "../use-modal-focus";
import type { CircleExternalLink, CircleViewRecord } from "../circle-records";
import { projectCircleDraftRecords } from "../circle-records";
import { PUBLISHED_EVENTS, getPublishedEvent, type EventDefinition } from "../event-catalog";
import { eventCalendar, eventsByProximity, nearestEvent, taipeiDate } from "../event-calendar";
import { AccountNotificationSettings } from "../account-notification-settings";
import { adminLoginDestination } from "../notification-navigation";
import { ContactLink, WorkspaceSwitch } from "../workspace-nav";
import { SignInFinePrint, SignInScreen } from "../portal-sign-in";
import { MapContributorPanel } from "./map-contribution-panel";
import { CirclePageShare } from "./circle-page-share";
import { selectedCircleShareImage } from "../circle-share-image";
import { CatalogImagesField } from "./catalog-images-field";
import { pointTo } from "./point-to";
import { useSessionExpiry } from "./session-status";
import { AccountMenu } from "./account-menu";
import styles from "./portal.module.css";

/**
 * `at` places an editor message beside the control that caused it: the
 * after-event switch and the deletion each answer in their own section, and
 * everything else in the editor's action bar. One value rather than three, so
 * a new action always replaces the last message instead of standing next to it.
 */
type Status = { kind: "idle" | "busy" | "ok" | "error"; message: PortalNotice; at?: "setting" | "delete" };

const IDLE: Status = { kind: "idle", message: "" };
const SAVED_MESSAGE = "已儲存，公開頁面會在一分鐘內更新。";
/**
 * The map reads the same parameters it writes (`parseEventUrlState`), so a
 * record is enough to open the reader on that booth. Without one the link is
 * still the map, just not pointed anywhere in particular.
 */
const mapHref = (eventId: string, record?: CircleViewRecord) => {
  const parameters = new URLSearchParams({ event: eventId });
  if (record) {
    parameters.set("day", String(record.day));
    parameters.set("area", record.hall);
    parameters.set("selectedCircle", record.circle.id);
    parameters.set("selectedBooth", record.code);
  }
  return `/?${parameters.toString()}`;
};
/** The map side panel renders `externalLinks.slice(0, 6)`; the rest move to full detail. */
const SIDE_PANEL_LINK_LIMIT = 6;

const EMPTY_LINK: CircleExternalLink = { provider: "", kind: "social", url: "" };

const PORTAL_EVENT_STORAGE_KEY = "circle-portal-event";

/**
 * Which event this browser maintains. The account is the same in every event
 * and the claim is not, so the choice is a client-side pointer, never an
 * authorization: the server decides what this account owns in the event the
 * request names (ADR-0043).
 *
 * A link that names an event wins, so a circle can be sent straight to the
 * right one; otherwise the last event maintained here, and only then the
 * nearest event by date. An unpublished or unknown id falls back rather than
 * showing an event this build does not serve.
 */
function initialPortalEventId() {
  const fallback = (nearestEvent(PUBLISHED_EVENTS, taipeiDate(Date.now())) ?? PUBLISHED_EVENTS[0])?.id ?? "";
  if (typeof window === "undefined") return fallback;
  const named = new URLSearchParams(window.location.search).get("event") ?? "";
  if (getPublishedEvent(named)) return named;
  let stored = "";
  try {
    stored = window.localStorage.getItem(PORTAL_EVENT_STORAGE_KEY) ?? "";
  } catch {
    stored = "";
  }
  return getPublishedEvent(stored) ? stored : fallback;
}

/**
 * Unsaved edits, kept on this device only.
 *
 * The editor is long, the content is written in one sitting at a desk, and a
 * closed tab used to lose all of it. This is the smallest thing that stops
 * that: it is not a second copy of the record, it is what has not been sent
 * yet, and it is dropped the moment the server has the same content. Planning
 * data already lives in `localStorage` for the same reason (ADR-0002).
 */
const DRAFT_STORAGE_PREFIX = "circle-portal-draft:";



type StoredDraft = {
  fields: CircleOverrideFields;
  listInputs: Partial<Record<CircleOverrideFieldKey, string>>;
  /** Without it a restored draft would send a hosted thumbnail URL the write route refuses. */
  stagedThumbnailKey: string | null;
  savedAt: string;
};

function readStoredDraft(circleId: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${circleId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    return parsed && typeof parsed === "object" && parsed.fields && typeof parsed.fields === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredDraft(circleId: string, draft: StoredDraft) {
  try {
    window.localStorage.setItem(`${DRAFT_STORAGE_PREFIX}${circleId}`, JSON.stringify(draft));
  } catch {
    // A browser that refuses storage still edits; it just cannot keep the draft.
  }
}

function forgetStoredDraft(circleId: string) {
  try {
    window.localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${circleId}`);
  } catch {
    // Nothing to recover from: the draft is a convenience, not a record.
  }
}

/* The three states an editable field can be in, said as what a reader would
   see rather than as inherit/replace/clear (#197). The wording carries the
   "目前" itself, so the row needs no separate prefix. */
const FIELD_MODE_LABEL = { inherit: "目前顯示場刊資料", replace: "目前顯示你填寫的內容", clear: "目前不顯示" } as const;

type CircleOverrideListFieldKey = (typeof CIRCLE_OVERRIDE_LIST_FIELDS)[number]["key"];

/** 只能從固定選項挑的欄位。清單本身住在 `circle-overrides.ts`，搜尋面板讀同一份。 */
const CHOICE_FIELD_OPTIONS = {
  creatorTypes: CREATOR_TYPE_OPTIONS,
  workTypes: WORK_TYPE_OPTIONS,
  ageRatings: AGE_RATING_OPTIONS,
} as const;

type ChoiceFieldKey = keyof typeof CHOICE_FIELD_OPTIONS;

/**
 * 可以同時成立好幾個的固定選項欄位，用核取方塊；其餘用下拉選單。
 *
 * `ageRatings` 講的是**販售內容**：同時出全年齡本與 R18 本是一件真實而且常見
 * 的事，不是資料沒收乾淨。單選會在作者下次編輯任何一個分級時，把另一個值連同
 * 它描述的事實一起刪掉——那是替社團改了它沒改的答案。閱讀端逐項顯示所有分級，
 * 不從多值推導最高分級（#193）。
 */
const MULTI_CHOICE_FIELD_KEYS = ["creatorTypes", "ageRatings"] as const satisfies readonly ChoiceFieldKey[];

type MultiChoiceFieldKey = (typeof MULTI_CHOICE_FIELD_KEYS)[number];

function isMultiChoiceField(key: CircleOverrideListFieldKey): key is MultiChoiceFieldKey {
  return (MULTI_CHOICE_FIELD_KEYS as readonly string[]).includes(key);
}

/**
 * Offered only where the organizer's data has something of its own for the
 * field: anywhere else 使用場刊資料 and 不顯示 both show a reader nothing, two
 * buttons for one result, and emptying the field already says it.
 *
 * Each button is a toggle. Pressing the one that is on again gives back what
 * the author had written before it replaced that (`onRestore`), instead of
 * leaving a press that emptied the field with no way back but retyping.
 */
function FieldModeControls({ mode, label, onInherit, onClear, onRestore }: {
  mode: keyof typeof FIELD_MODE_LABEL;
  label: string;
  onInherit: () => void;
  onClear: () => void;
  /** Present while there is the author's own content to put back. */
  onRestore?: () => void;
}) {
  const t = usePortalText();
  return <div className={styles.fieldMode} role="group" aria-label={t("{label}顯示什麼", { label: t(label) })}>
    <span><b>{t(FIELD_MODE_LABEL[mode])}</b></span>
    <button type="button" aria-pressed={mode === "inherit"} disabled={mode === "inherit" && !onRestore} onClick={mode === "inherit" ? onRestore : onInherit}>{t("使用場刊資料")}</button>
    <button type="button" aria-pressed={mode === "clear"} disabled={mode === "clear" && !onRestore} onClick={mode === "clear" ? onRestore : onClear}>{t("不顯示")}</button>
  </div>;
}

function errorMessage(error: unknown) {
  return noticeError(error);
}

/** Read and immediately erase the emailed token before anything can await. */
function takeLoginToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("login");
  if (!token) return null;
  url.searchParams.delete("login");
  window.history.replaceState(null, "", url);
  return token;
}

export default function CirclePortalApp() {
  const t = usePortalText();
  const { locale } = useLocale();
  useDocumentLanguage();
  useEffect(() => { document.title = `${t("社團資料")}｜場刊 Map`; }, [t]);
  const [session, setSession] = useState<PortalSession | null>(null);
  const preferences = useAccountPreferences(session?.email, locale);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>(IDLE);
  const [claims, setClaims] = useState<ClaimSummary[]>([]);
  const [claimsLoadedFor, setClaimsLoadedFor] = useState("");
  const [claimsFailedFor, setClaimsFailedFor] = useState("");
  /** Each event's claims as last read, for the picker; an event not read yet shows no status. */
  const [claimsByEvent, setClaimsByEvent] = useState<Record<string, ClaimSummary[]>>({});
  const [eventId, setEventId] = useState(initialPortalEventId);
  const [adminDestination] = useState(() => adminLoginDestination(new URLSearchParams(window.location.search)));
  const [entry] = useState(() => {
    const parameters = new URLSearchParams(window.location.search);
    return { eventId: parameters.get("event"), circleId: parameters.get("circle") ?? "" };
  });
  const event = getPublishedEvent(eventId) ?? PUBLISHED_EVENTS[0];
  const targetCircleId = entry.eventId === event.id ? entry.circleId : "";
  /** What a late answer is compared against; `claims` lives above the keyed subtree. */
  const maintainedEventId = useRef(event.id);
  const forgetSession = useCallback(() => { setSession(null); setClaims([]); setClaimsLoadedFor(""); setClaimsFailedFor(""); setClaimsByEvent({}); }, []);
  const expireSession = useCallback(() => {
    forgetSession();
    setStatus({ kind: "error", message: "登入已到期，請重新登入。" });
  }, [forgetSession]);
  useSessionExpiry(session, expireSession);

  const refreshClaims = useCallback(async () => {
    // Set here as well as in the effect below: the claim list is the first
    // event-scoped call after a sign-in, and reading it for the wrong event
    // would show the account claims it does not hold in this one.
    if (entry.eventId && !getPublishedEvent(entry.eventId)) return;
    setPortalEventId(event.id);
    const requested = event.id;
    try {
      const answer = await listMyClaims();
      if (answer.eventId === requested) setClaimsByEvent((known) => ({ ...known, [requested]: answer.claims }));
      // A switch while this request was in flight leaves an older answer
      // arriving late. The server says which event it answered for, so a stale
      // one is dropped rather than rendered — with its editors — under the
      // event now on screen.
      if (requested !== maintainedEventId.current || answer.eventId !== requested) return;
      setClaims(answer.claims);
      setClaimsLoadedFor(requested);
      setClaimsFailedFor("");
    } catch {
      if (requested === maintainedEventId.current) { setClaims([]); setClaimsLoadedFor(""); setClaimsFailedFor(requested); }
    }
  }, [event.id, entry.eventId]);

  // Declared before the session effect so the scope is in place for every
  // event-scoped call of this commit.
  useEffect(() => {
    if (adminDestination) return;
    if (entry.eventId && !getPublishedEvent(entry.eventId)) return;
    maintainedEventId.current = event.id;
    setPortalEventId(event.id);
    try {
      window.localStorage.setItem(PORTAL_EVENT_STORAGE_KEY, event.id);
    } catch {
      // A browser that refuses storage still works; it just forgets the choice.
    }
    const url = new URL(window.location.href);
    url.searchParams.set("event", event.id);
    if (entry.eventId !== event.id) url.searchParams.delete("circle");
    else if (entry.circleId) url.searchParams.set("circle", entry.circleId);
    window.history.replaceState(null, "", url);
  }, [adminDestination, entry, event.id]);

  useEffect(() => {
    const token = takeLoginToken();
    const acceptSession = (current: PortalSession) => {
      if (adminDestination) window.location.replace(adminDestination);
      else setSession(current);
    };
    void (async () => {
      if (token) {
        try {
          acceptSession(await verifyLoginToken(token));
          setStatus({ kind: "ok", message: "登入成功。" });
        } catch (error) {
          setStatus({ kind: "error", message: errorMessage(error) });
        }
      } else {
        try {
          acceptSession(await readSession());
        } catch {
          setSession(null);
        }
      }
      setReady(true);
    })();
  }, [adminDestination]);

  useEffect(() => {
    if (!session) return;
    // Deferred like `use-planning.ts`: the load is async, but scheduling it out
    // of the effect body keeps the render pass free of cascading updates.
    queueMicrotask(() => { void refreshClaims(); });
  }, [refreshClaims, session]);

  // The picker says what this account holds in every event, so the other
  // events are read once per sign-in; the open one is kept current by
  // `refreshClaims`, which is also what a later switch re-reads. A read that
  // failed is tried again the next time the picker is reached for.
  const signedInAs = session?.email;
  /** Reads in flight for this sign-in; replaced on every sign-in so a late answer never lands under another. */
  const claimReads = useRef({ signedIn: false, pending: new Set<string>() });
  const readClaimsFor = useCallback((eventIds: readonly string[]) => {
    const reads = claimReads.current;
    if (!reads.signedIn) return;
    for (const id of eventIds) {
      if (id === maintainedEventId.current || reads.pending.has(id)) continue;
      reads.pending.add(id);
      void listMyClaims(id).then((answer) => {
        if (claimReads.current === reads && answer.eventId === id) setClaimsByEvent((known) => id in known ? known : { ...known, [id]: answer.claims });
      }, () => {}).finally(() => reads.pending.delete(id));
    }
  }, []);
  useEffect(() => {
    claimReads.current = { signedIn: Boolean(signedInAs), pending: new Set() };
    if (PUBLISHED_EVENTS.length > 1) readClaimsFor(PUBLISHED_EVENTS.map((item) => item.id));
  }, [readClaimsFor, signedInAs]);

  if (entry.eventId && !getPublishedEvent(entry.eventId)) return <div className={styles.page}>
    <header className={styles.masthead}><div className={styles.titleRow}><h1>{t("社團資料")}</h1></div></header>
    <main className={styles.card}><h2>{t("找不到指定的活動")}</h2><p className={styles.backLink}><a href={localizedHref("/circle", locale)}>{t("返回社團資料")}</a></p></main>
  </div>;

  // The public header's "登入" lands here, organizers included; the sign-in
  // screen is the one `/organizer` shows too.
  if (ready && !session) return <SignInScreen
    title={t("社團資料")}
    current="circle"
    circleId={targetCircleId}
    notice={status.kind === "ok" || status.kind === "error" ? { kind: status.kind, message: portalNotice(status.message, locale) } : null}
  >
    <SignInFinePrint>{t("個資與著作權爭議請寄")}<code>maintain@kotoban.top</code>{t("，網站操作問題請寄")}<code>circle@kotoban.top</code>。</SignInFinePrint>
  </SignInScreen>;

  return <div className={styles.page}>
    <header className={styles.masthead}>
      {/* Who is signed in, beside the page and its event when they fit and
          above them when not (the stylesheet orders them). Everything else
          about the account waits in one menu. */}
      {session && <div className={styles.accountBar}>
        {/* Shows which identity the server resolved, so a mismatch against
            ADMIN_EMAILS is visible rather than silently hiding the panel. */}
        <p className={styles.identityWho}>
          <span>{session.email}{session.isAdmin ? t("・管理者") : ""}{session.isMapContributor ? t("・地圖貢獻者") : ""}</span>
        </p>
        <LanguageSwitcher onChange={preferences.chooseLocale} />
        <AccountMenu>
          {/* Signing in here does not hide the way to the organizer workspace:
              the same session opens it, and that page decides what it allows. */}
          <WorkspaceSwitch current="circle" />
          <AccountNotificationSettings key={session.email} session={session} preferences={preferences} />
          <ContactLink url={session.contactUrl} />
          {session.isMapContributor && <a href="#map-contribution">{t("地圖草稿")}</a>}
          {session.isAdmin && <a href="/admin">{t("網站管理")}</a>}
          <button type="button" className={styles.accountMenuEnd} onClick={() => void signOut().then(forgetSession)}>{t("登出")}</button>
        </AccountMenu>
      </div>}
      <div className={styles.titleRow}>
        <h1>{t("社團資料")}</h1>
        {/* The event is the page's context, not a task of its own: the picker
            sits where its name would, and one event needs no picker at all. */}
        {/* Signed out, no event is named: the browser's last event is only
            where the session will open, and naming it on the sign-in read as
            a sign-in for that event alone. */}
        {session && (PUBLISHED_EVENTS.length > 1
          ? <EventPicker
            eventId={event.id}
            claimsByEvent={claimsByEvent}
            onReach={() => readClaimsFor(PUBLISHED_EVENTS.map((item) => item.id).filter((id) => !(id in claimsByEvent)))}
            onChoose={(next) => { setEventId(next); setClaims([]); setClaimsLoadedFor(""); setClaimsFailedFor(""); setStatus(IDLE); }}
          />
          : <p>{event.name}・{eventCalendar(event, locale).label}</p>)}
        <a className={styles.backLink} href={localizedHref(mapHref(event.id), locale)}>{t("返回活動地圖")}</a>
      </div>
    </header>

    {session && preferences.error && <p className={styles.error} role="alert">
      {t("通知語言尚未儲存。")} {portalNotice(preferences.error, locale)}
      <button type="button" className={styles.inlineButton} disabled={preferences.loading || preferences.busy} onClick={preferences.conflict || !preferences.unsavedLocale ? preferences.reload : preferences.retry}>
        {preferences.conflict || !preferences.unsavedLocale ? t("重新載入設定") : t("重試儲存通知語言")}
      </button>
    </p>}
    {session && !preferences.error && preferences.unsavedLocale && !preferences.busy && !preferences.loading && <p className={styles.notice}>
      {t("通知語言尚未儲存。")} <button type="button" onClick={preferences.retry}>{t("重試儲存通知語言")}</button>
    </p>}
    {status.kind !== "idle" && <p className={status.kind === "error" ? styles.error : styles.notice} role="status">{portalNotice(status.message, locale)}</p>}

    {!ready || !session ? <p className={styles.notice}>{t("載入中…")}</p>
        : <div className={styles.workspace}>
          {/* Keyed on the event: claims, drafts and editor drafts all belong to
              one event, and carrying them across a switch would show one
              event's work under another's name. */}
          <Fragment key={event.id}>
            {/* Two columns on a desktop, cut on the editor's own lines below:
                the list over the form, the claim over the preview. */}
            <div className={claims.length > 0 ? styles.claimRow : styles.claimSolo}>
              <ClaimList claims={claims} session={session} onChanged={refreshClaims} />
              <div className={styles.claimColumn}>
                {targetCircleId
                  ? <ClaimDestination circleId={targetCircleId} claims={claims} ready={claimsLoadedFor === event.id} failed={claimsFailedFor === event.id} onChanged={refreshClaims} />
                  : <ClaimForm firstClaim={claimsLoadedFor === event.id && claims.length === 0} onCreated={refreshClaims} />}
              </div>
            </div>
            {claims.filter((claim) => claim.status === "verified").sort((a, b) => Number(b.circleId === targetCircleId) - Number(a.circleId === targetCircleId)).map((claim) => <CircleEditor key={claim.circleId} event={event} claim={claim} />)}
            {session.isMapContributor && <div lang="zh-Hant"><MapContributorPanel event={event} /></div>}
          </Fragment>
          {/* Account-wide, so after the event's work rather than inside it
              (ADR-0043); still keyed on the event so its notice never outlives
              a switch. */}
          <AccountDeletion key={`account-${event.id}`} session={session} onDeleted={forgetSession} />
        </div>}

  </div>;
}

/** What this account holds in an event, as the picker says it; nothing until the event has been read. */
function claimSummaryLabel(claims: readonly ClaimSummary[] | undefined, t: ReturnType<typeof usePortalText>) {
  if (!claims) return "";
  const names = (status: ClaimSummary["status"]) => [...new Set(claims.filter((claim) => claim.status === status).map((claim) => claim.circleName))].join("、");
  const parts = ([["已認領", names("verified")], ["審核中", names("pending")]] as const)
    .filter(([, circles]) => circles).map(([label, circles]) => `${t(label)}：${circles}`);
  return `（${parts.join("；") || t("未認領")}）`;
}

/**
 * Events by date: the ones still to come or being held first, soonest first,
 * then the ended ones from the most recent back. An event whose dates cannot
 * be read stays with the current ones rather than reading as over.
 */
function EventPicker({ eventId, claimsByEvent, onReach, onChoose }: {
  eventId: string; claimsByEvent: Record<string, ClaimSummary[]>;
  /** The picker is about to be read: fill in any event whose claims are still missing. */
  onReach: () => void;
  onChoose: (eventId: string) => void;
}) {
  const t = usePortalText();
  const { locale } = useLocale();
  const [today] = useState(() => taipeiDate(Date.now()));
  const ordered = eventsByProximity(PUBLISHED_EVENTS, today, locale);
  const groups = [
    { label: "即將舉辦、舉辦中", entries: ordered.filter((entry) => entry.group !== "past") },
    { label: "已結束", entries: ordered.filter((entry) => entry.group === "past") },
  ].filter((group) => group.entries.length > 0);
  return <div className={styles.eventPicker}>
    <label htmlFor="portal-event" className={styles.visuallyHidden}>{t("活動")}</label>
    {/* Pressing and focusing both reach it: Safari opens a select without focusing it. */}
    <select id="portal-event" value={eventId} onFocus={onReach} onPointerDown={onReach} onChange={(event) => onChoose(event.target.value)}>
      {groups.map((group) => <optgroup key={group.label} label={t(group.label)}>
        {group.entries.map(({ event: item, label }) => <option key={item.id} value={item.id}>
          {item.name}・{label}{claimSummaryLabel(claimsByEvent[item.id], t)}
        </option>)}
      </optgroup>)}
    </select>
  </div>;
}

function AccountDeletion({ session, onDeleted }: { session: PortalSession; onDeleted: () => void }) {
  const t = usePortalText();
  const { locale } = useLocale();
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>(IDLE);
  return <section className={styles.accountZone} aria-label={t("帳號")}>
    <details className={styles.danger}>
    <summary>{t("刪除帳號")}</summary>
    <p>{t("刪除帳號會一併刪除你在所有活動的認領與自行填寫的資料。場刊中的社團與攤位資料不受影響。")}</p>
    {session.isAdmin
      ? <p>{t("管理者需先由另一位管理者移出名單，才能刪除帳號。")}</p>
      : <>
        <label htmlFor="delete-account-confirm">{t("輸入完整 email 確認：")}{session.email}</label>
        <input id="delete-account-confirm" type="email" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        <button type="button" className={styles.dangerButton} disabled={confirm !== session.email || status.kind === "busy"} onClick={() => {
          setStatus({ kind: "busy", message: "刪除中…" });
          void deleteMyAccount(session.email)
            .then(() => { onDeleted(); })
            .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
        }}>{t("永久刪除帳號")}</button>
      </>}
    {status.kind === "error" && <p className={styles.error}>{portalNotice(status.message, locale)}</p>}
    </details>
  </section>;
}

function ClaimList({ claims, session, onChanged }: { claims: ClaimSummary[]; session: PortalSession; onChanged: () => void }) {
  const t = usePortalText();
  const { locale } = useLocale();
  const [status, setStatus] = useState<Status>(IDLE);
  if (claims.length === 0) return null;

  return <section className={styles.card}>
    <h2>{t("我的社團")}</h2>
    <ul className={styles.claimList}>
      {claims.map((claim) => <li key={claim.id}>
        <div>
          <b>{claim.circleName}</b>
        </div>
        {claim.status === "verified" && <a href={`#circle-editor-${claim.circleId}`}>{t("編輯資料")}</a>}
        <span className={styles[`claim_${claim.status}`]}>{
          t({ pending: "審核中", verified: "已通過", rejected: "已婉拒", revoked: "已撤銷", withdrawn: "已撤回" }[claim.status])
        }</span>
        {claim.status === "pending" && claim.targetUrl && <button type="button" onClick={() => {
          setStatus({ kind: "busy", message: "驗證中…" });
          void runChallenge(claim.id)
            .then((result) => {
              setStatus({ kind: result.verified ? "ok" : "error", message: result.verified ? "驗證通過。" : result.error ?? "尚未找到驗證碼。" });
              onChanged();
            })
            .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
        }}>{t("重新驗證")}</button>}
        {claim.status === "pending" && <button type="button" className={styles.secondaryButton} onClick={() => {
          setStatus({ kind: "busy", message: "撤回中…" });
          void withdrawClaim(claim.id)
            .then(() => {
              setStatus({ kind: "ok", message: "已撤回。可以重新送出這個社團的認領，並取得新的驗證碼。" });
              onChanged();
            })
            .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
        }}>{t("撤回")}</button>}
      </li>)}
    </ul>
    {/* Only manual review waits on the maintainers; a code claim verifies itself. */}
    {session.claimReviewNotice && claims.some((claim) => claim.status === "pending" && !claim.targetUrl) && <p className={styles.notice}>
      {session.claimReviewNotice}{session.contactUrl && <> <ContactLink url={session.contactUrl} /></>}
    </p>}
    {status.kind !== "idle" && <p className={status.kind === "error" ? styles.error : styles.notice}>{portalNotice(status.message, locale)}</p>}
  </section>;
}

/**
 * Server-side search. Downloading the catalog here would force it to be public,
 * which is exactly what the access gate is holding back until the source
 * licensing review lands.
 */
function useCircleSearch(query: string) {
  const [matches, setMatches] = useState<CircleMatch[]>([]);
  // Derived rather than cleared in the effect: a too-short query has no results
  // by definition, so there is nothing to synchronise and nothing to flash.
  const active = query.trim().length >= 2;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchCircles(query)
        .then((result) => { if (!cancelled) setMatches(result.circles); })
        .catch(() => { if (!cancelled) setMatches([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, query]);

  return active ? matches : [];
}

function ClaimDestination({ circleId, claims, ready, failed, onChanged }: {
  circleId: string; claims: ClaimSummary[]; ready: boolean; failed: boolean; onChanged: () => void;
}) {
  const t = usePortalText();
  const { locale } = useLocale();
  const [result, setResult] = useState<{ circle: CircleMatch | null; error?: PortalNotice } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [created, setCreated] = useState<Awaited<ReturnType<typeof createClaim>> | null>(null);
  const claim = claims.find((item) => item.circleId === circleId && (item.status === "verified" || item.status === "pending"));
  useEffect(() => {
    if (!ready || claim) return;
    let active = true;
    void readClaimCircle(circleId).then((circle) => { if (active) setResult({ circle }); })
      .catch((error: unknown) => { if (active) setResult({ circle: null, error: errorMessage(error) }); });
    return () => { active = false; };
  }, [circleId, ready, claim, attempt]);
  // A challenge is returned only once. Keep it above the form so the claims
  // refresh can replace that form with the pending state without losing it.
  const proof = created?.challenge && <><p>{t("請把驗證碼公開貼在驗證用連結頁面，再到「我的社團」按重新驗證。")}</p><p className={styles.challenge}><span>{t("驗證碼")}</span><code>{created.challenge}</code></p></>;
  if (failed) return <section className={styles.card}>{proof}<p role="status">{t("無法讀取認領資料。")}</p><button type="button" onClick={onChanged}>{t("重新讀取")}</button></section>;
  if (!ready) return <p className={styles.notice} role="status">{t("正在讀取社團…")}</p>;
  if (claim) return <section className={styles.card}><h2>{claim.circleName}</h2>{claim.status === "verified"
    ? <a href={`#circle-editor-${claim.circleId}`}>{t("管理社團資料")}</a>
    : created?.id === claim.id && proof ? proof : <p>{t("審核中，進度見「我的社團」。")}</p>}</section>;
  if (!result) return <p className={styles.notice} role="status">{t("正在讀取社團…")}</p>;
  if (result.error) return <section className={styles.card}><p className={styles.error} role="status">{portalNotice(result.error, locale)}</p><button type="button" onClick={() => { setResult(null); setAttempt((value) => value + 1); }}>{t("重新讀取")}</button></section>;
  // Same words as the refusal `createClaim` would give after the form was filled in.
  if (result.circle?.claimed) return <section className={styles.card}><h2>{result.circle.name}</h2><p>{t("此社團已有通過的認領。若這是你的社團，請聯絡管理者。")}</p></section>;
  return <>{!result.circle && <p className={styles.notice}>{t("在這個活動找不到指定社團，請重新搜尋。")}</p>}<ClaimForm key={result.circle?.id ?? "search"} initialCircle={result.circle} firstClaim={claims.length === 0} onCreated={(answer) => { setCreated(answer); onChanged(); }} /></>;
}

/**
 * Where a circle with nothing claimed in this event starts. Everything else on
 * the page appears only once a claim exists, so on its own the form did not
 * say it was the first of three steps, or that it was the place to begin.
 */
const FIRST_CLAIM_STEPS = ["認領社團", "驗證身分", "編輯社團資料"] as const;

function FirstClaimSteps() {
  const t = usePortalText();
  return <ol className={styles.startSteps} aria-label={t("開始使用")}>
    {FIRST_CLAIM_STEPS.map((step, index) => <li key={step} aria-current={index === 0 ? "step" : undefined}>
      <span aria-hidden="true">{index + 1}</span>
      <b>{t(step)}</b>
      {index === 0 && <small>{t("從這裡開始")}</small>}
    </li>)}
  </ol>;
}

function ClaimForm({ onCreated, initialCircle = null, firstClaim = false }: {
  onCreated: (answer: Awaited<ReturnType<typeof createClaim>>) => void;
  initialCircle?: CircleMatch | null;
  /** Only once the claims have answered: a guess before then flashes the steps at a circle that has one. */
  firstClaim?: boolean;
}) {
  const t = usePortalText();
  const { locale } = useLocale();
  const [query, setQuery] = useState(initialCircle?.name ?? "");
  const [selected, setSelected] = useState<CircleMatch | null>(initialCircle);
  const [targetUrl, setTargetUrl] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(IDLE);

  const matches = useCircleSearch(selected ? "" : query);

  return <section className={styles.card}>
    <h2>{t("認領社團")}</h2>
    {firstClaim && <FirstClaimSteps />}
    <p>{t("搜尋你的社團，並選擇一個可用來驗證身分的連結。沒有可用連結時會改由人工確認。")}</p>

    <label htmlFor="portal-search">{t("社團名稱")}</label>
    <input id="portal-search" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null); }} placeholder={t("輸入至少 2 個字")} />
    {matches.length > 0 && !selected && <ul className={styles.matchList}>
      {matches.map((match) => <li key={match.id}>
        <button type="button" onClick={() => { setSelected(match); setQuery(match.name); }}>
          <b>{match.name}</b><small>{t("{count} 個已登錄連結", { count: match.linkCount })}</small>
        </button>
      </li>)}
    </ul>}

    {selected && <>
      <label htmlFor="portal-target">{t("驗證用連結（選填）")}</label>
      <select id="portal-target" value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)}>
        <option value="">{t("不使用自動驗證，改由人工審核")}</option>
        {selected.links.map((link) => <option key={link.url} value={link.url}>{link.provider}：{link.url}</option>)}
      </select>

      {/* Manual review is the third tier and never issues a code: the reviewer
          reads the link and the note. Asking for a code here described the
          second tier's flow in the third tier's field (#142). */}
      <label htmlFor="portal-evidence">{t("佐證連結（人工審核用，選填）")}</label>
      <input id="portal-evidence" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder={t("https://…（可證明你是這個社團的頁面）")} />
      <small>{t("人工審核不會發驗證碼。管理者會看這個連結與下方說明，人工核對你與社團的關係。")}</small>

      <label htmlFor="portal-note">{t("補充說明（選填）")}</label>
      <textarea id="portal-note" rows={2} value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} />

      <button type="button" disabled={status.kind === "busy"} onClick={() => {
        setStatus({ kind: "busy", message: "送出中…" });
        void createClaim({
          circleId: selected.id,
          ...(targetUrl ? { targetUrl } : {}),
          ...(evidenceUrl ? { evidenceUrl } : {}),
          ...(evidenceNote ? { evidenceNote } : {}),
        })
          .then((result) => {
            setChallenge(result.challenge);
            setStatus({
              kind: "ok",
              message: result.status === "verified" ? "已自動通過驗證。"
                : result.challenge ? "已建立認領。請把下方驗證碼公開貼在該連結頁面，再回到「我的社團」按重新驗證。"
                  : "已送出，等待管理者人工核對。",
            });
            onCreated(result);
          })
          .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
      }}>{t("送出認領")}</button>
    </>}

    {challenge && <p className={styles.challenge}><span>{t("驗證碼")}</span><code>{challenge}</code></p>}
    {status.kind !== "idle" && status.kind !== "busy" && <p className={status.kind === "error" ? styles.error : styles.notice}>{portalNotice(status.message, locale)}</p>}
  </section>;
}

/**
 * What deleting would remove, in the circle's own terms.
 *
 * Shown before the button rather than after the fact: pretix makes an export
 * mandatory before a deletion, and this is the weaker version of the same idea
 * — nobody should be able to delete something they cannot see (ADR-0020).
 */
function deletionSummary(fields: CircleOverrideFields, t: ReturnType<typeof usePortalText>) {
  const lines: string[] = [];
  if (fields.pen) lines.push(t("筆名：{value}", { value: fields.pen }));
  if (fields.saleInfo) lines.push(t("販售資訊 {count} 字", { count: [...fields.saleInfo].length }));
  if (fields.circleCategory) lines.push(t("社團主題：{value}", { value: fields.circleCategory }));
  for (const { key, label } of CIRCLE_OVERRIDE_LIST_FIELDS) {
    const items = fields[key];
    if (items?.length) lines.push(t("{label} {count} 項", { label: t(label), count: items.length }));
  }
  if (fields.links?.length) lines.push(t("連結 {count} 條", { count: fields.links.length }));
  if (fields.thumbnail) lines.push(t("代表圖 1 張"));
  if (fields.catalogImages?.length) lines.push(t("品書 {count} 張", { count: fields.catalogImages.length }));
  return lines;
}

/**
 * Readers meet a circle at two densities — the map's side panel and the full
 * detail behind it — and they carry different content, not just different
 * widths (PRODUCT principle 6). The preview column is the width of the side
 * panel, so it shows that density; the full one opens the way a reader opens
 * it.
 */
function PublicationPreview({ records, compact = false }: { records: CircleViewRecord[]; compact?: boolean }) {
  const t = usePortalText();
  if (records.length === 0) return <p>{t("這個社團目前沒有配置攤位，公開頁面不會顯示。")}</p>;
  const record = records[0];
  return <>
    {records.length > 1 && <p>{t("此社團有 {count} 天配置；以下預覽 DAY {day} {booth}，其他天的內容相同。", { count: records.length, day: record.day, booth: record.code })}</p>}
    <div className={styles.previewFrame} aria-label={t("刊登預覽")}>
      <CircleDetails
        record={record}
        sharedRecords={records.filter((candidate) => candidate.day === record.day && candidate.code === record.code)}
        favorite={null} plan={null} groups={[]} compact={compact} floating={compact} readOnly
        onClose={() => undefined} onOpenFull={() => undefined} onSelectShared={() => undefined}
        onToggleFavorite={() => undefined} onTogglePlan={() => undefined} onSetNext={() => undefined}
        onUpdateFavorite={() => undefined} onCreateGroup={() => undefined}
      />
    </div>
  </>;
}

function ReviewSummary({ fields }: { fields: CircleOverrideFields }) {
  const t = usePortalText();
  const { locale } = useLocale();
  const value = (candidate: string | string[] | undefined) => Array.isArray(candidate)
    ? candidate.join("、") || t("未提供") : candidate?.trim() || t("未提供");
  const rows = [
    ["筆名", value(fields.pen)],
    ["販售資訊", value(fields.saleInfo)],
    ["本次品書", fields.catalogImages?.length ? t("{count} 張", { count: fields.catalogImages.length }) : t("未提供")],
    ["社團主題", value(fields.circleCategory)],
    ...CIRCLE_OVERRIDE_LIST_FIELDS.map(({ key, label }) => [label, value(key in CHOICE_FIELD_OPTIONS ? fields[key]?.map(option => circleOptionLabel(option, locale)) : fields[key])]),
    ["連結", fields.links?.length ? t("{count} 條", { count: fields.links.length }) : t("未提供")],
    ["代表圖", fields.thumbnail ? fields.thumbnail.provider || t("已提供") : t("未提供")],
  ];
  const shareImage = selectedCircleShareImage(fields, locale);
  return <dl className={styles.reviewSummary}>
    {rows.map(([label, content]) => <div key={label}><dt>{t(label)}</dt><dd>{content}</dd></div>)}
    {/* The picture stays with the row that names it. */}
    <div>
      <dt>{t("分享縮圖")}</dt>
      <dd>{shareImage.label}<img className={styles.shareImagePreview} src={shareImage.image.url} alt={t("儲存後的分享縮圖")} /></dd>
    </div>
  </dl>;
}

function CircleEditor({ event, claim }: { event: EventDefinition; claim: ClaimSummary }) {
  const t = usePortalText();
  const { locale } = useLocale();
  const [fields, setFields] = useState<CircleOverrideFields>({});
  // Keep separators and in-progress IME text intact while the author types.
  const [listInputs, setListInputs] = useState<Partial<Record<CircleOverrideFieldKey, string>>>({});
  const [status, setStatus] = useState<Status>(IDLE);
  const [baseRecords, setBaseRecords] = useState<CircleViewRecord[] | null>(null);
  const [serverPreview, setServerPreview] = useState<CircleViewRecord[] | null>(null);
  const [projectedAt, setProjectedAt] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  // The full density is what a reader opens from the side panel, so it opens
  // the same way here rather than replacing the column.
  const [expanded, setExpanded] = useState(false);
  const [reviewedFields, setReviewedFields] = useState<CircleOverrideFields | null>(null);
  const [stagedThumbnailKey, setStagedThumbnailKey] = useState<string | null>(null);
  // Reported next to the file picker: an error shown at the far end of the form
  // reads as the picker doing nothing at all.
  const [uploadNotice, setUploadNotice] = useState<Status>(IDLE);
  // Whether the browser could load the current address as an image, keyed by the
  // address it answered for so a stale verdict never blocks a new one.
  const [thumbnailLoad, setThumbnailLoad] = useState<{ url: string; ok: boolean } | null>(null);
  const [reviewedThumbnailKey, setReviewedThumbnailKey] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [saved, setSaved] = useState(false);
  // The editor is usable before the preview baseline arrives, and that request
  // can fail; gating the draft on it would silently stop saving drafts.
  const [hydrated, setHydrated] = useState(false);
  const [hydrationError, setHydrationError] = useState<PortalNotice | null>(null);
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  // What the server holds, as opposed to the draft in `fields`: the deletion
  // summary has to describe what would actually be deleted, not unsaved edits.
  const [savedFields, setSavedFields] = useState<CircleOverrideFields>({});
  const [confirmText, setConfirmText] = useState("");
  // When the draft on this device differs from what the server holds. Shown as
  // a line the author can act on, never as a silent restore.
  const [draftRestoredAt, setDraftRestoredAt] = useState<string | null>(null);
  // The author's own content for a field, put aside when 使用場刊資料 or 不顯示
  // replaced it, so the same button pressed again gives it back. This tab
  // only: it is an undo, not part of the draft.
  const [revertedDraft, setRevertedDraft] = useState<Pick<StoredDraft, "fields" | "listInputs" | "stagedThumbnailKey"> | null>(null);
  const [ownContent, setOwnContent] = useState<Partial<Record<CircleOverrideFieldKey, {
    value: CircleOverrideFields[CircleOverrideFieldKey];
    listInput: string | undefined;
    stagedThumbnailKey: string | null;
  }>>>({});
  const returnFocus = useRef<HTMLElement | null>(null);
  const reviewPanel = useRef<HTMLDivElement | null>(null);
  const reviewActions = useRef<HTMLDivElement | null>(null);
  const expandedPreview = useRef<HTMLDivElement | null>(null);
  const previewRequestGeneration = useRef(0);
  // The official records behind the share text. A failed first read is kept
  // apart from a pending one so the share panel can say which it is.
  const [baselineFailed, setBaselineFailed] = useState(false);
  const baselineRetry = useRef(0);
  // Its own counter: a retry must not cancel a review preview already in flight.
  const retryBaseline = () => {
    const attempt = ++baselineRetry.current;
    setBaselineFailed(false);
    void previewOverride(claim.circleId, savedFields)
      .then((result) => {
        if (attempt !== baselineRetry.current) return;
        setBaseRecords((current) => current ?? result.baseRecords as CircleViewRecord[]);
        setProjectedAt((current) => current || result.projectedAt);
      })
      .catch(() => { if (attempt === baselineRetry.current) setBaselineFailed(true); });
  };

  // State contains only fields the author has deliberately touched. Empty
  // strings/arrays and a null thumbnail are tombstones, not values to discard.
  const draft = (): CircleOverrideFields => ({ ...fields });
  // A circle can sit in more than one day; the map link opens the first one it
  // appears on, in the event's own day order rather than the array's.
  const firstDayRecord = useMemo(
    () => event.days.reduce<CircleViewRecord | undefined>(
      (found, day) => found ?? baseRecords?.find((record) => record.day === day.id), undefined),
    [baseRecords, event.days],
  );
  const livePreview = useMemo(() => baseRecords && projectedAt
    ? projectCircleDraftRecords(baseRecords, fields, projectedAt)
    : serverPreview, [baseRecords, fields, projectedAt, serverPreview]);

  useEffect(() => {
    let active = true;
    void readMyOverride(claim.circleId)
      .then((result) => {
        if (!active) return;
        const initialFields = result.fields ?? {};
        // The stored draft wins over the saved record: it is the newer of the
        // two by construction, and dropping it is one click away.
        const stored = readStoredDraft(claim.circleId);
        const restored = !!stored && JSON.stringify(stored.fields) !== JSON.stringify(initialFields);
        setFields(restored ? stored.fields : initialFields);
        setListInputs(restored ? stored.listInputs ?? {} : {});
        setStagedThumbnailKey(restored ? stored.stagedThumbnailKey ?? null : null);
        setDraftRestoredAt(restored ? stored.savedAt : null);
        setOwnContent({});
        setRevertedDraft(null);
        if (!restored) forgetStoredDraft(claim.circleId);
        setSavedFields(initialFields);
        setHidden(!!result.postEventHidden);
        setSaved(result.status !== "none");
        setHydrated(true);
        const requestGeneration = ++previewRequestGeneration.current;
        setBaselineFailed(false);
        void previewOverride(claim.circleId, initialFields).then((previewResult) => {
          const baseline = previewResult.baseRecords as CircleViewRecord[];
          if (requestGeneration === previewRequestGeneration.current) {
            setBaseRecords(baseline);
            setProjectedAt(previewResult.projectedAt);
            return;
          }
          // A review opened meanwhile owns the preview now, but if its own
          // request failed nothing else will fill the official records in —
          // and the share panel would wait on them forever.
          setBaseRecords((current) => current ?? baseline);
          setProjectedAt((current) => current || previewResult.projectedAt);
        // Editing goes on without the baseline; only sharing needs it, and it
        // offers its own retry rather than posting text with no booths. The
        // panel shows the failure only while no records have arrived by any
        // path, so a later request that succeeded is never shown as failed.
        }).catch(() => { if (active) setBaselineFailed(true); });
      })
      // Not hydrated: `savedFields` never arrived, so every comparison against
      // it would read as "same as the server" and take the draft away from an
      // author whose load simply failed. Keep the editor disabled until the
      // author retries and the saved record actually arrives.
      .catch((error: unknown) => {
        if (!active) return;
        setHydrationError(errorMessage(error));
      });
    return () => { active = false; };
  }, [claim.circleId, hydrationAttempt]);

  // Written on every edit rather than on a button: a draft that needs an action
  // to exist is one the author remembers only after losing the tab.
  const draftDiffersFromSaved = JSON.stringify(fields) !== JSON.stringify(savedFields);
  useEffect(() => {
    if (!hydrated) return;
    if (!draftDiffersFromSaved) forgetStoredDraft(claim.circleId);
    else writeStoredDraft(claim.circleId, { fields, listInputs, stagedThumbnailKey, savedAt: new Date().toISOString() });
  }, [claim.circleId, draftDiffersFromSaved, fields, hydrated, listInputs, stagedThumbnailKey]);

  // Going back to what is saved throws away unsaved work, so what it replaced
  // is kept until the next edit: a revert pressed by mistake is undone from the
  // same place it was made. "Until the next edit" is `fields === savedFields`,
  // true only between a revert and whatever changes the form after it.
  const discardDraft = () => {
    setRevertedDraft({ fields, listInputs, stagedThumbnailKey });
    setStatus(IDLE);
    forgetStoredDraft(claim.circleId);
    setFields(savedFields);
    setListInputs({});
    setStagedThumbnailKey(null);
    setDraftRestoredAt(null);
    setOwnContent({});
  };
  const undoRevert = () => {
    if (!revertedDraft) return;
    setFields(revertedDraft.fields);
    setListInputs(revertedDraft.listInputs);
    setStagedThumbnailKey(revertedDraft.stagedThumbnailKey);
    setRevertedDraft(null);
  };
  const justReverted = !!revertedDraft && fields === savedFields;

  const retryHydration = () => {
    setHydrated(false);
    setHydrationError(null);
    setHydrationAttempt((attempt) => attempt + 1);
  };

  const setList = (key: (typeof CIRCLE_OVERRIDE_LIST_FIELDS)[number]["key"], value: string) => {
    setListInputs((current) => ({ ...current, [key]: value }));
    const items = value.split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean);
    setFields((current) => ({ ...current, [key]: items }));
  };

  // 固定選項的欄位挑一個或幾個就好，剩下兩個仍然是自由填寫。既有的舊值不在選項
  // 裡時補進清單，作者才看得到、也刪得掉。
  const optionsFor = (key: ChoiceFieldKey) => {
    const options: readonly string[] = CHOICE_FIELD_OPTIONS[key];
    return [...options, ...(fields[key] ?? []).filter((value) => !options.includes(value))];
  };
  const toggleChoice = (key: ChoiceFieldKey, option: string, checked: boolean) => setFields((current) => {
    const values = current[key] ?? [];
    return { ...current, [key]: checked ? [...values, option] : values.filter((value) => value !== option) };
  });
  const setChoice = (key: ChoiceFieldKey, value: string) => setFields((current) => ({ ...current, [key]: value ? [value] : [] }));
  const removeChoice = (key: ChoiceFieldKey, value: string) => setFields((current) => ({
    ...current,
    [key]: (current[key] ?? []).filter((candidate) => candidate !== value),
  }));

  // A field's name and, where there is a choice to make, what it currently
  // shows share one line, so the state and the way back sit where the field
  // starts instead of on a line of their own under every control.
  const fieldHead = (key: CircleOverrideFieldKey, name: string, title: ReactNode) =>
    <div className={styles.fieldHead}>
      {title}
      {officialHas(key) && <FieldModeControls
        mode={modeFor(key)} label={name} onInherit={() => inheritField(key)} onClear={() => clearField(key)}
        onRestore={ownContent[key] ? () => restoreOwn(key) : undefined}
      />}
    </div>;

  const listField = (key: CircleOverrideListFieldKey, label: string) => {
    const id = `${key}-${claim.circleId}`;
    if (isMultiChoiceField(key)) return <div className={styles.field}>
      {fieldHead(key, label, <span id={`${id}-label`} className={styles.fieldLabel}>{t(label)}</span>)}
      <fieldset className={styles.choiceGroup} aria-labelledby={`${id}-label`}>
        {optionsFor(key).map((option) => <label key={option}>
          <input type="checkbox" checked={(fields[key] ?? []).includes(option)} onChange={(event) => toggleChoice(key, option, event.target.checked)} />
          <span>{circleOptionLabel(option, locale)}</span>
        </label>)}
      </fieldset>
    </div>;
    if (key in CHOICE_FIELD_OPTIONS) {
      const choiceKey = key as ChoiceFieldKey;
      const values = fields[choiceKey] ?? [];
      return <div className={styles.field}>
        {fieldHead(key, label, <label htmlFor={id}>{t(label)}</label>)}
        {/* 這個欄位以前可以填多個。多值時每一個都要看得到、刪得掉，不能只把
            第一個當成選取值，把其餘的留在送出的資料裡卻不顯示。 */}
        {values.length > 1 && <div className={styles.extraValues}>
          <span>{t("目前有 {count} 個值，選一項會取代全部：", { count: values.length })}</span>
          {values.map((value) => <button key={value} type="button" onClick={() => removeChoice(choiceKey, value)}>
            {circleOptionLabel(value, locale)}<span aria-hidden="true">✕</span><span className={styles.visuallyHidden}>{t("移除")}</span>
          </button>)}
        </div>}
        <select id={id} value={values.length === 1 ? values[0] : ""} onChange={(event) => setChoice(choiceKey, event.target.value)}>
          <option value="">{t("尚未選擇")}</option>
          {optionsFor(choiceKey).map((option) => <option key={option} value={option}>{circleOptionLabel(option, locale)}</option>)}
        </select>
      </div>;
    }
    return <div className={styles.field}>
      {fieldHead(key, label, <label htmlFor={id}>{t("{label}（以逗號分隔，最多 {max} 項）", { label: t(label), max: OVERRIDE_LIMITS.listItems })}</label>)}
      <input id={id} value={listInputs[key] ?? (fields[key] ?? []).join("、")} onChange={(event) => setList(key, event.target.value)} />
    </div>;
  };

  const resetListInput = (key: CircleOverrideFieldKey) => {
    setListInputs((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };
  // Taken only from the author's own content: moving between 使用場刊資料 and
  // 不顯示 keeps what was put aside first, so either toggle still gives it back.
  const putOwnAside = (key: CircleOverrideFieldKey) => {
    if (modeFor(key) !== "replace") return;
    setOwnContent((current) => ({
      ...current,
      [key]: { value: fields[key], listInput: listInputs[key], stagedThumbnailKey: key === "thumbnail" ? stagedThumbnailKey : null },
    }));
  };
  const restoreOwn = (key: CircleOverrideFieldKey) => {
    const kept = ownContent[key];
    if (!kept) return;
    setFields((current) => ({ ...current, [key]: kept.value }));
    if (kept.listInput !== undefined) setListInputs((current) => ({ ...current, [key]: kept.listInput }));
    if (key === "thumbnail") setStagedThumbnailKey(kept.stagedThumbnailKey);
    setOwnContent((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };
  const inheritField = (key: CircleOverrideFieldKey) => {
    putOwnAside(key);
    resetListInput(key);
    if (key === "thumbnail") setStagedThumbnailKey(null);
    setFields((current) => inheritCircleOverrideField(current, key));
  };
  const clearField = (key: CircleOverrideFieldKey) => {
    putOwnAside(key);
    resetListInput(key);
    if (key === "thumbnail") setStagedThumbnailKey(null);
    setFields((current) => clearCircleOverrideField(current, key));
  };
  const modeFor = (key: CircleOverrideFieldKey) => circleOverrideFieldMode(fields, key);

  // What the organizer's own data holds for this circle, which is what
  // 使用場刊資料 would show. Unknown until the preview baseline arrives.
  const official = baseRecords?.[0]?.circle;
  const officialHas = (key: CircleOverrideFieldKey) => {
    if (!official) return false;
    if (key === "shareImage") return false;
    if (key === "thumbnail") return official.media.some((item) => item.kind === "thumbnail");
    if (key === "catalogImages") return official.media.some((item) => item.kind === "catalog");
    if (key === "links") return official.externalLinks.length > 0;
    const value = official[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  };

  const links = fields.links ?? [];
  const setLinks = (next: CircleExternalLink[]) => setFields((current) => ({ ...current, links: next }));
  const editLink = (index: number, patch: Partial<CircleExternalLink>) =>
    setLinks(links.map((link, position) => position === index ? { ...link, ...patch } : link));
  const moveLink = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= links.length) return;
    const next = [...links];
    [next[index], next[target]] = [next[target], next[index]];
    setLinks(next);
  };

  const thumbnail = fields.thumbnail ?? undefined;
  const editThumbnail = (patch: Partial<CircleOverrideThumbnail>) => {
    // Metadata edits still describe the same staged object. Only replacing the
    // URL turns it into a different (external) thumbnail and drops the key.
    if (Object.hasOwn(patch, "url")) setStagedThumbnailKey(null);
    setFields((current) => {
      const next = { url: "", sourceUrl: "", provider: "", ...(current.thumbnail ?? {}), ...patch };
      // All three emptied is the picture taken away, which is what a reader
      // then sees — not an address still to be filled in.
      const emptied = !next.url.trim() && !next.sourceUrl?.trim() && !next.provider?.trim();
      return { ...current, thumbnail: emptied ? null : next };
    });
  };

  // Block the round trip rather than let the shared validator answer with one
  // message for nine fields: it cannot say which row is wrong, but the editor can.
  const problems = [
    ...CIRCLE_OVERRIDE_LIST_FIELDS.flatMap(({ key, label }) => {
      const items = fields[key] ?? [];
      const item = items.findIndex((candidate) => candidate.length > OVERRIDE_LIMITS.listItemLength);
      return [
        items.length > OVERRIDE_LIMITS.listItems
          ? { id: `${key}-${claim.circleId}`, message: t("{label}最多 {max} 項，目前有 {count} 項。", { label: t(label), max: OVERRIDE_LIMITS.listItems, count: items.length }) } : null,
        item >= 0
          ? { id: `${key}-${claim.circleId}`, message: t("{label}第 {index} 項超過 {max} 字。", { label: t(label), index: item + 1, max: OVERRIDE_LIMITS.listItemLength }) } : null,
      ];
    }),
    ...links.map((link, index) => {
      const problem = linkUrlProblem(link.url) || (link.provider.trim() ? "" : "請填寫平台名稱。");
      return problem ? { id: linkUrlProblem(link.url) ? `link-url-${claim.circleId}-${index}` : `link-provider-${claim.circleId}-${index}`, message: t("第 {index} 個連結：{problem}", { index: index + 1, problem: t(problem) }) } : null;
    }),
    thumbnail && thumbnailUrlProblem(thumbnail.url) ? { id: `thumb-url-${claim.circleId}`, message: thumbnailUrlProblem(thumbnail.url) } : null,
    // Pending counts as not yet checked, not as fine: a slow address could
    // otherwise be published in the window before `onError` fires.
    thumbnail?.url && !thumbnailUrlProblem(thumbnail.url) && !(thumbnailLoad?.url === thumbnail.url && thumbnailLoad.ok)
      ? {
        id: `thumb-url-${claim.circleId}`,
        message: thumbnailLoad?.url === thumbnail.url ? THUMBNAIL_NOT_AN_IMAGE : "正在確認圖片…",
      } : null,
    thumbnail?.sourceUrl?.trim() && linkUrlProblem(thumbnail.sourceUrl) ? { id: `thumb-source-${claim.circleId}`, message: linkUrlProblem(thumbnail.sourceUrl) } : null,
    JSON.stringify(fields).length > OVERRIDE_LIMITS.serializedFields
      ? { id: `editor-fields-${claim.circleId}`, message: t("全部欄位合計超過 {max} 字元，請縮短內容或連結。", { max: OVERRIDE_LIMITS.serializedFields }) } : null,
  ].filter((problem): problem is { id: string; message: string } => problem !== null);

  const closeReview = () => {
    setReviewOpen(false);
    requestAnimationFrame(() => returnFocus.current?.focus());
  };

  // The confirm button sits at the end of the review panel, which on a wide
  // screen only replaces the right column: without this the page looks
  // unchanged where the reader is looking.
  useEffect(() => {
    if (!reviewOpen) return;
    requestAnimationFrame(() => {
      reviewPanel.current?.focus({ preventScroll: true });
      reviewActions.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "end",
      });
    });
  }, [reviewOpen]);

  useModalFocus(expanded, expandedPreview, () => setExpanded(false));

  // Reachable with problems outstanding: the press is answered by taking the
  // author to the first field that needs fixing, rather than by a dead button.
  const showFirstProblem = () => pointTo(document.getElementById(problems[0]?.id ?? ""));
  const openReview = () => {
    if (problems.length > 0) {
      showFirstProblem();
      return;
    }
    const snapshot = draft();
    const requestGeneration = ++previewRequestGeneration.current;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setStatus({ kind: "busy", message: "正在用公開端規則檢查預覽…" });
    void previewOverride(claim.circleId, snapshot)
      .then((result) => {
        if (requestGeneration !== previewRequestGeneration.current) return;
        setBaseRecords(result.baseRecords as CircleViewRecord[]);
        setServerPreview(result.records as CircleViewRecord[]);
        setProjectedAt(result.projectedAt);
        setReviewedFields(snapshot);
        setReviewedThumbnailKey(stagedThumbnailKey);
        setReviewOpen(true);
        setStatus(IDLE);
      })
      .catch((error: unknown) => {
        if (requestGeneration === previewRequestGeneration.current) setStatus({ kind: "error", message: errorMessage(error) });
      });
  };

  // The action bar answers for the form itself; a busy state already shows on
  // its button, and the after-event switch and the deletion answer in place.
  const formMessage = !status.at && (status.kind === "ok" || status.kind === "error") ? status : null;

  return <section id={`circle-editor-${claim.circleId}`} className={`${styles.card} ${styles.editorCard}`} aria-busy={!hydrated && !hydrationError}>
    <h2>{t("編輯：{name}", { name: claim.circleName })}</h2>
    <p>{t("儲存後約一分鐘內公開。社團名稱、攤位與日期無法在此修改；名稱有誤請聯絡管理者。")}</p>

    {!hydrated && !hydrationError && <p className={styles.notice} role="status">{t("正在載入已儲存內容，完成前無法編輯。")}</p>}
    {hydrationError && <p className={styles.error} role="alert">
      {t("無法載入已儲存內容：")}{portalNotice(hydrationError, locale)}
      <button type="button" className={styles.inlineButton} onClick={retryHydration}>{t("重試載入已儲存內容")}</button>
    </p>}

    {draftRestoredAt && draftDiffersFromSaved && <p className={styles.notice} role="status">
      {t("這是你在這台裝置上 {time} 編輯到一半、還沒儲存的內容。", { time: new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Taipei" }).format(new Date(draftRestoredAt)) })}<button type="button" className={styles.inlineButton} onClick={discardDraft}>{t("還原為已儲存的版本")}</button>
    </p>}

    <div className={styles.editorLayout}>
      <div id={`editor-fields-${claim.circleId}`} className={styles.editorForm} tabIndex={-1} inert={reviewOpen ? true : undefined}>
      {/* The sections follow the reader's circle page — sale text, sale sheet,
          who and what, picture, links — so what is filled in here is found in
          the same place there. The sale sheet stays right after the sale text. */}
      <fieldset className={styles.editorFieldset} disabled={!hydrated || reviewOpen}>

    <div className={styles.editorSection}>
      {fieldHead("saleInfo", "販售資訊", <h3><label htmlFor={`sale-${claim.circleId}`}>{t("販售資訊")}</label></h3>)}
      <textarea
        id={`sale-${claim.circleId}`} rows={4} maxLength={OVERRIDE_LIMITS.saleInfo}
        aria-describedby={`sale-limit-${claim.circleId}`}
        value={fields.saleInfo ?? ""}
        onChange={(event) => setFields((current) => ({ ...current, saleInfo: event.target.value }))}
      />
      <p id={`sale-limit-${claim.circleId}`} className={styles.editorHint}>{t("最多 {max} 字", { max: OVERRIDE_LIMITS.saleInfo })}</p>
    </div>

    <div className={styles.editorSection}>
      {fieldHead("catalogImages", "品書", <h3>{t("本次品書")}</h3>)}
      <CatalogImagesField
        circleId={claim.circleId} images={fields.catalogImages ?? []} busy={status.kind === "busy"}
        onUpdate={(update) => setFields((current) => ({ ...current, catalogImages: update(current.catalogImages ?? []) }))}
        onUploading={(active) => setStatus(active ? { kind: "busy", message: "上傳品書中…" } : IDLE)}
      />
    </div>

    <div className={styles.editorSection}>
      <h3>{t("作者與作品")}</h3>
      <div className={styles.field}>
        {fieldHead("pen", "筆名", <label htmlFor={`pen-${claim.circleId}`}>{t("筆名（最多 {max} 字）", { max: OVERRIDE_LIMITS.pen })}</label>)}
        <input
          id={`pen-${claim.circleId}`} maxLength={OVERRIDE_LIMITS.pen}
          value={fields.pen ?? ""}
          onChange={(event) => setFields((current) => ({ ...current, pen: event.target.value }))}
        />
      </div>
      <div className={styles.field}>
        {fieldHead("circleCategory", "社團主題", <label htmlFor={`circle-category-${claim.circleId}`}>{t("社團主題")}</label>)}
        <select
          id={`circle-category-${claim.circleId}`}
          value={fields.circleCategory ?? ""}
          onChange={(event) => setFields((current) => ({ ...current, circleCategory: event.target.value }))}
        >
          <option value="">{t("尚未選擇")}</option>
          {event.circleCategories.categories.map((category) => <option key={category.id} value={category.label}>{category.label}</option>)}
        </select>
      </div>
      {CIRCLE_OVERRIDE_LIST_FIELDS.map(({ key, label }) => <Fragment key={key}>{listField(key, label)}</Fragment>)}
    </div>

    <div className={styles.editorSection}>
      {fieldHead("thumbnail", "代表圖", <h3>{t("代表圖")}</h3>)}
      <div className={styles.thumbnailLayout}>
        {/* The only check left on an external address is whether it is really
            an image, and the browser is the one that can answer it (ADR-0052).
            The preview is that answer, and doubles as the feedback an upload
            needs; it leads so the current picture is seen before changing it. */}
        {thumbnail?.url && !thumbnailUrlProblem(thumbnail.url) && <div className={styles.thumbnailPreview}>
          <img
            src={thumbnail.url} alt={t("代表圖預覽")}
            onLoad={() => setThumbnailLoad({ url: thumbnail.url, ok: true })}
            onError={() => setThumbnailLoad({ url: thumbnail.url, ok: false })}
          />
          {thumbnailLoad?.url === thumbnail.url && !thumbnailLoad.ok && <p className={styles.error}>{t(THUMBNAIL_NOT_AN_IMAGE)}</p>}
          {/* The way to take the picture away where 不顯示 is not offered; an
              emptied address alone would only be a field still to fill in. */}
          {!officialHas("thumbnail") && <button type="button" onClick={() => clearField("thumbnail")}>{t("移除圖片")}</button>}
        </div>}
        <div className={styles.thumbnailFields}>
          <label htmlFor={`thumb-file-${claim.circleId}`}>{t("上傳圖片")}</label>
          <input
            id={`thumb-file-${claim.circleId}`} type="file" accept="image/jpeg,image/png,image/webp"
            aria-describedby={`thumb-file-hint-${claim.circleId}`}
            disabled={status.kind === "busy"}
            onChange={(event) => {
              const input = event.currentTarget;
              const file = event.target.files?.[0];
              if (!file) return;
              // Whatever credit is already filled in travels with the bytes; neither
              // field gates the upload (ADR-0053).
              const sourceUrl = thumbnail?.sourceUrl?.trim() ?? "";
              const provider = thumbnail?.provider?.trim() ?? "";
              setUploadNotice({ kind: "busy", message: "上傳中…" });
              setStatus({ kind: "busy", message: "上傳代表圖中…" });
              void uploadThumbnail(claim.circleId, file, sourceUrl, provider)
                .then(({ thumbnail: uploaded, uploadKey }) => {
                  setFields((current) => ({ ...current, thumbnail: uploaded }));
                  setStagedThumbnailKey(uploadKey);
                  setUploadNotice({ kind: "ok", message: "圖片已上傳，儲存後公開。" });
                  setStatus(IDLE);
                })
                .catch((error: unknown) => {
                  setUploadNotice({ kind: "error", message: errorMessage(error) });
                  setStatus(IDLE);
                })
                .finally(() => { input.value = ""; });
            }}
          />
          <p id={`thumb-file-hint-${claim.circleId}`} className={styles.editorHint}>{t("JPEG、PNG、WebP，最大 5 MB")}</p>
          {uploadNotice.kind !== "idle" && <p className={uploadNotice.kind === "error" ? styles.error : styles.notice}>{portalNotice(uploadNotice.message, locale)}</p>}

          <label htmlFor={`thumb-url-${claim.circleId}`}>{t("外部圖片網址")}</label>
          <input
            id={`thumb-url-${claim.circleId}`} value={thumbnail?.url ?? ""} inputMode="url" placeholder="https://"
            aria-invalid={thumbnail?.url && thumbnailUrlProblem(thumbnail.url) ? true : undefined}
            onChange={(event) => editThumbnail({ url: event.target.value })}
          />
          {thumbnail?.url && thumbnailUrlProblem(thumbnail.url) && <p className={styles.error}>{t(thumbnailUrlProblem(thumbnail.url))}</p>}

          <label htmlFor={`thumb-source-${claim.circleId}`}>{t("圖片出處頁面（選填）")}</label>
          <input
            id={`thumb-source-${claim.circleId}`} value={thumbnail?.sourceUrl ?? ""} inputMode="url" placeholder="https://"
            aria-invalid={thumbnail?.sourceUrl && linkUrlProblem(thumbnail.sourceUrl) ? true : undefined}
            onChange={(event) => editThumbnail({ sourceUrl: event.target.value })}
          />
          {thumbnail?.sourceUrl && linkUrlProblem(thumbnail.sourceUrl) && <p className={styles.error}>{t(linkUrlProblem(thumbnail.sourceUrl))}</p>}

          <label htmlFor={`thumb-provider-${claim.circleId}`}>{t("來源標示（選填，例如轉載或委託繪師）")}</label>
          <input
            id={`thumb-provider-${claim.circleId}`} value={thumbnail?.provider ?? ""} maxLength={OVERRIDE_LIMITS.listItemLength}
            placeholder={t("例如：Pixiv")} onChange={(event) => editThumbnail({ provider: event.target.value })}
          />
        </div>
      </div>
    </div>

    <div className={styles.editorSection}>
      {fieldHead("links", "連結", <h3>{t("連結")}</h3>)}
      {/* The HTTPS rule lives in `linkUrlProblem`, which names the row that
          broke it; teaching it up here as well is a rule stated twice. */}
      <p className={styles.editorHint}>{t("地圖側欄顯示前 {visible} 個連結，最多可填 {max} 個。", { visible: SIDE_PANEL_LINK_LIMIT, max: OVERRIDE_LIMITS.links })}</p>

      {links.length === 0
        ? modeFor("links") === "inherit" && <p className={styles.editorHint}>{t("新增後會改用你填寫的連結。")}</p>
        : <ol className={styles.linkList}>
          {links.map((link, index) => {
            const problem = linkUrlProblem(link.url);
            return <li key={index}>
              <div className={styles.linkRow}>
                <span className={styles.linkPosition} aria-hidden="true">{index + 1}</span>
                {/* Each label owns its control, so a row lays out as three fields
                    rather than six items the grid has to guess the pairing of. */}
                <label htmlFor={`link-provider-${claim.circleId}-${index}`}>
                  {t("平台名稱")}<input
                    id={`link-provider-${claim.circleId}-${index}`}
                    value={link.provider} maxLength={OVERRIDE_LIMITS.listItemLength}
                    placeholder={t("例如：X、Pixiv、巴哈")}
                    onChange={(event) => editLink(index, { provider: event.target.value })}
                  />
                </label>
                <label htmlFor={`link-kind-${claim.circleId}-${index}`}>
                  {t("類型")}<select
                    id={`link-kind-${claim.circleId}-${index}`}
                    value={link.kind}
                    onChange={(event) => editLink(index, { kind: event.target.value as CircleExternalLink["kind"] })}
                  >
                    {LINK_KINDS.map((kind) => <option key={kind} value={kind}>{linkKindLabel(kind, locale)}</option>)}
                  </select>
                </label>
                <label htmlFor={`link-url-${claim.circleId}-${index}`} className={styles.linkUrlField}>
                  {t("網址")}<input
                    id={`link-url-${claim.circleId}-${index}`}
                    value={link.url} inputMode="url" placeholder="https://"
                    aria-invalid={problem ? true : undefined}
                    onChange={(event) => editLink(index, { url: event.target.value })}
                  />
                </label>
                <div className={styles.linkActions}>
                  <button type="button" disabled={index === 0} onClick={() => moveLink(index, -1)} aria-label={t("把第 {index} 個連結往前移", { index: index + 1 })}>↑</button>
                  <button type="button" disabled={index === links.length - 1} onClick={() => moveLink(index, 1)} aria-label={t("把第 {index} 個連結往後移", { index: index + 1 })}>↓</button>
                  <button type="button" onClick={() => setLinks(links.filter((unused, position) => position !== index))} aria-label={t("移除第 {index} 個連結", { index: index + 1 })}>{t("移除")}</button>
                </div>
              </div>
              {problem && <p className={styles.error}>{t(problem)}</p>}
              {index === SIDE_PANEL_LINK_LIMIT - 1 && links.length > SIDE_PANEL_LINK_LIMIT
                && <p className={styles.linkCut}>{t("以下的連結不會出現在地圖側欄")}</p>}
            </li>;
          })}
        </ol>}

      <div className={styles.linkAdd}>
        <button type="button" disabled={links.length >= OVERRIDE_LIMITS.links} onClick={() => setLinks([...links, { ...EMPTY_LINK }])}>{t("新增連結")}</button>
        {links.length > 0 && <span>{links.length} / {OVERRIDE_LIMITS.links}</span>}
      </div>
    </div>

      </fieldset>

      {saved && hydrated && <CirclePageShare
        event={event} circle={{ id: claim.circleId, name: claim.circleName }}
        records={baseRecords} failed={baselineFailed && !baseRecords} onRetry={retryBaseline}
        fields={fields} savedFields={savedFields}
        onImageChange={shareImage => setFields(current => ({ ...current, shareImage }))}
      />}

      {/* Held at the foot of the screen while the form scrolls past, and
          ending where the form ends: the step that publishes is always in
          reach, and nothing else — least of all the deletion — sits beside it. */}
      <div className={styles.saveBar}>
        {problems.length > 0 && <ul className={styles.problemList} aria-live="polite">
          {problems.map((problem) => <li key={`${problem.id}-${t(problem.message)}`}><a href={`#${problem.id}`}>{t(problem.message)}</a></li>)}
        </ul>}
        <div className={styles.saveBarRow}>
          <p className={formMessage?.kind === "error" ? styles.actionError : formMessage ? styles.actionOk : styles.actionState} role="status">
            {formMessage
              ? <>{portalNotice(formMessage.message, locale)}{formMessage.message === SAVED_MESSAGE && <a className={styles.inlineButton} href={localizedHref(mapHref(event.id, firstDayRecord), locale)}>{t("返回活動地圖")}</a>}</>
              : !hydrated ? null : draftDiffersFromSaved ? t("尚未儲存") : justReverted ? t("已還原為已儲存的版本") : null}
          </p>
          {/* Beside the step that publishes, so an edit gone wrong can be
              walked back where it would otherwise be sent; only once there is
              a saved version to go back to. */}
          {hydrated && saved && (draftDiffersFromSaved || justReverted) && <button
            type="button" className={styles.secondaryButton} disabled={status.kind === "busy" || reviewOpen}
            onClick={justReverted ? undoRevert : discardDraft}
          >{justReverted ? t("取消還原") : t("還原為已儲存的版本")}</button>}
          <button type="button" disabled={!hydrated || status.kind === "busy" || reviewOpen} aria-disabled={problems.length > 0 || undefined} onClick={openReview}>
            {status.kind === "busy" ? t("檢查中…") : t("預覽並送出")}
          </button>
        </div>
      </div>
      </div>

      <aside className={`${styles.previewColumn} ${reviewOpen ? styles.reviewOpen : ""}`} aria-label={reviewOpen ? t("儲存前確認") : t("即時公開預覽")}>
        {reviewOpen && reviewedFields && serverPreview
          ? <div ref={reviewPanel} className={styles.reviewPanel} role="region" tabIndex={-1} aria-labelledby={`review-title-${claim.circleId}`}>
            <div className={styles.reviewHeading}>
              <div><h3 id={`review-title-${claim.circleId}`}>{t("儲存前確認")}</h3></div>
              <button type="button" className={styles.backButton} onClick={closeReview}>{t("返回修改")}</button>
            </div>
            <PublicationPreview records={serverPreview} />
            <h4>{t("這次填寫的欄位")}</h4>
            <ReviewSummary fields={reviewedFields} />
            <div ref={reviewActions} className={styles.reviewActions}>
              <button type="button" className={styles.backButton} disabled={status.kind === "busy"} onClick={closeReview}>{t("返回修改")}</button>
              {/* Re-checked here, not only when the review opened: an image
                  verdict can arrive after that, and a confirmation taken before
                  it must not be the one that publishes. */}
              <button type="button" disabled={status.kind === "busy"} aria-disabled={problems.length > 0 || undefined} onClick={() => {
                // A verdict that arrived during the review sends the author
                // back to the field it is about, not to a button that is dead.
                if (problems.length > 0) {
                  closeReview();
                  requestAnimationFrame(showFirstProblem);
                  return;
                }
                const savingFields = { ...reviewedFields };
                setStatus({ kind: "busy", message: "儲存中…" });
                void saveOverride(claim.circleId, savingFields, null, reviewedThumbnailKey ?? undefined)
                  .then(() => {
                    setSaved(true);
                    setSavedFields(savingFields);
                    forgetStoredDraft(claim.circleId);
                    setDraftRestoredAt(null);
                    setStagedThumbnailKey(null);
                    setReviewedThumbnailKey(null);
                    setStatus({ kind: "ok", message: SAVED_MESSAGE });
                    closeReview();
                  })
                  .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
              }}>{status.kind === "busy" ? t("儲存中…") : t("確認儲存")}</button>
            </div>
            {problems.length > 0 && <ul className={styles.problemList} aria-live="polite">
              {problems.map((problem) => <li key={`${problem.id}-${t(problem.message)}`}>{t(problem.message)}</li>)}
            </ul>}
            {status.kind === "error" && !status.at && <p className={styles.error} role="status">{portalNotice(status.message, locale)}</p>}
          </div>
          : <div className={styles.livePreview}>
            <small>{t("尚未儲存")}</small>
            <div className={styles.previewHeading}>
              <h3>{t("公開預覽")}</h3>
              {/* `useModalFocus` returns focus here on close, so the button
                  needs no ref of its own. */}
              {livePreview?.length ? <button type="button" className={styles.inlineButton} onClick={() => setExpanded(true)}>{t("開啟完整詳細資訊")}</button> : null}
            </div>
            {livePreview ? <PublicationPreview records={livePreview} compact /> : <p>{t("正在準備預覽…")}</p>}
          </div>}
      </aside>

      {expanded && livePreview?.length ? <div
        className={styles.previewBackdrop} role="presentation"
        onPointerDown={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}
      >
        <div
          ref={expandedPreview} className={styles.previewDialog} role="dialog" aria-modal="true"
          aria-label={t("完整詳細資訊預覽")} tabIndex={-1}
        >
          <div className={styles.previewHeading}>
            <h3>{t("完整詳細資訊")}</h3>
            <button type="button" className={styles.backButton} onClick={() => setExpanded(false)}>{t("關閉")}</button>
          </div>
          <PublicationPreview records={livePreview} />
        </div>
      </div> : null}
    </div>

    {/* These settings act independently of the form's preview and save. */}
    <div className={styles.editorAfter} inert={reviewOpen ? true : undefined}>
      <fieldset className={styles.editorFieldset} disabled={!hydrated || reviewOpen}>
        <div className={styles.editorAfterRow}>
          {/* Saved on the spot rather than with the draft: it is one switch with an
              immediate answer, and it survives a tab closed before submitting. */}
          <fieldset className={styles.retention}>
            <legend>{t("活動結束後")}</legend>
            <div className={styles.retentionChoices}>
              {([{ value: false, title: "繼續公開" }, { value: true, title: "不再公開" }] as const).map((option) => <label key={option.title}>
                <input
                  type="radio" name={`after-event-${claim.circleId}`}
                  checked={hidden === option.value}
                  onChange={() => {
                    setHidden(option.value);
                    void setPostEventVisibility(claim.circleId, option.value)
                      .then(() => setStatus({ kind: "ok", message: option.value ? "活動結束後將不再公開你填寫的內容。" : "活動結束後仍會公開你填寫的內容。", at: "setting" }))
                      .catch((error: unknown) => { setHidden(!option.value); setStatus({ kind: "error", message: errorMessage(error), at: "setting" }); });
                  }}
                />
                <span>{t(option.title)}</span>
              </label>)}
            </div>
            {status.at === "setting" && <p className={status.kind === "error" ? styles.error : styles.notice} role="status">{portalNotice(status.message, locale)}</p>}
          </fieldset>
        </div>

        {/* Collapsed: it is the one irreversible action on the page, and it is
            reached deliberately rather than met on the way past. `<details>` keeps
            it one click away and findable by the browser's own in-page search.
            Its answer stays here even once the details are gone with the data. */}
        {(saved || status.at === "delete") && <div className={styles.dangerZone}>
        {saved && <details className={styles.danger}>
          <summary>{t("刪除資料")}</summary>
          {/* Clearing a field writes an empty value and leaves the row; this
              removes the row. ADR-0020 requires the two to read as different
              things, because only one of them is undoable. */}
          <p>{t("永久刪除你填寫的內容與上一版備份，")}<b>{t("無法復原")}</b>{t("。場刊中的社團名、攤位與日期不受影響。")}</p>
          <p>{t("將被刪除的內容：")}</p>
          {deletionSummary(savedFields, t).length === 0
            ? <ul className={styles.dangerSummary}><li>{t("（目前沒有任何欄位有內容，但資料列仍然存在）")}</li></ul>
            : <ul className={styles.dangerSummary}>{deletionSummary(savedFields, t).map((line) => <li key={line}>{line}</li>)}</ul>}
          {/* Not a single button: a session lasts 30 days, and one click from a
              stale tab must not be able to do this. Re-sending a mail would have
              been the other option, and it would put an irreversible action behind
              deliverability. */}
          <label htmlFor={`confirm-${claim.circleId}`}>{t("請輸入社團代號")}<code>{claim.circleId}</code> {t("以確認")}</label>
          <input
            id={`confirm-${claim.circleId}`} value={confirmText} autoComplete="off" spellCheck={false}
            onChange={(event) => setConfirmText(event.target.value)} placeholder={claim.circleId}
          />
          <button
            type="button" className={styles.dangerButton}
            disabled={confirmText.trim() !== claim.circleId || status.kind === "busy"}
            onClick={() => {
              setStatus({ kind: "busy", message: "刪除中…", at: "delete" });
              void deleteMyOverride(claim.circleId)
                .then(() => {
                  setFields({});
                  setListInputs({});
                  forgetStoredDraft(claim.circleId);
                  setDraftRestoredAt(null);
                  setSavedFields({});
                  setHidden(false);
                  setSaved(false);
                  setConfirmText("");
                  setOwnContent({});
                  setStatus({ kind: "ok", message: "已刪除。公開頁面會在一分鐘內不再顯示這筆內容。", at: "delete" });
                })
                .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error), at: "delete" }));
            }}
          >{t("刪除資料")}</button>
        </details>}
        {status.at === "delete" && status.kind !== "busy" && <p className={status.kind === "error" ? styles.error : styles.notice} role="status">{portalNotice(status.message, locale)}</p>}
        </div>}
      </fieldset>
    </div>
  </section>;
}
