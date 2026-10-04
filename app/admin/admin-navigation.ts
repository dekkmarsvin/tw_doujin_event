export type AdminSection = "overview" | "events" | "circles" | "accounts" | "data" | "settings" | "notifications";
export type AdminRoute = { section: AdminSection; view: string; event: string; draft: string; claim: string; circle: string; q: string; unavailable: boolean };

const defaults: Record<AdminSection, string> = { overview: "", events: "publication", circles: "claims", accounts: "", data: "venues", settings: "", notifications: "" };
const views: Record<AdminSection, string[]> = { overview: [""], events: ["publication", "maps"], circles: ["claims", "search"], accounts: [""], data: ["venues", "organizers", "categories"], settings: [""], notifications: [""] };
const legacy: Record<string, [AdminSection, string]> = {
  "#overview": ["overview", ""], "#admin": ["circles", "claims"], "#map-review": ["events", "maps"],
  "#takedown": ["circles", "search"], "#accounts": ["accounts", ""], "#review-notifications": ["notifications", ""],
};

export function readAdminRoute(url: URL): AdminRoute {
  const p = url.searchParams;
  let section = p.get("section") ?? "";
  let view = p.get("view") ?? "";
  if (section === "references") section = "data";
  if (!section) {
    const destination = legacy[url.hash] ?? (p.has("event") ? ["circles", "claims"] : ["overview", ""]);
    [section, view] = destination;
  }
  const known = Object.hasOwn(defaults, section);
  const target = (known ? section : "overview") as AdminSection;
  view ||= defaults[target];
  return { section: target, view, event: p.get("event") ?? "", draft: p.get("draft") ?? "", claim: p.get("claim") ?? "",
    circle: p.get("circle") ?? "", q: (p.get("q") ?? "").slice(0, 100), unavailable: !known || !views[target].includes(view) };
}

export function adminHref(section: AdminSection, params: Partial<Pick<AdminRoute, "view" | "event" | "draft" | "claim" | "circle" | "q">> = {}) {
  const p = new URLSearchParams();
  if (section !== "overview") p.set("section", section);
  for (const [key, value] of Object.entries(params)) if (value) p.set(key, value);
  return `/admin${p.size ? `?${p}` : ""}`;
}
