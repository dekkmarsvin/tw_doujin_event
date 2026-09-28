import type { OrganizerVenueCatalog } from './organizer-venue-catalog';
import { projectReferenceCatalog, type OrganizerReferenceRecord } from './organizer-reference-catalog';
import { sha256Hex } from './portal-crypto';

export async function sharedReferenceCatalog(venues: OrganizerVenueCatalog, records: OrganizerReferenceRecord[]) {
  const byId = new Map(records.map(row => [`${row.kind}:${row.id}`, row]));
  async function publicFields(kind: string, id: string) {
    const row = byId.get(`${kind}:${id}`);
    if (!row) return { publicName: null, address: null, officialUrl: null, version: null };
    const value = JSON.parse(row.publicReferenceJson);
    return { publicName: String(value.name ?? row.displayName), address: typeof value.address === 'string' ? value.address : null,
      officialUrl: String(value.officialUrl ?? value.sources[0].url), version: await sha256Hex(row.publicReferenceJson) };
  }
  return { ...projectReferenceCatalog(records), venues: await Promise.all(venues.venues.map(async venue => ({
    ...venue, ...await publicFields('venue', venue.id),
    spaces: await Promise.all(venue.spaces.map(async space => ({ ...space, ...await publicFields('venue-space', space.id) }))),
  }))) };
}
export type SharedReferenceCatalog = Awaited<ReturnType<typeof sharedReferenceCatalog>>;
