"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EventDefinition } from "./event-catalog";
import type { EventDayKey } from "./planning-store";
import { checkOfflineReadiness, prepareOffline, type OfflineScope } from "./offline-readiness";
import { useModalFocus } from "./use-modal-focus";
import { UiIcon } from "./ui-icons";
import styles from "./planning-tools.module.css";

type View =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "missing"; count: number }
  | { kind: "preparing"; done: number; total: number }
  | { kind: "failed"; count: number }
  | { kind: "unsupported" }
  | { kind: "reload" }
  | { kind: "error" };

/**
 * 準備離線使用 (#415): confirm that this event day's official catalog, map
 * and reader are in the offline cache, fetch what is missing, and say only
 * what the re-check verified. A page loaded once is not evidence.
 */
export function OfflinePrepDialog({ event, day, venueSpaceId, onClose }: {
  event: EventDefinition;
  day: EventDayKey;
  venueSpaceId?: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const [view, setView] = useState<View>({ kind: "checking" });
  useModalFocus(true, dialogRef, onClose);
  const scope: OfflineScope = { eventId: event.id, day, ...(event.venueAssignments.length > 1 && venueSpaceId ? { venueSpaceId } : {}) };
  const scopeKey = `${scope.eventId}\u0000${scope.day}\u0000${scope.venueSpaceId ?? ""}`;
  const dayInfo = event.days.find((item) => String(item.id) === String(day));
  const venue = event.venueAssignments.find((item) => item.venueSpaceId === venueSpaceId) ?? event.venueAssignments[0];

  useEffect(() => {
    let active = true;
    const [eventId, dayKey, space] = scopeKey.split("\u0000");
    checkOfflineReadiness({ eventId, day: dayKey, ...(space ? { venueSpaceId: space } : {}) })
      .then((status) => { if (active) setView(status.ambiguousCache ? { kind: "reload" } : status.state === "ready" ? { kind: "ready" } : status.state === "unsupported" ? { kind: "unsupported" } : { kind: "missing", count: status.missing.length }); })
      .catch(() => { if (active) setView({ kind: "error" }); });
    return () => { active = false; };
  }, [scopeKey]);

  async function prepare() {
    setView({ kind: "preparing", done: 0, total: 0 });
    try {
      const result = await prepareOffline(scope, (done, total) => setView({ kind: "preparing", done, total }));
      setView(result.ambiguousCache ? { kind: "reload" } : result.state === "ready" ? { kind: "ready" } : result.state === "unsupported" ? { kind: "unsupported" } : { kind: "failed", count: Math.max(result.failed.length, result.missing.length) });
    } catch {
      setView({ kind: "error" });
    }
  }

  return createPortal(<div className={styles.backdrop} role="presentation" onPointerDown={(pressed) => { if (pressed.target === pressed.currentTarget) onClose(); }}>
    <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="offline-prep-title" tabIndex={-1}>
      <header><div><h2 id="offline-prep-title">準備離線使用</h2></div><button onClick={onClose} aria-label="關閉離線準備"><UiIcon name="close" /></button></header>
      <section className={styles.section}>
        <div>
          <h3>{event.name}・{dayInfo ? `${dayInfo.label}（${dayInfo.dateLabel}）` : `DAY ${day}`}{venue ? `・${venue.venueName} · ${venue.venueSpaceName}` : ""}</h3>
          <p>會準備：這天的官方場刊、地圖與閱讀介面。你的收藏與行程本來就存在這台裝置。</p>
          <p>不包括：社團自填的介紹與品書圖、外部連結；離線時看到的是準備當下的官方資料。</p>
        </div>
        <div className={styles.offlineStatus} role="status">
          {view.kind === "checking" && <p>正在檢查…</p>}
          {view.kind === "ready" && <p className={styles.okText}>已就緒：斷網後重新開啟，仍可查看這天的地圖、收藏與行程。</p>}
          {view.kind === "missing" && <p>尚未準備完成，還缺 {view.count} 個檔案。</p>}
          {view.kind === "preparing" && <p>準備中{view.total > 0 ? `：${view.done}／${view.total}` : "…"}</p>}
          {view.kind === "failed" && <p className={styles.errorText}>有 {view.count} 個檔案無法下載，請確認網路後重試。</p>}
          {view.kind === "unsupported" && <p className={styles.errorText}>這個瀏覽器目前無法離線使用。請重新整理頁面後再試；若仍無法使用，請改用其他瀏覽器。</p>}
          {view.kind === "reload" && <p className={styles.errorText}>網站剛更新，離線資料還在切換。請重新整理頁面後再準備。</p>}
          {view.kind === "error" && <p className={styles.errorText}>無法確認離線準備狀態，請重新整理頁面後再試。</p>}
        </div>
        <div className={styles.confirmActions}>
          {(view.kind === "missing" || view.kind === "failed") && <button className={styles.primary} onClick={() => void prepare()}>{view.kind === "failed" ? "重試" : "準備離線使用"}</button>}
          <button onClick={onClose}>關閉</button>
        </div>
      </section>
    </section>
  </div>, document.body);
}
