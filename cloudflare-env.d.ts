/** Minimal Cloudflare runtime surface used by this application.
 * Wrangler supplies the concrete bindings in production.
 */
interface Fetcher {
  fetch(request: Request): Promise<Response>;
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

declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
  };
}

/** Bindings and secrets the Pages Functions read. Secrets are set with
 * `wrangler pages secret put` and never live in the repository. */
interface PortalEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  MAILGUN_API_KEY?: string;
  MAILGUN_DOMAIN?: string;
  MAILGUN_SENDER?: string;
  SESSION_SECRET?: string;
  HASH_PEPPER?: string;
  /** Public Turnstile sitekey. A plain variable: it is served to the browser. */
  TURNSTILE_SITEKEY?: string;
  TURNSTILE_SECRET?: string;
  ADMIN_EMAILS?: string;
  PREVIEW_MAIL_SINK?: string;
  PREVIEW_TEST_RECIPIENTS?: string;
  PREVIEW_E2E_TOKEN?: string;
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
