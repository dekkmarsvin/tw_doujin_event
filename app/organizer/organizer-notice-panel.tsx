import { useEffect, useRef, useState, type FormEvent } from "react";
import { EVENT_NOTICE_TEXT_MAX, EVENT_NOTICE_URL_MAX, eventNoticeInputProblem, type EventNotice, type EventNoticeInput } from "../event-notice";
import { clearOrganizerNotice, readOrganizerNotice, saveOrganizerNotice } from "../organizer-client";
import { IDLE, message, type Notice } from "./organizer-shared";
import styles from "../circle-portal/portal.module.css";

const EMPTY: EventNoticeInput = { kind: "info", text: "", url: "" };
const formOf = (notice: EventNotice | null): EventNoticeInput =>
  notice ? { kind: notice.kind, text: notice.text, url: notice.url ?? "" } : EMPTY;
const updated = (iso: string) => new Date(iso).toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short", hour12: false });

/** 活動公告: one notice for readers of the published event. Saving publishes it
 * at once and clearing removes it; there is no review step (#538). */
export function OrganizerNoticePanel({ candidateId }: { candidateId: string }) {
  const [current, setCurrent] = useState<EventNotice | null | undefined>(undefined);
  const [form, setForm] = useState<EventNoticeInput>(EMPTY);
  const [status, setStatus] = useState<Notice>(IDLE);
  const [readError, setReadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    readOrganizerNotice(candidateId)
      .then(answer => { if (live) { setCurrent(answer.notice); setForm(formOf(answer.notice)); } })
      .catch(error => { if (live) setReadError(message(error)); });
    return () => { live = false; };
  }, [candidateId, attempt]);

  const run = async (action: () => Promise<{ notice: EventNotice | null }>, done: string) => {
    if (busy.current) return;
    busy.current = true; setStatus({ kind: "busy", message: "" });
    try {
      const answer = await action();
      setCurrent(answer.notice); setForm(formOf(answer.notice));
      setStatus({ kind: "ok", message: done });
    } catch (error) {
      setStatus({ kind: "error", message: message(error) });
    } finally { busy.current = false; }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = eventNoticeInputProblem(form);
    if (problem) { setStatus({ kind: "error", message: problem }); return; }
    void run(() => saveOrganizerNotice(candidateId, form), current ? "已更新公告。" : "已發布公告。");
  };
  const patch = (change: Partial<EventNoticeInput>) => {
    setForm(value => ({ ...value, ...change }));
    if (status.kind !== "busy") setStatus(IDLE);
  };

  const pending = status.kind === "busy";
  const length = form.text.trim().length;
  return <section className={`${styles.card} ${styles.admin} ${styles.eventClaimPanel}`} aria-labelledby="event-notice-heading">
    <h2 id="event-notice-heading">活動公告</h2>
    <p>儲存後立即顯示在這場活動的地圖、逛品書與社團介紹頁頂端。</p>
    {readError ? <>
      <p role="alert" className={styles.error}>{readError}</p>
      <button type="button" onClick={() => { setReadError(""); setAttempt(value => value + 1); }}>重新讀取</button>
    </> : current === undefined ? <p role="status" className={styles.noticeMeta}>載入中…</p> : <form onSubmit={submit} noValidate>
      <fieldset disabled={pending} className={styles.noticeFields}>
        <label id="event-notice-kind-label" htmlFor="event-notice-kind-info">類型</label>
        <fieldset className={styles.noticeKinds} aria-labelledby="event-notice-kind-label">
          {([["info", "一般"], ["important", "重要"]] as const).map(([kind, label]) => <label key={kind}>
            <input id={`event-notice-kind-${kind}`} type="radio" name="event-notice-kind" checked={form.kind === kind} onChange={() => patch({ kind })} />{label}
          </label>)}
        </fieldset>
        <label htmlFor="event-notice-text">說明<textarea id="event-notice-text" rows={3} value={form.text}
          aria-describedby="event-notice-count" onChange={event => patch({ text: event.target.value })} /></label>
        <small id="event-notice-count" className={styles.noticeMeta} data-over={length > EVENT_NOTICE_TEXT_MAX || undefined}>{length} / {EVENT_NOTICE_TEXT_MAX} 字</small>
        <label htmlFor="event-notice-url">連結（選填）<input id="event-notice-url" type="url" inputMode="url" maxLength={EVENT_NOTICE_URL_MAX}
          value={form.url} placeholder="https://" onChange={event => patch({ url: event.target.value })} /></label>
        <div className={styles.reviewActions}>
          <button type="submit">{pending ? "儲存中…" : current ? "更新公告" : "發布公告"}</button>
          {current && <button type="button" className={styles.secondaryButton}
            onClick={() => { void run(() => clearOrganizerNotice(candidateId), "已清除公告。"); }}>清除公告</button>}
        </div>
      </fieldset>
      {status.kind === "error" && <p role="alert" className={styles.error}>{status.message}</p>}
      {status.kind === "ok" && <p role="status" className={styles.notice}>{status.message}</p>}
      {current && <p className={styles.noticeMeta}>最後更新 {updated(current.updatedAt)}</p>}
    </form>}
  </section>;
}
