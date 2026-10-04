const ADMIN_SELECTORS = {
  adminSection: "section", adminView: "view", adminEvent: "event", adminClaim: "claim",
  adminCircle: "circle", adminDraft: "draft", adminSearch: "q",
} as const;
const ADMIN_HASHES = new Set(["overview", "admin", "map-review", "takedown", "accounts", "review-notifications"]);
const SELECTOR_ID = /^[\p{L}\p{N}_.:-]{1,200}$/u;

/** A login continuation carries only selectors, never a caller-supplied URL. */
export function notificationParameters(value: unknown, audience: "circle" | "organizer") {
  const output = new URLSearchParams();
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  const input = value as Record<string, unknown>;
  if (audience === "circle" && input.admin === "1") {
    output.set("admin", "1");
    for (const key of Object.keys(ADMIN_SELECTORS)) {
      const item = input[key];
      if (typeof item === "string" && (key === "adminSearch" ? item.length <= 100 : SELECTOR_ID.test(item))) output.set(key, item);
    }
    if (typeof input.adminHash === "string" && ADMIN_HASHES.has(input.adminHash)) output.set("adminHash", input.adminHash);
    if (input.adminNotifications === "1") output.set("adminNotifications", "1");
    return output;
  }
  const keys = audience === "circle" ? ["event", "circle"] : ["candidate", "application"];
  for (const key of keys) {
    const item = input[key];
    if (typeof item === "string" && (SELECTOR_ID.test(item) || audience === "organizer" && key === "application" && item === "")) output.set(key, item);
  }
  if (audience === "organizer" && input.section === "review") output.set("section", "review");
  if (input.notifications === "1") output.set("notifications", "1");
  return output;
}

/** Admin shares the circle login form; its selectors cannot select a circle. */
export function adminLoginEntry(source: URL | string) {
  const url = source instanceof URL ? source : new URL(source, "https://local.invalid");
  const input: Record<string, string> = { admin: "1" };
  for (const [key, parameter] of Object.entries(ADMIN_SELECTORS)) {
    const item = url.searchParams.get(parameter);
    if (item !== null) input[key] = item;
  }
  input.adminHash = url.hash.slice(1);
  if (url.searchParams.get("notifications") === "1") input.adminNotifications = "1";
  return `/circle?${notificationParameters(input, "circle")}`;
}

/** After authentication, continuation can only open the same-origin /admin. */
export function adminLoginDestination(parameters: URLSearchParams) {
  const selectors = notificationParameters(Object.fromEntries(parameters), "circle");
  if (selectors.get("admin") !== "1") return null;
  const destination = new URL("/admin", "https://local.invalid");
  for (const [key, parameter] of Object.entries(ADMIN_SELECTORS)) {
    const item = selectors.get(key);
    if (item !== null) destination.searchParams.set(parameter, item);
  }
  if (selectors.get("adminNotifications") === "1") destination.searchParams.set("notifications", "1");
  const hash = selectors.get("adminHash");
  if (hash) destination.hash = hash;
  return `${destination.pathname}${destination.search}${destination.hash}`;
}
