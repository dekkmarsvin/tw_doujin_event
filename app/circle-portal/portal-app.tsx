"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createClaim, decideClaim, deleteMyAccount, deleteMyOverride, disableAccount, listAdmins, listMyClaims, listPendingClaims, manageAdmin, PortalError, readMyOverride,
  previewOverride, readSession, readTurnstileSitekey, setPostEventVisibility, requestLoginLink, runChallenge, saveOverride, searchCircles, signOut, takedownOverride, uploadThumbnail, verifyLoginToken, withdrawClaim,
  setPortalEventId,
  type AdminEntry, type CircleMatch, type ClaimSummary, type PendingClaim, type PortalSession,
} from "../circle-editor-client";
import {
  AGE_RATING_OPTIONS, CIRCLE_OVERRIDE_LIST_FIELDS, CREATOR_TYPE_OPTIONS, LINK_KINDS, OVERRIDE_LIMITS, WORK_TYPE_OPTIONS,
  circleOverrideFieldMode, clearCircleOverrideField, inheritCircleOverrideField,
  type CircleOverrideFieldKey, type CircleOverrideFields, type CircleOverrideThumbnail,
} from "../circle-overrides";
import { linkUrlProblem, thumbnailUrlProblem, THUMBNAIL_NOT_AN_IMAGE } from "../circle-override-messages";
import { CircleDetails, LINK_KIND_LABEL } from "../event-workspace-panels";
import { useModalFocus } from "../use-modal-focus";
import type { CircleExternalLink, CircleViewRecord } from "../circle-records";
import { projectCircleDraftRecords } from "../circle-records";
import { PUBLISHED_EVENTS, getPublishedEvent, type EventDefinition } from "../event-catalog";
import { TurnstileWidget } from "./turnstile-widget";
import { AdminMapReviewPanel, MapContributorPanel } from "./map-contribution-panel";
import styles from "./portal.module.css";

type Status = { kind: "idle" | "busy" | "ok" | "error"; message: string };

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
 * default. An unpublished or unknown id falls back rather than showing an
 * event this build does not serve.
 */
function initialPortalEventId() {
  const fallback = PUBLISHED_EVENTS[0]?.id ?? "";
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

const DRAFT_TIME = new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short" });

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
 * 它描述的事實一起刪掉——那是替社團改了它沒改的答案。閱讀端的限制分級要怎麼
 * 從多值推導，另見 #193。
 */
const MULTI_CHOICE_FIELD_KEYS = ["creatorTypes", "ageRatings"] as const satisfies readonly ChoiceFieldKey[];

type MultiChoiceFieldKey = (typeof MULTI_CHOICE_FIELD_KEYS)[number];

function isMultiChoiceField(key: CircleOverrideListFieldKey): key is MultiChoiceFieldKey {
  return (MULTI_CHOICE_FIELD_KEYS as readonly string[]).includes(key);
}

function FieldModeControls({ mode, label, onInherit, onClear, inheritStatus = "目前顯示場刊資料", inheritAction = "使用場刊資料" }: {
  mode: keyof typeof FIELD_MODE_LABEL;
  label: string;
  onInherit: () => void;
  onClear: () => void;
  inheritStatus?: string;
  inheritAction?: string;
}) {
  return <div className={styles.fieldMode} role="group" aria-label={`${label}顯示什麼`}>
    <span><b>{mode === "inherit" ? inheritStatus : FIELD_MODE_LABEL[mode]}</b></span>
    <button type="button" aria-pressed={mode === "inherit"} disabled={mode === "inherit"} onClick={onInherit}>{inheritAction}</button>
    <button type="button" aria-pressed={mode === "clear"} disabled={mode === "clear"} onClick={onClear}>不顯示</button>
  </div>;
}

function errorMessage(error: unknown) {
  return error instanceof PortalError || error instanceof Error ? error.message : "操作失敗，請稍後再試。";
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
  const [session, setSession] = useState<PortalSession | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>(IDLE);
  const [claims, setClaims] = useState<ClaimSummary[]>([]);
  const [eventId, setEventId] = useState(initialPortalEventId);
  const event = getPublishedEvent(eventId) ?? PUBLISHED_EVENTS[0];
  /** What a late answer is compared against; `claims` lives above the keyed subtree. */
  const maintainedEventId = useRef(event.id);

  const refreshClaims = useCallback(async () => {
    // Set here as well as in the effect below: the claim list is the first
    // event-scoped call after a sign-in, and reading it for the wrong event
    // would show the account claims it does not hold in this one.
    setPortalEventId(event.id);
    const requested = event.id;
    try {
      const answer = await listMyClaims();
      // A switch while this request was in flight leaves an older answer
      // arriving late. The server says which event it answered for, so a stale
      // one is dropped rather than rendered — with its editors — under the
      // event now on screen.
      if (requested !== maintainedEventId.current || answer.eventId !== requested) return;
      setClaims(answer.claims);
    } catch {
      if (requested === maintainedEventId.current) setClaims([]);
    }
  }, [event.id]);

  // Declared before the session effect so the scope is in place for every
  // event-scoped call of this commit.
  useEffect(() => {
    maintainedEventId.current = event.id;
    setPortalEventId(event.id);
    try {
      window.localStorage.setItem(PORTAL_EVENT_STORAGE_KEY, event.id);
    } catch {
      // A browser that refuses storage still works; it just forgets the choice.
    }
    const url = new URL(window.location.href);
    if (url.searchParams.get("event") === event.id) return;
    url.searchParams.set("event", event.id);
    window.history.replaceState(null, "", url);
  }, [event.id]);

  useEffect(() => {
    const token = takeLoginToken();
    void (async () => {
      if (token) {
        try {
          setSession(await verifyLoginToken(token));
          setStatus({ kind: "ok", message: "登入成功。" });
        } catch (error) {
          setStatus({ kind: "error", message: errorMessage(error) });
        }
      } else {
        try {
          setSession(await readSession());
        } catch {
          setSession(null);
        }
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!session) return;
    // Deferred like `use-planning.ts`: the load is async, but scheduling it out
    // of the effect body keeps the render pass free of cascading updates.
    queueMicrotask(() => { void refreshClaims(); });
  }, [refreshClaims, session]);

  return <div className={styles.page}>
    <header className={styles.masthead}>
      <div>
        <h1>社團資料</h1>
        <p>{event.name}・{event.dateRangeLabel}</p>
        <p className={styles.backLink}><a href={mapHref(event.id)}>返回活動地圖</a></p>
      </div>
      {session && <div className={styles.identity}>
        {/* Shows which identity the server resolved, so a mismatch against
            ADMIN_EMAILS is visible rather than silently hiding the panel. */}
        <span>{session.email}{session.isAdmin ? "・管理者" : ""}{session.isMapContributor ? "・地圖貢獻者" : ""}</span>
        {session.isMapContributor && <a href="#map-contribution">地圖草稿</a>}
        {session.isAdmin && <a href="#admin">管理</a>}
        <button type="button" onClick={() => void signOut().then(() => { setSession(null); setClaims([]); })}>登出</button>
      </div>}
    </header>

    {status.kind !== "idle" && <p className={status.kind === "error" ? styles.error : styles.notice} role="status">{status.message}</p>}

    {!ready ? <p className={styles.notice}>載入中…</p>
      : !session ? <SignIn />
        : <>
          {/* One event: no choice to make, so the portal opens straight into it. */}
          {PUBLISHED_EVENTS.length > 1 && <EventPicker
            eventId={event.id}
            onChoose={(next) => { setEventId(next); setClaims([]); setStatus(IDLE); }}
          />}
          {/* Keyed on the event: claims, drafts and editor drafts all belong to
              one event, and carrying them across a switch would show one
              event's work under another's name. */}
          <Fragment key={event.id}>
            <ClaimList claims={claims} onChanged={refreshClaims} />
            <ClaimForm onCreated={refreshClaims} />
            {claims.filter((claim) => claim.status === "verified").map((claim) => <CircleEditor key={claim.circleId} event={event} claim={claim} />)}
            {session.isMapContributor && <MapContributorPanel event={event} />}
            {session.isAdmin && <AdminMapReviewPanel event={event} />}
            <AccountDeletion session={session} onDeleted={() => { setSession(null); setClaims([]); }} />
            {session.isAdmin && <AdminPanel event={event} />}
          </Fragment>
        </>}

  </div>;
}

function EventPicker({ eventId, onChoose }: { eventId: string; onChoose: (eventId: string) => void }) {
  return <section className={styles.card}>
    <h2>活動</h2>
    <label htmlFor="portal-event">活動</label>
    <select id="portal-event" value={eventId} onChange={(event) => onChoose(event.target.value)}>
      {PUBLISHED_EVENTS.map((item) => <option key={item.id} value={item.id}>{item.name}・{item.dateRangeLabel}</option>)}
    </select>
    <p className={styles.editorHint}>選擇要編輯的活動。</p>
  </section>;
}

function AccountDeletion({ session, onDeleted }: { session: PortalSession; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>(IDLE);
  return <section className={styles.card}>
    <h2>刪除帳號</h2>
    <p>刪除帳號會一併刪除你的認領與自行填寫的資料。場刊中的社團與攤位資料不受影響。</p>
    {session.isAdmin
      ? <p className={styles.notice}>管理者需先由另一位管理者移出名單，才能刪除帳號。</p>
      : <>
        <label htmlFor="delete-account-confirm">輸入完整 email 確認：{session.email}</label>
        <input id="delete-account-confirm" type="email" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        <button type="button" disabled={confirm !== session.email || status.kind === "busy"} onClick={() => {
          setStatus({ kind: "busy", message: "刪除中…" });
          void deleteMyAccount(session.email)
            .then(() => { onDeleted(); })
            .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
        }}>永久刪除帳號</button>
      </>}
    {status.kind === "error" && <p className={styles.error}>{status.message}</p>}
  </section>;
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>(IDLE);
  const [sitekey, setSitekey] = useState<string | null>(null);
  const [humanToken, setHumanToken] = useState<string | null>(null);
  // A Turnstile token is single-use and short-lived. Remounting the widget is
  // what issues the next one, so every submit bumps this.
  const [widgetGeneration, setWidgetGeneration] = useState(0);

  // Only the sign-in view asks for the sitekey; a signed-in circle never pays
  // for the round trip, and the reader entry never imports this module at all.
  useEffect(() => {
    void readTurnstileSitekey()
      .then(setSitekey)
      .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
  }, []);

  const onUnavailable = useCallback(() => setStatus({
    kind: "error",
    message: "真人驗證元件載入失敗，請檢查網路或內容封鎖設定後重新整理。",
  }), []);

  return <section className={styles.card}>
    <h2>登入</h2>
    <p>輸入 email 取得 15 分鐘內有效的一次性登入連結。</p>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (!humanToken) return;
      setStatus({ kind: "busy", message: "寄送中…" });
      void requestLoginLink(email, humanToken)
        .then(() => setStatus({ kind: "ok", message: "若這個 email 可以使用，登入連結已寄出。請一併檢查垃圾郵件匣。" }))
        .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }))
        .finally(() => {
          // Spent either way: the server verifies the token before it decides
          // anything else, so it is never reusable for a second attempt.
          setHumanToken(null);
          setWidgetGeneration((generation) => generation + 1);
        });
    }}>
      <label htmlFor="portal-email">Email</label>
      <input id="portal-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
      {sitekey && <TurnstileWidget key={widgetGeneration} sitekey={sitekey} onToken={setHumanToken} onUnavailable={onUnavailable} />}
      <button type="submit" disabled={!humanToken || status.kind === "busy"}>{status.kind === "busy" ? "寄送中…" : "寄出登入連結"}</button>
    </form>
    {/* Before the address is handed over, not after. A notice that lives only
        in the repo does not exist for the person filling in this field
        (ADR-0011, #30). Plain anchor rather than a router link: the page is
        static and is not part of this bundle. */}
    <p className={styles.policyLink}>
      送出即表示你已閱讀<a href="/privacy">隱私權與資料使用告知</a>。
      個資與著作權爭議請寄 <code>maintain@kotoban.top</code>，控制面使用問題請寄 <code>circle@kotoban.top</code>。
    </p>
    {status.kind !== "idle" && status.kind !== "busy" && <p className={status.kind === "error" ? styles.error : styles.notice}>{status.message}</p>}
  </section>;
}

function ClaimList({ claims, onChanged }: { claims: ClaimSummary[]; onChanged: () => void }) {
  const [status, setStatus] = useState<Status>(IDLE);
  if (claims.length === 0) return null;

  return <section className={styles.card}>
    <h2>我的社團</h2>
    <ul className={styles.claimList}>
      {claims.map((claim) => <li key={claim.id}>
        <div>
          <b>{claim.circleName}</b>
          <small>{claim.circleId}</small>
        </div>
        <span className={styles[`claim_${claim.status}`]}>{
          { pending: "審核中", verified: "已通過", rejected: "已婉拒", revoked: "已撤銷", withdrawn: "已撤回" }[claim.status]
        }</span>
        {claim.status === "pending" && claim.targetUrl && <button type="button" onClick={() => {
          setStatus({ kind: "busy", message: "驗證中…" });
          void runChallenge(claim.id)
            .then((result) => {
              setStatus({ kind: result.verified ? "ok" : "error", message: result.verified ? "驗證通過。" : result.error ?? "尚未找到驗證碼。" });
              onChanged();
            })
            .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
        }}>重新驗證</button>}
        {claim.status === "pending" && <button type="button" onClick={() => {
          setStatus({ kind: "busy", message: "撤回中…" });
          void withdrawClaim(claim.id)
            .then(() => {
              setStatus({ kind: "ok", message: "已撤回。可以重新送出這個社團的認領，並取得新的驗證碼。" });
              onChanged();
            })
            .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
        }}>撤回</button>}
      </li>)}
    </ul>
    {/* The recovery path only works if it is visible before the code goes missing. */}
    {claims.some((claim) => claim.status === "pending") && <p className={styles.notice}>
      驗證碼遺失或過期時，撤回該筆認領後重新送出，即可取得新的驗證碼，不需要聯絡管理者。
    </p>}
    {status.kind !== "idle" && <p className={status.kind === "error" ? styles.error : styles.notice}>{status.message}</p>}
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

function ClaimForm({ onCreated }: { onCreated: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CircleMatch | null>(null);
  const [targetUrl, setTargetUrl] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(IDLE);

  const matches = useCircleSearch(selected ? "" : query);

  return <section className={styles.card}>
    <h2>認領社團</h2>
    <p>搜尋你的社團，並選擇一個可用來驗證身分的連結。沒有可用連結時會改由人工確認。</p>

    <label htmlFor="portal-search">社團名稱</label>
    <input id="portal-search" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null); }} placeholder="輸入至少 2 個字" />
    {matches.length > 0 && !selected && <ul className={styles.matchList}>
      {matches.map((match) => <li key={match.id}>
        <button type="button" onClick={() => { setSelected(match); setQuery(match.name); }}>
          <b>{match.name}</b><small>{match.linkCount} 個已登錄連結</small>
        </button>
      </li>)}
    </ul>}

    {selected && <>
      <label htmlFor="portal-target">驗證用連結（選填）</label>
      <select id="portal-target" value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)}>
        <option value="">不使用自動驗證，改由人工審核</option>
        {selected.links.map((link) => <option key={link.url} value={link.url}>{link.provider}：{link.url}</option>)}
      </select>

      {/* Manual review is the third tier and never issues a code: the reviewer
          reads the link and the note. Asking for a code here described the
          second tier's flow in the third tier's field (#142). */}
      <label htmlFor="portal-evidence">佐證連結（人工審核用，選填）</label>
      <input id="portal-evidence" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://…（可證明你是這個社團的頁面）" />
      <small>人工審核不會發驗證碼。管理者會看這個連結與下方說明，人工核對你與社團的關係。</small>

      <label htmlFor="portal-note">補充說明（選填）</label>
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
            onCreated();
          })
          .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
      }}>送出認領</button>
    </>}

    {challenge && <p className={styles.challenge}><span>驗證碼</span><code>{challenge}</code></p>}
    {status.kind !== "idle" && status.kind !== "busy" && <p className={status.kind === "error" ? styles.error : styles.notice}>{status.message}</p>}
  </section>;
}

/**
 * What deleting would remove, in the circle's own terms.
 *
 * Shown before the button rather than after the fact: pretix makes an export
 * mandatory before a deletion, and this is the weaker version of the same idea
 * — nobody should be able to delete something they cannot see (ADR-0020).
 */
function deletionSummary(fields: CircleOverrideFields) {
  const lines: string[] = [];
  if (fields.pen) lines.push(`筆名：${fields.pen}`);
  if (fields.saleInfo) lines.push(`販售資訊 ${[...fields.saleInfo].length} 字`);
  if (fields.circleCategory) lines.push(`社團主題：${fields.circleCategory}`);
  for (const { key, label } of CIRCLE_OVERRIDE_LIST_FIELDS) {
    const items = fields[key];
    if (items?.length) lines.push(`${label} ${items.length} 項`);
  }
  if (fields.links?.length) lines.push(`連結 ${fields.links.length} 條`);
  if (fields.thumbnail) lines.push("代表圖 1 張");
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
  if (records.length === 0) return <p>這個社團目前沒有配置攤位，公開頁面不會顯示。</p>;
  const record = records[0];
  return <>
    {records.length > 1 && <p>此社團有 {records.length} 天配置；以下預覽 DAY {record.day} {record.code}，其他天的內容相同。</p>}
    <div className={styles.previewFrame} aria-label="刊登預覽">
      <CircleDetails
        record={record}
        sharedRecords={records.filter((candidate) => candidate.day === record.day && candidate.code === record.code)}
        favorite={null} plan={null} groups={[]} compact={compact} readOnly
        onClose={() => undefined} onOpenFull={() => undefined} onSelectShared={() => undefined}
        onToggleFavorite={() => undefined} onTogglePlan={() => undefined} onSetNext={() => undefined}
        onUpdateFavorite={() => undefined} onCreateGroup={() => undefined}
      />
    </div>
  </>;
}

function ReviewSummary({ fields }: { fields: CircleOverrideFields }) {
  const value = (candidate: string | string[] | undefined) => Array.isArray(candidate)
    ? candidate.join("、") || "未提供" : candidate?.trim() || "未提供";
  const rows = [
    ["筆名", value(fields.pen)],
    ["販售資訊", value(fields.saleInfo)],
    ["社團主題", value(fields.circleCategory)],
    ...CIRCLE_OVERRIDE_LIST_FIELDS.map(({ key, label }) => [label, value(fields[key])]),
    ["連結", fields.links?.length ? `${fields.links.length} 條` : "未提供"],
    ["代表圖", fields.thumbnail ? fields.thumbnail.provider || "已提供" : "未提供"],
  ];
  return <dl className={styles.reviewSummary}>
    {rows.map(([label, content]) => <div key={label}><dt>{label}</dt><dd>{content}</dd></div>)}
  </dl>;
}

function CircleEditor({ event, claim }: { event: EventDefinition; claim: ClaimSummary }) {
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
  // What the server holds, as opposed to the draft in `fields`: the deletion
  // summary has to describe what would actually be deleted, not unsaved edits.
  const [savedFields, setSavedFields] = useState<CircleOverrideFields>({});
  const [confirmText, setConfirmText] = useState("");
  // When the draft on this device differs from what the server holds. Shown as
  // a line the author can act on, never as a silent restore.
  const [draftRestoredAt, setDraftRestoredAt] = useState<string | null>(null);
  const loaded = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const reviewPanel = useRef<HTMLDivElement | null>(null);
  const reviewActions = useRef<HTMLDivElement | null>(null);
  const expandedPreview = useRef<HTMLDivElement | null>(null);
  const previewRequestGeneration = useRef(0);

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
    if (loaded.current) return;
    loaded.current = true;
    void readMyOverride(claim.circleId)
      .then((result) => {
        const initialFields = result.fields ?? {};
        // The stored draft wins over the saved record: it is the newer of the
        // two by construction, and dropping it is one click away.
        const stored = readStoredDraft(claim.circleId);
        const restored = !!stored && JSON.stringify(stored.fields) !== JSON.stringify(initialFields);
        setFields(restored ? stored.fields : initialFields);
        setListInputs(restored ? stored.listInputs ?? {} : {});
        setStagedThumbnailKey(restored ? stored.stagedThumbnailKey ?? null : null);
        setDraftRestoredAt(restored ? stored.savedAt : null);
        if (!restored) forgetStoredDraft(claim.circleId);
        setSavedFields(initialFields);
        setHidden(!!result.postEventHidden);
        setSaved(result.status !== "none");
        setHydrated(true);
        const requestGeneration = ++previewRequestGeneration.current;
        void previewOverride(claim.circleId, initialFields).then((previewResult) => {
          if (requestGeneration !== previewRequestGeneration.current) return;
          setBaseRecords(previewResult.baseRecords as CircleViewRecord[]);
          setProjectedAt(previewResult.projectedAt);
        }).catch(() => undefined);
      })
      // Not hydrated: `savedFields` never arrived, so every comparison against
      // it would read as "same as the server" and take the draft away from an
      // author whose load simply failed.
      .catch(() => setFields({}));
  }, [claim.circleId]);

  // Written on every edit rather than on a button: a draft that needs an action
  // to exist is one the author remembers only after losing the tab.
  const draftDiffersFromSaved = JSON.stringify(fields) !== JSON.stringify(savedFields);
  useEffect(() => {
    if (!hydrated) return;
    if (!draftDiffersFromSaved) forgetStoredDraft(claim.circleId);
    else writeStoredDraft(claim.circleId, { fields, listInputs, stagedThumbnailKey, savedAt: new Date().toISOString() });
  }, [claim.circleId, draftDiffersFromSaved, fields, hydrated, listInputs, stagedThumbnailKey]);

  const discardDraft = () => {
    forgetStoredDraft(claim.circleId);
    setFields(savedFields);
    setListInputs({});
    setStagedThumbnailKey(null);
    setDraftRestoredAt(null);
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

  const listField = (key: CircleOverrideListFieldKey, label: string) => {
    const id = `${key}-${claim.circleId}`;
    if (isMultiChoiceField(key)) return <fieldset className={styles.choiceGroup}>
      <legend>{label}</legend>
      <div>{optionsFor(key).map((option) => <label key={option}>
        <input type="checkbox" checked={(fields[key] ?? []).includes(option)} onChange={(event) => toggleChoice(key, option, event.target.checked)} />
        <span>{option}</span>
      </label>)}</div>
    </fieldset>;
    if (key in CHOICE_FIELD_OPTIONS) {
      const choiceKey = key as ChoiceFieldKey;
      const values = fields[choiceKey] ?? [];
      return <>
        <label htmlFor={id}>{label}</label>
        {/* 這個欄位以前可以填多個。多值時每一個都要看得到、刪得掉，不能只把
            第一個當成選取值，把其餘的留在送出的資料裡卻不顯示。 */}
        {values.length > 1 && <div className={styles.extraValues}>
          <span>目前有 {values.length} 個值，選一項會取代全部：</span>
          {values.map((value) => <button key={value} type="button" onClick={() => removeChoice(choiceKey, value)}>
            {value}<span aria-hidden="true">✕</span><span className={styles.visuallyHidden}>移除</span>
          </button>)}
        </div>}
        <select id={id} value={values.length === 1 ? values[0] : ""} onChange={(event) => setChoice(choiceKey, event.target.value)}>
          <option value="">尚未選擇</option>
          {optionsFor(choiceKey).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </>;
    }
    return <>
      <label htmlFor={id}>{label}（以逗號分隔，最多 {OVERRIDE_LIMITS.listItems} 項）</label>
      <input id={id} value={listInputs[key] ?? (fields[key] ?? []).join("、")} onChange={(event) => setList(key, event.target.value)} />
    </>;
  };

  const resetListInput = (key: CircleOverrideFieldKey) => {
    setListInputs((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };
  const inheritField = (key: CircleOverrideFieldKey) => {
    resetListInput(key);
    if (key === "thumbnail") setStagedThumbnailKey(null);
    setFields((current) => inheritCircleOverrideField(current, key));
  };
  const clearField = (key: CircleOverrideFieldKey) => {
    resetListInput(key);
    if (key === "thumbnail") setStagedThumbnailKey(null);
    setFields((current) => clearCircleOverrideField(current, key));
  };
  const modeFor = (key: CircleOverrideFieldKey) => circleOverrideFieldMode(fields, key);

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
    setFields((current) => ({
      ...current,
      thumbnail: { url: "", sourceUrl: "", provider: "", ...(current.thumbnail ?? {}), ...patch },
    }));
  };

  // Block the round trip rather than let the shared validator answer with one
  // message for nine fields: it cannot say which row is wrong, but the editor can.
  const problems = [
    ...CIRCLE_OVERRIDE_LIST_FIELDS.flatMap(({ key, label }) => {
      const items = fields[key] ?? [];
      const item = items.findIndex((candidate) => candidate.length > OVERRIDE_LIMITS.listItemLength);
      return [
        items.length > OVERRIDE_LIMITS.listItems
          ? { id: `${key}-${claim.circleId}`, message: `${label}最多 ${OVERRIDE_LIMITS.listItems} 項，目前有 ${items.length} 項。` } : null,
        item >= 0
          ? { id: `${key}-${claim.circleId}`, message: `${label}第 ${item + 1} 項超過 ${OVERRIDE_LIMITS.listItemLength} 字。` } : null,
      ];
    }),
    ...links.map((link, index) => {
      const problem = linkUrlProblem(link.url) || (link.provider.trim() ? "" : "請填寫平台名稱。");
      return problem ? { id: linkUrlProblem(link.url) ? `link-url-${claim.circleId}-${index}` : `link-provider-${claim.circleId}-${index}`, message: `第 ${index + 1} 個連結：${problem}` } : null;
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
      ? { id: `editor-fields-${claim.circleId}`, message: `全部欄位合計超過 ${OVERRIDE_LIMITS.serializedFields} 字元，請縮短內容或連結。` } : null,
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

  const openReview = () => {
    if (problems.length > 0) {
      document.getElementById(problems[0].id)?.focus();
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

  return <section className={`${styles.card} ${styles.editorCard}`}>
    <h2>編輯：{claim.circleName}</h2>
    <p>儲存後約一分鐘內公開。社團名稱、攤位與日期無法在此修改；名稱有誤請聯絡管理者。</p>

    {draftRestoredAt && draftDiffersFromSaved && <p className={styles.notice} role="status">
      這是你在這台裝置上{DRAFT_TIME.format(new Date(draftRestoredAt))}編輯到一半、還沒儲存的內容。
      <button type="button" className={styles.inlineButton} onClick={discardDraft}>改用已儲存的版本</button>
    </p>}

    <div className={styles.editorLayout}>
      <div id={`editor-fields-${claim.circleId}`} className={styles.editorForm} tabIndex={-1} inert={reviewOpen ? true : undefined}>

    <label htmlFor={`pen-${claim.circleId}`}>筆名（最多 {OVERRIDE_LIMITS.pen} 字）</label>
    <input
      id={`pen-${claim.circleId}`} maxLength={OVERRIDE_LIMITS.pen}
      value={fields.pen ?? ""}
      onChange={(event) => setFields((current) => ({ ...current, pen: event.target.value }))}
    />
    <FieldModeControls mode={modeFor("pen")} label="筆名" onInherit={() => inheritField("pen")} onClear={() => clearField("pen")} />

    <label htmlFor={`sale-${claim.circleId}`}>販售資訊（最多 {OVERRIDE_LIMITS.saleInfo} 字）</label>
    <textarea
      id={`sale-${claim.circleId}`} rows={4} maxLength={OVERRIDE_LIMITS.saleInfo}
      value={fields.saleInfo ?? ""}
      onChange={(event) => setFields((current) => ({ ...current, saleInfo: event.target.value }))}
    />
    <FieldModeControls mode={modeFor("saleInfo")} label="販售資訊" onInherit={() => inheritField("saleInfo")} onClear={() => clearField("saleInfo")} />

    <label htmlFor={`circle-category-${claim.circleId}`}>社團主題</label>
    <select
      id={`circle-category-${claim.circleId}`}
      value={fields.circleCategory ?? ""}
      onChange={(event) => setFields((current) => ({ ...current, circleCategory: event.target.value }))}
    >
      <option value="">尚未選擇</option>
      {event.circleCategories.categories.map((category) => <option key={category.id} value={category.label}>{category.label}</option>)}
    </select>
    <FieldModeControls
      mode={modeFor("circleCategory")} label="社團主題"
      inheritStatus="目前未選擇" inheritAction="恢復未選擇"
      onInherit={() => inheritField("circleCategory")} onClear={() => clearField("circleCategory")}
    />

    {CIRCLE_OVERRIDE_LIST_FIELDS.map(({ key, label }) => <div key={key}>
      {listField(key, label)}
      <FieldModeControls mode={modeFor(key)} label={label} onInherit={() => inheritField(key)} onClear={() => clearField(key)} />
    </div>)}

    <h3 className={styles.editorSection}>連結</h3>
    {/* The HTTPS rule lives in `linkUrlProblem`, which names the row that
        broke it; teaching it up here as well is a rule stated twice. */}
    <p className={styles.editorHint}>地圖側欄顯示前 {SIDE_PANEL_LINK_LIMIT} 個連結，最多可填 {OVERRIDE_LIMITS.links} 個。</p>

    <FieldModeControls mode={modeFor("links")} label="連結" onInherit={() => inheritField("links")} onClear={() => clearField("links")} />

    {links.length === 0
      ? modeFor("links") === "inherit" && <p className={styles.editorHint}>新增後會改用你填寫的連結。</p>
      : <ol className={styles.linkList}>
        {links.map((link, index) => {
          const problem = linkUrlProblem(link.url);
          return <li key={index}>
            <div className={styles.linkRow}>
              <span className={styles.linkPosition} aria-hidden="true">{index + 1}</span>
              {/* Each label owns its control, so a row lays out as three fields
                  rather than six items the grid has to guess the pairing of. */}
              <label htmlFor={`link-provider-${claim.circleId}-${index}`}>
                平台名稱
                <input
                  id={`link-provider-${claim.circleId}-${index}`}
                  value={link.provider} maxLength={OVERRIDE_LIMITS.listItemLength}
                  placeholder="例如：X、Pixiv、巴哈"
                  onChange={(event) => editLink(index, { provider: event.target.value })}
                />
              </label>
              <label htmlFor={`link-kind-${claim.circleId}-${index}`}>
                類型
                <select
                  id={`link-kind-${claim.circleId}-${index}`}
                  value={link.kind}
                  onChange={(event) => editLink(index, { kind: event.target.value as CircleExternalLink["kind"] })}
                >
                  {LINK_KINDS.map((kind) => <option key={kind} value={kind}>{LINK_KIND_LABEL[kind]}</option>)}
                </select>
              </label>
              <label htmlFor={`link-url-${claim.circleId}-${index}`} className={styles.linkUrlField}>
                網址
                <input
                  id={`link-url-${claim.circleId}-${index}`}
                  value={link.url} inputMode="url" placeholder="https://"
                  aria-invalid={problem ? true : undefined}
                  onChange={(event) => editLink(index, { url: event.target.value })}
                />
              </label>
              <div className={styles.linkActions}>
                <button type="button" disabled={index === 0} onClick={() => moveLink(index, -1)} aria-label={`把第 ${index + 1} 個連結往前移`}>↑</button>
                <button type="button" disabled={index === links.length - 1} onClick={() => moveLink(index, 1)} aria-label={`把第 ${index + 1} 個連結往後移`}>↓</button>
                <button type="button" onClick={() => setLinks(links.filter((unused, position) => position !== index))} aria-label={`移除第 ${index + 1} 個連結`}>移除</button>
              </div>
            </div>
            {problem && <p className={styles.error}>{problem}</p>}
            {index === SIDE_PANEL_LINK_LIMIT - 1 && links.length > SIDE_PANEL_LINK_LIMIT
              && <p className={styles.linkCut}>以下的連結不會出現在地圖側欄</p>}
          </li>;
        })}
      </ol>}

    <div className={styles.linkAdd}>
      <button type="button" disabled={links.length >= OVERRIDE_LIMITS.links} onClick={() => setLinks([...links, { ...EMPTY_LINK }])}>新增連結</button>
      {links.length > 0 && <span>{links.length} / {OVERRIDE_LIMITS.links}</span>}
    </div>

    <h3 className={styles.editorSection}>代表圖</h3>
    <FieldModeControls mode={modeFor("thumbnail")} label="代表圖" onInherit={() => inheritField("thumbnail")} onClear={() => clearField("thumbnail")} />

    <label htmlFor={`thumb-file-${claim.circleId}`}>上傳圖片</label>
    <input
      id={`thumb-file-${claim.circleId}`} type="file" accept="image/jpeg,image/png,image/webp"
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
    <p className={styles.editorHint}>JPEG、PNG、WebP，最大 5 MB</p>
    {uploadNotice.kind !== "idle" && <p className={uploadNotice.kind === "error" ? styles.error : styles.notice}>{uploadNotice.message}</p>}

    <label htmlFor={`thumb-url-${claim.circleId}`}>外部圖片網址</label>
    <input
      id={`thumb-url-${claim.circleId}`} value={thumbnail?.url ?? ""} inputMode="url" placeholder="https://"
      aria-invalid={thumbnail?.url && thumbnailUrlProblem(thumbnail.url) ? true : undefined}
      onChange={(event) => editThumbnail({ url: event.target.value })}
    />
    {thumbnail?.url && thumbnailUrlProblem(thumbnail.url) && <p className={styles.error}>{thumbnailUrlProblem(thumbnail.url)}</p>}

    {/* The only check left on an external address is whether it is really an
        image, and the browser is the one that can answer it (ADR-0052). The
        preview is that answer, and doubles as the feedback an upload needs. */}
    {thumbnail?.url && !thumbnailUrlProblem(thumbnail.url) && <div className={styles.thumbnailPreview}>
      <img
        src={thumbnail.url} alt="代表圖預覽"
        onLoad={() => setThumbnailLoad({ url: thumbnail.url, ok: true })}
        onError={() => setThumbnailLoad({ url: thumbnail.url, ok: false })}
      />
      {thumbnailLoad?.url === thumbnail.url && !thumbnailLoad.ok && <p className={styles.error}>{THUMBNAIL_NOT_AN_IMAGE}</p>}
    </div>}

    <label htmlFor={`thumb-source-${claim.circleId}`}>圖片出處頁面（選填）</label>
    <input
      id={`thumb-source-${claim.circleId}`} value={thumbnail?.sourceUrl ?? ""} inputMode="url" placeholder="https://"
      aria-invalid={thumbnail?.sourceUrl && linkUrlProblem(thumbnail.sourceUrl) ? true : undefined}
      onChange={(event) => editThumbnail({ sourceUrl: event.target.value })}
    />
    {thumbnail?.sourceUrl && linkUrlProblem(thumbnail.sourceUrl) && <p className={styles.error}>{linkUrlProblem(thumbnail.sourceUrl)}</p>}

    <label htmlFor={`thumb-provider-${claim.circleId}`}>來源標示（選填，例如轉載或委託繪師）</label>
    <input
      id={`thumb-provider-${claim.circleId}`} value={thumbnail?.provider ?? ""} maxLength={OVERRIDE_LIMITS.listItemLength}
      placeholder="例如：Pixiv" onChange={(event) => editThumbnail({ provider: event.target.value })}
    />

    <div className={styles.editorActions}>
      <button type="button" disabled={status.kind === "busy" || problems.length > 0 || reviewOpen} onClick={openReview}>
        {status.kind === "busy" ? "檢查中…" : "預覽並送出"}
      </button>
    </div>

    {problems.length > 0 && <ul className={styles.problemList} aria-live="polite">
      {problems.map((problem) => <li key={`${problem.id}-${problem.message}`}><a href={`#${problem.id}`}>{problem.message}</a></li>)}
    </ul>}

    {/* Saved on the spot rather than with the draft: it is one switch with an
        immediate answer, and it survives a tab closed before submitting. */}
    <fieldset className={styles.retention}>
      <legend>活動結束後</legend>
      <div className={styles.retentionChoices}>
        {([{ value: false, title: "繼續公開" }, { value: true, title: "不再公開" }] as const).map((option) => <label key={option.title}>
          <input
            type="radio" name={`after-event-${claim.circleId}`}
            checked={hidden === option.value}
            onChange={() => {
              setHidden(option.value);
              void setPostEventVisibility(claim.circleId, option.value)
                .then(() => setStatus({ kind: "ok", message: option.value ? "活動結束後將不再公開你填寫的內容。" : "活動結束後仍會公開你填寫的內容。" }))
                .catch((error: unknown) => { setHidden(!option.value); setStatus({ kind: "error", message: errorMessage(error) }); });
            }}
          />
          <span>{option.title}</span>
        </label>)}
      </div>
    </fieldset>

    {/* Collapsed: it is the one irreversible action on the page, and it is
        reached deliberately rather than met on the way past. `<details>` keeps
        it one click away and findable by the browser's own in-page search. */}
    {saved && <details className={styles.danger}>
      <summary>刪除資料</summary>
      {/* Clearing a field writes an empty value and leaves the row; this
          removes the row. ADR-0020 requires the two to read as different
          things, because only one of them is undoable. */}
      <p>永久刪除你填寫的內容與上一版備份，<b>無法復原</b>。場刊中的社團名、攤位與日期不受影響。</p>
      <p>將被刪除的內容：</p>
      {deletionSummary(savedFields).length === 0
        ? <ul className={styles.dangerSummary}><li>（目前沒有任何欄位有內容，但資料列仍然存在）</li></ul>
        : <ul className={styles.dangerSummary}>{deletionSummary(savedFields).map((line) => <li key={line}>{line}</li>)}</ul>}
      {/* Not a single button: a session lasts 30 days, and one click from a
          stale tab must not be able to do this. Re-sending a mail would have
          been the other option, and it would put an irreversible action behind
          deliverability. */}
      <label htmlFor={`confirm-${claim.circleId}`}>請輸入社團代號 <code>{claim.circleId}</code> 以確認</label>
      <input
        id={`confirm-${claim.circleId}`} value={confirmText} autoComplete="off" spellCheck={false}
        onChange={(event) => setConfirmText(event.target.value)} placeholder={claim.circleId}
      />
      <button
        type="button" className={styles.dangerButton}
        disabled={confirmText.trim() !== claim.circleId || status.kind === "busy"}
        onClick={() => {
          setStatus({ kind: "busy", message: "刪除中…" });
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
              setStatus({ kind: "ok", message: "已刪除。公開頁面會在一分鐘內不再顯示這筆內容。" });
            })
            .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
        }}
      >刪除資料</button>
    </details>}

    {status.kind !== "idle" && status.kind !== "busy" && <p className={status.kind === "error" ? styles.error : styles.notice}>
      {status.message}
      {status.message === SAVED_MESSAGE && <a className={styles.inlineButton} href={mapHref(event.id, firstDayRecord)}>返回活動地圖</a>}
    </p>}
      </div>

      <aside className={`${styles.previewColumn} ${reviewOpen ? styles.reviewOpen : ""}`} aria-label={reviewOpen ? "儲存前確認" : "即時公開預覽"}>
        {reviewOpen && reviewedFields && serverPreview
          ? <div ref={reviewPanel} className={styles.reviewPanel} role="region" tabIndex={-1} aria-labelledby={`review-title-${claim.circleId}`}>
            <div className={styles.reviewHeading}>
              <div><h3 id={`review-title-${claim.circleId}`}>儲存前確認</h3></div>
              <button type="button" className={styles.backButton} onClick={closeReview}>返回修改</button>
            </div>
            <PublicationPreview records={serverPreview} />
            <h4>這次填寫的欄位</h4>
            <ReviewSummary fields={reviewedFields} />
            <div ref={reviewActions} className={styles.reviewActions}>
              <button type="button" className={styles.backButton} disabled={status.kind === "busy"} onClick={closeReview}>返回修改</button>
              {/* Re-checked here, not only when the review opened: an image
                  verdict can arrive after that, and a confirmation taken before
                  it must not be the one that publishes. */}
              <button type="button" disabled={status.kind === "busy" || problems.length > 0} onClick={() => {
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
              }}>{status.kind === "busy" ? "儲存中…" : "確認儲存"}</button>
            </div>
            {problems.length > 0 && <ul className={styles.problemList} aria-live="polite">
              {problems.map((problem) => <li key={`${problem.id}-${problem.message}`}>{problem.message}</li>)}
            </ul>}
            {status.kind === "error" && <p className={styles.error} role="status">{status.message}</p>}
          </div>
          : <div className={styles.livePreview}>
            <small>尚未儲存</small>
            <div className={styles.previewHeading}>
              <h3>公開預覽</h3>
              {/* `useModalFocus` returns focus here on close, so the button
                  needs no ref of its own. */}
              {livePreview?.length ? <button type="button" className={styles.inlineButton} onClick={() => setExpanded(true)}>開啟完整詳細資訊</button> : null}
            </div>
            {livePreview ? <PublicationPreview records={livePreview} compact /> : <p>正在準備預覽…</p>}
          </div>}
      </aside>

      {expanded && livePreview?.length ? <div
        className={styles.previewBackdrop} role="presentation"
        onPointerDown={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}
      >
        <div
          ref={expandedPreview} className={styles.previewDialog} role="dialog" aria-modal="true"
          aria-label="完整詳細資訊預覽" tabIndex={-1}
        >
          <div className={styles.previewHeading}>
            <h3>完整詳細資訊</h3>
            <button type="button" className={styles.backButton} onClick={() => setExpanded(false)}>關閉</button>
          </div>
          <PublicationPreview records={livePreview} />
        </div>
      </div> : null}
    </div>
  </section>;
}

function AdminPanel({ event }: { event: EventDefinition }) {
  const [pending, setPending] = useState<PendingClaim[]>([]);
  const [status, setStatus] = useState<Status>(IDLE);
  const [takedownId, setTakedownId] = useState("");
  const [reason, setReason] = useState("");

  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const requestVersion = useRef({ version: 0 });

  const refresh = useCallback(() => {
    const version = ++requestVersion.current.version;
    setLoading(true);
    void listPendingClaims()
      .then((result) => {
        if (version !== requestVersion.current.version) return;
        setPending(result.claims);
        setLoaded(true);
        setLoadError("");
      })
      .catch((error: unknown) => {
        if (version === requestVersion.current.version) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (version === requestVersion.current.version) setLoading(false);
      });
  }, []);

  useEffect(() => {
    const requests = requestVersion.current;
    const initialRefresh = window.setTimeout(refresh, 0);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = window.setInterval(refreshVisible, 30_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      ++requests.version;
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh]);

  return <section className={`${styles.card} ${styles.admin}`} id="admin">
    <h2>管理：待審認領</h2>
    <p className={styles.editorHint}>目前活動：{event.name}。認領逐場活動分開，同名社團在不同活動是不同的認領。</p>
    <button type="button" onClick={refresh} disabled={loading}>{loading ? "更新中…" : "重新整理待審認領"}</button>
    {loadError && <p role="alert">{loadError}</p>}
    {pending.length === 0 ? loaded && !loadError && <p>目前沒有待審項目。</p> : <ul className={styles.claimList}>
      {pending.map((claim) => <li key={claim.id}>
        <div>
          <b>{claim.circleName}</b>
          <small>{claim.circleId}</small>
          {claim.evidenceUrl && <a href={claim.evidenceUrl} target="_blank" rel="noreferrer">佐證連結</a>}
          {claim.evidenceNote && <small>{claim.evidenceNote}</small>}
        </div>
        <button type="button" onClick={() => void decideClaim(claim.id, "approve").then(refresh).catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }))}>核准</button>
        <button type="button" onClick={() => void decideClaim(claim.id, "reject").then(refresh).catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }))}>婉拒</button>
      </li>)}
    </ul>}

    <h2>撤下社團補充資料</h2>
    <label htmlFor="takedown-circle">社團 ID</label>
    <input id="takedown-circle" value={takedownId} onChange={(event) => setTakedownId(event.target.value)} placeholder="c-000001" />
    <label htmlFor="takedown-reason">原因</label>
    <input id="takedown-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
    <button type="button" onClick={() => {
      void takedownOverride(takedownId, reason)
        .then(() => { setStatus({ kind: "ok", message: "已撤下。" }); setTakedownId(""); setReason(""); })
        .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
    }}>撤下</button>

    {status.kind !== "idle" && <p className={status.kind === "error" ? styles.error : styles.notice}>{status.message}</p>}

    <AdminRoster />
  </section>;
}

function AdminRoster() {
  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [self, setSelf] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>(IDLE);
  const [disableEmail, setDisableEmail] = useState("");

  const refresh = useCallback(() => {
    void listAdmins()
      .then((result) => { setAdmins(result.admins); setSelf(result.self); })
      .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
  }, []);

  useEffect(refresh, [refresh]);

  const run = (target: string, action: "add" | "remove") => {
    setStatus({ kind: "busy", message: "處理中…" });
    void manageAdmin(target, action)
      .then(() => { setStatus({ kind: "ok", message: action === "add" ? "已新增管理者。" : "已移除管理者。" }); setEmail(""); refresh(); })
      .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
  };

  return <>
    <h2>管理者名單</h2>
    <ul className={styles.claimList}>
      {admins.map((admin) => <li key={admin.email}>
        <div>
          <b>{admin.email}{admin.email === self ? "（你）" : ""}</b>
          <small>{admin.addedBy === "bootstrap" ? "由設定值建立" : `由 ${admin.addedBy ?? "未知"} 新增`}</small>
        </div>
        {admin.email !== self && admins.length > 1
          && <button type="button" onClick={() => run(admin.email, "remove")}>移除</button>}
      </li>)}
    </ul>

    <label htmlFor="admin-email">新增管理者 email</label>
    <input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="someone@example.com" />
    <button type="button" disabled={status.kind === "busy"} onClick={() => run(email, "add")}>新增</button>

    {status.kind !== "idle" && status.kind !== "busy" && <p className={status.kind === "error" ? styles.error : styles.notice}>{status.message}</p>}

    <h3>停用帳號</h3>
    <p>停用會立即撤銷該帳號的登入狀態，但保留資料供身分確認或後續刪除請求。</p>
    <label htmlFor="disable-account-email">帳號 email</label>
    <input id="disable-account-email" type="email" value={disableEmail} onChange={(event) => setDisableEmail(event.target.value)} />
    <button type="button" disabled={!disableEmail || status.kind === "busy"} onClick={() => {
      setStatus({ kind: "busy", message: "處理中…" });
      void disableAccount(disableEmail)
        .then(() => { setStatus({ kind: "ok", message: "帳號已停用。" }); setDisableEmail(""); })
        .catch((error: unknown) => setStatus({ kind: "error", message: errorMessage(error) }));
    }}>停用</button>
  </>;
}
