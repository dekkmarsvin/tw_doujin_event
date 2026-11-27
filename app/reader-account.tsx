"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ClaimSummary, PortalSession, ReviewQueue } from "./circle-editor-client";
import type { OrganizerEventSummary } from "./organizer-client";
import { readReaderClaims, readReaderReviewQueue, readReaderServices, readReaderSession, readReaderWorkspaceClaims, readReaderWorkspaces } from "./reader-account-client";
import type { EventDefinition } from "./event-catalog";
import type { ServiceChecks } from "./site-settings";
import { wasSignedIn } from "./session-hint";
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
import styles from "./reader-account.module.css";

const MESSAGES = defineMessages({
  "zh-Hant": {
    open: "我的", openSignedIn: "我的：{email}",
    attention: "需要留意", alert: "有問題",
    pending: "待處理", claimsQueue: "社團認領", applications: "活動申請", submissions: "送審（含發布未完成）", toAdmin: "前往管理入口",
    services: "服務", servicesOk: "可用", servicesStale: "上次檢查 {date}", servicesNever: "尚未檢查", servicesDown: "不可用",
    myEvent: "我的活動", pendingClaims: "本場待審認領 {count}", editEvent: "編輯活動", toOrganizer: "主辦工作區",
    myCircles: "我的社團", verified: "已認領", reviewing: "審核中", rejected: "需補件", revoked: "已撤銷",
    booth: "本場 {codes}", notHere: "本場沒有攤位", catalogLive: "品書已上線", catalogNone: "還沒有品書",
    circlePage: "社團頁", locate: "地圖定位", edit: "編輯", progress: "查看進度", reclaim: "重新認領", claimMine: "認領我的社團", claimOther: "認領其他社團",
    device: "這台裝置的規劃", favorites: "收藏", favoriteCount: "{count}（{groups} 個群組）", plans: "行程", planCount: "{count} 站，已逛 {visited}",
    storage: "儲存", stored: "已存在這台裝置", storageFailed: "無法儲存",
    data: "活動資料", updated: "更新", connection: "連線", online: "線上", offline: "離線中", offlineUse: "離線使用", check: "檢查",
    display: "顯示", textScale: "字級", small: "小", medium: "中", large: "大", smallLabel: "標準字級", mediumLabel: "較大字級", largeLabel: "最大字級", textScaleGroup: "網頁字體大小", language: "語言",
    account: "帳號", until: "有效至 {date}", signOutHint: "登出請到社團資料的帳號選單", circleWorkspace: "社團資料", admin: "網站管理",
    draft: "草稿", changes_requested: "要求修改", submitted: "審閱中", approved: "發布未完成", publishing: "發布中", published: "已發布", failed: "發布失敗", abandoned: "已終止修正",
    signIn: "社團或主辦登入",
  },
  en: {
    open: "Me", openSignedIn: "Me: {email}",
    attention: "Needs attention", alert: "Problem",
    pending: "To do", claimsQueue: "Circle claims", applications: "Event applications", submissions: "Submissions (incl. unfinished publishing)", toAdmin: "Open admin",
    services: "Services", servicesOk: "Working", servicesStale: "Last checked {date}", servicesNever: "Not checked yet", servicesDown: "Not working",
    myEvent: "My event", pendingClaims: "{count} claims to review", editEvent: "Edit event", toOrganizer: "Organizer workspace",
    myCircles: "My circles", verified: "Claimed", reviewing: "In review", rejected: "Needs more", revoked: "Revoked",
    booth: "Here at {codes}", notHere: "No booth at this event", catalogLive: "Item list is live", catalogNone: "No item list yet",
    circlePage: "Circle page", locate: "Show on map", edit: "Edit", progress: "See progress", reclaim: "Claim again", claimMine: "Claim my circle", claimOther: "Claim another circle",
    device: "Plans on this device", favorites: "Favorites", favoriteCount: "{count} ({groups} groups)", plans: "Plan", planCount: "{count} stops, {visited} visited",
    storage: "Saving", stored: "Saved on this device", storageFailed: "Can't save",
    data: "Event data", updated: "Updated", connection: "Connection", online: "Online", offline: "Offline", offlineUse: "Offline use", check: "Check",
    display: "Display", textScale: "Text size", small: "S", medium: "M", large: "L", smallLabel: "Standard text", mediumLabel: "Larger text", largeLabel: "Largest text", textScaleGroup: "Text size", language: "Language",
    account: "Account", until: "Signed in until {date}", signOutHint: "Sign out from the account menu in Circle data", circleWorkspace: "Circle data", admin: "Site admin",
    draft: "Draft", changes_requested: "Changes requested", submitted: "In review", approved: "Publishing unfinished", publishing: "Publishing", published: "Published", failed: "Publishing failed", abandoned: "Correction ended",
    signIn: "Circle or organizer sign-in",
  },
  ja: {
    open: "マイページ", openSignedIn: "マイページ：{email}",
    attention: "確認が必要", alert: "問題あり",
    pending: "対応待ち", claimsQueue: "サークル申請", applications: "イベント申請", submissions: "審査待ち（公開未完了を含む）", toAdmin: "管理画面へ",
    services: "サービス", servicesOk: "利用可能", servicesStale: "前回の確認 {date}", servicesNever: "未確認", servicesDown: "利用不可",
    myEvent: "担当イベント", pendingClaims: "審査待ちの申請 {count} 件", editEvent: "イベントを編集", toOrganizer: "主催ワークスペース",
    myCircles: "マイサークル", verified: "確認済み", reviewing: "審査中", rejected: "要追加資料", revoked: "取り消し済み",
    booth: "このイベント {codes}", notHere: "このイベントに配置なし", catalogLive: "お品書き公開中", catalogNone: "お品書き未登録",
    circlePage: "サークルページ", locate: "マップで表示", edit: "編集", progress: "進捗を見る", reclaim: "再申請", claimMine: "自分のサークルを申請", claimOther: "ほかのサークルを申請",
    device: "この端末の保存データ", favorites: "お気に入り", favoriteCount: "{count}（{groups} グループ）", plans: "巡回プラン", planCount: "{count} 件、訪問済み {visited}",
    storage: "保存", stored: "この端末に保存済み", storageFailed: "保存できません",
    data: "イベントデータ", updated: "更新", connection: "接続", online: "オンライン", offline: "オフライン", offlineUse: "オフライン利用", check: "確認",
    display: "表示", textScale: "文字サイズ", small: "小", medium: "中", large: "大", smallLabel: "標準の文字サイズ", mediumLabel: "大きめの文字サイズ", largeLabel: "最大の文字サイズ", textScaleGroup: "文字サイズ", language: "言語",
    account: "アカウント", until: "{date} までログイン中", signOutHint: "ログアウトはサークル情報のアカウントメニューから", circleWorkspace: "サークル情報", admin: "サイト管理",
    draft: "下書き", changes_requested: "修正依頼", submitted: "審査中", approved: "公開未完了", publishing: "公開中", published: "公開済み", failed: "公開失敗", abandoned: "修正を終了",
    signIn: "サークル・主催者ログイン",
  },
});

export type TextScale = "standard" | "large" | "extra";

/** How long a service check is trusted before the light turns grey. */
const SERVICE_CHECK_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

type Account = {
  session: PortalSession;
  claims: ClaimSummary[] | null;
  /** The newest workspace this account is a member of for the event being read. */
  candidate: OrganizerEventSummary | null;
  candidatePendingClaims: number | null;
  queue: ReviewQueue | null;
  services: ServiceChecks | null;
};

/**
 * Who is signed in, and what waits for them, read only on a device that has
 * signed in before (#581). Re-read when the page comes back and when the
 * connection returns, like the overlay; no timers.
 */
function useReaderAccount(eventId: string) {
  const [account, setAccount] = useState<Account | null>(null);
  const sequence = useRef({ value: 0 });
  const refresh = useCallback(async () => {
    if (!wasSignedIn()) { setAccount(null); return; }
    const request = ++sequence.current.value;
    const session = await readReaderSession();
    if (request !== sequence.current.value) return;
    if (!session) { setAccount(null); return; }
    const [claims, events, queue, services] = await Promise.all([
      readReaderClaims(eventId),
      session.hasOrganizerAccess ? readReaderWorkspaces() : null,
      session.isAdmin ? readReaderReviewQueue() : null,
      session.isAdmin ? readReaderServices() : null,
    ]);
    const candidate = (events ?? []).filter((item) => item.eventId === eventId && item.role !== "admin")
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    const organizerQueue = candidate ? await readReaderWorkspaceClaims(candidate.id) : null;
    if (request !== sequence.current.value) return;
    setAccount({
      session, claims, candidate, queue, services,
      candidatePendingClaims: organizerQueue ? organizerQueue.pendingClaimCount ?? organizerQueue.claims.length : null,
    });
  }, [eventId]);
  useEffect(() => {
    const requests = sequence.current;
    let active = true;
    queueMicrotask(() => { if (active) void refresh(); });
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const online = () => void refresh();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", online);
    return () => {
      active = false;
      ++requests.value;
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", online);
    };
  }, [refresh]);
  return account;
}

function useOnline() {
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

type ServiceLight = "ok" | "stale" | "never" | "down";
function serviceLight(services: ServiceChecks | null, now: number): ServiceLight {
  if (!services || services.checkedAt === null) return "never";
  if ([services.mail, services.publication].some((check) => check?.status === "unavailable")) return "down";
  return now - services.checkedAt > SERVICE_CHECK_FRESH_MS ? "stale" : "ok";
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
export default function ReaderAccountMenu({ event, textScale, onTextScale, onCheckOffline, className }: {
  event: EventDefinition;
  textScale?: TextScale;
  onTextScale?: (next: TextScale) => void;
  onCheckOffline?: () => void;
  className?: string;
}) {
  const t = useMessages(MESSAGES);
  const { locale } = useLocale();
  const planning = useReaderPlanning();
  const publication = useCircleCatalog(event.id);
  const account = useReaderAccount(event.id);
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [now] = useState(() => Date.now());
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
      if (key.key !== "Escape" || inDialog(key.target) || document.querySelector("[aria-modal='true']")) return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const session = account?.session ?? null;
  const favorites = planning.document.favorites.filter((item) => item.eventId === event.id);
  const plans = planning.document.visitPlans.filter((item) => item.eventId === event.id);
  const claims = (account?.claims ?? []).filter((claim) => claim.status !== "withdrawn");
  const queue = account?.queue ?? null;
  const queueTotal = queue ? (queue.pendingClaimCount ?? queue.claims.length) + queue.organizer.applications + queue.organizer.submissions : 0;
  const light = session?.isAdmin ? serviceLight(account?.services ?? null, now) : null;
  const catalog = publication.catalog;

  // Red: something is broken. Amber: something the reader should do. Blue: work is waiting.
  const dot = planning.storageError || light === "down" ? "bad"
    : !online || claims.some((claim) => claim.status === "rejected") ? "warn"
    : queueTotal > 0 || (account?.candidatePendingClaims ?? 0) > 0 ? "info" : null;
  const label = session ? t("openSignedIn", { email: session.email }) : t("open");
  const circleHref = (circleId?: string) => localizedHref(`/circle?${new URLSearchParams({ event: event.id, ...(circleId ? { circle: circleId } : {}) })}`, locale);

  return <div ref={root} className={`${styles.menu} ${className ?? ""}`} data-reader-menu>
    {/* Beside the button where there is room: the two states that change what the reader can rely on. */}
    {(planning.storageError || !online) && <span className={planning.storageError ? `${styles.badge} ${styles.badgeBad}` : styles.badge} role="status">{planning.storageError ? t("storageFailed") : t("offline")}</span>}
    <button ref={trigger} type="button" className={styles.trigger} aria-expanded={open} aria-controls={panelId} aria-label={dot === "bad" ? `${label}（${t("alert")}）` : dot === "warn" ? `${label}（${t("attention")}）` : label} onClick={() => setOpen(!open)}>
      <span className={session ? styles.avatar : `${styles.avatar} ${styles.anonymous}`} aria-hidden="true">{session ? session.email.slice(0, 1).toUpperCase() : <UiIcon name="user" />}</span>
      {dot && <i className={`${styles.dot} ${styles[dot]}`} aria-hidden="true" />}
    </button>
    <div id={panelId} className={styles.panel} hidden={!open}>
      {queue && <Section title={t("pending")}>
        <Row label={t("claimsQueue")}>{queue.pendingClaimCount ?? queue.claims.length}</Row>
        <Row label={t("applications")}>{queue.organizer.applications}</Row>
        <Row label={t("submissions")}>{queue.organizer.submissions}</Row>
        {light && <Row label={t("services")} tone={light === "ok" ? "ok" : light === "down" ? "bad" : "muted"}>
          {light === "ok" ? t("servicesOk") : light === "down" ? t("servicesDown") : light === "never" ? t("servicesNever") : t("servicesStale", { date: shortDate(account!.services!.checkedAt!, locale) })}
        </Row>}
        <a className={styles.link} href="/admin">{t("toAdmin")}</a>
      </Section>}
      {account?.candidate && <Section title={t("myEvent")}>
        <Row label={account.candidate.tentativeName}>{t(account.candidate.status)}</Row>
        {account.candidatePendingClaims !== null && <Row label={t("pendingClaims", { count: account.candidatePendingClaims })} />}
        <a className={styles.link} href={`/organizer?${new URLSearchParams({ candidate: account.candidate.id })}`}>{t("editEvent")}</a>
      </Section>}
      {session && account?.claims && <Section title={t("myCircles")}>
        {claims.map((claim) => {
          const circle = catalog.circlesById.get(claim.circleId);
          const placements = catalog.placements.filter((placement) => placement.circleId === claim.circleId && placement.status === "active");
          const first = placements[0];
          return <div key={claim.id} className={styles.claim}>
            <Row label={<b>{claim.circleName}</b>} tone={claim.status === "verified" ? "ok" : claim.status === "rejected" ? "warn" : "muted"}>
              {claim.status === "verified" ? t("verified") : claim.status === "pending" ? t("reviewing") : claim.status === "rejected" ? t("rejected") : t("revoked")}
            </Row>
            {claim.status === "verified" && <>
              <small>{placements.length ? t("booth", { codes: [...new Set(placements.map((placement) => placement.boothCode))].join("、") }) : t("notHere")}{circle ? ` · ${circle.media.some((media) => media.kind === "catalog") ? t("catalogLive") : t("catalogNone")}` : ""}</small>
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
      <Section title={t("device")}>
        <Row label={t("favorites")}>{t("favoriteCount", { count: favorites.length, groups: planning.document.favoriteGroups.length })}</Row>
        <Row label={t("plans")}>{t("planCount", { count: plans.length, visited: plans.filter((plan) => plan.status === "visited").length })}</Row>
        <Row label={t("storage")} tone={planning.storageError ? "bad" : "ok"}>{planning.storageError ? t("storageFailed") : t("stored")}</Row>
        <div className={styles.tool}><PlanningTools eventId={event.id} /></div>
      </Section>
      <Section title={t("data")}>
        <Row label={t("updated")}>{event.dataLastUpdatedLabel}</Row>
        <Row label={t("connection")} tone={online ? "ok" : "warn"}>{online ? t("online") : t("offline")}</Row>
        {onCheckOffline && <Row label={t("offlineUse")}><button type="button" className={styles.inline} onClick={() => { setOpen(false); onCheckOffline(); }}>{t("check")}</button></Row>}
      </Section>
      <Section title={t("display")}>
        {textScale && onTextScale && <div className={styles.row}><span>{t("textScale")}</span>
          <span className={styles.scale} role="group" aria-label={t("textScaleGroup")}>{(["standard", "large", "extra"] as const).map((value, index) => <button key={value} type="button" aria-pressed={textScale === value} aria-label={index === 0 ? t("smallLabel") : index === 1 ? t("mediumLabel") : t("largeLabel")} onClick={() => onTextScale(value)}>{index === 0 ? t("small") : index === 1 ? t("medium") : t("large")}</button>)}</span>
        </div>}
        <div className={styles.row}><span>{t("language")}</span><LanguageSwitcher /></div>
        <div className={styles.tool}><ReaderHelp eventId={event.id} dataLastUpdatedLabel={event.dataLastUpdatedLabel} inline /></div>
      </Section>
      {session ? <Section title={t("account")}>
        <Row label={session.email}>{session.expiresAt ? t("until", { date: shortDate(session.expiresAt, locale) }) : undefined}</Row>
        <div className={styles.actions}>
          <a href={circleHref()}>{t("circleWorkspace")}</a>
          {session.hasOrganizerAccess && <a href="/organizer">{t("toOrganizer")}</a>}
          {session.isAdmin && <a href="/admin">{t("admin")}</a>}
        </div>
        {/* Signing out is a write; the reader carries none, so it happens in the workspace. */}
        <small>{t("signOutHint")}</small>
      </Section> : <a className={styles.signIn} href={localizedHref(publicLoginHref({ eventId: event.id }), locale)}>{t("signIn")}</a>}
    </div>
  </div>;
}
