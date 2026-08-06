/** Minimal Cloudflare runtime surface used by this application.
 * Wrangler supplies the concrete bindings in production.
 */
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface D1PreparedStatement {
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
  };
}
