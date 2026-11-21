import { parseEventDefinition } from "../app/event-catalog";
import { homepageSummary } from "../app/static-discovery";
import { publishedEventDefinitions, readEventIndex } from "./_event-data";

/** The element `app/event-catalog.ts` reads the published events from. */
export const PUBLISHED_EVENTS_ELEMENT_ID = "published-events";

/**
 * Gives every HTML page the published events it is built around (#546).
 *
 * The list is a JSON data block, not a script: the page's modules read it
 * synchronously when they load, and a data block needs no CSP nonce. The
 * homepage also gets its summary, which crawlers and a slow first paint see
 * before the chooser script runs.
 */
export async function withPublishedEvents(env: Pick<PortalEnv, "EVENT_DATA">, pathname: string, response: Response): Promise<Response> {
  if (response.status !== 200 || !(response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html")) return response;
  let html = await response.text();
  // A page without scripts (the share redirect) has nothing to read the list.
  if (!html.includes("<script")) return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
  let definitions: ReturnType<typeof publishedEventDefinitions>;
  try {
    definitions = publishedEventDefinitions(await readEventIndex(env));
  } catch (error) {
    console.error(JSON.stringify({ event: "event_index.unavailable", message: error instanceof Error ? error.message : String(error) }));
    return new Response("<!doctype html><meta charset=\"utf-8\"><title>暫時無法使用</title><p>暫時無法載入活動資料，請稍後再試。</p>", {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8", "retry-after": "60" },
    });
  }
  const block = `<script type="application/json" id="${PUBLISHED_EVENTS_ELEMENT_ID}">${JSON.stringify(definitions).replace(/</g, "\\u003c")}</script>`;
  html = html.includes("</head>") ? html.replace("</head>", `${block}</head>`) : block + html;
  if (pathname === "/" || pathname === "/index.html") {
    const events = definitions.map(({ definition, references }) => parseEventDefinition(definition, references));
    html = html.replace('<div id="root"></div>', `<div id="root">${homepageSummary(events)}</div>`);
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
