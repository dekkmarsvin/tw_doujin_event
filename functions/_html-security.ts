/** Origin CSP for HTML only. Cloudflare adds this nonce to its JSD scripts
 * after Pages Functions runs. Never nonce arbitrary HTML script elements. */
export function htmlPolicy(pathname: string, nonce?: string): string {
  const turnstile = pathname.startsWith("/circle") || pathname.startsWith("/organizer");
  return [
    "default-src 'self'", "base-uri 'self'", "connect-src 'self'",
    "font-src 'self' data:", "form-action 'self'", "frame-ancestors 'none'",
    ...(turnstile ? ["frame-src https://challenges.cloudflare.com"] : []),
    "img-src 'self' data: https:", "manifest-src 'self'", "object-src 'none'",
    `script-src 'self' https://static.cloudflareinsights.com${turnstile ? " https://challenges.cloudflare.com" : ""}${nonce ? ` 'nonce-${nonce}'` : ""}`,
    "style-src 'self' 'unsafe-inline'", "worker-src 'self'", "upgrade-insecure-requests",
  ].join("; ");
}

export function isHtmlRoute(pathname: string): boolean {
  return ["/", "/index.html", "/404.html"].includes(pathname)
    || ["/circle", "/organizer", "/admin", "/privacy", "/events/", "/s/"].some(prefix => pathname.startsWith(prefix));
}

export function unconditionalHtmlRequest(request: Request): Request {
  const headers = new Headers(request.headers);
  // A 304 could combine an old body with a fresh CSP nonce. Range responses
  // likewise are not complete documents and cannot establish a fresh policy.
  for (const name of ["if-none-match", "if-modified-since", "if-range", "range"]) headers.delete(name);
  return new Request(request, { headers });
}

export function secureHtmlResponse(response: Response, pathname: string): Response {
  if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html")) return response;
  if (response.status >= 300 && response.status < 400) return response;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = btoa(String.fromCharCode(...bytes));
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", htmlPolicy(pathname, nonce));
  headers.set("cache-control", "private, no-store");
  headers.set("cdn-cache-control", "no-store");
  headers.set("cloudflare-cdn-cache-control", "no-store");
  headers.delete("etag");
  headers.delete("last-modified");
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=()");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  if (["/circle", "/organizer", "/admin"].some(prefix => pathname.startsWith(prefix))) {
    headers.set("x-robots-tag", "noindex, nofollow");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
