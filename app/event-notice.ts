import { isHttpsUrl } from "./site-settings";

export const EVENT_NOTICE_TEXT_MAX = 200;
export const EVENT_NOTICE_URL_MAX = 500;
export type EventNoticeKind = "info" | "important";
export type EventNotice = { kind: EventNoticeKind; text: string; url?: string; updatedAt: string };
export type EventNoticeInput = { kind: EventNoticeKind; text: string; url: string };

export function eventNoticeInputProblem(value: unknown): string | null {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (body.kind !== "info" && body.kind !== "important") return "請選擇公告類型。";
  if (typeof body.text !== "string" || !body.text.trim()) return "請填寫公告說明。";
  if (body.text.trim().length > EVENT_NOTICE_TEXT_MAX) return "說明最多 200 字。";
  if (typeof body.url !== "string") return "連結必須是 https:// 開頭的網址。";
  const url = body.url.trim();
  if (url.length > EVENT_NOTICE_URL_MAX) return "連結最多 500 字。";
  if (url && !isHttpsUrl(url)) return "連結必須是 https:// 開頭的網址。";
  return null;
}

export function parseEventNoticeInput(value: unknown): EventNoticeInput | null {
  if (eventNoticeInputProblem(value)) return null;
  const body = value as EventNoticeInput;
  return { kind: body.kind, text: body.text.trim(), url: body.url.trim() };
}

export function parseEventNotice(value: unknown): EventNotice | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const input = parseEventNoticeInput({ ...body, url: body.url === undefined ? "" : body.url });
  if (!input || typeof body.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(body.updatedAt) || !Number.isFinite(Date.parse(body.updatedAt))) return null;
  return { kind: input.kind, text: input.text, ...(input.url ? { url: input.url } : {}), updatedAt: body.updatedAt };
}
