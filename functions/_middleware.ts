/**
 * Shared request gate for every portal route.
 *
 * CSRF needs no token table here. A cross-site HTML form cannot send
 * `content-type: application/json`, and a cross-origin `fetch` that does gets
 * preflighted — a preflight we never answer. Combined with the `SameSite=Lax`
 * session cookie, requiring both a same-origin `Origin` header and a JSON body
 * closes the hole without any per-request state.
 */

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

  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin !== url.origin) return json({ error: "來源不符，請重新整理後再試。" }, 403);

    const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const thumbnailUpload = request.method === "POST"
      && /^\/api\/circle\/[^/]+\/thumbnail$/.test(url.pathname)
      && contentType === "multipart/form-data";
    if (contentType !== "application/json" && !thumbnailUpload) return json({ error: "請求格式無效。" }, 415);
  }

  const response = await context.next();

  // The public overlay sets its own cacheable headers; everything else under
  // /api/ carries identity and must never be stored by a cache or the worker.
  if (url.pathname.startsWith("/api/")) {
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    headers.set("x-content-type-options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  }
  return response;
};
