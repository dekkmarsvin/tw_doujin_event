import type { OrganizerEventSummary } from "./organizer-client";

export type OrganizerEventGroup = { id: string; name: string; editions: OrganizerEventSummary[]; latest: OrganizerEventSummary };

/** A saved edit does not create a new edition. An AMEND candidate does. */
export function groupOrganizerEvents(events: readonly OrganizerEventSummary[]): OrganizerEventGroup[] {
  const groups = new Map<string, OrganizerEventSummary[]>();
  for (const event of events) {
    const key = event.eventId ? `event:${event.eventId}` : `candidate:${event.id}`;
    const editions = groups.get(key) ?? [];
    editions.push(event);
    groups.set(key, editions);
  }
  return [...groups].map(([id, items]) => {
    const editions = [...items].sort((a, b) => (b.edition ?? 1) - (a.edition ?? 1)
      || (b.createdAt ?? b.updatedAt) - (a.createdAt ?? a.updatedAt) || b.id.localeCompare(a.id));
    const latest = editions[0];
    return { id, name: latest.tentativeName, editions, latest };
  }).sort((a, b) => Math.max(...b.editions.map(event => event.updatedAt))
    - Math.max(...a.editions.map(event => event.updatedAt)) || a.id.localeCompare(b.id));
}

export function latestOrganizerEdition(events: readonly OrganizerEventSummary[], candidateId?: string | null) {
  const groups = groupOrganizerEvents(events);
  return (candidateId ? groups.find(group => group.editions.some(event => event.id === candidateId)) : groups[0])?.latest.id ?? null;
}
