import type { IdentityRepository } from '../db/identity-repository';
import type { AdminReferenceWrite } from '../db/admin-reference-repository';
import { createCategoryReference, createOrganizerReference, createVenueReference, createVenueSpaceReference, completeVenueAddress,
  venueReferenceNeedsAddress } from './organizer-reference-catalog';
import { isOrganizerVenueSpaceAreaMode, normalizeOrganizerVenueAddress, normalizeOrganizerVenueName, normalizeOrganizerVenueSourceUrl } from './organizer-venue-catalog';
import { sharedReferenceCatalog } from './shared-reference-catalog';
import { sha256Hex } from './portal-crypto';

type Gate = { ok: false; response: Response } | { ok: true; session: { accountId: string } };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export function createAdminReferenceHandlers(repository: IdentityRepository, requireAdmin: (request: Request) => Promise<Gate>, now: () => number) {
  async function adminListReferences(request: Request) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;
    const [venues, records] = await Promise.all([repository.listOrganizerVenueCatalog(), repository.listOrganizerReferenceRecords()]);
    return json(await sharedReferenceCatalog(venues, records));
  }
  async function adminCreateReference(request: Request) {
    const gate = await requireAdmin(request);
    if (!gate.ok) return gate.response;
    let body: Record<string, unknown>;
    try {
      const value = await request.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      body = value;
    } catch { return json({ error: '請求格式無效。' }, 400); }
    const timestamp = now();
    const actor = { actorAccountId: gate.session.accountId, now: timestamp };
    let mutation: AdminReferenceWrite;
    try {
      if (body.kind === 'organizer') mutation = { ...actor, record: createOrganizerReference({ name: body.name, sourceUrl: body.sourceUrl }, timestamp) };
      else if (body.kind === 'category-catalog' && typeof body.organizerId === 'string') {
        mutation = { ...actor, record: createCategoryReference({ name: body.name, sourceUrl: body.sourceUrl, categories: body.categories }, body.organizerId, timestamp) };
      } else {
        const catalog = await repository.listOrganizerVenueCatalog();
        const records = await repository.listOrganizerReferenceRecords();
        const venue = catalog.venues.find(item => item.id === body.venueId);
        if (body.kind === 'venue-address') {
          if (!venue) return json({ error: '找不到場館。' }, 404);
          const previous = records.find(row => row.kind === 'venue' && row.id === venue.id);
          if (!previous) return json({ error: '請先補齊場館來源。' }, 409);
          if (!venueReferenceNeedsAddress(previous) || body.version !== await sha256Hex(previous.publicReferenceJson)) {
            return json({ error: '場館資料已變更，請重新讀取後核對。' }, 409);
          }
          const address = normalizeOrganizerVenueAddress(body.address);
          if (!address) return json({ error: '請填寫場館地址。' }, 400);
          mutation = { ...actor, previous, record: completeVenueAddress(previous, address, timestamp) };
        } else if (body.kind === 'venue-create') {
          const name = normalizeOrganizerVenueName(body.name), sourceUrl = normalizeOrganizerVenueSourceUrl(body.sourceUrl);
          const address = normalizeOrganizerVenueAddress(body.address);
          const spaceName = normalizeOrganizerVenueName(body.spaceName);
          const requestedSpaceUrl = normalizeOrganizerVenueSourceUrl(body.spaceSourceUrl);
          const defaultAreaMode = body.defaultAreaMode ?? 'imported';
          if (!name || !sourceUrl || !spaceName || requestedSpaceUrl === undefined || !isOrganizerVenueSpaceAreaMode(defaultAreaMode)) {
            return json({ error: '請填寫場館名稱、場地名稱與有效的 HTTPS 來源網址。' }, 400);
          }
          if (!address) return json({ error: '請填寫場館地址。' }, 400);
          const id = `venue-${crypto.randomUUID()}`, spaceId = `venue-space-${crypto.randomUUID()}`;
          const space = { id: spaceId, venueId: id, name: spaceName, sourceUrl: requestedSpaceUrl ?? sourceUrl, defaultAreaMode };
          mutation = { ...actor, record: createVenueReference({ id, name, sourceUrl, address }, timestamp), newVenue: { name, sourceUrl },
            newSpace: { ...space, record: createVenueSpaceReference(space, timestamp) } };
        } else if (body.kind === 'venue-space-create') {
          if (!venue) return json({ error: '找不到場館。' }, 404);
          const name = normalizeOrganizerVenueName(body.name), requestedUrl = normalizeOrganizerVenueSourceUrl(body.sourceUrl);
          const parentRecord = records.find(row => row.kind === 'venue' && row.id === venue.id);
          const parentUrl = parentRecord ? JSON.parse(parentRecord.publicReferenceJson).officialUrl as string : venue.sourceUrl;
          const sourceUrl = requestedUrl ?? parentUrl;
          const defaultAreaMode = body.defaultAreaMode ?? 'imported';
          if (!name || requestedUrl === undefined || !sourceUrl || !isOrganizerVenueSpaceAreaMode(defaultAreaMode)) {
            return json({ error: '請填寫場地名稱與有效的 HTTPS 來源網址。' }, 400);
          }
          const space = { id: `venue-space-${crypto.randomUUID()}`, venueId: venue.id, name, sourceUrl, defaultAreaMode };
          const record = createVenueSpaceReference(space, timestamp);
          mutation = { ...actor, record, newSpace: { ...space, record } };
        } else if (body.kind === 'venue' || body.kind === 'venue-space') {
          if (!venue) return json({ error: '找不到場館。' }, 404);
          const id = body.kind === 'venue' ? venue.id : typeof body.spaceId === 'string' ? body.spaceId : '';
          if (body.kind === 'venue-space' && !venue.spaces.some(space => space.id === id)) return json({ error: '找不到場地。' }, 404);
          if (records.some(row => row.kind === body.kind && row.id === id)) return json({ error: '來源已補齊，請重新讀取後核對。' }, 409);
          const name = normalizeOrganizerVenueName(body.name), sourceUrl = normalizeOrganizerVenueSourceUrl(body.sourceUrl);
          if (!name || !sourceUrl) return json({ error: '請填寫公開名稱與有效的 HTTPS 官方來源網址。' }, 400);
          const address = normalizeOrganizerVenueAddress(body.address);
          if (body.kind === 'venue' && !address) return json({ error: '請填寫場館地址。' }, 400);
          mutation = { ...actor, record: body.kind === 'venue' ? createVenueReference({ id, name, sourceUrl, address }, timestamp)
            : createVenueSpaceReference({ id, venueId: venue.id, name, sourceUrl }, timestamp) };
        } else return json({ error: '請選擇要建立或補齊的共用資料。' }, 400);
      }
    } catch { return json({ error: '資料格式無效，請核對名稱、官方 HTTPS 來源及分類內容。' }, 400); }
    const saved = await repository.saveAdminReference(mutation);
    if (!saved) return json({ error: '資料已存在、已變更或管理權限已失效，請重新讀取後核對。' }, 409);
    // No dependent read after commit: a refresh failure cannot turn a successful
    // write into an apparent save failure.
    return json({ ok: true, id: mutation.record.id }, 201);
  }
  return { adminListReferences, adminCreateReference };
}
