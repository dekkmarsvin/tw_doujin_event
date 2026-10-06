import { navigateReader, ordinaryLinkClick } from "./reader-navigation";
import { useEffect, useState } from "react";
import type { EventDefinition } from "./event-catalog";
import { groupCalendarEvents, taipeiDate } from "./event-calendar";
import styles from "./event-chooser.module.css";
import { LanguageSwitcher } from "./i18n/language-switcher";
import { localizedHref } from "./i18n/locale";
import { useDocumentLanguage, useLocale, useMessages } from "./i18n/locale-context";
import { defineMessages } from "./i18n/messages";
import { PUBLIC_HEADER, PUBLIC_HEADER_MESSAGES, publicLoginHref } from "./public-header";
import { eventPath } from "./seo";
import { UiIcon } from "./ui-icons";

const MESSAGES = defineMessages({
  "zh-Hant": {
    title: "選擇活動",
    intro: "選一場活動後即可搜尋社團、查看攤位並收藏。",
    unresolvedTitle: "這個連結指向的活動目前無法開啟",
    unresolvedHint: "可能尚未公開，或連結中的活動代號有誤。請從下方選擇一場活動。",
    openMap: "開啟攤位地圖",
    openMapFor: "開啟攤位地圖：{name}",
    browse: "逛品書",
    browseFor: "逛品書：{name}",
    introduction: "活動介紹與社團名單",
    introductionFor: "活動介紹與社團名單：{name}",
    empty: "目前沒有公開活動，請稍後再來查看。",
  },
  en: {
    title: "Choose an event",
    intro: "Pick an event to search circles, find their booths and save favorites.",
    unresolvedTitle: "The event in this link can’t be opened right now",
    unresolvedHint: "It may not be public yet, or the event ID in the link is wrong. Choose an event below.",
    openMap: "Open booth map",
    openMapFor: "Open booth map: {name}",
    browse: "Browse item lists",
    browseFor: "Browse item lists: {name}",
    introduction: "Event info and circle list",
    introductionFor: "Event info and circle list: {name}",
    empty: "No events are public right now. Please check back later.",
  },
  ja: {
    title: "イベントを選択",
    intro: "イベントを選ぶと、サークルの検索、スペースの確認、お気に入り登録ができます。",
    unresolvedTitle: "このリンクのイベントは現在開けません",
    unresolvedHint: "まだ公開されていないか、リンク内のイベントIDが正しくない可能性があります。下の一覧からイベントを選んでください。",
    openMap: "配置マップを開く",
    openMapFor: "配置マップを開く：{name}",
    browse: "お品書きを見る",
    browseFor: "お品書きを見る：{name}",
    introduction: "イベント情報とサークル一覧",
    introductionFor: "イベント情報とサークル一覧：{name}",
    empty: "現在公開中のイベントはありません。しばらくしてから再度ご確認ください。",
  },
});

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
  const { locale } = useLocale();
  const t = useMessages(MESSAGES);
  useDocumentLanguage();
  const groups = groupCalendarEvents(events, today, locale);
  return <div className={styles.shell}>
    <PublicHeader loginHref={localizedHref(publicLoginHref(), locale)} />
    <main className={styles.main}>
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>

      {unresolved && <p className={styles.notice} role="status">
        <span className={styles.mark} aria-hidden="true">!</span>
        <span>
          <b>{t("unresolvedTitle")}</b>
          <small>{t("unresolvedHint")}</small>
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
            <a className={styles.map} href={localizedHref(`?event=${encodeURIComponent(event.id)}`, locale)} aria-label={t("openMapFor", { name: event.name })} onClick={(pressed) => {
              // A modified or middle click is the browser's, not ours: it opens
              // the event in a new tab, which a button could never do.
              if (!ordinaryLinkClick(pressed)) return;
              pressed.preventDefault();
              onSelect(event);
            }}>{t("openMap")}<UiIcon name="chevron-right" /></a>
            <a className={styles.browse} href={localizedHref(`?event=${encodeURIComponent(event.id)}&view=browse`, locale)} aria-label={t("browseFor", { name: event.name })} onClick={(pressed) => {
              if (!ordinaryLinkClick(pressed)) return;
              pressed.preventDefault();
              navigateReader(new URL(pressed.currentTarget.href));
            }}>{t("browse")}</a>
            <a className={styles.introduction} href={localizedHref(eventPath(event.id), locale)} aria-label={t("introductionFor", { name: event.name })}>{t("introduction")}</a>
          </div>
        </li>)}
        </ul>
      </section>)}
      {events.length === 0 && <p className={styles.empty} role="status">{t("empty")}</p>}
    </main>
  </div>;
}

/** `publicHeaderHtml()` in React: the same elements, in the same order. */
function PublicHeader({ loginHref }: { loginHref: string }) {
  const { home, mark, name } = PUBLIC_HEADER;
  const t = useMessages(PUBLIC_HEADER_MESSAGES);
  const { locale } = useLocale();
  return <header className="site-header">
    <a className="site-header-brand" href={localizedHref(home, locale)}><span className="site-header-mark" aria-hidden="true">{mark}</span><span className="site-header-name"><b>{name}</b><small data-i18n="header.tagline">{t("tagline")}</small></span></a>
    <div className={`site-header-actions ${styles.headerActions}`}>
      <LanguageSwitcher />
      <a className="site-header-login" href={loginHref} data-i18n="header.login">{t("login")}</a>
    </div>
  </header>;
}
