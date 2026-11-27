import type { MouseEvent } from "react";
import type { EventDefinition } from "./event-catalog";
import { switchReaderViewUrl } from "./catalog-browse-url";
import styles from "./reader-navigation.module.css";
import { useMessages } from "./i18n/locale-context";
import { defineMessages } from "./i18n/messages";

const MESSAGES = defineMessages({
  "zh-Hant": { label: "閱讀方式", map: "地圖", browse: "逛品書" },
  en: { label: "View", map: "Map", browse: "Item lists" },
  ja: { label: "表示方法", map: "マップ", browse: "お品書き" },
});

export const READER_NAVIGATION_EVENT = "reader:navigate";
export function navigateReader(url: URL, state: Record<string, unknown> = {}) {
  window.history.pushState(state, "", url);
  window.dispatchEvent(new Event(READER_NAVIGATION_EVENT));
}

export function ordinaryLinkClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
/**
 * The map/browse switch. Both views draw the same control in their header, on
 * phones as well (#581), so it sits in one spot across views.
 */
export default function ReaderViewTabs({ event, view, beforeNavigate, url, className }: {
  event: EventDefinition; view: "map" | "browse"; beforeNavigate?: () => void; url?: URL; className?: string;
}) {
  const current = url ?? new URL(typeof window === "undefined" ? "https://event.invalid/" : window.location.href);
  const other = switchReaderViewUrl(event, current);
  const t = useMessages(MESSAGES);
  return <nav className={`${styles.tabs} ${className ?? ""}`} aria-label={t("label")}>
    {(["map", "browse"] as const).map((target) => <a key={target}
      href={(target === view ? current : other).toString()} aria-current={target === view ? "page" : undefined}
      onClick={(pressed) => {
        if (!ordinaryLinkClick(pressed)) return;
        pressed.preventDefault();
        if (target !== view) { beforeNavigate?.(); navigateReader(other); }
      }}>{target === "map" ? t("map") : t("browse")}</a>)}
  </nav>;
}
