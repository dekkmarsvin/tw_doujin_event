/**
 * Shared request gate for every portal route.
 *
 * CSRF needs no token table here. A cross-site HTML form cannot send
 * `content-type: application/json`, and a cross-origin `fetch` that does gets
 * preflighted — a preflight we never answer. Combined with the `SameSite=Lax`
 * session cookie, requiring both a same-origin `Origin` header and a JSON body
 * closes the hole without any per-request state.
 */

import { isHtmlRoute, secureHtmlResponse, unconditionalHtmlRequest } from "./_html-security";
import { applyCircleShareImage } from "./_circle-share-image";
import { withPublishedEvents } from "./_published-events-html";
import { afterWrite } from "./_after-write";
import { API_ERROR_CODES, type ApiErrorCode } from "../app/i18n/api-error-codes";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const onRequest: PagesFunction<PortalEnv> = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  const circleErrors = API_ERROR_CODES.origin_mismatch.endpoints.some(endpoint =>
    new RegExp(`^${endpoint.replace(/:[^/]+/g, "[^/]+")}$`).test(url.pathname));
  const errorCode = (code: ApiErrorCode) => circleErrors ? { code } : {};

  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin !== url.origin) return json({ error: "來源不符，請重新整理後再試。", ...errorCode("origin_mismatch") }, 403);

    const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const privateFileUpload = contentType === "multipart/form-data" && (
      (request.method === "POST"
        && /^\/api\/circle\/[^/]+\/(?:thumbnail|catalog-image)$/.test(url.pathname))
      // Replace-in-place, hence PUT: a candidate map has one layout plan, and
      // an event has one picture.
      || (request.method === "PUT"
        && (/^\/api\/organizer\/events\/[^/]+\/maps\/[^/]+\/background$/.test(url.pathname)
          || /^\/api\/organizer\/events\/[^/]+\/image$/.test(url.pathname)))
    );
    if (contentType !== "application/json" && !privateFileUpload) return json({ error: "請求格式無效。", ...errorCode("invalid_content_type") }, 415);
  }

  const html = SAFE_METHODS.has(request.method) && isHtmlRoute(url.pathname);
  const response = html ? await context.next(unconditionalHtmlRequest(request)) : await context.next();

  // Shares are anonymous snapshots with a bounded private cache. Other APIs
  // carry identity and must never be stored by a cache or the worker.
  if (url.pathname.startsWith("/api/")) {
    // A write may have queued notices or a service check; send them after the
    // response, the way the scheduled Worker used to each minute.
    if (!SAFE_METHODS.has(request.method) && response.status < 400) context.waitUntil?.(afterWrite(context.env, url.origin));
    const headers = new Headers(response.headers);
    if (!(request.method === "GET" && /^\/api\/shares\/[^/]+$/.test(url.pathname))) {
      headers.set("cache-control", "no-store");
    }
    headers.set("x-content-type-options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  }
  if (!html) return response;
  const shared = await applyCircleShareImage(context, response);
  return secureHtmlResponse(request.method === "GET" ? await withPublishedEvents(context.env, url.pathname, shared) : shared, url.pathname);
};
