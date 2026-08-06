import { env } from "cloudflare:workers";
import { createEventMapRepository } from "./event-map-repository";
import type { EventMapLayout } from "../app/event-map";

let defaultRepository: ReturnType<typeof createEventMapRepository> | null = null;

function repository() {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database.");
  defaultRepository ??= createEventMapRepository(env.DB);
  return defaultRepository;
}

export async function getEventMap(eventId: string) {
  return repository().getEventMap(eventId);
}

export async function publishEventMap(input: { eventId: string; sourceName: string; confidence: number; layout: EventMapLayout }) {
  return repository().publishEventMap(input);
}
