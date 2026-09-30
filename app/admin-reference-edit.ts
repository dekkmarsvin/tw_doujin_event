import { createCategoryReference, createOrganizerReference, createVenueReference, createVenueSpaceReference, type OrganizerReferenceRecord } from './organizer-reference-catalog';
import { normalizeOrganizerVenueAddress, normalizeOrganizerVenueName, normalizeOrganizerVenueSourceUrl } from './organizer-venue-catalog';
import { parseReferenceRecord } from './reference-selection.mjs';

/** Edits keep stable identities; category edits always create a fresh revision. */
export function editSharedReference(previous: OrganizerReferenceRecord, input: Record<string, unknown>, now: number, revision?: string): OrganizerReferenceRecord {
  const name = normalizeOrganizerVenueName(input.name), sourceUrl = normalizeOrganizerVenueSourceUrl(input.sourceUrl);
  if (!name || !sourceUrl) throw new Error('請填寫名稱與有效的 HTTPS 來源網址。');
  let next: OrganizerReferenceRecord;
  if (previous.kind === 'category-catalog') {
    const old = JSON.parse(previous.publicReferenceJson);
    const categories = Array.isArray(input.categories) ? input.categories.map(category => ({
      ...old.categories.find((item: { label: string }) => item.label === category?.label), ...category,
    })) : input.categories;
    next = createCategoryReference({ name, sourceUrl, categories }, previous.organizerId!, now);
    const value = JSON.parse(next.publicReferenceJson);
    value.id = previous.id; value.revision = revision;
    // A reorder must not change category identities or drop existing descriptions.
    value.categories = value.categories.map((category: { label: string; description?: string }) => {
      const retained = old.categories.find((item: { label: string }) => item.label === category.label);
      return { ...retained, ...category, id: retained?.id ?? `category-${crypto.randomUUID()}` };
    });
    next = { ...next, id: previous.id, revision: revision!, path: previous.path.replace(/[^/]+\.json$/, `${revision}.json`), publicReferenceJson: `${JSON.stringify(value, null, 2)}\n` };
  } else if (previous.kind === 'organizer') {
    next = createOrganizerReference({ name, sourceUrl }, now);
    const value = JSON.parse(next.publicReferenceJson); value.id = previous.id;
    next = { ...next, id: previous.id, path: previous.path, publicReferenceJson: `${JSON.stringify(value, null, 2)}\n` };
  } else if (previous.kind === 'venue') {
    next = createVenueReference({ id: previous.id, name, sourceUrl, address: normalizeOrganizerVenueAddress(input.address) }, now);
  } else {
    next = createVenueSpaceReference({ id: previous.id, venueId: JSON.parse(previous.publicReferenceJson).venueId, name, sourceUrl }, now);
  }
  parseReferenceRecord(JSON.parse(next.publicReferenceJson), next.path);
  return next;
}
