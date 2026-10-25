import { useState } from "react";
import type { EventDefinition } from "./event-catalog";
import { dayDateLabel, eventDayCalendarDate, type groupCalendarEvents } from "./event-calendar";
import styles from "./event-chooser.module.css";
import { localizedHref } from "./i18n/locale";
import { useLocale, useMessages } from "./i18n/locale-context";
import { defineMessages } from "./i18n/messages";
import { inspectPlanningStorage, type PlanningDocument } from "./planning-store";
import { ordinaryLinkClick } from "./reader-navigation";

const MESSAGES = defineMessages({
  "zh-Hant": { resume: "繼續規劃", favorites: "收藏 {count}", plans: "行程 {count}" },
  en: {
    resume: "Continue planning",
    favorites: ({ count }) => Number(count) === 1 ? "1 favorite" : `${count} favorites`,
    plans: ({ count }) => Number(count) === 1 ? "1 plan item" : `${count} plan items`,
  },
  ja: { resume: "プランの続き", favorites: "お気に入り {count} 件", plans: "巡回プラン {count} 件" },
});

type Groups = ReturnType<typeof groupCalendarEvents>;

/** Months as Sunday-first weeks: blank cells before the 1st, then each date. */
function monthCells(year: number, month: number) {
  const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [...Array(lead).fill(null), ...Array.from({ length }, (_, index) => `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`)] as (string | null)[];
}

/**
 * This month, and the month of the next event day after it when that is a
 * later month: a reader sees where today sits and what comes next.
 */
function calendarMonths(groups: Groups, today: string) {
  const days = new Map<string, EventDefinition[]>();
  for (const { event } of groups.flatMap((group) => group.entries)) {
    for (const date of new Set(event.days.map((day) => eventDayCalendarDate(event, day.id)))) {
      if (date) days.set(date, [...days.get(date) ?? [], event]);
    }
  }
  const months = [today.slice(0, 7)];
  const next = [...days.keys()].filter((date) => date.slice(0, 7) > months[0]).sort()[0];
  if (next) months.push(next.slice(0, 7));
  return { days, months };
}

/** Bring an event's row into view and put focus on its map entry. */
function revealEvent(eventId: string) {
  const row = document.getElementById(`event-row-${eventId}`);
  row?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  row?.querySelector("a")?.focus({ preventScroll: true });
}

/**
 * The chooser's side column on a wide screen, below the list on a narrow one:
 * the current events this browser has planning for, and a small calendar.
 * Planning is read once and never written, so opening the chooser cannot
 * migrate or overwrite what the map saves.
 */
export default function EventChooserAside({ groups, today, onSelect }: {
  groups: Groups;
  today: string;
  onSelect: (event: EventDefinition) => void;
}) {
  const { locale } = useLocale();
  const t = useMessages(MESSAGES);
  // The pre-schema favorites belong to no event here; the map migrates them.
  // Blocked storage, or none at all, leaves nothing to resume.
  const [planning] = useState<PlanningDocument | null>(() => {
    try { return inspectPlanningStorage(localStorage, "").document; } catch { return null; }
  });

  const resume = groups.filter((group) => group.id !== "past").flatMap((group) => group.entries).flatMap(({ event }) => {
    const favorites = planning?.favorites.filter((favorite) => favorite.eventId === event.id).length ?? 0;
    const plans = planning?.visitPlans.filter((plan) => plan.eventId === event.id).length ?? 0;
    return favorites || plans ? [{ event, counts: [favorites && t("favorites", { count: favorites }), plans && t("plans", { count: plans })].filter(Boolean).join(" · ") }] : [];
  });
  const { days, months } = calendarMonths(groups, today);
  const caption = new Intl.DateTimeFormat(locale, { timeZone: "UTC", year: "numeric", month: "long" });
  const weekdays = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "narrow" });
  const names = new Intl.ListFormat(locale, { style: "narrow", type: "unit" });

  return <aside className={styles.aside}>
    {resume.length > 0 && <section className={styles.panel} aria-labelledby="event-chooser-resume">
      <h2 id="event-chooser-resume">{t("resume")}</h2>
      <ul className={styles.resume}>
        {resume.map(({ event, counts }) => <li key={event.id}>
          <a href={localizedHref(`?event=${encodeURIComponent(event.id)}`, locale)} onClick={(pressed) => {
            if (!ordinaryLinkClick(pressed)) return;
            pressed.preventDefault();
            onSelect(event);
          }}><b>{event.name}</b><small>{counts}</small></a>
        </li>)}
      </ul>
    </section>}
    {/* Only event days are read out and pressable: each names its date and
        events, and leads to that event's row in the list. */}
    <section className={styles.panel}>
      {months.map((month) => {
        const [year, number] = month.split("-").map(Number);
        return <div key={month} className={styles.month}>
          <h2>{caption.format(new Date(Date.UTC(year, number - 1, 1)))}</h2>
          <div className={styles.days}>
            {Array.from({ length: 7 }, (_, index) => <span key={`w${index}`} className={styles.weekday} aria-hidden="true">{weekdays.format(new Date(Date.UTC(2026, 10, 1 + index)))}</span>)}
            {monthCells(year, number).map((date, index) => {
              const held = date ? days.get(date) : undefined;
              if (!date || !held) return <span key={date ?? `b${index}`} data-today={date === today || undefined} aria-hidden="true">{date ? Number(date.slice(8)) : ""}</span>;
              const label = dayDateLabel(date, locale);
              const column = index % 7;
              return <button key={date} type="button" data-today={date === today || undefined} data-event={date < today ? "past" : "current"} data-align={column < 2 ? "start" : column > 4 ? "end" : undefined}
                aria-label={`${label} ${names.format(held.map((event) => event.name))}`} onClick={() => revealEvent(held[0].id)}>
                {Number(date.slice(8))}
                <span className={styles.tip} aria-hidden="true"><b>{label}</b>{held.map((event) => <span key={event.id}>{event.name}</span>)}</span>
              </button>;
            })}
          </div>
        </div>;
      })}
    </section>
  </aside>;
}
