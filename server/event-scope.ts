import type { OverridesPhase } from "../db/identity-repository";
import type { ApiErrorCode } from "../app/i18n/api-error";
import { json } from "./http";

const errorCode = (code: ApiErrorCode) => code;

/** Which event a request operates on, and its publication phase (#546 phase 5). */
export function createEventScope(config: {
  eventId: string;
  dataUpdatedAt: string | (() => Promise<string>);
  eventEndsAt: string | (() => Promise<string>);
  now: () => number;
  publishedEvent?: (eventId: string) => Promise<unknown>;
}) {
  /** Publication phase. Only the circle's own content is withdrawn afterwards. */
  const configValue = async (value: string | (() => Promise<string>)) => typeof value === "string" ? value : value();
  const dataUpdatedAt = () => configValue(config.dataUpdatedAt);
  const eventEndsAt = () => configValue(config.eventEndsAt);
  const currentPhase = async (): Promise<OverridesPhase> => (config.now() > Date.parse(await eventEndsAt()) ? "after" : "during");

  /**
   * Whether this deployment serves the event the request named.
   *
   * `publishedEvent` is the same lookup the public overlay uses — "this
   * deployment actually has the event's data" — so the control plane and the
   * reader agree on which events exist without a second registry. Omitted means
   * a single-event deployment, where the configured event is the only one.
   */
  async function servesRequestedEvent() {
    return config.publishedEvent ? !!(await config.publishedEvent(config.eventId)) : true;
  }

  /**
   * Every event-scoped route answers 404 for an event this deployment does not
   * serve, rather than reaching a catalog read that throws. It runs before the
   * session check on purpose: which events exist is not a secret, and a claim
   * for one event must never be answered with another event's data.
   */
  function eventScoped<Rest extends unknown[]>(handler: (request: Request, ...rest: Rest) => Promise<Response>, circleErrors = false) {
    return async (request: Request, ...rest: Rest) => (await servesRequestedEvent())
      ? handler(request, ...rest)
      : json({ error: "找不到這個活動。", ...(circleErrors ? { code: errorCode("event_not_found") } : {}) }, 404);
  }

  return { dataUpdatedAt, eventEndsAt, currentPhase, servesRequestedEvent, eventScoped };
}
