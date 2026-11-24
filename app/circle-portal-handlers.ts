import { type CircleOverrideFields } from "./circle-overrides";
import { type PortalMail } from "./portal-mail";
import type { IdentityRepository } from "../db/identity-repository";
import { createAuth } from "../server/auth";
import { createCircle } from "../server/circle";
import { createAdmin } from "../server/admin";
import { createOrganizer } from "../server/organizer";
import { type HostedThumbnailStore } from "./hosted-thumbnails";
import { type MapContributionFileStore } from "./map-contribution-files";
import { type AmendmentPublishedSource, type OrganizerAmendmentBaseline } from "./organizer-amendment-baseline";

/**
 * The wiring every backend module is built from, and all modules' routes in
 * one object for the handler tests. Requests are served by the single router
 * in `functions/api/[[path]].ts`, which builds each module on its own (#546).
 */

export { SESSION_COOKIE, emailAuditSubjectId } from "../server/auth";

export type CircleLookup = {
  id: string;
  name: string;
  nameKey: string;
  sourceRow: number | null;
  links: { provider: string; url: string }[];
};

type PortalConfig = {
  eventId: string;
  origin: string;
  sessionSecret: string;
  hashPepper: string;
  adminEmails: string[];
  dataUpdatedAt: string | (() => Promise<string>);
  /** ISO instant after which an opted-out circle's content is withdrawn. */
  eventEndsAt: string | (() => Promise<string>);
  now: () => number;
  /**
   * Resolves any published event, not just `eventId`.
   *
   * The public overlay is read per event id from the URL, so it cannot use the
   * control plane's single-event configuration: a second published event would
   * otherwise get a 404 and silently lose every circle's own content. Returns
   * null for an event this deployment does not serve. Omitted means "only
   * `eventId` is published", which is what a single-event deployment is.
   */
  publishedEvent?: (eventId: string) => Promise<{ dataUpdatedAt: string; eventEndsAt: string } | null>;
  /** Merge remains off until the GitHub App and both repository rulesets are verified. */
  organizerPublicationMode?: "disabled" | "fake" | "r2";
};

export type PortalDependencies = {
  loadPublishedAmendmentBaseline?: (source: AmendmentPublishedSource) => Promise<OrganizerAmendmentBaseline>;
  /** Durable dispatch only; never wait for checks or deployment in a request.
   * Omitted until the production driver and rollout gates are verified. */
  dispatchOrganizerPublication?: (jobId: string) => Promise<void>;
  repository: IdentityRepository;
  sendMail: (message: PortalMail) => Promise<void>;
  /**
   * Whether this environment can deliver to an address at all, asked before
   * anything is written. Only the preview and local portals set it: they keep a
   * fixed recipient list, so an address off it is a rejected input, not a
   * server fault, and the caller deserves to be told which it was.
   *
   * Production leaves it undefined. Its mailer accepts any address, so there is
   * nothing to answer and `requestLink` keeps returning the same 202 whatever
   * the address — a gate here would turn that into an inbox oracle.
   */
  mailRecipientAllowed?: (email: string) => boolean;
  lookupCircle: (circleId: string, eventId?: string) => Promise<CircleLookup | null>;
  searchCircles: (query: string, limit: number, eventId?: string) => Promise<CircleLookup[]>;
  /** Returns page text, or null when the host cannot be read from a Worker. */
  fetchEvidence: (url: string) => Promise<string | null>;
  /**
   * Turnstile siteverify. Fails closed: an unreachable verifier is a `false`,
   * not a pass, so an outage stops sign-ins instead of opening the mailer.
   */
  verifyHuman: (token: string, remoteIp: string | null) => Promise<boolean>;
  /**
   * The public half of the Turnstile pair. Resolved on call, not on
   * construction: the reader's public overlay is built from this same wiring,
   * and a sitekey nobody has configured yet must not take that down too.
   */
  turnstileSitekey: () => string;
  /** Runs the reader's own projection so a preview cannot drift from reality. */
  projectCircle: (circleId: string, fields: CircleOverrideFields | null, updatedAt?: string) => Promise<unknown[] | null>;
  thumbnailStore?: HostedThumbnailStore;
  /** Separate private R2 bucket. It must never share the public thumbnail origin. */
  mapContributionStore?: MapContributionFileStore;
  /** Confirms readers do not see a failed job's approval before its candidate is reopened. */
  publicationAuditor?: (jobId: string) => Promise<{ clear: boolean }>;
  config: PortalConfig;
};

export function createCirclePortalHandlers(dependencies: PortalDependencies) {
  const auth = createAuth(dependencies);
  const circle = createCircle(dependencies, auth);
  const admin = createAdmin(dependencies, auth);
  const organizer = createOrganizer(dependencies, auth, admin);
  return { ...admin.routes, ...auth.routes, ...organizer.routes, ...circle.routes };
}

export type CirclePortalHandlers = ReturnType<typeof createCirclePortalHandlers>;
