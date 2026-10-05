import { formatTaipeiTime, renderLetter } from "./mail-letter";
import type { Locale } from "./i18n/locale";

export type AccountNotificationCadence = "off" | "hourly" | "daily";
export type AccountNotificationPreferences = { cadence: AccountNotificationCadence; version: number; locale: Locale | null };
export type AccountNotificationKind = "claim.approved" | "claim.rejected" | "claim.revoked" |
  "circle.updated" | "circle.takendown" | "application.approved" | "application.rejected" |
  "member.granted" | "member.revoked" | "review.approved" | "review.changes_requested" |
  "publication.published" | "publication.failed";
export type NotificationItem = {
  id: string; account_id: string; kind: AccountNotificationKind; occurrence: string;
  event_id: string | null; circle_id: string | null; candidate_id: string | null;
  source_id: string; audience: "claimant" | "circle_owner" | "applicant" | "owner" | "member";
  name: string; version: number | null; detail: string; occurred_at: number;
  /** Workspace edition, read at delivery; version is the save counter for staleness. */
  edition?: number | null;
};

export function isAccountNotificationCadence(value: unknown): value is AccountNotificationCadence {
  return value === "off" || value === "hourly" || value === "daily";
}

const descriptions: Record<AccountNotificationKind, { title: string; text: string; action: string }> = {
  "claim.approved": { title: "認領通過", text: "你的認領已通過。請登入查看目前狀態及可管理的補充資料。", action: "管理社團資料" },
  "claim.rejected": { title: "認領未通過", text: "這次認領未通過。", action: "查看認領狀態" },
  "claim.revoked": { title: "認領已撤銷", text: "你的認領曾於以下時間被撤銷。撤銷會移除該次認領的管理權限，相關補充資料將停止公開。請登入查看目前認領狀態；如需協助，請聯絡網站管理者。", action: "查看認領狀態" },
  "circle.updated": { title: "補充資料已更新", text: "你的社團補充資料有更新。", action: "查看社團資料" },
  "circle.takendown": { title: "補充資料撤下通知", text: "網站管理者已對這筆補充資料作撤下處理。請登入查看目前狀態；如需協助，請聯絡網站管理者。", action: "查看社團資料" },
  "application.approved": { title: "活動建置申請通過", text: "這次申請已核准建置。請查看目前申請結果與可使用的工作區；活動內容仍須送審後發布。", action: "查看申請結果" },
  "application.rejected": { title: "活動建置申請未通過", text: "你的活動建置申請未通過。", action: "查看申請結果" },
  "member.granted": { title: "工作區權限已更新", text: "此工作區有成員取得權限。", action: "查看工作區" },
  "member.revoked": { title: "工作區權限已移除", text: "此工作區有成員的權限被移除。", action: "查看工作區" },
  "review.approved": { title: "審核通過", text: "這一版內容已通過審核，請查看發布進度。只有發布完成才會公開。", action: "查看發布進度" },
  "review.changes_requested": { title: "需要修正", text: "這一版內容已退回修正，請查看需要處理的項目。", action: "查看修正項目" },
  "publication.published": { title: "活動已公開", text: "這一版內容已完成發布。", action: "查看公開活動" },
  "publication.failed": { title: "發布未完成", text: "這次發布未完成，請查看處理方式。已公開的舊版內容不因此撤下。", action: "查看發布狀態" },
};

type CircleNotificationKind = "claim.approved" | "claim.rejected" | "claim.revoked" | "circle.updated" | "circle.takendown";
const circleDescriptions: Record<Exclude<Locale, "zh-Hant">, Record<CircleNotificationKind, { title: string; text: string; action: string }>> = {
  en: {
    "claim.approved": { title: "Circle claim approved", text: "Your circle claim has been approved. Sign in to view its current status and manage your circle details.", action: "Manage circle details" },
    "claim.rejected": { title: "Circle claim rejected", text: "This circle claim was rejected.", action: "View claim status" },
    "claim.revoked": { title: "Circle claim revoked", text: "Your circle claim was revoked at the time below. Revocation removes management access for that claim and stops publishing the associated circle details. Sign in to view your current claim status. Contact the site administrator if you need help.", action: "View claim status" },
    "circle.updated": { title: "Circle details updated", text: "Your circle details have been updated.", action: "View circle details" },
    "circle.takendown": { title: "Circle details taken down", text: "The site administrator has taken down these circle details. Sign in to view their current status. Contact the site administrator if you need help.", action: "View circle details" },
  },
  ja: {
    "claim.approved": { title: "管理申請が承認されました", text: "サークル情報の管理申請が承認されました。ログインして現在の状態を確認し、サークル補足情報を管理できます。", action: "サークル情報を管理する" },
    "claim.rejected": { title: "管理申請が承認されませんでした", text: "今回のサークル情報の管理申請は承認されませんでした。", action: "申請状況を確認する" },
    "claim.revoked": { title: "管理権限が取り消されました", text: "サークル情報の管理権限は以下の日時に取り消されました。この申請による管理権限は失われ、関連するサークル補足情報は公開されなくなります。ログインして現在の申請状況を確認してください。お困りの場合はサイト管理者にお問い合わせください。", action: "申請状況を確認する" },
    "circle.updated": { title: "サークル補足情報が更新されました", text: "サークル補足情報が更新されました。", action: "サークル情報を見る" },
    "circle.takendown": { title: "サークル補足情報の公開停止", text: "サイト管理者がこのサークル補足情報を公開停止にしました。ログインして現在の状態を確認してください。お困りの場合はサイト管理者にお問い合わせください。", action: "サークル情報を見る" },
  },
};
const detailTokens: Record<Exclude<Locale, "zh-Hant">, Record<string, string>> = {
  en: { 補充資料: "Circle details", 品書: "Item list", 恢復公開: "Publication restored", 保存設定: "Retention settings", 代表圖片: "Featured image", 補充資料已刪除: "Circle details deleted", 活動結束後的公開設定: "Post-event visibility" },
  ja: { 補充資料: "サークル補足情報", 品書: "お品書き", 恢復公開: "公開再開", 保存設定: "保存設定", 代表圖片: "代表画像", 補充資料已刪除: "補足情報を削除", 活動結束後的公開設定: "イベント終了後の公開設定" },
};

export function notificationDestination(item: NotificationItem, origin: string, locale?: Locale) {
  const url = new URL(item.candidate_id || item.kind.startsWith("application.") ? "/organizer" : "/circle", origin);
  if (item.kind === "publication.published" && item.event_id) return new URL(`/events/${encodeURIComponent(item.event_id)}/`, origin).href;
  if (item.candidate_id) {
    url.searchParams.set("candidate", item.candidate_id);
    url.searchParams.set("section", "review");
  }
  if (item.kind.startsWith("application.")) url.searchParams.set("application", item.source_id);
  if (url.pathname === "/circle") {
    if (item.event_id) url.searchParams.set("event", item.event_id);
    if (item.circle_id) url.searchParams.set("circle", item.circle_id);
  }
  if (locale) url.searchParams.set("lang", locale);
  return url.href;
}

export function accountNotificationLetter(origin: string, items: NotificationItem[], recipientLocale: Locale = "zh-Hant") {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.pathname !== "/" || base.search || base.hash || base.username || base.password) throw new Error("Invalid notification origin.");
  if (!items.length) throw new Error("Empty notification.");
  const first = items[0];
  const circle = first.kind.startsWith("claim.") || first.kind.startsWith("circle.");
  const locale = circle ? recipientLocale : "zh-Hant";
  const digest = first.kind === "circle.updated";
  const description = locale === "zh-Hant" ? descriptions[first.kind] : circleDescriptions[locale][first.kind as CircleNotificationKind];
  const copy = {
    "zh-Hant": { circle: "社團", event: "活動", eventId: "活動代碼", time: "異動時間", settings: "通知設定", details: "補充資料", category: "審核與權限通知", digestCategory: "內容更新摘要", digestTitle: "社團補充資料更新", preheader: "查看這段時間的社團補充資料更新。", zone: "" },
    en: { circle: "Circle", event: "Event", eventId: "Event ID", time: "Changed at (Taiwan time, UTC+8)", settings: "Notification settings", details: "Circle details", category: "Review and access notice", digestCategory: "Content update digest", digestTitle: "Circle details updates", preheader: "View circle details updated during this period.", zone: " Taiwan time (UTC+8)" },
    ja: { circle: "サークル", event: "イベント", eventId: "イベントID", time: "変更日時（台湾時間 UTC+8）", settings: "通知設定", details: "サークル補足情報", category: "審査・権限のお知らせ", digestCategory: "更新内容のまとめ", digestTitle: "サークル補足情報の更新", preheader: "この期間に更新されたサークル補足情報を確認できます。", zone: " 台湾時間 UTC+8" },
  }[locale];
  const ownMember = first.audience === "member";
  const title = ownMember ? first.kind === "member.revoked" ? "你的工作區權限曾被移除" : "你的工作區權限已更新" : description.title;
  const settings = new URL(first.candidate_id || first.kind.startsWith("application.") ? "/organizer" : "/circle", base);
  settings.searchParams.set("notifications", "1");
  if (circle) settings.searchParams.set("lang", locale);
  const grouped = new Map<string, NotificationItem>();
  for (const item of items) {
    const key = `${item.event_id}:${item.circle_id}`, previous = grouped.get(key);
    grouped.set(key, { ...item, detail: [...new Set([...(previous?.detail.split("、") ?? []), ...item.detail.split("、")].filter(Boolean))].join("、") });
  }
  const summary = [...grouped.values()];
  const detail = (value: string) => locale === "zh-Hant" ? value : value.split("、").map(token => Object.hasOwn(detailTokens[locale], token) ? detailTokens[locale][token] : token).join("、");
  const destination = (item: NotificationItem) => notificationDestination(item, base.origin, circle ? locale : undefined);
  return renderLetter({
    kind: digest ? "general" : "system", origin: base.origin, locale,
    subject: digest ? locale === "en" ? `場刊 Map｜Circle details updated for ${summary.length} circles` : locale === "ja" ? `場刊 Map｜${summary.length}サークルの補足情報更新` : `場刊 Map｜${summary.length} 個社團的補充資料更新` : `場刊 Map｜${first.name} ${title}`,
    preheader: digest ? copy.preheader : title,
    category: digest ? copy.digestCategory : copy.category, stamp: formatTaipeiTime(first.occurred_at) + copy.zone, title: digest ? copy.digestTitle : title,
    paragraphs: digest ? [] : [ownMember ? "你的權限於以下時間發生異動。如需協助，請聯絡網站管理者。" : description.text],
    facts: digest ? summary.map(item => ({ label: `${item.name}（${item.event_id}）`, value: detail(item.detail) || copy.details, href: destination(item) })) : [
      { label: first.circle_id ? copy.circle : copy.event, value: first.name },
      ...(first.event_id ? [{ label: copy.eventId, value: first.event_id }] : []),
      ...(first.edition ? [{ label: "內容版本", value: `第 ${first.edition} 版` }] : []),
      { label: copy.time, value: formatTaipeiTime(first.occurred_at) },
    ],
    ...(!digest && !(ownMember && first.kind === "member.revoked") ? { action: { label: description.action, href: destination(first) } } : {}),
    footerLink: { label: copy.settings, href: settings.href },
  });
}
