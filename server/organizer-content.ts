import { groupOrganizerCircles } from "../app/organizer-circle-groups.mjs";
import { json, readJson } from "./http";
import { deleteObjectKeys } from "../app/hosted-thumbnails";
import { organizerMapBackgroundObjectKey, prepareMapImageFile, type PreparedMapImage } from "../app/map-contribution-files";
import { parseMapContributionDraftContent, validateMapContributionDraft } from "../app/map-contribution-draft";
import {
  describeEventImageBytes, eventImageKeyParts, eventImagePublicKey, organizerEventImageObjectKey, organizerEventImagePrefix, prepareEventImage, sameEventImage, type EventImage,
} from "../app/event-image";
import { parseOrganizerEventDraft, type OrganizerEventDraft } from "../app/organizer-event";
import { getOrganizerWorkspacePrerequisiteIssues, validateOrganizerImportedRowsAgainstDraft } from "../app/organizer-workspace";
import { resolveCandidateAuthoringScope } from "../app/event-authoring-scope";
import {
  createOrganizerReference, createCategoryReference, createVenueReference, createVenueSpaceReference, projectReferenceCatalog, completeVenueAddress, venueReferenceNeedsAddress, resolveOrganizerReferences, type OrganizerReferenceRecord,
} from "../app/organizer-reference-catalog";
import { readOrganizerAmendmentBaseline } from "../app/organizer-amendment-baseline";
import { applyAmendmentSettings, type OrganizerAmendmentSettings } from "../app/organizer-amendment-settings";
import {
  isOrganizerVenueSpaceAreaMode, normalizeOrganizerVenueAddress, normalizeOrganizerVenueName, normalizeOrganizerVenueSourceUrl, validateOrganizerVenueCatalogAssignments,
} from "../app/organizer-venue-catalog";
import type { Auth } from "./auth";
import type { PortalDependencies } from "../app/circle-portal-handlers";
import type { OrganizerAccess } from "./organizer";

/**
 * Organizer draft content (#546 phase 5): venues and references, the circle
 * import, maps and their backgrounds, the event picture, validation and the
 * preview. Part of the organizer module, split off to keep each file small.
 */

export function createOrganizerContent(dependencies: PortalDependencies, auth: Auth, { organizerAccess, organizerAuditRole }: OrganizerAccess) {
  const { repository, thumbnailStore, mapContributionStore, config } = dependencies;
  const { clientIpHash } = auth;

  async function listOrganizerVenues(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    return json(await repository.listOrganizerVenueCatalog());
  }

  async function createOrganizerReferenceEntry(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    if (!Number.isSafeInteger(body?.expectedVersion) || (body!.expectedVersion as number) < 1) return json({ error: "版本資訊無效，請重新載入。" }, 400);
    const now = config.now();
    if (body?.kind === "venue-address") return completeOrganizerVenueAddressEntry(access, body, candidateId, now);
    let record: OrganizerReferenceRecord;
    try {
      if (body?.kind === "organizer") record = createOrganizerReference({ name: body.name, sourceUrl: body.sourceUrl }, now);
      else if (body?.kind === "category-catalog" && typeof body.organizerId === "string") {
        record = createCategoryReference({ name: body.name, sourceUrl: body.sourceUrl, categories: body.categories }, body.organizerId, now);
      } else if ((body?.kind === "venue" || body?.kind === "venue-space") && typeof body.referenceId === "string") {
        const name = normalizeOrganizerVenueName(body.name);
        const sourceUrl = normalizeOrganizerVenueSourceUrl(body.sourceUrl);
        if (!name || !sourceUrl) return json({ error: "請填寫公開名稱與有效的 HTTPS 官方來源網址。" }, 400);
        const address = normalizeOrganizerVenueAddress(body.address);
        if (body.kind === "venue" && !address) return json({ error: "請填寫場館地址。" }, 400);
        const catalog = await repository.listOrganizerVenueCatalog();
        const venue = catalog.venues.find((item) => body.kind === "venue" ? item.id === body.referenceId : item.spaces.some((space) => space.id === body.referenceId));
        if (!venue) return json({ error: "找不到場館或場地。" }, 404);
        record = body.kind === "venue"
          ? createVenueReference({ id: venue.id, name, sourceUrl, address }, now)
          : createVenueSpaceReference({ id: body.referenceId, venueId: venue.id, name, sourceUrl }, now);
      } else return json({ error: "請選擇要建立的主辦或分類目錄。" }, 400);
    } catch (error) { return json({ error: error instanceof Error ? error.message : "主辦或分類資料無效。" }, 400); }
    const created = await repository.createOrganizerReferenceRecord({
      record, candidateId, expectedVersion: body!.expectedVersion as number,
      actorAccountId: access.current.accountId, actorRole: organizerAuditRole(access), admin: access.admin, now,
    });
    if (!created) return json({ error: "活動版本、編輯權限、狀態或主辦資料已變更，請重新載入。" }, 409);
    return json({ created: { id: record.id, organizerId: record.organizerId, revision: record.revision },
      catalog: projectReferenceCatalog(await repository.listOrganizerReferenceRecords()) }, 201);
  }

  /** Adds the address to a venue whose public record predates addresses (#395). */
  async function completeOrganizerVenueAddressEntry(access: { admin: boolean; role: "owner" | "admin"; current: { accountId: string } },
    body: Record<string, unknown>, candidateId: string, now: number) {
    const address = normalizeOrganizerVenueAddress(body.address);
    if (!address) return json({ error: "請填寫場館地址。" }, 400);
    const previous = typeof body.referenceId === "string"
      ? (await repository.listOrganizerReferenceRecords()).find((row) => row.kind === "venue" && row.id === body.referenceId) : undefined;
    if (!previous) return json({ error: "找不到場館。" }, 404);
    if (!venueReferenceNeedsAddress(previous)) return json({ error: "這個場館已經有地址，請重新載入。" }, 409);
    const record = completeVenueAddress(previous, address, now);
    const completed = await repository.completeOrganizerVenueAddress({
      previous, record, candidateId, expectedVersion: body.expectedVersion as number,
      actorAccountId: access.current.accountId, actorRole: organizerAuditRole(access), admin: access.admin, now,
    });
    if (!completed) return json({ error: "活動版本、編輯權限、狀態或場館資料已變更，請重新載入。" }, 409);
    return json({ created: { id: record.id, organizerId: null, revision: null },
      catalog: projectReferenceCatalog(await repository.listOrganizerReferenceRecords()) }, 201);
  }

  async function createOrganizerVenue(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    const initialSpace = body?.initialSpace && typeof body.initialSpace === "object" && !Array.isArray(body.initialSpace)
      ? body.initialSpace as Record<string, unknown> : null;
    const name = normalizeOrganizerVenueName(body?.name);
    const sourceUrl = normalizeOrganizerVenueSourceUrl(body?.sourceUrl);
    const address = normalizeOrganizerVenueAddress(body?.address);
    const spaceName = normalizeOrganizerVenueName(initialSpace?.name);
    /* null is blank and undefined is malformed, and the two answer
     * differently: 「全館」 rarely has a page of its own, so a blank space URL
     * inherits the venue it is being created under rather than making the
     * organizer paste the same address twice. Every row still carries an
     * official HTTPS source (#219). */
    const requestedSpaceUrl = normalizeOrganizerVenueSourceUrl(initialSpace?.sourceUrl);
    const defaultAreaMode = initialSpace?.defaultAreaMode ?? "imported";
    if (!name || !spaceName || !sourceUrl || requestedSpaceUrl === undefined
      || !isOrganizerVenueSpaceAreaMode(defaultAreaMode)) {
      return json({ error: "請填寫場館名稱、場地名稱與有效的 HTTPS 來源網址。" }, 400);
    }
    if (!address) return json({ error: "請填寫場館地址。" }, 400);
    const spaceSourceUrl = requestedSpaceUrl ?? sourceUrl;
    const venueId = `venue-${crypto.randomUUID()}`;
    const venueSpaceId = `venue-space-${crypto.randomUUID()}`;
    const now = config.now();
    const created = await repository.createOrganizerVenue({
      id: venueId,
      name,
      sourceUrl,
      address,
      createdByAccountId: access.current.accountId,
      now,
      initialSpace: { id: venueSpaceId, name: spaceName, sourceUrl: spaceSourceUrl, defaultAreaMode },
      audit: {
        at: now, actorAccountId: access.current.accountId,
        actorRole: organizerAuditRole(access),
        action: "organizer_venue.created", subjectType: "organizer_venue", subjectId: venueId,
        detail: { candidateId, venueSpaceId, defaultAreaMode }, ipHash: await clientIpHash(request),
      },
    });
    if (!created.ok) {
      return json({ error: created.reason === "duplicate" ? "這個場館或場地已經存在。" : "無法建立場館，請重新整理後再試。" }, 409);
    }
    return json({
      venue: { id: venueId, name, sourceUrl },
      space: { id: venueSpaceId, venueId, name: spaceName, sourceUrl: spaceSourceUrl, defaultAreaMode },
    }, 201);
  }

  async function createOrganizerVenueSpace(request: Request, candidateId: string, venueId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    const name = normalizeOrganizerVenueName(body?.name);
    const requestedUrl = normalizeOrganizerVenueSourceUrl(body?.sourceUrl);
    const defaultAreaMode = body?.defaultAreaMode ?? "imported";
    if (!name || requestedUrl === undefined || !isOrganizerVenueSpaceAreaMode(defaultAreaMode)) {
      return json({ error: "請填寫場地名稱與有效的 HTTPS 來源網址。" }, 400);
    }
    // Blank inherits the venue this space belongs to (#219). The catalog read
    // also answers the missing venue here rather than leaving it to the write.
    const parent = (await repository.listOrganizerVenueCatalog()).venues.find((item) => item.id === venueId);
    if (!parent) return json({ error: "找不到這個場館。" }, 404);
    const sourceUrl = requestedUrl ?? parent.sourceUrl;
    const venueSpaceId = `venue-space-${crypto.randomUUID()}`;
    const now = config.now();
    const created = await repository.createOrganizerVenueSpace({
      id: venueSpaceId,
      venueId,
      name,
      sourceUrl,
      defaultAreaMode,
      createdByAccountId: access.current.accountId,
      now,
      audit: {
        at: now, actorAccountId: access.current.accountId,
        actorRole: organizerAuditRole(access),
        action: "organizer_venue_space.created", subjectType: "organizer_venue_space", subjectId: venueSpaceId,
        detail: { candidateId, venueId, defaultAreaMode }, ipHash: await clientIpHash(request),
      },
    });
    if (!created.ok) {
      const error = created.reason === "not_found" ? "找不到這個場館。" : "這個場地已經存在。";
      return json({ error }, created.reason === "not_found" ? 404 : 409);
    }
    return json({ space: { id: venueSpaceId, venueId, name, sourceUrl, defaultAreaMode } }, 201);
  }

  async function readAmendment(candidateId: string) {
    const stored = await repository.getOrganizerAmendment(candidateId);
    if (!stored) return null;
    const baseline = await readOrganizerAmendmentBaseline(stored.baseline_json, stored.baseline_sha256);
    return { stored, baseline, changes: JSON.parse(stored.changes_json) as unknown[],
      settings: stored.settings_json ? JSON.parse(stored.settings_json) as OrganizerAmendmentSettings : null };
  }

  async function validateOrganizerWorkspace(candidateId: string, draft: OrganizerEventDraft) {
    const [imported, maps, venueCatalog, referenceRecords] = await Promise.all([
      repository.getOrganizerImport(candidateId), repository.listOrganizerMapDrafts(candidateId),
      repository.listOrganizerVenueCatalog(), repository.listOrganizerReferenceRecords(),
    ]);
    const issues = getOrganizerWorkspacePrerequisiteIssues({
      draft,
      importedRows: imported?.rows.length ?? 0,
      importedVenueSpaceIds: imported?.rows.map((row) => row.venue_space_id),
      maps: maps.map((map) => ({ periodKey: map.period_key, venueSpaceId: map.venue_space_id })),
    });
    const referenceCatalog = projectReferenceCatalog(referenceRecords);
    const resolved = await resolveOrganizerReferences(draft, referenceRecords);
    issues.push(...resolved.issues);
    issues.push(...validateOrganizerVenueCatalogAssignments(draft.venue.assignments, venueCatalog));
    issues.push(...validateOrganizerImportedRowsAgainstDraft(
      draft,
      (imported?.rows ?? []).map((row) => ({
        sourceRow: row.source_row,
        dayId: row.day_id,
        venueSpaceId: row.venue_space_id,
        areaId: row.area_id,
      })),
    ));
    // The candidate, its import and every map body are read exactly once here.
    // Resolving scope per day × venue-space used to reload the candidate and
    // the whole import inside the loop, so a multi-day multi-hall event — the
    // case this workspace exists for — paid for the full booth list once per
    // scope on validate, on preview and again on submit.
    const importedRows = (imported?.rows ?? []).map((row) => ({
      dayId: row.day_id, venueSpaceId: row.venue_space_id, codes: row.codes,
    }));
    const contents = new Map<string, string>();
    for (const [index, detail] of (await Promise.all(
      maps.map((map) => repository.getOrganizerMapDraft(candidateId, map.id)),
    )).entries()) {
      if (detail?.content_json) contents.set(maps[index].id, detail.content_json);
    }
    for (const day of draft.event.days) {
      for (const assignment of draft.venue.assignments) {
        const map = maps.find((item) => item.period_key === day.id && item.venue_space_id === assignment.venueSpaceId);
        if (!map) continue;
        const scope = resolveCandidateAuthoringScope({ candidateId, draft, importedRows }, day.id, assignment.venueSpaceId);
        const content = contents.get(map.id);
        const validation = scope && content ? validateMapContributionDraft(
          JSON.parse(content) as unknown,
          {
            eventId: draft.event.id ?? candidateId, periodKey: scope.periodKey, periodAliases: [scope.periodKey],
            venueSpaceId: scope.venueSpaceId, mapTemplate: scope.mapTemplate,
            areaIds: scope.areaIds,
            allowedBoothCodes: scope.allowedBoothCodes, requiredBoothCodes: scope.requiredBoothCodes,
            allowsUnallocatedBooths: scope.allowsUnallocatedBooths,
            targetPath: `candidate://${candidateId}/${scope.periodKey}/${scope.venueSpaceId}`,
          },
        ) : null;
        // A passing draft can still carry warnings -- unallocated booths, most
        // of the time -- and they are reported at their own severity so the map
        // section stays open while the author still sees what was noticed.
        const problems = validation
          ? validation.problems
          : [{ code: "invalid_content" as const, message: "地圖草稿無效。", severity: undefined }];
        for (const problem of problems) {
          issues.push({
            severity: problem.severity === "warning" ? "warning" : "error", step: "map", code: problem.code,
            target: `${day.id}/${assignment.venueSpaceId}`, message: problem.message,
            ...("boothCodes" in problem && problem.boothCodes ? { boothCodes: problem.boothCodes } : {}),
          });
        }
      }
    }
    const missingVenueReferences = venueCatalog.venues.flatMap((venue) => [
      { kind: "venue" as const, id: venue.id, name: venue.name, sourceUrl: venue.sourceUrl },
      ...venue.spaces.map((space) => ({ kind: "venue-space" as const, id: space.id, name: `${venue.name}・${space.name}`, sourceUrl: space.sourceUrl })),
    ]).filter((item) => !referenceRecords.some((record) => record.kind === item.kind && record.id === item.id)
      && draft.venue.assignments.some((assignment) => item.kind === "venue" ? assignment.venueId === item.id : assignment.venueSpaceId === item.id));
    // A venue with no public record yet is asked for its address in the form
    // above; these have a record, written before venues had addresses.
    const missingVenueAddresses = referenceRecords.filter((record) => venueReferenceNeedsAddress(record)
      && draft.venue.assignments.some((assignment) => assignment.venueId === record.id))
      .map((record) => ({ id: record.id, name: venueCatalog.venues.find((venue) => venue.id === record.id)?.name ?? record.displayName }));
    return { issues, imported, maps, contents, venueCatalog, referenceCatalog, missingVenueReferences, missingVenueAddresses,
      referenceSnapshot: resolved.snapshot };
  }

  async function putOrganizerImport(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    if ((await repository.getOrganizerCandidate(candidateId))?.publication_operation === "AMEND") {
      return json({ error: "已發布名單不能以匯入缺列推論變動，請使用明確修正宣告。", code: "amendment_declaration_required" }, 409);
    }
    const body = await readJson(request);
    const expectedVersion = body?.expectedVersion;
    const source = body?.source && typeof body.source === "object" && !Array.isArray(body.source)
      ? body.source as Record<string, unknown> : null;
    const rows = Array.isArray(body?.rows) ? body.rows : null;
    if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1 || !source || !rows) {
      return json({ error: "匯入資料不完整，請重新整理後再試一次。" }, 400);
    }
    // A well-formed import that is merely too long deserves its own message:
    // the organizer can act on the row cap, but not on a sentence that also
    // covers a missing expectedVersion.
    if (rows.length > 20_000) return json({ error: "匯入資料最多 20,000 列。" }, 400);
    const fileName = typeof source.fileName === "string" ? source.fileName.normalize("NFKC").trim() : "";
    const worksheet = source.worksheet === null ? null
      : typeof source.worksheet === "string" ? source.worksheet.normalize("NFKC").trim() : undefined;
    const sha256 = typeof source.sha256 === "string" ? source.sha256.toLowerCase() : "";
    const sourceDescription = typeof source.sourceDescription === "string" ? source.sourceDescription.normalize("NFKC").trim() : "";
    let mappingJson = "";
    try { mappingJson = JSON.stringify(source.mapping); } catch { mappingJson = ""; }
    if (!fileName || fileName.length > 255 || worksheet === undefined || (worksheet?.length ?? 0) > 120
      || !/^[0-9a-f]{64}$/u.test(sha256) || !sourceDescription || sourceDescription.length > 500
      || !mappingJson || new TextEncoder().encode(mappingJson).byteLength > 100_000) {
      return json({ error: "匯入來源資訊格式無效。" }, 400);
    }

    const candidate = await repository.getOrganizerCandidate(candidateId);
    if (!candidate) return json({ error: "找不到活動。" }, 404);
    const draft = parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown);
    if (!draft) return json({ error: "活動資料格式無效，請聯絡網站管理者。" }, 500);
    const days = new Set(draft.event.days.map((day) => day.id));
    const spaces = new Map(draft.venue.assignments.map((assignment) => [assignment.venueSpaceId, assignment]));
    const normalized: Array<{
      sourceRow: number; dayId: string; venueSpaceId: string; areaId: string; codes: string[];
      circleName: string; stableKey: string | null; identityGroup: string | null;
    }> = [];
    const placements = new Set<string>();
    for (const value of rows) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return json({ error: "匯入資料格式無效。" }, 400);
      const row = value as Record<string, unknown>;
      const sourceRow = row.sourceRow;
      const rowLabel = sourceRow === 0 ? "手動群組" : `來源列 ${String(sourceRow)}`;
      const dayId = typeof row.dayId === "string" ? row.dayId.normalize("NFKC").trim() : "";
      const venueSpaceId = typeof row.venueSpaceId === "string" ? row.venueSpaceId.normalize("NFKC").trim() : "";
      const submittedAreaId = typeof row.areaId === "string" ? row.areaId.normalize("NFKC").trim() : "";
      const codes = Array.isArray(row.codes) && row.codes.every((code) => typeof code === "string")
        ? row.codes.map((code: string) => code.normalize("NFKC").trim()) : [];
      const circleName = typeof row.circleName === "string" ? row.circleName.normalize("NFKC").trim().replace(/\s+/gu, " ") : "";
      const stableKey = row.stableKey === null ? null : typeof row.stableKey === "string" ? row.stableKey.normalize("NFKC").trim() : undefined;
      const identityGroup = row.identityGroup === null ? null : typeof row.identityGroup === "string" ? row.identityGroup.normalize("NFKC").trim() : undefined;
      const assignment = spaces.get(venueSpaceId);
      const areaId = assignment?.areaMode === "none" ? "ALL" : submittedAreaId;
      const areaAllowed = assignment?.areaMode === "none" || assignment?.areaIds.includes(areaId);
      if (!Number.isSafeInteger(sourceRow) || (sourceRow as number) < 0 || !days.has(dayId)
        || !assignment || !areaAllowed || codes.length === 0 || codes.some((code) => !code || code.length > 80)
        || !circleName || circleName.length > 200 || stableKey === undefined || identityGroup === undefined
        || identityGroup !== (stableKey ? `stable:${stableKey}` : null)) {
        return json({ error: `${rowLabel} 的活動日、場地、展區或社團識別對應不一致。` }, 422);
      }
      for (const code of codes) {
        const placement = `${dayId}\u0000${venueSpaceId}\u0000${code.toLocaleLowerCase("en-US")}`;
        if (placements.has(placement)) return json({ error: `${rowLabel} 的攤位 ${code} 重複。` }, 422);
        placements.add(placement);
      }
      normalized.push({ sourceRow: sourceRow as number, dayId, venueSpaceId, areaId, codes, circleName, stableKey, identityGroup });
    }
    // The row count and per-field caps bound a normal import, but 20,000 rows
    // of maximum-length names escape to far more bytes than a Worker should
    // hold. Refuse that before it reaches the database rather than failing on
    // an opaque storage error partway through the organizer's main task.
    if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > 8 * 1024 * 1024) {
      return json({ error: "匯入資料超過 8 MB，請縮短欄位內容或確認匯入範圍是同一場活動。" }, 413);
    }
    const result = await repository.replaceOrganizerImport({
      candidateId, actorAccountId: access.current.accountId, expectedVersion: expectedVersion as number,
      source: { fileName, worksheet, sha256, sourceDescription, mappingJson }, rows: normalized,
      now: config.now(), admin: access.admin,
    });
    if (!result.ok) {
      if (result.reason === "not_found" || result.reason === "forbidden") return json({ error: "找不到活動。" }, 404);
      return json({ error: result.reason === "status" ? "目前狀態不可匯入。" : "草稿已被其他人更新，請重新載入。", conflict: result }, 409);
    }
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId,
      actorRole: organizerAuditRole(access),
      action: "organizer_event.import_replaced", subjectType: "organizer_event", subjectId: candidateId,
      // The source hash is what provenance needs. A private workbook's file and
      // sheet names are the organizer's own data and would outlive the import
      // row they describe, so they stay out of the durable audit trail.
      detail: { version: result.version, rows: normalized.length, sha256 },
      ipHash: await clientIpHash(request),
    });
    return json({ ok: true, candidateId, version: result.version, importedRows: normalized.length });
  }

  async function candidateMapScope(candidateId: string, periodKey: string, venueSpaceId: string) {
    const [candidate, imported] = await Promise.all([
      repository.getOrganizerCandidate(candidateId), repository.getOrganizerImport(candidateId),
    ]);
    if (!candidate) return null;
    const draft = parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown);
    if (!draft) return null;
    return resolveCandidateAuthoringScope({
      candidateId, draft,
      importedRows: (imported?.rows ?? []).map((row) => ({
        dayId: row.day_id, venueSpaceId: row.venue_space_id, codes: row.codes,
      })),
    }, periodKey, venueSpaceId);
  }

  async function listOrganizerMaps(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const includeCoverage = new URL(request.url).searchParams.get("coverage") === "1";
    const maps = await repository.listOrganizerMapDrafts(candidateId, includeCoverage);
    return json({ maps: maps.map((map) => ({
      id: map.id, periodKey: map.period_key, venueSpaceId: map.venue_space_id,
      status: map.status, mapRevision: map.current_revision, updatedAt: map.updated_at,
      ...(includeCoverage ? { boothCodes: map.content_json
        ? parseMapContributionDraftContent(JSON.parse(map.content_json))?.layout.rows.flatMap(row => row.slots.map(slot => slot.code)) ?? null
        : null } : {}),
    })) });
  }

  async function getOrganizerMap(request: Request, candidateId: string, draftId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const map = await repository.getOrganizerMapDraft(candidateId, draftId);
    if (!map?.content_json) return json({ error: "找不到地圖草稿。" }, 404);
    const content = parseMapContributionDraftContent(JSON.parse(map.content_json) as unknown);
    if (!content) return json({ error: "地圖草稿格式無效。" }, 500);
    return json({ map: {
      id: map.id, periodKey: map.period_key, venueSpaceId: map.venue_space_id,
      status: map.status, mapRevision: map.current_revision, updatedAt: map.updated_at,
      layout: content.layout, ...(content.authoring ? { authoring: content.authoring } : {}),
    } });
  }

  async function createOrganizerMap(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    const expectedVersion = body?.expectedVersion;
    const periodKey = typeof body?.periodKey === "string" ? body.periodKey.normalize("NFKC").trim() : "";
    const venueSpaceId = typeof body?.venueSpaceId === "string" ? body.venueSpaceId.normalize("NFKC").trim() : "";
    const content = parseMapContributionDraftContent({ schema: "map-contribution-draft/1", layout: body?.layout, ...(body?.authoring === undefined ? {} : { authoring: body.authoring }) });
    if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1 || !content) {
      return json({ error: "活動日、場地與地圖內容為必填。" }, 400);
    }
    const scope = await candidateMapScope(candidateId, periodKey, venueSpaceId);
    if (!scope || content.layout.template !== scope.mapTemplate) return json({ error: "這張地圖的活動日、場地或地圖模板不屬於此活動。" }, 422);
    const draftId = crypto.randomUUID();
    const result = await repository.createOrganizerMapDraft({
      id: draftId, candidateId, periodKey: scope.periodKey, venueSpaceId: scope.venueSpaceId,
      actorAccountId: access.current.accountId, expectedVersion: expectedVersion as number,
      contentJson: JSON.stringify(content), now: config.now(), admin: access.admin,
    });
    if (!result.ok) {
      const status = result.reason === "not_found" || result.reason === "forbidden" ? 404
        : result.reason === "scope_exists" ? 409 : 409;
      return json({ error: result.reason === "scope_exists" ? "此 day × venue-space 已有地圖草稿。" : "版本或狀態已變更。", conflict: result }, status);
    }
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId,
      actorRole: organizerAuditRole(access),
      action: "organizer_event.map_created", subjectType: "organizer_event", subjectId: candidateId,
      detail: { version: result.version, draftId, periodKey, venueSpaceId }, ipHash: await clientIpHash(request),
    });
    return json({ ok: true, draftId, version: result.version, mapRevision: result.mapRevision }, 201);
  }

  async function updateOrganizerMap(request: Request, candidateId: string, draftId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const body = await readJson(request);
    const expectedVersion = body?.expectedVersion;
    const expectedMapRevision = body?.expectedMapRevision;
    const content = parseMapContributionDraftContent({ schema: "map-contribution-draft/1", layout: body?.layout, ...(body?.authoring === undefined ? {} : { authoring: body.authoring }) });
    if (!Number.isSafeInteger(expectedVersion) || !Number.isSafeInteger(expectedMapRevision) || !content) {
      return json({ error: "地圖版本或內容無效，請重新載入。" }, 400);
    }
    const current = await repository.getOrganizerMapDraft(candidateId, draftId);
    if (!current) return json({ error: "找不到地圖草稿。" }, 404);
    const scope = await candidateMapScope(candidateId, current.period_key, current.venue_space_id);
    if (!scope || content.layout.template !== scope.mapTemplate) return json({ error: "這張地圖的活動日、場地或地圖模板不屬於此活動。" }, 422);
    const result = await repository.saveOrganizerMapDraft({
      candidateId, draftId, actorAccountId: access.current.accountId,
      expectedVersion: expectedVersion as number, expectedMapRevision: expectedMapRevision as number,
      contentJson: JSON.stringify(content), now: config.now(), admin: access.admin,
    });
    if (!result.ok) return json({ error: result.reason === "not_found" ? "找不到地圖草稿。" : "版本或狀態已變更。", conflict: result }, result.reason === "not_found" ? 404 : 409);
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId,
      actorRole: organizerAuditRole(access),
      action: "organizer_event.map_updated", subjectType: "organizer_event", subjectId: candidateId,
      detail: { version: result.version, draftId, mapRevision: result.mapRevision }, ipHash: await clientIpHash(request),
    });
    return json({ ok: true, version: result.version, mapRevision: result.mapRevision });
  }

  const MAP_BACKGROUND_TYPES = ["image/jpeg", "image/png", "image/webp"];

  /** The layout plan a candidate map is traced from. One file per map, replaced
   * in place, and deliberately outside the revision stream: the plan is an
   * authoring aid rather than reviewable content, so putting one behind the
   * booths must not move the candidate on a version or write a map revision
   * that says nothing about the layout. */
  async function putOrganizerMapBackground(request: Request, candidateId: string, draftId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    if (!mapContributionStore) return json({ error: "暫時無法使用配置圖，請稍後再試。" }, 503);
    const [candidate, map] = await Promise.all([
      repository.getOrganizerCandidate(candidateId),
      repository.getOrganizerMapDraft(candidateId, draftId),
    ]);
    if (!candidate || !map) return json({ error: "找不到地圖草稿。" }, 404);
    if (candidate.status !== "draft" && candidate.status !== "changes_requested") {
      return json({ error: "這個活動目前不能編輯。" }, 409);
    }
    let form: FormData;
    try { form = await request.formData(); } catch { return json({ error: "上傳格式無效。" }, 400); }
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "請選擇配置圖。" }, 400);
    let prepared: PreparedMapImage;
    try { prepared = await prepareMapImageFile(file); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "配置圖格式無效。" }, 400); }
    await mapContributionStore.put(
      organizerMapBackgroundObjectKey({ candidateId, draftId }), prepared.bytes, prepared.contentType,
    );
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId, actorRole: organizerAuditRole(access),
      action: "organizer_event.map_background_updated", subjectType: "organizer_event", subjectId: candidateId,
      detail: {
        draftId, sha256: prepared.sha256, sizeBytes: prepared.sizeBytes,
        width: prepared.width, height: prepared.height,
      },
      ipHash: await clientIpHash(request),
    });
    return json({ ok: true, width: prepared.width, height: prepared.height });
  }

  async function getOrganizerMapBackground(request: Request, candidateId: string, draftId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    if (!mapContributionStore) return json({ error: "暫時無法使用配置圖，請稍後再試。" }, 503);
    const map = await repository.getOrganizerMapDraft(candidateId, draftId);
    if (!map) return json({ error: "找不到地圖草稿。" }, 404);
    let object = await mapContributionStore.get(organizerMapBackgroundObjectKey({ candidateId, draftId }));
    // A copied map has a new id. Its published baseline authorizes reading the
    // same scope's source plan without exposing a bucket key to the browser or
    // writing during GET. An uploaded replacement always belongs to this map.
    // Follow successive amendments too; retained source bytes keep their
    // existing lifetime rather than being copied into a new retention window.
    const visited = new Set([candidateId]);
    let sourceCandidateId = candidateId;
    while (!object) {
      const amendment = await readAmendment(sourceCandidateId);
      if (!amendment || amendment.baseline.source.candidateId !== amendment.stored.source_candidate_id
        || amendment.baseline.source.candidateVersion !== amendment.stored.source_version
        || amendment.baseline.event.id !== map.event_id) break;
      sourceCandidateId = amendment.stored.source_candidate_id;
      if (visited.has(sourceCandidateId)) break;
      visited.add(sourceCandidateId);
      const sourceMaps = amendment.baseline.maps.filter((source) => source.periodKey === map.period_key && source.venueSpaceId === map.venue_space_id);
      if (sourceMaps.length !== 1) break;
      const [sourceCandidate, sourceMap] = await Promise.all([
        repository.getOrganizerCandidate(sourceCandidateId),
        repository.getOrganizerMapDraft(sourceCandidateId, sourceMaps[0].id),
      ]);
      if (!sourceCandidate || sourceCandidate.status !== "published" || sourceCandidate.published_version !== amendment.stored.source_version
        || !sourceMap || sourceMap.event_id !== map.event_id || sourceMap.period_key !== map.period_key || sourceMap.venue_space_id !== map.venue_space_id) break;
      object = await mapContributionStore.get(organizerMapBackgroundObjectKey({ candidateId: sourceCandidateId, draftId: sourceMap.id }));
    }
    // The bucket answers with whatever was written. Only the three types the
    // upload accepts are served back, so a stray object cannot pick the content
    // type of a private response.
    const contentType = object?.contentType ?? "";
    if (!object || !MAP_BACKGROUND_TYPES.includes(contentType)) return json({ error: "找不到配置圖。" }, 404);
    return new Response(object.body, {
      headers: {
        "content-type": contentType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  }

  const EVENT_IMAGE_UNAVAILABLE = "暫時無法使用活動圖片，請稍後再試。";

  /** The staged upload a draft or declaration points at, re-read and re-checked:
   * what the browser sent back about a picture is only trusted once the bucket
   * holds exactly those bytes, under the address the draft names. */
  async function readStagedEventImage(candidateId: string, image: EventImage): Promise<ArrayBuffer | null> {
    if (!mapContributionStore || !thumbnailStore) return null;
    if (image.url !== thumbnailStore.url(eventImagePublicKey(image))) return null;
    const object = await mapContributionStore.get(organizerEventImageObjectKey(candidateId, image));
    if (!object) return null;
    const bytes = await new Response(object.body).arrayBuffer();
    try {
      const described = await describeEventImageBytes(object.contentType ?? "", bytes);
      return described.sha256 === image.sha256 && described.contentType === image.contentType
        && described.width === image.width && described.height === image.height ? bytes : null;
    } catch { return null; }
  }

  /** A save that keeps the picture it already had needs no bucket read. */
  async function eventImageChangeProblem(candidateId: string, previous: EventImage | undefined, next: EventImage | undefined) {
    if (!next || sameEventImage(previous, next)) return null;
    if (!mapContributionStore || !thumbnailStore) return { status: 503, error: EVENT_IMAGE_UNAVAILABLE };
    return await readStagedEventImage(candidateId, next) ? null
      : { status: 422, error: "找不到剛上傳的活動圖片，請重新上傳後再儲存。" };
  }

  /** Staged uploads the submission does not use. Run only once a submission
   * has frozen the content: while the draft is editable, a concurrent save
   * could come to point at any of them. Cleanup never fails the submission. */
  async function pruneStagedEventImages(candidateId: string, keep: EventImage | undefined) {
    if (!mapContributionStore?.list) return;
    try {
      const kept = keep ? organizerEventImageObjectKey(candidateId, keep) : null;
      const stale = (await mapContributionStore.list(organizerEventImagePrefix(candidateId))).filter((key) => key !== kept);
      await deleteObjectKeys(mapContributionStore, stale);
    } catch { /* The next submission tries again. */ }
  }

  /** Approval makes the picture public before the publication that names it
   * starts. The key is the content hash, so a retried approval, or a
   * correction that keeps the published picture, finds it already there. */
  async function publishEventImage(candidateId: string, image: EventImage) {
    if (!thumbnailStore) return false;
    const key = eventImagePublicKey(image);
    if ((await thumbnailStore.list(key)).includes(key)) return true;
    const bytes = await readStagedEventImage(candidateId, image);
    if (!bytes) return false;
    await thumbnailStore.put(key, bytes, image.contentType);
    return true;
  }

  async function putOrganizerEventImage(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    if (!mapContributionStore || !thumbnailStore) return json({ error: EVENT_IMAGE_UNAVAILABLE }, 503);
    const candidate = await repository.getOrganizerCandidate(candidateId);
    if (!candidate) return json({ error: "找不到活動。" }, 404);
    if (candidate.status !== "draft" && candidate.status !== "changes_requested") {
      return json({ error: "這個活動目前不能編輯。" }, 409);
    }
    let form: FormData;
    try { form = await request.formData(); } catch { return json({ error: "上傳格式無效。" }, 400); }
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "請選擇活動圖片。" }, 400);
    let prepared: Awaited<ReturnType<typeof prepareEventImage>>;
    try { prepared = await prepareEventImage(file, thumbnailStore.url); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "活動圖片格式無效。" }, 400); }
    // Staged only. The draft points at it once the organizer saves, and it
    // becomes public only when an approval publishes the event.
    await mapContributionStore.put(organizerEventImageObjectKey(candidateId, prepared.image), prepared.bytes, prepared.image.contentType);
    await repository.writeAudit({
      at: config.now(), actorAccountId: access.current.accountId, actorRole: organizerAuditRole(access),
      action: "organizer_event.image_uploaded", subjectType: "organizer_event", subjectId: candidateId,
      detail: { sha256: prepared.image.sha256, sizeBytes: file.size, width: prepared.image.width, height: prepared.image.height },
      ipHash: await clientIpHash(request),
    });
    return json({ ok: true, image: prepared.image });
  }

  /** The private copy of an upload, for the organizer to see before approval.
   * A picture already published is read from its public address instead. */
  async function getOrganizerEventImage(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    if (!mapContributionStore || !thumbnailStore) return json({ error: EVENT_IMAGE_UNAVAILABLE }, 503);
    const query = new URL(request.url).searchParams;
    const image = eventImageKeyParts(query.get("sha256"), query.get("contentType"));
    const object = image ? await mapContributionStore.get(organizerEventImageObjectKey(candidateId, image)) : null;
    if (!image || !object || object.contentType !== image.contentType) return json({ error: "找不到活動圖片。" }, 404);
    return new Response(object.body, {
      headers: {
        "content-type": image.contentType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  }

  async function validateOrganizerCandidate(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const candidate = await repository.getOrganizerCandidate(candidateId);
    if (!candidate) return json({ error: "找不到活動。" }, 404);
    const draft = parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown);
    if (!draft) return json({ error: "活動資料格式無效，請聯絡網站管理者。" }, 500);
    const { issues } = await validateOrganizerWorkspace(candidateId, draft);
    const ok = issues.every((issue) => issue.severity !== "error");
    if (ok && !await repository.markOrganizerValidated(candidateId, candidate.current_version, config.now())) {
      const current = await repository.getOrganizerCandidate(candidateId);
      if (!current) return json({ error: "找不到活動。" }, 404);
      return json({
        error: "草稿已被其他人更新，請重新驗證。",
        conflict: { currentVersion: current.current_version },
      }, 409);
    }
    return json({ ok, version: candidate.current_version, issues });
  }

  async function previewOrganizerCandidate(request: Request, candidateId: string) {
    const access = await organizerAccess(request, candidateId);
    if (!access.ok) return access.response;
    const candidate = await repository.getOrganizerCandidate(candidateId);
    if (!candidate) return json({ error: "找不到活動。" }, 404);
    const draft = parseOrganizerEventDraft(JSON.parse(candidate.current_draft_json) as unknown);
    if (!draft) return json({ error: "活動資料格式無效，請聯絡網站管理者。" }, 500);
    const { issues, imported, maps, contents, referenceSnapshot } = await validateOrganizerWorkspace(candidateId, draft);
    // A correction's draft stays the published one; readers will see it with
    // the declared settings applied.
    const amendment = candidate.publication_operation === "AMEND" ? await readAmendment(candidateId) : null;
    const shown = amendment ? applyAmendmentSettings(draft, amendment.settings) : draft;
    const previewRows = (imported?.rows ?? []).map(row => ({
      dayId: row.day_id, circleName: row.circle_name, codes: row.codes, stableKey: row.stable_key,
    }));
    const circleGroups = new Map(groupOrganizerCircles(previewRows).flatMap(group =>
      group.rowIndexes.map(index => [index, group.key] as const)));
    const mapArtifacts = maps.map((map) => {
      const stored = contents.get(map.id);
      const content = stored ? parseMapContributionDraftContent(JSON.parse(stored) as unknown) : null;
      return content ? {
        periodKey: map.period_key, venueSpaceId: map.venue_space_id,
        revision: map.current_revision, layout: content.layout,
      } : null;
    });
    return json({
      version: candidate.current_version,
      issues,
      preview: {
        schema: "organizer-reader-preview/1",
        event: shown.event, venueAssignments: draft.venue.assignments, officialSource: draft.officialSource,
        references: referenceSnapshot ? referenceSnapshot.files.map((file) => JSON.parse(file.content) as unknown) : [],
        placements: (imported?.rows ?? []).flatMap((row, index) => row.codes.map((boothCode) => ({
          sourceRow: row.source_row, dayId: row.day_id, venueSpaceId: row.venue_space_id,
          areaId: row.area_id, boothCode, circleName: row.circle_name,
          identityGroup: amendment ? row.identity_group : circleGroups.get(index),
        }))),
        maps: mapArtifacts.filter(Boolean),
      },
    });
  }

  return {
    readAmendment, validateOrganizerWorkspace, eventImageChangeProblem, pruneStagedEventImages, publishEventImage,
    routes: {
      listOrganizerVenues, createOrganizerVenue, createOrganizerVenueSpace, createOrganizerReferenceEntry,
      putOrganizerImport, listOrganizerMaps, getOrganizerMap, createOrganizerMap,
      updateOrganizerMap, putOrganizerMapBackground, getOrganizerMapBackground, putOrganizerEventImage,
      getOrganizerEventImage, validateOrganizerCandidate, previewOrganizerCandidate,
    },
  };
}

export type OrganizerContent = ReturnType<typeof createOrganizerContent>;
