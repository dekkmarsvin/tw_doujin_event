import { useEffect, useState } from "react";
import type { EventDefinition } from "./event-catalog";
import { groupCalendarEvents, taipeiDate } from "./event-calendar";
import styles from "./event-chooser.module.css";

/**
 * The public entry when a URL names no event, or names one this build does not
 * serve (ADR-0042), grouped by the event's Taiwan calendar dates (#134).
 */
export default function EventChooser({ events, unresolved, onSelect }: {
  events: readonly EventDefinition[];
  /** An event id the URL asked for that is not published, if there was one. */
  unresolved?: string | null;
  onSelect: (event: EventDefinition) => void;
}) {
  const [today, setToday] = useState(() => taipeiDate(Date.now()));
  useEffect(() => {
    const refresh = () => setToday(taipeiDate(Date.now()));
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const groups = groupCalendarEvents(events, today);
  return <div className={styles.shell}>
    <header className={styles.header}>
      <span aria-hidden="true">場</span>
      <div><b>場刊 Map</b><small>同人展逛攤地圖</small></div>
    </header>
    <main className={styles.main}>
      <h1>選擇活動</h1>
      <p>選一場活動後即可搜尋社團、查看攤位並收藏。</p>

      {unresolved && <p className={styles.notice} role="status">
        <span className={styles.mark} aria-hidden="true">!</span>
        <span>
          <b>這個連結指向的活動目前無法開啟</b>
          <small>可能尚未公開，或連結中的活動代號有誤。請從下方選擇一場活動。</small>
        </span>
      </p>}

      {groups.map((group) => <section key={group.id} className={styles.group} data-event-group={group.id} aria-labelledby={`event-group-${group.id}`}>
        <h2 id={`event-group-${group.id}`}>{group.label}</h2>
        <ul className={styles.list}>
        {group.entries.map(({ event, label }) => <li key={event.id}>
          <button type="button" onClick={() => onSelect(event)}>
            <span>
              <b>{event.name}</b>
              <small>{label} · {event.venue}</small>
            </span>
            <span className={styles.arrow} aria-hidden="true">→</span>
          </button>
        </li>)}
        </ul>
      </section>)}
      {events.length === 0 && <p className={styles.empty} role="status">目前沒有公開活動，請稍後再來查看。</p>}
    </main>
  </div>;
}
