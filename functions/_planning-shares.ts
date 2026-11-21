import { createPlanningShareHandlers } from "../app/planning-share-handlers";
import { parseEventDefinition } from "../app/event-catalog";
import { createPlanningShareRepository } from "../db/planning-share-repository";
import { readEventJson } from "./_event-data";

const repositories = new WeakMap<D1Database, ReturnType<typeof createPlanningShareRepository>>();

export function planningShareHandlers({ env }: { env: PortalEnv; request: Request }) {
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
      const [definition, references] = await Promise.all([
        readEventJson(env, eventId, "event.json"),
        readEventJson(env, eventId, "reference-records.json"),
      ]);
      if (definition === null || references === null) return null;
      const event = parseEventDefinition(definition, references);
      return event.id === eventId ? event : null;
    },
  });
}
