import type { EventNotice } from "./event-notice";
import { defineMessages } from "./i18n/messages";
import { useMessages } from "./i18n/locale-context";
import { UiIcon } from "./ui-icons";
import styles from "./event-notice-banner.module.css";

const MESSAGES = defineMessages({
  "zh-Hant": { label: "主辦公告", link: "詳細資訊" },
  en: { label: "Organizer notice", link: "Details" },
  ja: { label: "主催者からのお知らせ", link: "詳細" },
});

/**
 * The organizer's notice for the whole event, exactly as written. The site adds
 * only the label and the link words: no disclaimer, no "may be outdated", and
 * nothing at all when there is no notice (#538).
 */
export function EventNoticeBanner({ notice, className }: { notice: EventNotice | undefined; className?: string }) {
  const t = useMessages(MESSAGES);
  if (!notice) return null;
  return <aside className={`${styles.banner} ${className ?? ""}`} data-kind={notice.kind} aria-label={t("label")}>
    <strong className={styles.label}>{notice.kind === "important" && <span aria-hidden="true">!</span>}{t("label")}</strong>
    <p className={styles.text}>{notice.text}</p>
    {notice.url && <a className={styles.link} href={notice.url} target="_blank" rel="noopener noreferrer">{t("link")}<UiIcon name="external" /></a>}
  </aside>;
}
