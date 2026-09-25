// Both the journey and its interruption cleanup must satisfy the real mutation
// gate, including requests without a body. Redirects must never forward secrets.
export function previewRequestInit(baseUrl, { method = "GET", body, cookie, e2eToken, accessHeaders = {} } = {}) {
  return {
    method, redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: {
      ...accessHeaders,
      ...(method === "GET" || method === "HEAD" ? {} : { origin: new URL(baseUrl).origin, "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...(e2eToken ? { "x-preview-e2e-token": e2eToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
