/**
 * The frozen error-code registry for the circle and share APIs (#523), kept
 * apart from the failure helpers in ./api-error: it names write endpoints, and
 * the Reader, which only reads failures, must not carry them (public-artifact
 * test). Server code and tests import it from here.
 */
const circleEndpoints = [
  "/api/auth/request-link", "/api/auth/verify", "/api/auth/session", "/api/account", "/api/account/notification-preferences",
  "/api/claims", "/api/claims/:claimId", "/api/claims/:claimId/challenge", "/api/circle/search",
  "/api/circle/:circleId/overrides", "/api/circle/:circleId/preview", "/api/circle/:circleId/thumbnail", "/api/circle/:circleId/catalog-image", "/api/circle/:circleId/visibility",
  "/api/shares", "/api/shares/:shareId",
] as const;
const eventEndpoints = circleEndpoints.filter(endpoint => endpoint.startsWith("/api/claims") || endpoint.startsWith("/api/circle/"));
const ownedEndpoints = ["/api/circle/:circleId/overrides", "/api/circle/:circleId/preview", "/api/circle/:circleId/thumbnail", "/api/circle/:circleId/catalog-image", "/api/circle/:circleId/visibility"] as const;

/** Registry for D's additive envelopes; this module does not emit server responses.
 * Endpoint strings use :parameters and list only the circle/share scope. */
export const API_ERROR_CODES = {
  origin_mismatch: { status: 403, endpoints: circleEndpoints },
  invalid_content_type: { status: 415, endpoints: circleEndpoints },
  server_error: { status: 500, endpoints: circleEndpoints },
  service_unavailable: { status: 503, endpoints: circleEndpoints },
  unauthenticated: { status: 401, endpoints: circleEndpoints.filter(endpoint => !["/api/auth/request-link", "/api/auth/verify", "/api/shares", "/api/shares/:shareId"].includes(endpoint)) },
  rate_limited: { status: 429, endpoints: ["/api/auth/request-link", "/api/shares"] },
  turnstile_failed: { status: 403, endpoints: ["/api/auth/request-link"] },
  invalid_locale: { status: 400, endpoints: ["/api/auth/request-link", "/api/account/notification-preferences"] },
  mail_recipient_not_allowed: { status: 400, endpoints: ["/api/auth/request-link"] },
  login_link_invalid: { status: 400, endpoints: ["/api/auth/verify"] },
  login_link_expired: { status: 400, endpoints: ["/api/auth/verify"] },
  account_deleting: { status: 409, endpoints: ["/api/claims", "/api/claims/:claimId/challenge", "/api/circle/:circleId/overrides", "/api/circle/:circleId/thumbnail", "/api/circle/:circleId/catalog-image"], params: ["action"] },
  account_creation_refused: { status: 403, endpoints: ["/api/auth/verify"] },
  account_not_found: { status: 404, endpoints: ["/api/account"] },
  account_delete_confirmation: { status: 400, endpoints: ["/api/account"] },
  admin_account_delete_blocked: { status: 409, endpoints: ["/api/account"] },
  account_sole_owner: { status: 409, endpoints: ["/api/account"] },
  account_files_unavailable: { status: 503, endpoints: ["/api/account"] },
  event_not_found: { status: 404, endpoints: [...eventEndpoints, "/s/:shareId"] },
  circle_not_found: { status: 404, endpoints: ["/api/claims", "/api/circle/:circleId/preview"] },
  claim_not_found: { status: 404, endpoints: ["/api/claims/:claimId", "/api/claims/:claimId/challenge"] },
  claim_not_verified: { status: 403, endpoints: ownedEndpoints },
  claim_not_pending: { status: 409, endpoints: ["/api/claims/:claimId"] },
  circle_already_claimed: { status: 409, endpoints: ["/api/claims", "/api/claims/:claimId/challenge"] },
  claim_already_verified: { status: 409, endpoints: ["/api/claims"] },
  claim_already_pending: { status: 409, endpoints: ["/api/claims"] },
  claim_daily_limit: { status: 429, endpoints: ["/api/claims"] },
  claim_challenge_expired: { status: 410, endpoints: ["/api/claims/:claimId/challenge"] },
  claim_challenge_attempts_exhausted: { status: 429, endpoints: ["/api/claims/:claimId/challenge"] },
  claim_requires_manual_review: { status: 409, endpoints: ["/api/claims/:claimId/challenge"] },
  claim_already_decided: { status: 409, endpoints: ["/api/claims/:claimId/challenge"] },
  invalid_fields: { status: 400, endpoints: ["/api/circle/:circleId/overrides", "/api/circle/:circleId/preview"] },
  image_required: { status: 400, endpoints: ["/api/circle/:circleId/thumbnail", "/api/circle/:circleId/catalog-image"] },
  invalid_upload: { status: 400, endpoints: ["/api/circle/:circleId/thumbnail", "/api/circle/:circleId/catalog-image"] },
  invalid_image: { status: 400, endpoints: ["/api/circle/:circleId/thumbnail", "/api/circle/:circleId/catalog-image"], params: ["kind"] },
  image_reselect_required: { status: 400, endpoints: ["/api/circle/:circleId/overrides"], params: ["kind"] },
  image_service_unavailable: { status: 503, endpoints: ["/api/account", "/api/circle/:circleId/overrides", "/api/circle/:circleId/thumbnail", "/api/circle/:circleId/catalog-image"] },
  nothing_to_delete: { status: 404, endpoints: ["/api/circle/:circleId/overrides"] },
  circle_delete_confirmation: { status: 400, endpoints: ["/api/circle/:circleId/overrides"] },
  save_required_first: { status: 409, endpoints: ["/api/circle/:circleId/visibility"] },
  invalid_retention: { status: 400, endpoints: ["/api/circle/:circleId/overrides"] },
  invalid_visibility: { status: 400, endpoints: ["/api/circle/:circleId/visibility"] },
  invalid_notification_preferences: { status: 400, endpoints: ["/api/account/notification-preferences"] },
  version_conflict: { status: 409, endpoints: ["/api/account/notification-preferences"] },
  share_invalid: { status: 400, endpoints: ["/api/shares"] },
  share_snapshot_invalid: { status: 400, endpoints: ["/api/shares"] },
  share_event_ended: { status: 400, endpoints: ["/api/shares"] },
  share_not_found: { status: 404, endpoints: ["/api/shares/:shareId", "/s/:shareId"] },
  share_expired: { status: 410, endpoints: ["/api/shares/:shareId", "/s/:shareId"] },
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_CODES;
