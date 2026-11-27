import { useId } from "react";
import type { PortalSession } from "./circle-editor-client";
import { localizedHref } from "./i18n/locale";
import { useLocale, useMessages } from "./i18n/locale-context";
import { defineMessages } from "./i18n/messages";
import { workspaceSections } from "./workspace-sections";
import styles from "./public-workspace-menu.module.css";

const MESSAGES = defineMessages({
  "zh-Hant": { account: "帳號", circle: "社團資料", organizer: "主辦工作區", admin: "網站管理" },
  "en": { account: "Account", circle: "Circle data", organizer: "Organizer workspace", admin: "Site admin" },
  "ja": { account: "アカウント", circle: "サークル情報", organizer: "主催ワークスペース", admin: "サイト管理" },
});

export function PublicWorkspaceMenu({ session, circleHref }: { session: PortalSession; circleHref: string }) {
  const menuId = useId();
  const { locale } = useLocale();
  const t = useMessages(MESSAGES);
  return <>
    <button type="button" className={styles.avatar} popoverTarget={menuId} aria-label={t("account")}>{session.email.slice(0, 1).toUpperCase()}</button>
    <nav id={menuId} popover="auto" aria-label={t("account")} className={styles.workspaces}>
      {workspaceSections(session).filter(section => section.visible).map(section =>
        <a key={section.id} href={localizedHref(section.id === "circle" ? circleHref : "/" + section.id, locale)}>{t(section.id)}</a>)}
    </nav>
  </>;
}
