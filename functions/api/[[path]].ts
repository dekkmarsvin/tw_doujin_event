import { authFor, guard, sharesFor } from "../_portal";

/**
 * Single router for the rewritten backend modules (#546 phase 5). Each rewritten
 * domain adds its routes here and deletes its old per-route function files;
 * until then, those more specific files still answer their own paths, since
 * Pages prefers them over this catch-all.
 */

type Context = Parameters<PagesFunction<PortalEnv>>[0];
type Route = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  handle: (context: Context, params: Record<string, string>) => Promise<Response>;
  /** Failures carry the machine-readable `code` the portal client localizes. */
  circleErrors?: boolean;
};

const routes: Route[] = [
  { method: "GET", path: "/api/auth/config", handle: async (context) => authFor(context).authConfig() },
  { method: "POST", path: "/api/auth/request-link", handle: (context) => authFor(context).requestLink(context.request), circleErrors: true },
  { method: "POST", path: "/api/auth/verify", handle: (context) => authFor(context).verify(context.request), circleErrors: true },
  { method: "GET", path: "/api/auth/session", handle: (context) => authFor(context).session(context.request), circleErrors: true },
  { method: "DELETE", path: "/api/auth/session", handle: (context) => authFor(context).signOut(context.request), circleErrors: true },
  { method: "DELETE", path: "/api/account", handle: (context) => authFor(context).deleteMyAccount(context.request), circleErrors: true },
  { method: "GET", path: "/api/account/notification-preferences", circleErrors: true,
    handle: (context) => authFor(context).getAccountNotificationPreferences(context.request) },
  { method: "PUT", path: "/api/account/notification-preferences", circleErrors: true,
    handle: (context) => authFor(context).saveAccountNotificationPreferences(context.request) },
  { method: "POST", path: "/api/shares", handle: (context) => sharesFor(context).create(context.request), circleErrors: true },
  { method: "GET", path: "/api/shares/:shareId", handle: (context, { shareId }) => sharesFor(context).get(shareId), circleErrors: true },
];

/** `/api/claims/:claimId` style patterns; a parameter is one non-empty segment,
 * passed raw (not percent-decoded), as Pages passed `context.params`. */
function match(pattern: string, pathname: string) {
  const expected = pattern.split("/");
  const actual = pathname.split("/");
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of expected.entries()) {
    if (part.startsWith(":")) {
      if (!actual[index]) return null;
      params[part.slice(1)] = actual[index];
    } else if (part !== actual[index]) return null;
  }
  return params;
}

function notFound(status: 404 | 405, allow: string[] = []) {
  return new Response(JSON.stringify({ error: status === 404 ? "找不到這個 API。" : "不支援這個請求方法。" }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(allow.length ? { allow: allow.join(", ") } : {}) },
  });
}

export const onRequest: PagesFunction<PortalEnv> = async (context) => {
  const { pathname } = new URL(context.request.url);
  const method = context.request.method === "HEAD" ? "GET" : context.request.method;
  const allowed: string[] = [];
  for (const route of routes) {
    const params = match(route.path, pathname);
    if (!params) continue;
    if (route.method !== method) { allowed.push(route.method); continue; }
    return guard(() => route.handle(context, params), route.circleErrors);
  }
  if (allowed.includes("GET")) allowed.push("HEAD");
  return notFound(allowed.length ? 405 : 404, allowed);
};
