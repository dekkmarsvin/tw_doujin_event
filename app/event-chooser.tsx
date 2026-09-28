import { navigateReader, ordinaryLinkClick } from "./reader-navigation";
import { useEffect, useState } from "react";
import type { EventDefinition } from "./event-catalog";
import { groupCalendarEvents, taipeiDate } from "./event-calendar";
import styles from "./event-chooser.module.css";
import { eventPath } from "./seo";
import { UiIcon } from "./ui-icons";

/**
 * The public entry when a URL names no event, or names one this build does not
 * serve (ADR-0042), grouped by the event's Taiwan calendar dates (#134).
 *
 * The entries are links, not buttons. This screen is the only address anything
 * outside the site can reach, so a button leaves every published event with no
 * way in that is not a script running first: nothing crawls it, nothing
 * previews it, and no reader can open one in a second tab. The href is what the
 * press would have produced; the handler still does the pressing.
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
      {import.meta.env.VITE_ORGANIZER_APPLICATIONS_OPEN === "true" && <p><a href="/organizer">申請建置活動</a></p>}

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
        {/* One card per event: what it is, then the ways in. The map is the
            primary entry and catalog browse its peer; each link names its event
            so a list of links read out of context still says where it goes. */}
        {group.entries.map(({ event, label }) => <li key={event.id} className={styles.card}>
          <div>
            <h3>{event.name}</h3>
            <p>{label} · {event.venue}</p>
          </div>
          <div className={styles.entries}>
            <a className={styles.map} href={`?event=${encodeURIComponent(event.id)}`} aria-label={`開啟攤位地圖：${event.name}`} onClick={(pressed) => {
              // A modified or middle click is the browser's, not ours: it opens
              // the event in a new tab, which a button could never do.
              if (!ordinaryLinkClick(pressed)) return;
              pressed.preventDefault();
              onSelect(event);
            }}>開啟攤位地圖<UiIcon name="chevron-right" /></a>
            <a className={styles.browse} href={`?event=${encodeURIComponent(event.id)}&view=browse`} aria-label={`逛品書：${event.name}`} onClick={(pressed) => {
              if (!ordinaryLinkClick(pressed)) return;
              pressed.preventDefault();
              navigateReader(new URL(pressed.currentTarget.href));
            }}>逛品書</a>
            <a className={styles.introduction} href={eventPath(event.id)} aria-label={`活動介紹與社團名單：${event.name}`}>活動介紹與社團名單</a>
          </div>
        </li>)}
        </ul>
      </section>)}
      {events.length === 0 && <p className={styles.empty} role="status">目前沒有公開活動，請稍後再來查看。</p>}
    </main>
  </div>;
}
