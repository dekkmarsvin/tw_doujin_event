import type { EventDefinition } from "./event-catalog";
import styles from "./event-chooser.module.css";

/**
 * The public entry when a URL names no event, or names one this build does not
 * serve (ADR-0042). Deliberately a flat list in published order: grouping by
 * lifecycle is a separate decision (#134) and a list of two does not need it.
 */
export default function EventChooser({ events, unresolved, onSelect }: {
  events: readonly EventDefinition[];
  /** An event id the URL asked for that is not published, if there was one. */
  unresolved?: string | null;
  onSelect: (event: EventDefinition) => void;
}) {
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

      <ul className={styles.list}>
        {events.map((event) => <li key={event.id}>
          <button type="button" onClick={() => onSelect(event)}>
            <span>
              <b>{event.name}</b>
              <small>{event.dateRangeLabel} · {event.venue}</small>
            </span>
            <span className={styles.arrow} aria-hidden="true">→</span>
          </button>
        </li>)}
      </ul>
    </main>
  </div>;
}
