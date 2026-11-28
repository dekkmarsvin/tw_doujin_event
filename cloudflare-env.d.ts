/** Minimal Cloudflare runtime surface used by this application.
 * Wrangler supplies the concrete bindings in production.
 */
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

/** HTMLRewriter subset used for the circle page's Open Graph image. */
declare class HTMLRewriter {
  on(selector: string, handler: { element(element: { setAttribute(name: string, value: string): void; remove(): void }): void }): HTMLRewriter;
  transform(response: Response): Response;
}

interface D1Meta {
  changes: number;
  last_row_id: number;
}

interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface R2PutOptions {
  httpMetadata?: { contentType?: string; cacheControl?: string };
  customMetadata?: Record<string, string>;
  /** The put returns null, writing nothing, when the stored ETag differs. */
  onlyIf?: { etagMatches: string };
}

interface R2ObjectBody {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  /** Quoted ETag, ready for an `ETag` header. */
  httpEtag: string;
  etag: string;
  text(): Promise<string>;
}

interface R2Bucket {
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: Array<{ key: string }>;
    truncated: boolean;
    cursor?: string;
  }>;
  put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: R2PutOptions): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(keys: string | string[]): Promise<void>;
}

/** Bindings the scheduled retention purge reads. It is deployed on its own,
 * outside the Pages project, because Pages has no Cron Trigger (ADR-0022). */
interface RetentionEnv {
  DB: D1Database;
  THUMBNAILS: R2Bucket;
  /** Private evidence bucket. It has no public domain and is only read through authenticated Functions. */
  MAP_CONTRIBUTIONS?: R2Bucket;
  /** Hourly service check (#580). The domain and origins are variables; the key and recipient are secrets. */
  MAILGUN_API_KEY?: string;
  MAILGUN_DOMAIN?: string;
  SITE_ORIGIN?: string;
  ENVIRONMENT_NAME?: string;
  /** A verified Email Routing destination address, kept out of this public repository. */
  ALERT_RECIPIENT?: string;
  ALERT_EMAIL?: { send(message: import("cloudflare:email").EmailMessage): Promise<unknown> };
}

/** The argument a Cron Trigger hands to `scheduled()`. */
interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
  noRetry(): void;
}

declare module "cloudflare:email" {
  /** Raw MIME for a `send_email` binding. */
  export class EmailMessage {
    constructor(from: string, to: string, raw: string);
  }
}

declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
  };
}

/** Bindings and secrets the Pages Functions read. Secrets are set with
 * `wrangler pages secret put` and never live in the repository. */
interface PortalEnv {
  EVENT_ID: string;
  DB: D1Database;
  THUMBNAILS: R2Bucket;
  /** Published event data (#546): `index.json` names each event's current version; files live under `events/<id>/<version>/`. */
  EVENT_DATA: R2Bucket;
  /** Private evidence bucket. It has no public domain and is read only through authenticated Functions. */
  MAP_CONTRIBUTIONS?: R2Bucket;
  THUMBNAIL_PUBLIC_ORIGIN?: string;
  ASSETS: Fetcher;
  MAILGUN_API_KEY?: string;
  MAILGUN_DOMAIN?: string;
  MAILGUN_SENDER?: string;
  NOTIFICATION_ORIGIN?: string;
  SESSION_SECRET?: string;
  HASH_PEPPER?: string;
  /** Public Turnstile sitekey. A plain variable: it is served to the browser. */
  TURNSTILE_SITEKEY?: string;
  TURNSTILE_SECRET?: string;
  ADMIN_EMAILS?: string;
  PREVIEW_MAIL_SINK?: string;
  PREVIEW_TEST_RECIPIENTS?: string;
  /** Preview only. Real inboxes the Mailgun sandbox is allowed to write to,
   * kept in a secret rather than in `wrangler.jsonc` because they are real
   * personal addresses and the repository is public. */
  PREVIEW_SANDBOX_RECIPIENTS?: string;
  PREVIEW_E2E_TOKEN?: string;
  /** Only the explicit loopback portal may reset its entire disposable store. */
  LOCAL_PORTAL_DISPOSABLE?: string;
  /** Defaults disabled. `r2` publishes approvals to EVENT_DATA (#546); fake is accepted
   * only with the isolated preview mail sink. */
  ORGANIZER_PUBLICATION_MODE?: "disabled" | "r2";
}

interface EventContext<Env, Params extends string, Data> {
  request: Request;
  env: Env;
  params: Record<Params, string | string[]>;
  data: Data;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
}

type PagesFunction<
  Env = unknown,
  Params extends string = string,
  Data extends Record<string, unknown> = Record<string, unknown>,
> = (context: EventContext<Env, Params, Data>) => Response | Promise<Response>;
