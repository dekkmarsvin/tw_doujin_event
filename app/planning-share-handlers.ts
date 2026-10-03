import type { EventDefinition } from "./event-catalog";
import { parseShareSnapshot, type ShareSnapshot } from "./planning-share-snapshot";
import { peppered, randomToken } from "./portal-crypto";
import { SHARE_IMAGE } from "./seo";
import { escapeHtml, metadataHtml } from "./static-discovery";
import type { createPlanningShareRepository } from "../db/planning-share-repository";

const BODY_LIMIT = 64 * 1024;
const SHARE_LIFETIME_AFTER_EVENT = 30 * 24 * 60 * 60 * 1000;
// 16 random bytes encode to 22 base64url characters (the final four bits are zero).
const validId = (id: string) => id.length === 22 && /^[A-Za-z0-9_-]{21}[AQgw]$/.test(id);
const json = (body: unknown, status: number, cache = "no-store") => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
});

async function boundedJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > BODY_LIMIT || !request.body) throw new Error("Invalid body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) throw new Error("Body too large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function html(title: string, content: string, status: number, head = "") {
  return new Response(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><meta name="robots" content="noindex">${head}</head><body><main>${content}</main></body></html>`, {
    status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex" },
  });
}

export function createPlanningShareHandlers({ repository, publishedEvent, hashPepper, now = Date.now }: {
  repository: ReturnType<typeof createPlanningShareRepository>;
  publishedEvent: (eventId: string) => Promise<EventDefinition | null>;
  hashPepper: () => string;
  now?: () => number;
}) {
  async function read(shareId: string) {
    if (!validId(shareId)) return null;
    return repository.get(shareId);
  }
  return {
    async create(request: Request) {
      const origin = new URL(request.url).origin;
      if (request.headers.get("origin") !== origin) return json({ error: "來源不符，請重新整理後再試。" }, 403);
      if ((request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json") {
        return json({ error: "請求格式無效。" }, 415);
      }
      let value: unknown;
      try { value = await boundedJson(request); }
      catch { return json({ error: "分享清單格式無效或超過大小限制。" }, 400); }
      const eventId = typeof value === "object" && value !== null && "eventId" in value ? value.eventId : null;
      const event = typeof eventId === "string" ? await publishedEvent(eventId) : null;
      const parsed = parseShareSnapshot(value, id => event?.id === id ? event : null);
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      const expiresAt = Date.parse(event!.eventEndsAt) + SHARE_LIFETIME_AFTER_EVENT;
      const createdAt = now();
      if (expiresAt <= createdAt) return json({ error: "活動的分享期限已結束。" }, 400);
      const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "";
      const ipHash = address ? await peppered(hashPepper(), address) : null;
      const shareId = randomToken(16);
      if (!await repository.create(shareId, parsed.snapshot, createdAt, expiresAt, ipHash)) {
        return json({ error: "建立分享清單太頻繁，請稍後再試。" }, 429);
      }
      return json({ shareId, url: `${origin}/s/${shareId}`, expiresAt }, 201);
    },
    async get(shareId: string) {
      const row = await read(shareId);
      if (!row) return json({ error: "找不到分享清單。" }, 404);
      if (row.expires_at <= now()) return json({ error: "這份清單已過期。", eventId: row.event_id }, 410);
      const snapshot: ShareSnapshot = { version: 1, eventId: row.event_id, items: JSON.parse(row.items_json) };
      // Never cache a live response beyond its remaining lifetime.
      const maxAge = Math.min(60, Math.floor((row.expires_at - now()) / 1000));
      return json({ snapshot, expiresAt: row.expires_at }, 200, `private, max-age=${Math.max(0, maxAge)}`);
    },
    async page(request: Request, shareId: string) {
      const row = await read(shareId);
      if (!row) return html("找不到分享清單｜場刊 Map", '<h1>找不到分享清單。</h1><a href="/">返回場刊 Map</a>', 404);
      const eventLink = `/?${new URLSearchParams({ event: row.event_id })}`;
      if (row.expires_at <= now()) return html("清單已過期｜場刊 Map", `<h1>這份清單已過期。</h1><a href="${escapeHtml(eventLink)}">返回活動</a>`, 410);
      const event = await publishedEvent(row.event_id);
      if (!event) return html("找不到活動｜場刊 Map", '<h1>找不到活動。</h1><a href="/">返回場刊 Map</a>', 404);
      const items: ShareSnapshot["items"] = JSON.parse(row.items_json);
      const title = `${event.name} 逛攤清單｜場刊 Map`;
      const description = `分享了 ${items.length} 個想逛的社團，開啟清單查看並加入自己的行程。`;
      const target = `/?${new URLSearchParams({ event: row.event_id, share: shareId })}`;
      const metadata = metadataHtml({ title, description, canonical: `${new URL(request.url).origin}/s/${shareId}`, image: SHARE_IMAGE });
      // html() already supplies title; metadataHtml also supplies it for normal pages.
      return html(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><a href="${escapeHtml(target)}">開啟清單</a>`, 200,
        metadata.replace(/<title>[\s\S]*?<\/title>\s*/, "") + `<meta http-equiv="refresh" content="${escapeHtml(`0;url=${target}`)}">`);
    },
  };
}
