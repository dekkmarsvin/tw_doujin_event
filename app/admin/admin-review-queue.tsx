import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decideClaim, PortalError, type QueuedClaim, type ReviewQueue } from "../circle-editor-client";
import { PUBLISHED_EVENTS } from "../event-catalog";
import { eventsByProximity, taipeiDate } from "../event-calendar";
import { useModalFocus } from "../use-modal-focus";
import { planClaimBatch, type ClaimBatchPlan, type ClaimDecision, type SkippedClaims } from "./claim-batch";
import { useAdminReviewQueue } from "./use-admin-review-queue";
import styles from "../circle-portal/portal.module.css";

const VERB: Record<ClaimDecision, string> = { approve: "核准", reject: "婉拒" };
const ALL_EVENTS = "";

function errorMessage(error: unknown) {
  return error instanceof PortalError || error instanceof Error ? error.message : "操作失敗，請稍後再試。";
}

const STAMP = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function stamp(at: number) {
  const part = Object.fromEntries(STAMP.formatToParts(at).map(({ type, value }) => [type, value]));
  return `${part.month}.${part.day} ${part.hour}:${part.minute}`;
}

/** Host and path, which is what tells a reviewer whose page it is. */
function evidenceLabel(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

function skipReason(skip: SkippedClaims) {
  return skip.reason === "claimed" ? "已有通過的認領" : `同一社團選了 ${skip.count} 筆，只能核准一筆`;
}

type Summary = { kind: "ok" | "mixed"; text: string };

/**
 * Every published event's review work on one page, so the page opens on where
 * the work is rather than on whichever event it defaults to. Claims can be
 * decided one at a time or in a batch; each decision is still its own request,
 * scoped to the claim's own event, so authorization and the audit trail stay
 * exactly what a single decision gives.
 */
export type ClaimReviewScope = {
  eventId: string;
  load: () => Promise<ReviewQueue>;
  decide: (claimId: string, decision: ClaimDecision) => Promise<unknown>;
};

export function AdminReviewQueue({ initialEventId, initialClaimId, onEventChange, claimScope, onQueueLoaded }: {
  initialEventId: string; initialClaimId?: string; onEventChange?: (eventId: string) => void;
  claimScope?: ClaimReviewScope; onQueueLoaded?: (queue: ReviewQueue | null) => void;
}) {
  const [filter, setFilter] = useState(initialEventId);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [plan, setPlan] = useState<ClaimBatchPlan | null>(null);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** A decision in flight owns the list: a background answer landing midway
   * would drop rows the batch is still reporting on. */
  const busy = useRef(false);
  const isBusy = useCallback(() => busy.current, []);
  const [openedAt] = useState(() => Date.now());
  const acceptQueue = useCallback((answer: ReviewQueue | null) => {
    if (answer) {
      const live = new Set(answer.claims.map(claim => claim.id));
      setSelected(current => new Set([...current].filter(id => live.has(id))));
      setMessages(current => Object.fromEntries(Object.entries(current).filter(([id]) => live.has(id))));
    }
    onQueueLoaded?.(answer);
  }, [onQueueLoaded]);
  const { queue, loading, loadError, updatedAt, refresh, invalidate } = useAdminReviewQueue({
    eventId: claimScope?.eventId ?? filter, claimId: initialClaimId,
    load: claimScope?.load, onQueueLoaded: acceptQueue, isBusy,
  });
  const today = taipeiDate(updatedAt ?? openedAt);
  const mounted = useRef(true);
  const dialog = useRef<HTMLDivElement>(null);
  const summaryLine = useRef<HTMLParagraphElement>(null);
  const claimTarget = useRef<HTMLLIElement>(null);
  const focusedTarget = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const closeDialog = useCallback(() => { if (!busy.current) setPlan(null); }, []);
  useModalFocus(plan !== null, dialog, closeDialog);

  const ordered = useMemo(() => eventsByProximity(claimScope
    ? PUBLISHED_EVENTS.filter(event => event.id === claimScope.eventId) : PUBLISHED_EVENTS, today), [today, claimScope]);
  const eventEntry = useMemo(() => new Map(ordered.map((entry, index) => [entry.event.id, { ...entry, rank: index }])), [ordered]);
  const claims = useMemo(() => (queue?.claims ?? [])
    .filter((claim) => eventEntry.has(claim.eventId))
    .sort((a, b) => eventEntry.get(a.eventId)!.rank - eventEntry.get(b.eventId)!.rank || a.createdAt - b.createdAt), [queue, eventEntry]);
  const claimCount = (eventId: string) => queue?.claimCounts?.find((entry) => entry.eventId === eventId)?.pending
    ?? (claimScope?.eventId === eventId ? queue?.pendingClaimCount : undefined)
    ?? claims.filter((claim) => claim.eventId === eventId).length;

  const visible = filter === ALL_EVENTS ? claims : claims.filter((claim) => claim.eventId === filter);
  const targetAvailable = !!filter && visible.some(claim => claim.id === initialClaimId);
  useEffect(() => {
    if (initialClaimId && targetAvailable && !focusedTarget.current) {
      focusedTarget.current = true;
      claimTarget.current?.focus();
      claimTarget.current?.scrollIntoView({ block: "nearest" });
    }
  }, [initialClaimId, targetAvailable]);
  const selectedClaims = visible.filter((claim) => selected.has(claim.id));
  const allVisibleSelected = visible.length > 0 && visible.every((claim) => selected.has(claim.id));
  const pendingPerCircle = new Map<string, number>();
  for (const claim of claims) {
    const key = `${claim.eventId}\u0000${claim.circleId}`;
    pendingPerCircle.set(key, (pendingPerCircle.get(key) ?? 0) + 1);
  }
  const perEvent = (list: readonly QueuedClaim[]) => ordered
    .map(({ event }) => ({ event, items: list.filter((claim) => claim.eventId === event.id) }))
    .filter(({ items }) => items.length > 0);

  const showClaims = (eventId: string) => {
    if (busy.current || (eventId === filter && !initialClaimId)) return;
    invalidate();
    setSelected(new Set());
    setMessages({});
    setSummary(null);
    setPlan(null);
    setFilter(eventId);
    onEventChange?.(eventId);
  };
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleVisible = () => setSelected((current) => {
    const next = new Set(current);
    for (const claim of visible) {
      if (allVisibleSelected) next.delete(claim.id); else next.add(claim.id);
    }
    return next;
  });

  /** Starts a decision: a background answer already in flight is dropped, so
   * nothing replaces the list until the decision reloads it itself. */
  const holdQueue = () => {
    busy.current = true;
    invalidate();
    setWorking(true);
  };

  const decideOne = (claim: QueuedClaim, decision: ClaimDecision) => {
    if (busy.current) return;
    holdQueue();
    // Row messages report the last action only; one left from an earlier batch
    // would read as a reason for something that has not happened since.
    setSummary(null);
    setMessages({});
    void (claimScope ? claimScope.decide(claim.id, decision) : decideClaim(claim.id, decision, claim.eventId))
      .then(() => {
        if (!mounted.current) return;
        setSummary({ kind: "ok", text: `已${VERB[decision]}「${claim.circleName}」。` });
        setSelected((current) => new Set([...current].filter((id) => id !== claim.id)));
      })
      .catch((error: unknown) => {
        if (mounted.current) setMessages((current) => ({ ...current, [claim.id]: errorMessage(error) }));
      })
      .finally(() => {
        busy.current = false;
        if (!mounted.current) return;
        setWorking(false);
        refresh(false);
      });
  };

  const runBatch = async (batch: ClaimBatchPlan) => {
    holdQueue();
    setSummary(null);
    setMessages({});
    const reasons: Record<string, string> = {};
    const skippedIds = batch.skipped.flatMap((skip) => skip.ids);
    // A circle that already has an owner says so on its own row; repeating the
    // same words underneath would only say it twice.
    for (const skip of batch.skipped) {
      if (skip.reason === "duplicate") for (const id of skip.ids) reasons[id] = `${skipReason(skip)}。`;
    }
    let done = 0;
    for (const [index, claim] of batch.go.entries()) {
      setProgress({ done: index, total: batch.go.length });
      try {
        await (claimScope ? claimScope.decide(claim.id, batch.decision) : decideClaim(claim.id, batch.decision, claim.eventId));
        done += 1;
      } catch (error) {
        reasons[claim.id] = errorMessage(error);
        // Signed out or no longer an administrator: every later request would
        // fail the same way, so say so on each rather than sending them.
        if (error instanceof PortalError && (error.status === 401 || error.status === 403 || (claimScope && error.status === 404))) {
          for (const rest of batch.go.slice(index + 1)) reasons[rest.id] = errorMessage(error);
          break;
        }
      }
      if (!mounted.current) return;
    }
    busy.current = false;
    if (!mounted.current) return;
    const unfinished = new Set([...skippedIds, ...Object.keys(reasons)]);
    const left = unfinished.size;
    const verb = VERB[batch.decision];
    setMessages(reasons);
    // A reason on a row the filter hides would be a reason nobody can read.
    setSelected(new Set());
    setSummary({ kind: left ? "mixed" : "ok", text: `已${verb} ${done} 筆。${left ? `${left} 筆未${verb}，原因標在各列。` : ""}` });
    setProgress(null);
    setPlan(null);
    setWorking(false);
    refresh(false);
    // The dialog hands focus back to the button that opened it, which the
    // cleared selection has just disabled; the outcome is the next thing to read.
    window.requestAnimationFrame(() => summaryLine.current?.focus());
  };

  const openBatch = (decision: ClaimDecision) => {
    if (!selectedClaims.length || busy.current) return;
    setPlan(planClaimBatch(claims, selected, decision));
  };

  const chips = [
    { id: ALL_EVENTS, label: "全部", count: queue?.pendingClaimCount ?? claims.length },
    ...ordered.filter(({ event }) => claimCount(event.id) > 0 || event.id === filter)
      .map(({ event }) => ({ id: event.id, label: event.name, count: claimCount(event.id) })),
  ];
  const skippedCount = plan?.skipped.reduce((sum, skip) => sum + skip.ids.length, 0) ?? 0;

  return <>
    <section className={`${styles.card} ${styles.admin}${claimScope ? ` ${styles.eventClaimPanel}` : ""}`} id="admin" aria-labelledby="claims-heading">
      <div className={styles.queueHeading}>
        <h2 id="claims-heading">社團認領</h2>
        <button type="button" className={styles.secondaryButton} onClick={() => refresh(true)} disabled={loading || working}>{loading ? "更新中…" : "重新整理"}</button>
        {!claimScope && <div role="group" aria-label="依活動篩選" className={styles.filterChips}>
          {chips.map((chip) => <button key={chip.id || "all"} type="button" className={styles.filterChip}
            aria-pressed={filter === chip.id} disabled={working} onClick={() => showClaims(chip.id)}>{chip.label} <span>{queue ? chip.count : "—"}</span></button>)}
        </div>}
      </div>
      {loadError && <p className={styles.error} role="alert">{loadError}</p>}
      {loadError && updatedAt && <p className={styles.notice}>顯示 {stamp(updatedAt)} 的資料，更新失敗。</p>}
      {initialClaimId && queue && !targetAvailable && <p className={styles.warningNotice}>此認領不在這個活動的待審清單。</p>}
      {summary && <p ref={summaryLine} tabIndex={-1} className={summary.kind === "ok" ? styles.notice : styles.warningNotice} role="status">{summary.text}</p>}
      {!queue ? loading && <p className={styles.notice}>載入中…</p>
        : visible.length === 0 ? <p>目前沒有待審項目。</p>
          : <>
            <p className={styles.notice}>待審 {filter ? claimCount(filter) : queue.pendingClaimCount ?? claims.length} 筆，已載入 {visible.length} 筆。</p>
            <div className={styles.queueToolbar} data-selected={selectedClaims.length > 0 || undefined}>
              <label className={styles.selectAll}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} disabled={working} />
                全選目前列出的 {visible.length} 筆
              </label>
              <div className={styles.queueActions}>
                {selectedClaims.length > 0 && <>
                  <span className={styles.selectionCount}><b>已選 {selectedClaims.length} 筆</b>
                    {perEvent(selectedClaims).map(({ event, items }) => `${event.name} ${items.length}`).join("、")}</span>
                  <button type="button" className={styles.inlineButton} disabled={working} onClick={() => setSelected(new Set())}>取消選取</button>
                </>}
                <button type="button" className={styles.secondaryButton} disabled={working || !selectedClaims.length} onClick={() => openBatch("reject")}>婉拒已選</button>
                <button type="button" disabled={working || !selectedClaims.length} onClick={() => openBatch("approve")}>核准已選</button>
              </div>
            </div>
            <div className={styles.queueHeader} aria-hidden="true"><span /><span>社團</span><span>活動</span><span>佐證</span><span>送出</span><span /></div>
            <ul className={styles.queueList}>
              {visible.map((claim) => {
                const entry = eventEntry.get(claim.eventId)!;
                const samePending = pendingPerCircle.get(`${claim.eventId}\u0000${claim.circleId}`) ?? 1;
                const message = messages[claim.id];
                return <li key={claim.id} ref={claim.id === initialClaimId && filter ? claimTarget : undefined}
                  tabIndex={claim.id === initialClaimId && filter ? -1 : undefined}
                  className={styles.queueRow} data-targeted={claim.id === initialClaimId && !!filter || undefined}
                  data-selected={selected.has(claim.id) || undefined} data-problem={message ? true : undefined}>
                  <input type="checkbox" aria-label={`選取${claim.circleName}（${entry.event.name}）`}
                    checked={selected.has(claim.id)} onChange={() => toggle(claim.id)} disabled={working} />
                  <div className={styles.queueCircle}>
                    <p><b>{claim.circleName}</b>
                      {samePending > 1 && <span className={styles.flagWarn}>同社團 {samePending} 筆</span>}
                      {claim.circleClaimed && <span className={styles.flagMuted}>已有通過的認領</span>}
                    </p>
                    <small>{claim.circleId}</small>
                    {message && <span className={styles.rowError}>{message}</span>}
                  </div>
                  <div className={styles.queueEvent}>{entry.event.name}{entry.group === "past" && <small>已結束</small>}</div>
                  <div className={styles.queueEvidence}>
                    {claim.evidenceUrl && <a href={claim.evidenceUrl} target="_blank" rel="noreferrer">{evidenceLabel(claim.evidenceUrl)}</a>}
                    {claim.evidenceNote && <small>{claim.evidenceNote}</small>}
                    {!claim.evidenceUrl && !claim.evidenceNote && <small>—</small>}
                  </div>
                  <time className={styles.queueTime} dateTime={new Date(claim.createdAt).toISOString()}>{stamp(claim.createdAt)}</time>
                  <div className={styles.queueRowActions}>
                    <button type="button" className={styles.secondaryButton} disabled={working} onClick={() => decideOne(claim, "reject")}>婉拒</button>
                    <button type="button" disabled={working || claim.circleClaimed} onClick={() => decideOne(claim, "approve")}>核准</button>
                  </div>
                </li>;
              })}
            </ul>
          </>}

      {plan && <div className={styles.previewBackdrop} role="presentation"
        onPointerDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
        <div ref={dialog} className={styles.batchDialog} role="dialog" aria-modal="true" aria-labelledby="batch-heading" tabIndex={-1}>
          <h2 id="batch-heading">{VERB[plan.decision]} {plan.go.length} 筆社團認領</h2>
          {perEvent(plan.go).map(({ event, items }) => <div key={event.id} className={styles.batchGroup}>
            <p><b>{event.name}</b><span>{items.length} 筆</span></p>
            <p>{items.map((claim) => claim.circleName).join("、")}</p>
          </div>)}
          {plan.skipped.length > 0 && <div className={styles.batchSkipped}>
            <b>略過 {skippedCount} 筆</b>
            <ul>{plan.skipped.map((skip) => <li key={skip.ids[0]}>{skip.count > 1 ? `${skip.circleName} ×${skip.count}` : skip.circleName}・{skipReason(skip)}</li>)}</ul>
          </div>}
          <div className={styles.reviewActions}>
            <button type="button" className={styles.secondaryButton} disabled={working} onClick={closeDialog}>返回</button>
            <button type="button" disabled={working || plan.go.length === 0} onClick={() => void runBatch(plan)}>
              {progress ? `處理中 ${progress.done + 1}/${progress.total}…` : `${VERB[plan.decision]} ${plan.go.length} 筆`}
            </button>
          </div>
        </div>
      </div>}
    </section>
  </>;
}
