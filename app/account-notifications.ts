import { formatTaipeiTime, renderLetter } from "./mail-letter";

export type AccountNotificationCadence = "off" | "hourly" | "daily";
export type AccountNotificationPreferences = { cadence: AccountNotificationCadence; version: number };
export type AccountNotificationKind = "claim.approved" | "claim.rejected" | "claim.revoked" |
  "circle.updated" | "circle.takendown" | "application.approved" | "application.rejected" |
  "member.granted" | "member.revoked" | "review.approved" | "review.changes_requested" |
  "publication.published" | "publication.failed";
export type AccountNotificationConfig = { enabled: boolean; since: number };
export type NotificationItem = {
  id: string; account_id: string; kind: AccountNotificationKind; occurrence: string;
  event_id: string | null; circle_id: string | null; candidate_id: string | null;
  source_id: string; audience: "claimant" | "circle_owner" | "applicant" | "owner" | "member";
  name: string; version: number | null; detail: string; occurred_at: number;
};

/** Both control-plane and scheduled producers must use the same rollout epoch. */
export function accountNotificationConfig(env: { ACCOUNT_NOTIFICATIONS_ENABLED?: string; ACCOUNT_NOTIFICATIONS_SINCE?: string }): AccountNotificationConfig {
  const since = Date.parse(env.ACCOUNT_NOTIFICATIONS_SINCE ?? "");
  return { enabled: env.ACCOUNT_NOTIFICATIONS_ENABLED === "true" && Number.isFinite(since), since: Number.isFinite(since) ? since : 0 };
}

export function isAccountNotificationCadence(value: unknown): value is AccountNotificationCadence {
  return value === "off" || value === "hourly" || value === "daily";
}

const descriptions: Record<AccountNotificationKind, { title: string; text: string; action: string }> = {
  "claim.approved": { title: "認領通過", text: "你的認領已通過。請登入查看目前狀態及可管理的補充資料。", action: "管理社團資料" },
  "claim.rejected": { title: "認領未通過", text: "這次認領未通過。", action: "查看認領狀態" },
  "claim.revoked": { title: "認領已撤銷", text: "你的認領曾於以下時間被撤銷。請登入查看目前認領狀態；如需協助，請聯絡網站管理者。", action: "查看認領狀態" },
  "circle.updated": { title: "補充資料已更新", text: "你的社團補充資料有更新。", action: "查看社團資料" },
  "circle.takendown": { title: "補充資料已撤下", text: "網站管理者已處理這筆補充資料。請登入查看目前狀態；如需協助，請聯絡網站管理者。", action: "查看社團資料" },
  "application.approved": { title: "活動建置申請通過", text: "你的申請已通過，可以開始建置活動。活動內容仍須送審後發布。", action: "查看申請結果" },
  "application.rejected": { title: "活動建置申請未通過", text: "你的活動建置申請未通過。", action: "查看申請結果" },
  "member.granted": { title: "工作區權限已更新", text: "此工作區有成員取得權限。", action: "查看工作區" },
  "member.revoked": { title: "工作區權限已移除", text: "此工作區有成員的權限被移除。", action: "查看工作區" },
  "review.approved": { title: "審核通過", text: "這一版內容已通過審核，請查看發布進度。只有發布完成才會公開。", action: "查看發布進度" },
  "review.changes_requested": { title: "需要修正", text: "這一版內容已退回修正，請查看需要處理的項目。", action: "查看修正項目" },
  "publication.published": { title: "活動已公開", text: "這一版內容已完成發布。", action: "查看公開活動" },
  "publication.failed": { title: "發布未完成", text: "這次發布未完成，請查看處理方式。已公開的舊版內容不因此撤下。", action: "查看發布狀態" },
};

export function notificationDestination(item: NotificationItem, origin: string) {
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
  return url.href;
}

export function accountNotificationLetter(origin: string, items: NotificationItem[]) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.pathname !== "/" || base.search || base.hash || base.username || base.password) throw new Error("Invalid notification origin.");
  if (!items.length) throw new Error("Empty notification.");
  const first = items[0];
  const digest = first.kind === "circle.updated";
  const description = descriptions[first.kind];
  const ownMember = first.audience === "member";
  const title = ownMember ? first.kind === "member.revoked" ? "你的工作區權限曾被移除" : "你的工作區權限已更新" : description.title;
  const settings = new URL(first.candidate_id || first.kind.startsWith("application.") ? "/organizer" : "/circle", base);
  settings.searchParams.set("notifications", "1");
  const grouped = new Map<string, NotificationItem>();
  for (const item of items) {
    const key = `${item.event_id}:${item.circle_id}`, previous = grouped.get(key);
    grouped.set(key, { ...item, detail: [...new Set([...(previous?.detail.split("、") ?? []), ...item.detail.split("、")].filter(Boolean))].join("、") });
  }
  const summary = [...grouped.values()];
  return renderLetter({
    kind: digest ? "general" : "system", origin: base.origin,
    subject: digest ? `場刊 Map｜${summary.length} 個社團的補充資料更新` : `場刊 Map｜${first.name} ${title}`,
    preheader: digest ? "查看這段時間的社團補充資料更新。" : title,
    category: digest ? "內容更新摘要" : "審核與權限通知", stamp: formatTaipeiTime(first.occurred_at), title: digest ? "社團補充資料更新" : title,
    paragraphs: digest ? [] : [ownMember ? "你的權限於以下時間發生異動。如需協助，請聯絡網站管理者。" : description.text],
    facts: digest ? summary.map(item => ({ label: `${item.name}（${item.event_id}）`, value: item.detail || "補充資料", href: notificationDestination(item, base.origin) })) : [
      { label: first.circle_id ? "社團" : "活動", value: first.name },
      ...(first.event_id ? [{ label: "活動代碼", value: first.event_id }] : []),
      ...(first.version ? [{ label: "內容版本", value: `第 ${first.version} 版` }] : []),
      { label: "異動時間", value: formatTaipeiTime(first.occurred_at) },
    ],
    ...(!digest && !(ownMember && first.kind === "member.revoked") ? { action: { label: description.action, href: notificationDestination(first, base.origin) } } : {}),
    footerLink: { label: "通知設定", href: settings.href },
  });
}
