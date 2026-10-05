"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EventDefinition } from "./event-catalog";
import { dayDateLabel, eventDayCalendarDate } from "./event-calendar";
import { formatCount } from "./i18n/format";
import { useLocale, useMessages } from "./i18n/locale-context";
import { defineMessages, type MessageParams } from "./i18n/messages";
import type { EventDayKey } from "./planning-store";
import { checkOfflineReadiness, prepareOffline, type OfflineScope } from "./offline-readiness";
import { useModalFocus } from "./use-modal-focus";
import { UiIcon } from "./ui-icons";
import styles from "./planning-tools.module.css";

const files = (value: MessageParams[string]) => Number(value) === 1 ? "1 file" : `${formatCount(Number(value), "en")} files`;

const MESSAGES = defineMessages({
  "zh-Hant": {
    title: "離線使用",
    close: "關閉離線使用",
    dayWithDate: "{label}（{date}）",
    checking: "正在檢查…",
    ready: "已就緒：斷網後重新開啟，仍可查看這天的地圖、收藏與行程。",
    missing: "還缺 {count} 個檔案，按「補齊」下載。",
    preparing: "準備中…",
    preparingProgress: "準備中：{done}／{total}",
    failed: "有 {count} 個檔案無法下載，請確認網路後重試。",
    unsupported: "這個瀏覽器目前無法離線使用。請重新整理頁面後再試；若仍無法使用，請改用其他瀏覽器。",
    reload: "網站剛更新，離線資料還在切換。請重新整理頁面後再準備。",
    error: "無法確認離線準備狀態，請重新整理頁面後再試。",
    retry: "重試",
    download: "補齊",
    closeButton: "關閉",
  },
  en: {
    title: "Offline use",
    close: "Close offline use",
    dayWithDate: "{label} ({date})",
    checking: "Checking…",
    ready: "Ready: reopen this page offline and you can still see this day’s map, favorites and plan.",
    missing: ({ count }) => `${files(count)} missing. Press “Download missing” to get ${Number(count) === 1 ? "it" : "them"}.`,
    preparing: "Preparing…",
    preparingProgress: "Preparing: {done}/{total}",
    failed: ({ count }) => `${files(count)} couldn’t be downloaded. Check your connection and try again.`,
    unsupported: "This browser can’t be used offline right now. Reload the page and try again; if it still doesn’t work, use another browser.",
    reload: "The site was just updated and offline data is still switching over. Reload the page, then prepare again.",
    error: "Couldn’t check whether this day is ready offline. Reload the page and try again.",
    retry: "Retry",
    download: "Download missing",
    closeButton: "Close",
  },
  ja: {
    title: "オフライン利用",
    close: "オフライン利用を閉じる",
    dayWithDate: "{label}（{date}）",
    checking: "確認中…",
    ready: "準備完了：オフラインで開き直しても、この日のマップ、お気に入り、巡回プランを見られます。",
    missing: ({ count }, locale) => `${formatCount(Number(count), locale)}個のファイルが不足しています。「不足分を取得」を押してダウンロードしてください。`,
    preparing: "準備中…",
    preparingProgress: "準備中：{done}／{total}",
    failed: ({ count }, locale) => `${formatCount(Number(count), locale)}個のファイルをダウンロードできませんでした。接続を確認して再試行してください。`,
    unsupported: "このブラウザでは現在オフライン利用できません。ページを再読み込みしてもう一度お試しください。それでも利用できない場合は、別のブラウザをご利用ください。",
    reload: "サイトが更新されたばかりで、オフラインデータを切り替え中です。ページを再読み込みしてから準備してください。",
    error: "オフライン準備の状態を確認できませんでした。ページを再読み込みしてもう一度お試しください。",
    retry: "再試行",
    download: "不足分を取得",
    closeButton: "閉じる",
  },
});

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
 * 離線使用 (#415): confirm that this event day's official catalog, map
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
  const { locale } = useLocale();
  const t = useMessages(MESSAGES);
  useModalFocus(true, dialogRef, onClose);
  const scope: OfflineScope = { eventId: event.id, day, ...(event.venueAssignments.length > 1 && venueSpaceId ? { venueSpaceId } : {}) };
  const scopeKey = `${scope.eventId}\u0000${scope.day}\u0000${scope.venueSpaceId ?? ""}`;
  const dayInfo = event.days.find((item) => String(item.id) === String(day));
  // The published date label is Chinese; other languages write the date out
  // from the calendar day, and fall back to the label when it is not a date.
  const calendarDay = locale === "zh-Hant" ? null : eventDayCalendarDate(event, day);
  const dateLabel = calendarDay ? dayDateLabel(calendarDay, locale) : dayInfo?.dateLabel ?? "";
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
      <header><div><h2 id="offline-prep-title">{t("title")}</h2></div><button onClick={onClose} aria-label={t("close")}><UiIcon name="close" /></button></header>
      <section className={styles.section}>
        <div>
          <h3>{event.name}・{dayInfo ? t("dayWithDate", { label: dayInfo.label, date: dateLabel }) : `DAY ${day}`}{venue ? `・${venue.venueName} · ${venue.venueSpaceName}` : ""}</h3>
        </div>
        <div className={styles.offlineStatus} role="status">
          {view.kind === "checking" && <p>{t("checking")}</p>}
          {view.kind === "ready" && <p className={styles.okText}>{t("ready")}</p>}
          {view.kind === "missing" && <p>{t("missing", { count: view.count })}</p>}
          {view.kind === "preparing" && <p>{view.total > 0 ? t("preparingProgress", { done: view.done, total: view.total }) : t("preparing")}</p>}
          {view.kind === "failed" && <p className={styles.errorText}>{t("failed", { count: view.count })}</p>}
          {view.kind === "unsupported" && <p className={styles.errorText}>{t("unsupported")}</p>}
          {view.kind === "reload" && <p className={styles.errorText}>{t("reload")}</p>}
          {view.kind === "error" && <p className={styles.errorText}>{t("error")}</p>}
        </div>
        <div className={styles.confirmActions}>
          {(view.kind === "missing" || view.kind === "failed") && <button className={styles.primary} onClick={() => void prepare()}>{view.kind === "failed" ? t("retry") : t("download")}</button>}
          <button onClick={onClose}>{t("closeButton")}</button>
        </div>
      </section>
    </section>
  </div>, document.body);
}
