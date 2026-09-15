import { readFile } from "node:fs/promises";
import { PIXEL, base } from "./journey.mjs";

export const source = JSON.parse(await readFile("fixtures/events/sample/map.json", "utf8")).layout;
const now = Date.now();
const summary = { id: "placement", tentativeName: "畫布放置驗收", status: "draft", operation: "CREATE", version: 1, role: "owner", updatedAt: now, workspaceMode: "binder" };
const assignment = { venueId: "test-hall", venueSpaceId: "test-space", areaIds: ["A"], mapTemplate: "SAMPLE", areaMode: "imported" };
const detail = { event: summary, publicationAvailable: false, publication: null, revisions: [], venueCatalog: { venues: [] },
  draft: { schema: "organizer-event-draft/1", event: { id: "sample", name: "畫布放置驗收", days: [{ id: "1", label: "第一天", date: "2026-11-07" }] }, venue: { assignments: [assignment] }, officialSource: { label: "測試來源", url: "https://organizer.example/" } },
  import: { source: {}, rows: [{ dayId: "1", venueSpaceId: "test-space", codes: ["S01"], circleName: "測試社" }] },
  workspace: { mode: "binder", onboardingCompletedAt: now, resume: { guidedTask: "identity_source", section: "map" }, readiness: { completed: 3, total: 6, suggestedNextSection: "map", blockers: [], sections: ["event", "venue", "import", "map", "validate", "review"].map(id => ({ id, state: "available" })) } } };

export async function openSurface(journey, surface, initialLayout = source) {
  const state = { layout: structuredClone(initialLayout), authoring: { guides: [] }, saves: 0, background: false };
  const page = await journey.page({ url: `${base}/${surface}`, viewport: { width: 1600, height: 1100 }, routes: async page => {
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
      const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/api/auth/session") return reply({ email: "map@example.test", isAdmin: false, isMapContributor: true, hasOrganizerAccess: true, expiresAt: now + 86400000 });
      if (path === "/api/auth/config") return reply({ turnstileSitekey: "" });
      if (path.endsWith("/claims")) return reply({ claims: [], eventId: "sample" });
      if (path === "/api/organizer/events") return reply({ events: [summary] });
      if (path.endsWith("/workspace")) return reply({ ok: true });
      if (path.endsWith("/events/placement")) return reply(detail);
      const map = { id: "test-map", periodKey: "1", venueSpaceId: "test-space", mapRevision: 1, layout: state.layout, authoring: state.authoring };
      if (path.endsWith("/maps")) return reply({ maps: [map] });
      // The traced plan is stored beside the map, so a journey that needs the
      // background controls uploads one and reads it back the way the app does.
      if (path.endsWith("/background")) {
        if (method === "PUT") { state.background = true; return reply({ ok: true, width: 1, height: 1 }); }
        if (!state.background) return reply({ error: "missing" }, 404);
        return route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
      }
      if (path.endsWith("/maps/test-map")) {
        if (method === "PATCH") { state.layout = request.postDataJSON().layout; state.authoring = request.postDataJSON().authoring ?? { guides: [] }; state.saves++; return reply({ ok: true, version: 1, mapRevision: 1 }); }
        return reply({ map });
      }
      const draft = { id: "test-map", event_id: "sample", period_key: "1", venue_space_id: "test-space", status: "draft", current_revision: 1, updated_at: now, content: { schema: "map-contribution-draft/1", layout: state.layout, authoring: state.authoring } };
      if (path === "/api/map-contributions/drafts") return reply({ drafts: [draft] });
      if (path === "/api/map-contributions/drafts/test-map") {
        if (method === "PUT") { state.layout = request.postDataJSON().content.layout; state.authoring = request.postDataJSON().content.authoring ?? { guides: [] }; state.saves++; return reply({ ok: true, revision: 1 }); }
        return reply({ draft, files: [], reviews: [], comments: [] });
      }
      throw new Error(`Unexpected API: ${method} ${path}`);
    });
  } });
  if (surface === "organizer") await page.getByRole("button", { name: "第一天", exact: true }).click();
  else await page.locator("#map-contribution").getByRole("button", { name: "開啟", exact: true }).click();
  const editor = page.getByRole("region", { name: "活動地圖編輯器" });
  await editor.waitFor();
  return { page, editor, state };
}
