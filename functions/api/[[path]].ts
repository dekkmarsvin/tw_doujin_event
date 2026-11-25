import { adminFor, authFor, circleFor, guard, organizerFor, sharesFor } from "../_portal";

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
  { method: "GET", path: "/api/claims", handle: (context) => circleFor(context).listClaims(context.request), circleErrors: true },
  { method: "POST", path: "/api/claims", handle: (context) => circleFor(context).createClaim(context.request), circleErrors: true },
  { method: "DELETE", path: "/api/claims/:claimId", circleErrors: true,
    handle: (context, { claimId }) => circleFor(context).withdrawClaim(context.request, claimId) },
  { method: "POST", path: "/api/claims/:claimId/challenge", circleErrors: true,
    handle: (context, { claimId }) => circleFor(context).runChallenge(context.request, claimId) },
  { method: "GET", path: "/api/circle/search", handle: (context) => circleFor(context).searchCatalog(context.request), circleErrors: true },
  { method: "GET", path: "/api/circle/:circleId/overrides", circleErrors: true,
    handle: (context, { circleId }) => circleFor(context).getMyOverride(context.request, circleId) },
  { method: "PUT", path: "/api/circle/:circleId/overrides", circleErrors: true,
    handle: (context, { circleId }) => circleFor(context).putOverride(context.request, circleId) },
  { method: "DELETE", path: "/api/circle/:circleId/overrides", circleErrors: true,
    handle: (context, { circleId }) => circleFor(context).deleteMyOverride(context.request, circleId) },
  { method: "POST", path: "/api/circle/:circleId/preview", circleErrors: true,
    handle: (context, { circleId }) => circleFor(context).previewOverride(context.request, circleId) },
  { method: "GET", path: "/api/circle/:circleId/thumbnail", circleErrors: true,
    handle: (context, { circleId }) => circleFor(context).readThumbnail(context.request, circleId) },
  { method: "POST", path: "/api/circle/:circleId/thumbnail", circleErrors: true,
    handle: (context, { circleId }) => circleFor(context).uploadThumbnail(context.request, circleId) },
  { method: "POST", path: "/api/circle/:circleId/catalog-image", circleErrors: true,
    handle: (context, { circleId }) => circleFor(context).uploadCatalogImage(context.request, circleId) },
  { method: "POST", path: "/api/circle/:circleId/visibility", circleErrors: true,
    handle: (context, { circleId }) => circleFor(context).setPostEventVisibility(context.request, circleId) },
  { method: "GET", path: "/api/admin/site-settings", handle: (context) => adminFor(context).adminGetSiteSettings(context.request) },
  { method: "PUT", path: "/api/admin/site-settings", handle: (context) => adminFor(context).adminUpdateSiteSettings(context.request) },
  { method: "POST", path: "/api/admin/service-check", handle: (context) => adminFor(context).adminRequestServiceCheck(context.request) },
  { method: "GET", path: "/api/admin/review-queue", handle: (context) => adminFor(context).adminReviewQueue(context.request) },
  { method: "GET", path: "/api/admin/claims", handle: (context) => adminFor(context).adminListClaims(context.request) },
  { method: "POST", path: "/api/admin/claims", handle: (context) => adminFor(context).adminDecideClaim(context.request) },
  { method: "GET", path: "/api/admin/overrides", handle: (context) => adminFor(context).adminSearchTakedownCircles(context.request) },
  { method: "POST", path: "/api/admin/overrides", handle: (context) => adminFor(context).adminTakedown(context.request) },
  { method: "GET", path: "/api/admin/circles/:circleId",
    handle: (context, { circleId }) => adminFor(context).adminCircleDetail(context.request, circleId) },
  { method: "GET", path: "/api/admin/admins", handle: (context) => adminFor(context).adminListAdmins(context.request) },
  { method: "POST", path: "/api/admin/admins", handle: (context) => adminFor(context).adminManageAdmins(context.request) },
  // `?circle=` searches accounts by claimed circle name; `?email=` reads one account.
  { method: "GET", path: "/api/admin/accounts", handle: (context) => new URL(context.request.url).searchParams.has("circle")
    ? adminFor(context).adminSearchAccountsByCircle(context.request) : adminFor(context).adminAccountDetail(context.request) },
  { method: "POST", path: "/api/admin/accounts", handle: (context) => adminFor(context).adminDisableAccount(context.request) },
  { method: "GET", path: "/api/admin/references", handle: (context) => adminFor(context).adminListReferences(context.request) },
  { method: "POST", path: "/api/admin/references", handle: (context) => adminFor(context).adminCreateReference(context.request) },
  { method: "GET", path: "/api/organizer/applications", handle: (context) => organizerFor(context).listEventApplications(context.request) },
  { method: "POST", path: "/api/organizer/applications", handle: (context) => organizerFor(context).submitEventApplication(context.request) },
  { method: "POST", path: "/api/admin/organizer/applications/:applicationId",
    handle: (context, { applicationId }) => organizerFor(context).reviewEventApplication(context.request, applicationId) },
  { method: "POST", path: "/api/admin/organizer/events", handle: (context) => organizerFor(context).adminCreateOrganizerCandidate(context.request) },
  { method: "POST", path: "/api/admin/organizer/events/:candidateId/review",
    handle: (context, { candidateId }) => organizerFor(context).adminReviewOrganizerCandidate(context.request, candidateId) },
  { method: "GET", path: "/api/organizer/events", handle: (context) => organizerFor(context).listOrganizerCandidates(context.request) },
  { method: "GET", path: "/api/organizer/events/:candidateId",
    handle: (context, { candidateId }) => organizerFor(context).getOrganizerCandidate(context.request, candidateId) },
  { method: "PATCH", path: "/api/organizer/events/:candidateId",
    handle: (context, { candidateId }) => organizerFor(context).updateOrganizerCandidate(context.request, candidateId) },
  { method: "PATCH", path: "/api/organizer/events/:candidateId/workspace",
    handle: (context, { candidateId }) => organizerFor(context).updateOrganizerWorkspacePreference(context.request, candidateId) },
  { method: "POST", path: "/api/organizer/events/:candidateId/workspace/complete-onboarding",
    handle: (context, { candidateId }) => organizerFor(context).completeOrganizerWorkspaceOnboarding(context.request, candidateId) },
  { method: "POST", path: "/api/organizer/events/:candidateId/collaborators",
    handle: (context, { candidateId }) => organizerFor(context).manageOrganizerCollaborators(context.request, candidateId) },
  { method: "GET", path: "/api/organizer/events/:candidateId/venues",
    handle: (context, { candidateId }) => organizerFor(context).listOrganizerVenues(context.request, candidateId) },
  { method: "POST", path: "/api/organizer/events/:candidateId/venues",
    handle: (context, { candidateId }) => organizerFor(context).createOrganizerVenue(context.request, candidateId) },
  { method: "POST", path: "/api/organizer/events/:candidateId/venues/:venueId/spaces",
    handle: (context, { candidateId, venueId }) => organizerFor(context).createOrganizerVenueSpace(context.request, candidateId, venueId) },
  { method: "POST", path: "/api/organizer/events/:candidateId/references",
    handle: (context, { candidateId }) => organizerFor(context).createOrganizerReferenceEntry(context.request, candidateId) },
  { method: "PUT", path: "/api/organizer/events/:candidateId/imports",
    handle: (context, { candidateId }) => organizerFor(context).putOrganizerImport(context.request, candidateId) },
  { method: "GET", path: "/api/organizer/events/:candidateId/maps",
    handle: (context, { candidateId }) => organizerFor(context).listOrganizerMaps(context.request, candidateId) },
  { method: "POST", path: "/api/organizer/events/:candidateId/maps",
    handle: (context, { candidateId }) => organizerFor(context).createOrganizerMap(context.request, candidateId) },
  { method: "GET", path: "/api/organizer/events/:candidateId/maps/:draftId",
    handle: (context, { candidateId, draftId }) => organizerFor(context).getOrganizerMap(context.request, candidateId, draftId) },
  { method: "PATCH", path: "/api/organizer/events/:candidateId/maps/:draftId",
    handle: (context, { candidateId, draftId }) => organizerFor(context).updateOrganizerMap(context.request, candidateId, draftId) },
  { method: "GET", path: "/api/organizer/events/:candidateId/maps/:draftId/background",
    handle: (context, { candidateId, draftId }) => organizerFor(context).getOrganizerMapBackground(context.request, candidateId, draftId) },
  { method: "PUT", path: "/api/organizer/events/:candidateId/maps/:draftId/background",
    handle: (context, { candidateId, draftId }) => organizerFor(context).putOrganizerMapBackground(context.request, candidateId, draftId) },
  { method: "GET", path: "/api/organizer/events/:candidateId/image",
    handle: (context, { candidateId }) => organizerFor(context).getOrganizerEventImage(context.request, candidateId) },
  { method: "PUT", path: "/api/organizer/events/:candidateId/image",
    handle: (context, { candidateId }) => organizerFor(context).putOrganizerEventImage(context.request, candidateId) },
  { method: "POST", path: "/api/organizer/events/:candidateId/validate",
    handle: (context, { candidateId }) => organizerFor(context).validateOrganizerCandidate(context.request, candidateId) },
  { method: "POST", path: "/api/organizer/events/:candidateId/preview",
    handle: (context, { candidateId }) => organizerFor(context).previewOrganizerCandidate(context.request, candidateId) },
  { method: "POST", path: "/api/organizer/events/:candidateId/submit",
    handle: (context, { candidateId }) => organizerFor(context).submitOrganizerCandidate(context.request, candidateId) },
  { method: "POST", path: "/api/organizer/events/:candidateId/amendments",
    handle: (context, { candidateId }) => organizerFor(context).createOrganizerAmendment(context.request, candidateId) },
  { method: "GET", path: "/api/organizer/events/:candidateId/amendment",
    handle: (context, { candidateId }) => organizerFor(context).getOrganizerAmendment(context.request, candidateId) },
  { method: "PUT", path: "/api/organizer/events/:candidateId/amendment",
    handle: (context, { candidateId }) => organizerFor(context).saveOrganizerAmendment(context.request, candidateId) },
  { method: "GET", path: "/api/organizer/events/:candidateId/claims",
    handle: (context, { candidateId }) => organizerFor(context).organizerListClaims(context.request, candidateId) },
  { method: "POST", path: "/api/organizer/events/:candidateId/claims",
    handle: (context, { candidateId }) => organizerFor(context).organizerDecideClaim(context.request, candidateId) },
  { method: "GET", path: "/api/organizer/events/:candidateId/overrides",
    handle: (context, { candidateId }) => organizerFor(context).organizerSearchTakedownCircles(context.request, candidateId) },
  { method: "POST", path: "/api/organizer/events/:candidateId/overrides",
    handle: (context, { candidateId }) => organizerFor(context).organizerTakedown(context.request, candidateId) },
  { method: "GET", path: "/api/organizer/events/:candidateId/notice",
    handle: (context, { candidateId }) => organizerFor(context).readOrganizerNotice(context.request, candidateId) },
  { method: "PUT", path: "/api/organizer/events/:candidateId/notice",
    handle: (context, { candidateId }) => organizerFor(context).saveOrganizerNotice(context.request, candidateId) },
  { method: "DELETE", path: "/api/organizer/events/:candidateId/notice",
    handle: (context, { candidateId }) => organizerFor(context).clearOrganizerNotice(context.request, candidateId) },
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
