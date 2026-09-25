export function normalizeCloudflareToken(token) {
  return token?.match(/Authorization: Bearer ([^"\s]+)/)?.[1] ?? token?.trim();
}
export function cloudflareApi({ accountId, token, fetchImpl = fetch }) {
  token = normalizeCloudflareToken(token);
  if (!/^[a-f0-9]{32}$/.test(accountId ?? "") || !token) throw new Error("Cloudflare account ID and token are required.");
  return async (suffix, { method = "GET", body } = {}) => {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/${suffix}`, {
      method, redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Cloudflare ${method} failed (HTTP ${response.status}).`);
    const result = await response.json();
    if (result.success !== true) throw new Error(`Cloudflare ${method} did not confirm success.`);
    return result.result;
  };
}
