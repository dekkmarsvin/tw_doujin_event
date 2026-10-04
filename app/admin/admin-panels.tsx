import { useCallback, useEffect, useRef, useState } from "react";
import { listAdmins, manageAdmin, PortalError, searchTakedownCircles, takedownOverride, type AdminEntry, type TakedownCircle } from "../circle-editor-client";
import { useModalFocus } from "../use-modal-focus";
import { PUBLISHED_EVENTS } from "../event-catalog";
import { eventsByProximity, taipeiDate } from "../event-calendar";
import styles from "../circle-portal/portal.module.css";
type Status = { kind: "idle" | "busy" | "ok" | "error"; message: string };
const IDLE: Status = { kind: "idle", message: "" };
function errorMessage(error: unknown) { return error instanceof PortalError || error instanceof Error ? error.message : "操作失敗，請稍後再試。"; }

/**
 * Takedown needs an event: a circle id is only meaningful inside one. The
 * picker lives on the form instead of heading the page, and the request names
 * that event itself, so it cannot follow whichever event the map review above
 * happens to have open.
 */
export type TakedownScope = {
  search: (query: string) => Promise<{ circles: TakedownCircle[] }>;
  takedown: (circleId: string, reason: string) => Promise<unknown>;
};
export function AdminTakedownPanel({ initialEventId, initialQuery = "", onEventChange, onSearchChange, scope }: {
  initialEventId: string; initialQuery?: string; onEventChange?: (id: string) => void; onSearchChange?: (query: string) => void; scope?: TakedownScope;
}) {
  const [eventId, setEventId] = useState(initialEventId);
  const [takedownStatus, setTakedownStatus] = useState<Status>(IDLE);
  const [query, setQuery] = useState(initialQuery);
  const [matches, setMatches] = useState<TakedownCircle[]>([]);
  const [selected, setSelected] = useState<TakedownCircle | null>(null);
  const [searchStatus, setSearchStatus] = useState<Status>(IDLE);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const pending = takedownStatus.kind === "busy";
  const busy = useRef(false);
  const searchSequence = useRef(0);
  const initialSearch = useRef(initialQuery);
  const dialog = useRef<HTMLDivElement>(null);
  const close = () => { if (!busy.current) setConfirming(false); };
  useModalFocus(confirming, dialog, close);
  useEffect(() => () => { searchSequence.current++; }, []);
  useEffect(() => {
    const query = initialSearch.current;
    if (!query) return;
    initialSearch.current = "";
    const sequence = ++searchSequence.current;
    void (scope ? scope.search(query) : searchTakedownCircles(query, eventId)).then(result => {
      if (sequence !== searchSequence.current) return;
      setMatches(result.circles); setSearchStatus({ kind: "ok", message: result.circles.length ? `找到 ${result.circles.length} 個社團` : "找不到符合的社團。" });
    }).catch(error => { if (sequence === searchSequence.current) setSearchStatus({ kind: "error", message: errorMessage(error) }); });
  }, [scope, eventId]);

  const clearSearch = () => {
    searchSequence.current++; setMatches([]); setSelected(null); setReason("");
    setSearchStatus(IDLE); setTakedownStatus(IDLE);
  };
  const search = async () => {
    onSearchChange?.(query.trim());
    const sequence = ++searchSequence.current;
    setMatches([]); setSelected(null); setReason(""); setTakedownStatus(IDLE);
    setSearchStatus({ kind: "busy", message: "搜尋中…" });
    try {
      const result = await (scope ? scope.search(query.trim()) : searchTakedownCircles(query.trim(), eventId));
      if (sequence !== searchSequence.current) return;
      setMatches(result.circles);
      setSearchStatus({ kind: "ok", message: result.circles.length ? `找到 ${result.circles.length} 個社團` : "找不到符合的社團。" });
    } catch (error) {
      if (sequence === searchSequence.current) setSearchStatus({ kind: "error", message: errorMessage(error) });
    }
  };
  const submit = async () => {
    if (!selected || !reason.trim() || busy.current) return;
    busy.current = true;
    setTakedownStatus({ kind: "busy", message: "撤下中…" });
    try {
      await (scope ? scope.takedown(selected.circleId, reason.trim()) : takedownOverride(selected.circleId, reason.trim(), eventId));
      setMatches(current => current.map(circle => circle.circleId === selected.circleId ? { ...circle, status: "takendown", cleanupPending: false } : circle));
      setSelected(null); setReason(""); setConfirming(false);
      setTakedownStatus({ kind: "ok", message: "已撤下。" });
    } catch (error) {
      setTakedownStatus({ kind: "error", message: errorMessage(error) });
    } finally { busy.current = false; }
  };

  return <section className={`${styles.card} ${styles.admin}${scope ? ` ${styles.eventClaimPanel}` : ""}`} id="takedown" aria-labelledby="takedown-heading">
    <h2 id="takedown-heading">撤下社團補充資料</h2>
    {!scope && <AdminEventSelect id="takedown-event" value={eventId} onChange={id => { setEventId(id); setQuery(""); clearSearch(); onEventChange?.(id); }} />}
    <form className={styles.takedownSearch} onSubmit={event => { event.preventDefault(); void search(); }}>
      <label htmlFor="takedown-search">社團名稱<input id="takedown-search" maxLength={100} value={query} placeholder="輸入社團名稱" disabled={pending} onChange={event => { setQuery(event.target.value); clearSearch(); }} /></label>
      <button type="submit" disabled={!query.trim() || searchStatus.kind === "busy" || pending}>搜尋</button>
    </form>
    {searchStatus.kind !== "idle" && <p role="status" className={searchStatus.kind === "error" ? styles.error : styles.muted}>{searchStatus.message}</p>}
    <ul className={styles.takedownResults}>
      {matches.map(circle => <li key={circle.circleId}>
        <div><strong>{circle.name}</strong><small>{circle.circleId}</small></div>
        <span>{circle.cleanupPending ? "已撤下，圖片待清除" : circle.status === "live" ? "補充資料上線中" : circle.status === "takendown" ? "已撤下" : "沒有補充資料"}</span>
        <button type="button" aria-pressed={selected?.circleId === circle.circleId} disabled={(!circle.cleanupPending && circle.status !== "live") || pending}
          onClick={() => { setSelected(circle); setReason(""); setTakedownStatus(IDLE); }}>選擇{circle.name}</button>
      </li>)}
    </ul>
    {selected && <div className={styles.takedownSelection}>
      <h3>{selected.name}</h3>
      <label htmlFor="takedown-reason">原因<textarea id="takedown-reason" maxLength={500} value={reason} disabled={pending} onChange={event => setReason(event.target.value)} /></label>
      <button type="button" disabled={!reason.trim() || pending} onClick={() => setConfirming(true)}>撤下</button>
    </div>}
    {takedownStatus.kind !== "idle" && !confirming && <p role="status" className={takedownStatus.kind === "error" ? styles.error : styles.notice}>{takedownStatus.message}</p>}
    {confirming && selected && <div className={styles.previewBackdrop}>
      <div ref={dialog} className={styles.batchDialog} role="dialog" aria-modal="true" aria-labelledby="takedown-confirm" tabIndex={-1}>
        <h2 id="takedown-confirm">撤下「{selected.name}」的補充資料？</h2>
        <p>介紹與品書將停止公開，已上傳圖片會刪除。活動攤位資料與社團認領保留。</p>
        <p>原因：{reason.trim()}</p>
        {takedownStatus.kind !== "idle" && <p role="status" className={takedownStatus.kind === "error" ? styles.error : styles.notice}>{takedownStatus.message}</p>}
        <div className={styles.reviewActions}><button type="button" disabled={pending} onClick={close}>取消</button><button type="button" disabled={pending} onClick={() => { void submit(); }}>確認撤下</button></div>
      </div>
    </div>}
  </section>;
}

/** Nothing to choose with one published event, so nothing is shown. */
export function AdminEventSelect({ id, value, onChange }: { id: string; value: string; onChange: (eventId: string) => void }) {
  const [today] = useState(() => taipeiDate(Date.now()));
  if (PUBLISHED_EVENTS.length < 2) return null;
  return <>
    <label htmlFor={id}>活動</label>
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      {eventsByProximity(PUBLISHED_EVENTS, today).map(({ event, label, group }) => <option key={event.id} value={event.id}>
        {event.name}・{label}{group === "past" ? "（已結束）" : ""}
      </option>)}
    </select>
  </>;
}

export function AdminRoster() {
  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [self, setSelf] = useState("");
  const [email, setEmail] = useState("");
  const [rosterStatus, setRosterStatus] = useState<Status>(IDLE);

  const refresh = useCallback(() => {
    void listAdmins()
      .then((result) => { setAdmins(result.admins); setSelf(result.self); })
      .catch((error: unknown) => {
        setRosterStatus({ kind: "error", message: errorMessage(error) });
      });
  }, []);

  useEffect(refresh, [refresh]);

  const run = (target: string, action: "add" | "remove") => {
    setRosterStatus({ kind: "busy", message: "處理中…" });
    void manageAdmin(target, action)
      .then(() => { setRosterStatus({ kind: "ok", message: action === "add" ? "已新增管理者。" : "已移除管理者。" }); setEmail(""); refresh(); })
      .catch((error: unknown) => {
        setRosterStatus({ kind: "error", message: errorMessage(error) });
      });
  };

  return <section className={`${styles.card} ${styles.admin}`} id="accounts" aria-labelledby="accounts-heading">
    <h2 id="accounts-heading">網站管理者</h2>
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
    <button type="button" disabled={rosterStatus.kind === "busy"} onClick={() => run(email, "add")}>新增</button>

    {rosterStatus.kind !== "idle" && rosterStatus.kind !== "busy" && <p className={rosterStatus.kind === "error" ? styles.error : styles.notice}>{rosterStatus.message}</p>}

  </section>;
}
