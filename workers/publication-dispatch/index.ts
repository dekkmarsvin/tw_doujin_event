import { createIdentityRepository, type IdentityRepository } from "../../db/identity-repository";
import { runPublicationTick } from "../../app/publication-scheduler";
import { createRuntimePublicationDriver, readPublishedEventAtOrigin } from "../../app/publication-runtime";
import { createFakePublicationDriver } from "../../app/publication-dispatch";

type Env = Pick<PortalEnv, "DB" | "ORGANIZER_PUBLICATION_MODE" | "PREVIEW_MAIL_SINK" | "GITHUB_APP_ID" | "GITHUB_APP_INSTALLATION_ID" | "GITHUB_APP_PRIVATE_KEY">;

/**
 * One repository per isolate, not per tick — the same reason `repositoryFor`
 * exists in `functions/_portal.ts`. `ensureTables()` memoizes its bootstrap on
 * the instance, so a fresh repository each minute re-ran the whole thing: the
 * `CREATE TABLE IF NOT EXISTS` batch, all twenty-two `ADD COLUMN` migrations —
 * which necessarily fail with `duplicate column name` once the columns exist,
 * and cost ~150ms each in sequence — the index batch, and the venue catalog
 * seed. A warm isolate's trace showed 7.6s of that ahead of two SELECTs of
 * actual work.
 *
 * Keyed on the binding rather than held in a plain module variable so the
 * preview environment's separate D1 never reuses production's memo.
 */
const repositories = new WeakMap<D1Database, IdentityRepository>();

function repositoryFor(database: D1Database) {
  const existing = repositories.get(database);
  if (existing) return existing;
  const created = createIdentityRepository(database);
  repositories.set(database, created);
  return created;
}

/** No HTTP entry point. This Worker shares only the environment's identity D1. */
export default {
  async scheduled(_controller: ScheduledController, env: Env) {
    if (env.ORGANIZER_PUBLICATION_MODE !== "github" && !(env.ORGANIZER_PUBLICATION_MODE === "fake" && env.PREVIEW_MAIL_SINK === "d1")) return;
    const driver = env.ORGANIZER_PUBLICATION_MODE === "fake" ? createFakePublicationDriver(async () => false)
      : createRuntimePublicationDriver(env, readPublishedEventAtOrigin);
    const summary = await runPublicationTick({ repository: repositoryFor(env.DB), driver });
    console.log(JSON.stringify({ event: "publication.tick", ...summary }));
  },
};
