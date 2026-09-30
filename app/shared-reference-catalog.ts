import type { OrganizerVenueCatalog } from './organizer-venue-catalog';
import { projectReferenceCatalog, type OrganizerReferenceRecord } from './organizer-reference-catalog';
import { sha256Hex } from './portal-crypto';

export async function sharedReferenceCatalog(venues: OrganizerVenueCatalog, records: OrganizerReferenceRecord[], access: Array<{ path: string; used: number; dependents: number }> = []) {
  const byId = new Map(records.map(row => [`${row.kind}:${row.id}`, row]));
  async function management(row: OrganizerReferenceRecord, mode?: string) {
    const state = access.find(item => item.path === row.path);
    return { path: row.path, version: await sha256Hex(row.publicReferenceJson + (mode === undefined ? '' : `\n${mode}`)),
      editBlocked: row.kind !== 'category-catalog' && !!state?.used,
      deleteBlocked: !!state?.used || !!state?.dependents,
      deleteReason: state?.used ? '此資料已被活動使用，無法刪除。' : state?.dependents ? '請先移除所屬分類目錄或場地。' : '' };
  }
  async function publicFields(kind: string, id: string, mode?: string) {
    const row = byId.get(`${kind}:${id}`);
    if (!row) return { publicName: null, address: null, officialUrl: null, version: null, path: null, editBlocked: true, deleteBlocked: true, deleteReason: '請先補齊來源。' };
    const value = JSON.parse(row.publicReferenceJson);
    return { publicName: String(value.name ?? row.displayName), address: typeof value.address === 'string' ? value.address : null,
      officialUrl: String(value.officialUrl ?? value.sources[0].url), ...await management(row, mode) };
  }
  const projected = projectReferenceCatalog(records);
  return { organizers: await Promise.all(projected.organizers.map(async item => ({ ...item, ...await management(byId.get(`organizer:${item.id}`)!) }))),
    categories: await Promise.all(projected.categories.map(async item => ({ ...item,
      ...await management(records.find(row => row.kind === 'category-catalog' && row.id === item.id && row.revision === item.revision)!) }))),
    venues: await Promise.all(venues.venues.map(async venue => ({
    ...venue, ...await publicFields('venue', venue.id),
    spaces: await Promise.all(venue.spaces.map(async space => ({ ...space, ...await publicFields('venue-space', space.id, space.defaultAreaMode) }))),
  }))) };
}
export type SharedReferenceCatalog = Awaited<ReturnType<typeof sharedReferenceCatalog>>;
