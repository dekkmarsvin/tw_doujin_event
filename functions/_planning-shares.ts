import { createPlanningShareHandlers } from "../app/planning-share-handlers";
import { parseEventDefinition } from "../app/event-catalog";
import { createPlanningShareRepository } from "../db/planning-share-repository";

const repositories = new WeakMap<D1Database, ReturnType<typeof createPlanningShareRepository>>();

export function planningShareHandlers({ env, request }: { env: PortalEnv; request: Request }) {
  let repository = repositories.get(env.DB);
  if (!repository) {
    repository = createPlanningShareRepository(env.DB);
    repositories.set(env.DB, repository);
  }
  return createPlanningShareHandlers({
    repository,
    hashPepper: () => {
      if (!env.HASH_PEPPER) throw new Error("Missing Pages secret HASH_PEPPER.");
      return env.HASH_PEPPER;
    },
    publishedEvent: async (eventId) => {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(eventId)) return null;
      const base = `/data/events/${encodeURIComponent(eventId)}`;
      const [definition, references] = await Promise.all([
        env.ASSETS.fetch(new Request(new URL(`${base}/event.json`, request.url))),
        env.ASSETS.fetch(new Request(new URL(`${base}/reference-records.json`, request.url))),
      ]);
      if (definition.status === 404 || references.status === 404) return null;
      if (!definition.ok || !references.ok) throw new Error("Published event assets unavailable.");
      const event = parseEventDefinition(await definition.json(), await references.json());
      return event.id === eventId ? event : null;
    },
  });
}
