/**
 * The hourly service check (#580), run by the retention-purge Worker so an
 * admin learns about a broken service without pressing 「檢查服務」.
 *
 * It only reads: Mailgun's domain status, the public event index, and the
 * notification outbox. Results land in the same `site_service_check` row the
 * admin page shows. Mail goes out only when an item changes between normal and
 * abnormal, so a lasting outage sends one alert and one recovery.
 *
 * Like the purge it never creates schema: a database no Function has reached
 * yet has no row to write and nothing to check.
 */
import { checkMailService } from "../app/site-service-check";
import type { ServiceCheck } from "../app/site-settings";

/** Off the top of the hour, and never the daily purge's minute. */
export const SERVICE_CHECK_CRON = "47 * * * *";
const HOUR_MS = 60 * 60 * 1000;
export const ALERT_SENDER = "alerts@kotoban.top";

const ITEMS = ["mail", "reader", "notifications"] as const;
type Item = typeof ITEMS[number];
const LABELS: Record<Item, string> = { mail: "寄信服務", reader: "讀取服務", notifications: "通知寄送" };
const STATUS: Record<ServiceCheck["status"], string> = { available: "可用", unavailable: "不可用", unknown: "無法確認" };

/** What the row keeps between runs; never returned by the admin API. */
type AlertState = { down: Item[]; notificationFailures: number | null };
type Stored = Partial<Record<Item | "publication", ServiceCheck>> & { alert?: AlertState };

export type ScheduledCheckEnv = {
  MAILGUN_API_KEY?: string; MAILGUN_DOMAIN?: string;
  /** Public site the reader check reads; preview leaves it unset. */
  SITE_ORIGIN?: string;
  /** Names the environment in the alert subject. */
  ENVIRONMENT_NAME?: string;
};
export type AlertLetter = { subject: string; text: string };

const check = (status: ServiceCheck["status"], source: string, reason: string): ServiceCheck => ({ status, source, reason });

async function tableExists(db: D1Database, name: string) {
  return !!await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1").bind(name).first();
}

const isTimeout = (error: unknown) => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

/** Pages, the event-data Function and its R2 read in one request, as a reader makes it. */
export async function checkReaderService(origin: string | undefined, requestFetch = globalThis.fetch): Promise<ServiceCheck> {
  if (!origin) return check("unknown", "讀取設定", "此環境未設定公開網址。");
  try {
    const response = await requestFetch(new URL("/data/events/index.json", origin).href, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return check("unavailable", "活動資料", `公開網站回應 ${response.status}。`);
    try { await response.json(); } catch (error) {
      if (isTimeout(error)) throw error;
      return check("unavailable", "活動資料", "活動索引不是有效的資料。");
    }
    return check("available", "活動資料", "公開網站可讀取活動索引。");
  } catch (error) {
    // A slow answer is not a confirmed outage, so it is recorded without alerting.
    return isTimeout(error) ? check("unknown", "活動資料", "讀取逾時，無法確認。") : check("unavailable", "活動資料", "未取得回應。");
  }
}

export async function checkNotificationService(db: D1Database, now: number, previousFailures: number | null) {
  if (!await tableExists(db, "account_notification_items")) {
    return { result: check("available", "通知佇列", "沒有待寄通知。"), failures: 0 };
  }
  const row = await db.prepare(`SELECT MIN(CASE WHEN state = 'pending' THEN due_at END) AS oldest_due,
      COUNT(CASE WHEN state = 'failed' THEN 1 END) AS failures FROM account_notification_items`)
    .first<{ oldest_due: number | null; failures: number }>();
  const failures = row?.failures ?? 0;
  // Pages sends only after write requests, so a quiet site leaves due mail waiting.
  if (row?.oldest_due != null && row.oldest_due <= now - HOUR_MS) {
    return { result: check("unavailable", "通知佇列", "有通知超過 1 小時仍未寄出。"), failures };
  }
  if (previousFailures !== null && failures > previousFailures) {
    return { result: check("unavailable", "通知佇列", `上次檢查後有 ${failures - previousFailures} 則通知無法寄出。`), failures };
  }
  return { result: check("available", "通知佇列", "沒有逾時或新增失敗的通知。"), failures };
}

function letter(env: ScheduledCheckEnv, results: Record<Item, ServiceCheck>, failed: Item[], recovered: Item[], now: number): AlertLetter {
  const names = (items: Item[]) => items.map(item => LABELS[item]).join("、");
  const prefix = env.ENVIRONMENT_NAME ? `【${env.ENVIRONMENT_NAME}】` : "";
  const subject = failed.length
    ? `${prefix}服務異常：${names(failed)}${recovered.length ? `；已恢復：${names(recovered)}` : ""}`
    : `${prefix}服務已恢復：${names(recovered)}`;
  const time = new Date(now).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
  const lines = ITEMS.map(item => `${LABELS[item]}：${STATUS[results[item].status]}（${results[item].source}：${results[item].reason}）`);
  return { subject, text: [`檢查時間：${time}（台北時間）`, "", ...lines, "", "狀態再次改變前不會重複寄信。"].join("\n") };
}

/**
 * One check run. `sendAlert` is absent where no recipient is configured: the
 * result is still recorded, and nothing is sent. A failed send keeps the
 * previous alert state, so the next run tries the same message again.
 */
export async function runScheduledServiceCheck(input: {
  db: D1Database; env: ScheduledCheckEnv; now: number;
  fetch?: typeof globalThis.fetch; sendAlert?: (letter: AlertLetter) => Promise<unknown>;
}) {
  const { db, env, now } = input;
  if (!await tableExists(db, "site_service_check")) return { skipped: true as const };
  const row = await db.prepare("SELECT result_json FROM site_service_check WHERE id = 'global'").first<{ result_json: string | null }>();
  const stored: Stored = row?.result_json ? JSON.parse(row.result_json) : {};
  const previous: AlertState = { down: stored.alert?.down ?? [], notificationFailures: stored.alert?.notificationFailures ?? null };

  const [mail, reader, notifications] = await Promise.all([
    checkMailService(env, input.fetch), checkReaderService(env.SITE_ORIGIN, input.fetch),
    checkNotificationService(db, now, previous.notificationFailures),
  ]);
  const results: Record<Item, ServiceCheck> = { mail, reader, notifications: notifications.result };
  // `unknown` neither raises nor clears an alert: it says nothing new.
  const down = ITEMS.filter(item => results[item].status === "unavailable" || (results[item].status === "unknown" && previous.down.includes(item)));
  const failed = down.filter(item => !previous.down.includes(item));
  const recovered = previous.down.filter(item => !down.includes(item));

  let alerted = down;
  let alert: "none" | "sent" | "not_configured" | "failed" = "none";
  if (failed.length || recovered.length) {
    if (!input.sendAlert) alert = "not_configured";
    else {
      try { await input.sendAlert(letter(env, results, failed, recovered, now)); alert = "sent"; }
      catch (error) {
        alerted = previous.down; alert = "failed";
        // The error name only: a delivery message can quote the recipient.
        console.error(JSON.stringify({ event: "service_check.alert_failed", error: error instanceof Error ? error.name : "unknown" }));
      }
    }
  }

  // After a failed send the failure baseline stays too, so the same increase is seen, and sent, next hour.
  const patch = JSON.stringify({ ...results, alert: { down: alerted,
    notificationFailures: alert === "failed" ? previous.notificationFailures : notifications.failures } satisfies AlertState });
  // A waiting manual request keeps its NULL `checked_at` for the Pages check
  // to answer; the publication item is kept from the last manual check.
  await db.prepare(`INSERT INTO site_service_check (id, requested_at, checked_at, result_json) VALUES ('global', ?1, ?1, ?2)
    ON CONFLICT(id) DO UPDATE SET checked_at = CASE WHEN checked_at IS NULL THEN NULL ELSE ?1 END,
      result_json = json_patch(COALESCE(result_json, '{}'), ?2)`).bind(now, patch).run();
  return { skipped: false as const, statuses: Object.fromEntries(ITEMS.map(item => [item, results[item].status])), failed, recovered, alert };
}

/** RFC 5322 text mail for the Email Routing binding, UTF-8 throughout. */
export function alertMime(letter: AlertLetter, to: string, now: number) {
  const base64 = (text: string) => {
    let binary = "";
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  const body = base64(letter.text).replace(/.{1,76}/g, "$&\r\n");
  // RFC 2047 caps an encoded word at 75 characters: 12 code points of up to
  // 4 UTF-8 bytes each stay inside it, folded onto continuation lines.
  const chars = [...letter.subject];
  const words = Array.from({ length: Math.ceil(chars.length / 12) },
    (_, index) => `=?UTF-8?B?${base64(chars.slice(index * 12, index * 12 + 12).join(""))}?=`);
  return [
    `From: ${ALERT_SENDER}`, `To: ${to}`, `Subject: ${words.join("\r\n ")}`,
    `Date: ${new Date(now).toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@kotoban.top>`,
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body,
  ].join("\r\n");
}
