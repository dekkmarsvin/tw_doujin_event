"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { TextScale } from "./use-reader-text-scale";
import { eventDayCalendarDate, taipeiDate } from "./event-calendar";
import type { EventDefinition } from "./event-catalog";
import type { ServiceChecks } from "./site-settings";
import { circlePath, readerLink } from "./seo";
import { publicLoginHref } from "./public-header";
import { useCircleCatalog } from "./use-circle-catalog";
import { useReaderPlanning } from "./reader-planning";
import PlanningTools from "./planning-tools";
import ReaderHelp from "./reader-help";
import { LanguageSwitcher } from "./i18n/language-switcher";
import { localizedHref } from "./i18n/locale";
import { useLocale, useMessages } from "./i18n/locale-context";
import { defineMessages } from "./i18n/messages";
import { UiIcon } from "./ui-icons";
import type { Account } from "./use-reader-account";
import { endReaderSession } from "./reader-account-client";
import styles from "./reader-account.module.css";

const MESSAGES = defineMessages({
  "zh-Hant": {
    open: "我的", openSignedIn: "我的：{email}",
    attention: "需要留意", alert: "有問題",
    pending: "待處理", claimsQueue: "社團認領", applications: "活動申請", submissions: "送審（含發布未完成）", toAdmin: "前往管理入口",
    services: "服務", servicesOk: "可用", servicesUnknown: "無法確認", servicesStale: "上次檢查 {date}", servicesNever: "尚未檢查", servicesDown: "不可用",
    myEvent: "我的活動", reviewClaims: "審核認領", announcement: "公告", pendingClaims: "本場待審認領 {count}", editEvent: "編輯活動", toOrganizer: "主辦工作區",
    myCircles: "我的社團", verified: "已認領", reviewing: "審核中", rejected: "需補件", revoked: "已撤銷",
    booth: "本場 {codes}", notHere: "本場沒有攤位", catalogLive: "品書已上線", catalogNone: "還沒有品書",
    circlePage: "社團頁", locate: "地圖定位", edit: "編輯", progress: "查看進度", reclaim: "重新認領", claimMine: "認領我的社團", claimOther: "認領其他社團",
    device: "這台裝置的規劃", favorites: "收藏", favoriteCount: "{count}（{groups} 個群組）", plans: "行程", planCount: "{count} 站，已逛 {visited}",
    storage: "儲存", stored: "已存在這台裝置", storageFailed: "無法儲存",
    data: "活動資料", updated: "更新", connection: "連線", online: "線上", offline: "離線中", offlineUse: "離線使用", check: "檢查",
    display: "顯示", textScale: "字級", small: "小", medium: "中", large: "大", smallLabel: "標準字級", mediumLabel: "較大字級", largeLabel: "最大字級", textScaleGroup: "網頁字體大小", language: "語言",
    account: "帳號", until: "有效至 {date}", signOut: "登出", logoutError: "登出失敗，請重試。", circleWorkspace: "社團資料", admin: "網站管理",
    draft: "草稿", changes_requested: "要求修改", submitted: "審閱中", approved: "發布未完成", publishing: "發布中", published: "已發布", failed: "發布失敗", abandoned: "已終止修正",
    signIn: "社團或主辦登入",
  },
  en: {
    open: "Me", openSignedIn: "Me: {email}",
    attention: "Needs attention", alert: "Problem",
    pending: "To do", claimsQueue: "Circle claims", applications: "Event applications", submissions: "Submissions (incl. unfinished publishing)", toAdmin: "Open admin",
    services: "Services", servicesOk: "Working", servicesUnknown: "Couldn't confirm", servicesStale: "Last checked {date}", servicesNever: "Not checked yet", servicesDown: "Not working",
    myEvent: "My event", reviewClaims: "Review claims", announcement: "Announcement", pendingClaims: "{count} claims to review", editEvent: "Edit event", toOrganizer: "Organizer workspace",
    myCircles: "My circles", verified: "Claimed", reviewing: "In review", rejected: "Needs more", revoked: "Revoked",
    booth: "Here at {codes}", notHere: "No booth at this event", catalogLive: "Item list is live", catalogNone: "No item list yet",
    circlePage: "Circle page", locate: "Show on map", edit: "Edit", progress: "See progress", reclaim: "Claim again", claimMine: "Claim my circle", claimOther: "Claim another circle",
    device: "Plans on this device", favorites: "Favorites", favoriteCount: "{count} ({groups} groups)", plans: "Plan", planCount: "{count} stops, {visited} visited",
    storage: "Saving", stored: "Saved on this device", storageFailed: "Can't save",
    data: "Event data", updated: "Updated", connection: "Connection", online: "Online", offline: "Offline", offlineUse: "Offline use", check: "Check",
    display: "Display", textScale: "Text size", small: "S", medium: "M", large: "L", smallLabel: "Standard text", mediumLabel: "Larger text", largeLabel: "Largest text", textScaleGroup: "Text size", language: "Language",
    account: "Account", until: "Signed in until {date}", signOut: "Sign out", logoutError: "Sign-out failed. Try again.", circleWorkspace: "Circle data", admin: "Site admin",
    draft: "Draft", changes_requested: "Changes requested", submitted: "In review", approved: "Publishing unfinished", publishing: "Publishing", published: "Published", failed: "Publishing failed", abandoned: "Correction ended",
    signIn: "Circle or organizer sign-in",
  },
  ja: {
    open: "マイページ", openSignedIn: "マイページ：{email}",
    attention: "確認が必要", alert: "問題あり",
    pending: "対応待ち", claimsQueue: "サークル申請", applications: "イベント申請", submissions: "審査待ち（公開未完了を含む）", toAdmin: "管理画面へ",
    services: "サービス", servicesOk: "利用可能", servicesUnknown: "確認できません", servicesStale: "前回の確認 {date}", servicesNever: "未確認", servicesDown: "利用不可",
    myEvent: "担当イベント", reviewClaims: "管理申請を審査", announcement: "お知らせ", pendingClaims: "審査待ちの申請 {count} 件", editEvent: "イベントを編集", toOrganizer: "主催ワークスペース",
    myCircles: "マイサークル", verified: "確認済み", reviewing: "審査中", rejected: "要追加資料", revoked: "取り消し済み",
    booth: "このイベント {codes}", notHere: "このイベントに配置なし", catalogLive: "お品書き公開中", catalogNone: "お品書き未登録",
    circlePage: "サークルページ", locate: "マップで表示", edit: "編集", progress: "進捗を見る", reclaim: "再申請", claimMine: "自分のサークルを申請", claimOther: "ほかのサークルを申請",
    device: "この端末の保存データ", favorites: "お気に入り", favoriteCount: "{count}（{groups} グループ）", plans: "巡回プラン", planCount: "{count} 件、訪問済み {visited}",
    storage: "保存", stored: "この端末に保存済み", storageFailed: "保存できません",
    data: "イベントデータ", updated: "更新", connection: "接続", online: "オンライン", offline: "オフライン", offlineUse: "オフライン利用", check: "確認",
    display: "表示", textScale: "文字サイズ", small: "小", medium: "中", large: "大", smallLabel: "標準の文字サイズ", mediumLabel: "大きめの文字サイズ", largeLabel: "最大の文字サイズ", textScaleGroup: "文字サイズ", language: "言語",
    account: "アカウント", until: "{date} までログイン中", signOut: "ログアウト", logoutError: "ログアウトできませんでした。もう一度お試しください。", circleWorkspace: "サークル情報", admin: "サイト管理",
    draft: "下書き", changes_requested: "修正依頼", submitted: "審査中", approved: "公開未完了", publishing: "公開中", published: "公開済み", failed: "公開失敗", abandoned: "修正を終了",
    signIn: "サークル・主催者ログイン",
  },
});

/** How long a service check is trusted before the light turns grey. */
const SERVICE_CHECK_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    queueMicrotask(update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return online;
}

type ServiceLight = "ok" | "unknown" | "stale" | "never" | "down";
function serviceLight(services: ServiceChecks | null, now: number): ServiceLight {
  if (!services || services.checkedAt === null) return "never";
  if (now - services.checkedAt > SERVICE_CHECK_FRESH_MS) return "stale";
  const checks = [services.mail, services.publication, services.reader, services.notifications];
  if (checks.some((check) => check?.status === "unavailable")) return "down";
  if (checks.every((check) => check?.status === "available")) return "ok";
  return "unknown";
}

const shortDate = (time: number, locale: string) => new Date(time).toLocaleDateString(locale, { month: "numeric", day: "numeric", timeZone: "Asia/Taipei" });

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.section}><h3>{title}</h3>{children}</section>;
}
function Row({ label, children, tone }: { label: ReactNode; children?: ReactNode; tone?: "ok" | "warn" | "bad" | "muted" }) {
  return <div className={styles.row}><span>{label}</span>{children !== undefined && <span className={tone ? styles[tone] : undefined}>{children}</span>}</div>;
}

/**
 * The one place for everything about the reader that is not the event itself
 * (#581): their plans on this device, the event data's state, display settings,
 * and — once signed in — the circles, event and review queue that wait for
 * them. The header keeps only the button; a dot on it says when something here
 * needs a look.
 *
 * The panel is hidden rather than unmounted, as the portal's account menu is:
 * 資料管理 and the offline check open dialogs that must outlive a click that
 * lands outside the panel.
 */
export default function ReaderAccountMenu({ account, event, day, textScale, onTextScale, onCheckOffline, className }: {
  event: EventDefinition;
  account: Account | null;
  day: string | number | null;
  textScale: TextScale;
  onTextScale: (next: TextScale) => void;
  onCheckOffline?: (day: string | number) => void;
  className?: string;
}) {
  const t = useMessages(MESSAGES);
  const { locale } = useLocale();
  const planning = useReaderPlanning();
  const publication = useCircleCatalog(event.id);
  const [logoutError, setLogoutError] = useState(false);
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const inDialog = (target: EventTarget | null) => target instanceof Element && target.closest("[aria-modal='true'],dialog") !== null;
    const outside = (pressed: PointerEvent) => {
      if (!root.current?.contains(pressed.target as Node) && !inDialog(pressed.target)) setOpen(false);
    };
    const escape = (key: KeyboardEvent) => {
      if (key.key !== "Escape" || inDialog(key.target) || document.querySelector("[aria-modal='true']") || root.current?.querySelector("[role='dialog']")) return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const session = account?.session ?? null;
  const favorites = planning.document.favorites.filter((item) => item.eventId === event.id);
  const planDay = event.days.find((entry) => day === null
    ? eventDayCalendarDate(event, entry.id) === taipeiDate(now)
    : entry.id === day) ?? event.days[0];
  const plans = planning.document.visitPlans.filter((item) => item.eventId === event.id && item.day === planDay.id);
  // Red: something is broken. Amber: something the reader should do. Blue: work is waiting.
  const seenKey = "reader-publication:" + event.id;
  const revision = publication.overrides && JSON.stringify([event.dataUpdatedAt, publication.overrides.revision]);
  const [baseline, setBaseline] = useState<string | null>(() => {
    try { return sessionStorage.getItem(seenKey); } catch { return null; }
  });
  if (revision && (baseline === null || open) && revision !== baseline) setBaseline(revision);
  useEffect(() => {
    if (baseline) try { sessionStorage.setItem(seenKey, baseline); } catch { /* Keep the in-memory baseline. */ }
  }, [seenKey, baseline]);
  const updated = !!revision && !!baseline && revision !== baseline;
  const roleDot = accountAttention(account, now);
  const dot = planning.storageError || roleDot === "bad" ? "bad" : !online || roleDot === "warn" ? "warn" : updated || roleDot === "info" ? "info" : null;
  const label = session ? t("openSignedIn", { email: session.email }) : t("open");
  const circleHref = (circleId?: string) => localizedHref(`/circle?${new URLSearchParams({ event: event.id, ...(circleId ? { circle: circleId } : {}) })}`, locale);

  return <div ref={root} className={`${styles.menu} ${className ?? ""}`} data-reader-menu>
    {/* Beside the button where there is room: the two states that change what the reader can rely on. */}
    {(planning.storageError || !online) && <span className={planning.storageError ? `${styles.badge} ${styles.badgeBad}` : styles.badge} role="status">{planning.storageError ? t("storageFailed") : t("offline")}</span>}
    <button ref={trigger} type="button" className={styles.trigger} aria-expanded={open} aria-controls={panelId} aria-label={dot === "bad" ? `${label}（${t("alert")}）` : dot === "warn" ? `${label}（${t("attention")}）` : dot === "info" ? `${label}（${t("attention")}）` : label} onClick={() => { if (!open) setNow(Date.now()); setOpen(!open); }}>
      <span className={session ? styles.avatar : `${styles.avatar} ${styles.anonymous}`} aria-hidden="true">{session ? session.email.slice(0, 1).toUpperCase() : <UiIcon name="user" />}</span>
      {dot && <i className={`${styles.dot} ${styles[dot]}`} aria-hidden="true" />}
    </button>
    <div id={panelId} className={styles.panel} hidden={!open}>
      <RoleSections account={account} event={event} now={now} />
      <Section title={t("device")}>
        <Row label={t("favorites")}>{t("favoriteCount", { count: favorites.length, groups: planning.document.favoriteGroups.length })}</Row>
        <Row label={`${t("plans")} · ${planDay.dateLabel}`}>{t("planCount", { count: plans.length, visited: plans.filter((plan) => plan.status === "visited").length })}</Row>
        <Row label={t("storage")} tone={planning.storageError ? "bad" : "ok"}>{planning.storageError ? t("storageFailed") : t("stored")}</Row>
        <div className={styles.tool}><PlanningTools eventId={event.id} /></div>
      </Section>
      <Section title={t("data")}>
        <Row label={t("updated")}>{event.dataLastUpdatedLabel}</Row>
        <Row label={t("connection")} tone={online ? "ok" : "warn"}>{online ? t("online") : t("offline")}</Row>
        {onCheckOffline && <Row label={t("offlineUse")}><button type="button" className={styles.inline} onClick={() => { setOpen(false); onCheckOffline(planDay.id); }}>{t("check")}</button></Row>}
      </Section>
      <Section title={t("display")}>
        <div className={styles.row}><span>{t("textScale")}</span>
          <span className={styles.scale} role="group" aria-label={t("textScaleGroup")}>{(["standard", "large", "extra"] as const).map((value, index) => <button key={value} type="button" aria-pressed={textScale === value} aria-label={index === 0 ? t("smallLabel") : index === 1 ? t("mediumLabel") : t("largeLabel")} onClick={() => onTextScale(value)}>{index === 0 ? t("small") : index === 1 ? t("medium") : t("large")}</button>)}</span>
        </div>
        <div className={styles.row}><span>{t("language")}</span><LanguageSwitcher /></div>
        <div className={styles.tool}><ReaderHelp eventId={event.id} dataLastUpdatedLabel={event.dataLastUpdatedLabel} inline /></div>
      </Section>
      {session ? <Section title={t("account")}>
        <div className={styles.identity}>
          <span>{session.email}</span>
          {session.expiresAt && <small>{t("until", { date: new Date(session.expiresAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) })}</small>}
        </div>
        <div className={styles.actions}>
          <a href={circleHref()}>{t("circleWorkspace")}</a>
          {session.hasOrganizerAccess && <a href="/organizer">{t("toOrganizer")}</a>}
          {session.isAdmin && <a href="/admin">{t("admin")}</a>}
        </div>
        <button className={styles.inline} onClick={() => { setLogoutError(false); void endReaderSession().catch(() => setLogoutError(true)); }}>{t("signOut")}</button>
        {logoutError && <p role="alert">{t("logoutError")}</p>}
      </Section> : <a className={styles.signIn} href={localizedHref(publicLoginHref({ eventId: event.id }), locale)}>{t("signIn")}</a>}
    </div>
  </div>;
}

export function RoleSections({ account, event, now }: { account: Account | null; event?: EventDefinition; now: number }) {
  const { locale } = useLocale();
  const t = useMessages(MESSAGES);
  const publication = useCircleCatalog(event?.id ?? "", !!event && !!account?.claims?.some(claim => claim.status === "verified"));
  const catalog = publication.catalog;
  const session = account?.session;
  const queue = account?.queue;
  const claims = account?.claims?.filter(claim => claim.status !== "withdrawn") ?? [];
  const light = session?.isAdmin ? serviceLight(account?.services ?? null, now) : null;
  const circleHref = (circleId?: string) => localizedHref(`/circle?${new URLSearchParams({ event: event?.id ?? "", ...(circleId ? { circle: circleId } : {}) })}`, locale);
  return <>
      {queue && <Section title={t("pending")}>
        <Row label={<a href="/admin?section=circles&view=claims">{t("claimsQueue")}</a>}>{queue.pendingClaimCount ?? queue.claims.length}</Row>
        <Row label={<a href="/organizer?application">{t("applications")}</a>}>{queue.organizer.applications}</Row>
        <Row label={<a href="/admin?section=events&view=publication">{t("submissions")}</a>}>{queue.organizer.submissions}</Row>
        {light && <Row label={t("services")} tone={light === "ok" ? "ok" : light === "down" ? "bad" : "muted"}>
          {light === "ok" ? t("servicesOk") : light === "down" ? t("servicesDown") : light === "unknown" ? t("servicesUnknown") : light === "never" ? t("servicesNever") : t("servicesStale", { date: shortDate(account!.services!.checkedAt!, locale) })}
        </Row>}
        <a className={styles.link} href="/admin">{t("toAdmin")}</a>
      </Section>}
      {account?.candidate && <Section title={t("myEvent")}>
        <Row label={account.candidate.tentativeName}>{t(account.candidate.status)}</Row>
        {account.candidatePendingClaims !== null && <Row label={t("pendingClaims", { count: account.candidatePendingClaims })} />}
        <a className={styles.link} href={`/organizer?${new URLSearchParams({ candidate: account.candidate.id })}`}>{t("editEvent")}</a>
        {account.candidatePendingClaims !== null && (["circles", "notice"] as const).map(section => <a key={section} className={styles.link} href={`/organizer?${new URLSearchParams({ candidate: account.candidate!.id, section })}`}>{t(section === "circles" ? "reviewClaims" : "announcement")}</a>)}
      </Section>}
      {event && session && account?.claims && <Section title={t("myCircles")}>
        {claims.map((claim) => {
          const circle = catalog.circlesById.get(claim.circleId);
          const placements = catalog.placements.filter((placement) => placement.circleId === claim.circleId && placement.status === "active");
          const first = placements[0];
          return <div key={claim.id} className={styles.claim}>
            <Row label={<b>{claim.circleName}</b>} tone={claim.status === "verified" ? "ok" : claim.status === "rejected" ? "warn" : "muted"}>
              {claim.status === "verified" ? t("verified") : claim.status === "pending" ? t("reviewing") : claim.status === "rejected" ? t("rejected") : t("revoked")}
            </Row>
            {claim.status === "verified" && <>
              {publication.status === "ready" && <small>{placements.length ? t("booth", { codes: [...new Set(placements.map((placement) => placement.boothCode))].join("、") }) : t("notHere")}{circle ? ` · ${circle.media.some((media) => media.kind === "catalog") ? t("catalogLive") : t("catalogNone")}` : ""}</small>}
              <div className={styles.actions}>
                {circle && <a href={localizedHref(circlePath(event.id, claim.circleId), locale)}>{t("circlePage")}</a>}
                {first && <a href={localizedHref(readerLink(event, { day: first.day, area: first.area, boothCode: first.boothCode, circleId: claim.circleId }), locale)}>{t("locate")}</a>}
                <a href={circleHref(claim.circleId)}>{t("edit")}</a>
              </div>
            </>}
            {claim.status === "pending" && <div className={styles.actions}><a href={circleHref(claim.circleId)}>{t("progress")}</a></div>}
            {claim.status === "rejected" && <div className={styles.actions}><a href={circleHref(claim.circleId)}>{t("reclaim")}</a></div>}
          </div>;
        })}
        <a className={styles.link} href={circleHref()}>{claims.length ? t("claimOther") : t("claimMine")}</a>
      </Section>}
  </>;
}

export function accountAttention(account: Account | null, now: number) {
  const session = account?.session;
  const claims = (account?.claims ?? []).filter((claim) => claim.status !== "withdrawn");
  const queue = account?.queue ?? null;
  const queueTotal = queue ? (queue.pendingClaimCount ?? queue.claims.length) + queue.organizer.applications + queue.organizer.submissions : 0;
  const light = session?.isAdmin ? serviceLight(account?.services ?? null, now) : null;
  return light === "down" ? "bad" : claims.some(claim => claim.status === "rejected") ? "warn" : queueTotal > 0 || (account?.candidatePendingClaims ?? 0) > 0 ? "info" : null;
}
