import { useState, type ReactNode } from "react";
import { getPublishedEvent } from "./event-catalog";
import { useReaderAccount } from "./use-reader-account";
import { RoleSections, accountAttention, useOnline } from "./reader-account";
import type { PortalSession } from "./circle-editor-client";
import { AccountMenu } from "./circle-portal/account-menu";
import { useLocale } from "./i18n/locale-context";
import { localizedHref } from "./i18n/locale";
import { usePortalText } from "./circle-portal/portal-i18n";
import { SiteTopbar } from "./site-topbar";
import { useWorkspaceSaveStatus } from "./workspace-save-status";
import styles from "./workspace-header.module.css";

export function WorkspaceHeader({ session, current, event, eventId, candidateId, anonymousHref, children }: {
  session: PortalSession | null; current: "circle" | "organizer" | "admin"; event?: ReactNode; eventId?: string; candidateId?: string; anonymousHref?: string; children?: ReactNode;
}) {
  const { locale } = useLocale();
  const t = usePortalText();
  const scope = getPublishedEvent(eventId ?? "");
  const account = useReaderAccount(scope?.id ?? "", false, session, candidateId);
  const [now, setNow] = useState(() => Date.now());
  const online = useOnline();
  const roleDot = accountAttention(account, now);
  const attention = roleDot === "bad" ? roleDot : !online ? "warn" : roleDot;
  const state = useWorkspaceSaveStatus();
  const time = typeof state === "number" && state > 0 ? new Date(state).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "";
  const sections = [
    { id: "circle", title: "社團資料", visible: true },
    { id: "organizer", title: "主辦工作區", visible: session?.hasOrganizerAccess || session?.isAdmin || session?.canApplyForEvent || session?.hasEventApplications },
    { id: "admin", title: "網站管理", visible: session?.isAdmin },
  ];
  return <SiteTopbar className={styles.header}
    brand={<h1><span aria-hidden="true">場</span>{t(sections.find(section => section.id === current)!.title)}</h1>}
    event={event && <div className={styles.event}>{event}</div>}
    navigation={session && <nav aria-label={t("工作區")}>{sections.filter(section => section.visible).map(section => <a key={section.id} href={localizedHref("/" + section.id, locale)} aria-current={section.id === current ? "page" : undefined}>{t(section.title)}</a>)}</nav>}
    status={session && <output>{!online && <span className={styles.offline}>{t("離線中")} </span>}{state === "saving" ? t("儲存中…") : state === "dirty" ? t("有未儲存的變更") : time ? t("已儲存") + " " + time : ""}</output>}
    account={session ? <AccountMenu email={session.email} attention={attention} onOpen={() => setNow(Date.now())}><RoleSections account={account} event={scope ?? undefined} now={now} /><strong>{session.email}</strong>
      {session.expiresAt && <small>{t("有效期限")} {new Date(session.expiresAt).toLocaleString(locale)}</small>}{children}</AccountMenu> : anonymousHref && <AccountMenu><a href={anonymousHref}>{t("登入")}</a></AccountMenu>} />;
}
