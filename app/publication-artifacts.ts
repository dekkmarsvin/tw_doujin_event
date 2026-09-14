import { parseOrganizerEventDraft, validateOrganizerEventDraft } from "./organizer-event";
import type { OrganizerNormalizedImportRow } from "./organizer-import";
import type { OrganizerReferenceSnapshot } from "./organizer-reference-catalog";
import { parseEventDefinition } from "./event-catalog";
import { buildMapCandidate, validateMapContributionDraft } from "./map-contribution-draft";
import { resolveCandidateAuthoringScope } from "./event-authoring-scope";
import { eventMapArtifactPath } from "./event-map-manifest";
import { verifyReferenceFiles, selectEventReferenceRecords } from "./reference-selection.mjs";
import { parseOfficialBoothData } from "./official-booth-data.mjs";
import { parseCircleIdentityGrouping, planCircleIdentityRegistryUpdate } from "./circle-identity-registry.mjs";
import { parseEventDataPin, EVENT_DATA_REPOSITORY } from "./event-data-pin.mjs";
import { parsePublishedEvents } from "./published-events.mjs";
import { assemblePublicationStage, type PublicationBundleFile } from "./publication-bundle-assembler";
import { PublicationFailure } from "./organizer-publication";
import { sha256Hex } from "./portal-crypto";

export type ApprovedArtifactSource = { snapshotJson: string; approvalHash: string };
type Snapshot = {
  schema: string; candidateId: string; candidateVersion: number; eventId: string; draft: unknown; contentUpdatedAt: string;
  references: OrganizerReferenceSnapshot;
  import: { source: { sourceDescription: string }; rows: OrganizerNormalizedImportRow[] };
  maps: Array<{ id: string; periodKey: string; venueSpaceId: string; mapRevision: number; content: unknown }>;
};
const COMMIT = /^[0-9a-f]{40}$/;
const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
function fail(message: string, code = "artifact_invalid"): never { throw new PublicationFailure(code, message, false); }
function requireCommit(commit: string) { if (!COMMIT.test(commit)) fail("產檔需要完整的固定 commit SHA。"); }
function semanticJson(text: string): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)])) : value;
  return JSON.stringify(canonical(JSON.parse(text)));
}

/** Pure approved input conversion; no catalog, clock, repository or network reads. */
export async function buildApprovedPublicationArtifacts(source: ApprovedArtifactSource) {
  try {
    if (await sha256Hex(source.snapshotJson) !== source.approvalHash) fail("核准 snapshot 的內容與 hash 不符。", "snapshot_mismatch");
    const snapshot = JSON.parse(source.snapshotJson) as Snapshot;
    if (snapshot.schema !== "organizer-submission-snapshot/3") fail("此歷史 snapshot 缺少完整發布資料，請重新整理並送審。");
    const draft = parseOrganizerEventDraft(snapshot.draft);
    if (!draft || !snapshot.candidateId || !Number.isSafeInteger(snapshot.candidateVersion) || snapshot.candidateVersion < 1
      || snapshot.eventId !== draft.event.id || !draft.references?.categoryCatalog
      || validateOrganizerEventDraft(draft).some((issue) => issue.severity === "error")
      || !Array.isArray(snapshot.import?.rows) || !snapshot.import.rows.length || !Array.isArray(snapshot.maps)) fail("核准 snapshot 的活動資料不完整。");
    const timestamp = Date.parse(snapshot.contentUpdatedAt);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== snapshot.contentUpdatedAt) fail("核准內容時間無效。");
    const templates = [...new Set(draft.venue.assignments.map((assignment) => assignment.mapTemplate))];
    if (templates.length !== 1) fail("目前公開活動格式要求所有使用空間採同一地圖模板。");
    const areaIds = draft.venue.assignments.flatMap((assignment) => assignment.areaIds);
    if (!areaIds.length || new Set(areaIds).size !== areaIds.length) fail("各使用空間的展區必須明確且不可重複。");
    const dates = draft.event.days.map((day) => day.date).sort();
    const event = {
      schema: "event-definition/3", id: snapshot.eventId, name: draft.event.name,
      dateRangeLabel: dates[0] === dates.at(-1) ? dates[0] : `${dates[0]}–${dates.at(-1)}`,
      dataUpdatedAt: snapshot.contentUpdatedAt, eventEndsAt: `${dates.at(-1)}T23:59:59+08:00`,
      mapTemplate: templates[0], areaMode: areaIds.length === 1 ? "single" : "switchable",
      days: draft.event.days.map((day) => ({ id: day.id, label: day.label, dateLabel: day.date })),
      areas: areaIds.map((id) => ({ id, label: id, shortLabel: id })),
      organizerAssignments: draft.references.organizerAssignments, categoryCatalog: draft.references.categoryCatalog,
      venueAssignments: draft.venue.assignments.map(({ venueId, venueSpaceId, areaIds }) => ({ venueId, venueSpaceId, areaIds })),
      officialData: { adapter: "organizer-import/1", eventUrl: draft.officialSource.url,
        boothListUrls: Object.fromEntries(draft.event.days.map((day) => [day.id, draft.officialSource.url])) },
    };
    const prefix = `events/${snapshot.eventId}/`;
    const inputs: Array<{ path: string; content: unknown }> = [];
    const refs = new Map<string, Uint8Array>();
    for (const file of snapshot.references.files) {
      if (refs.has(file.path) || await sha256Hex(file.content) !== file.sha256) fail("核准 reference 的 path 或 hash 不符。");
      refs.set(file.path, new TextEncoder().encode(file.content));
      inputs.push({ path: file.path, content: file.content });
    }
    const verified = verifyReferenceFiles(snapshot.references.selection, refs, snapshot.eventId);
    parseEventDefinition(event, selectEventReferenceRecords(snapshot.references.selection, verified.records, event));
    for (const row of snapshot.import.rows) {
      const assignment = draft.venue.assignments.find((item) => item.venueSpaceId === row.venueSpaceId);
      if (!draft.event.days.some((day) => day.id === row.dayId) || !assignment?.areaIds.includes(row.areaId)
        || row.identityGroup !== (row.stableKey ? `stable:${row.stableKey}` : null)) fail("匯入列與已核准日期、展區或身分連結不符。");
    }
    const official = { schemaVersion: 1, days: draft.event.days.map((day) => ({ day: day.id, url: draft.officialSource.url,
      booths: snapshot.import.rows.filter((row) => row.dayId === day.id).map((row) => ({ codes: row.codes, name: row.circleName, areaId: row.areaId })) })) };
    parseOfficialBoothData(official, event);
    const groups = new Map<string, { sources: string[]; linkage?: { kind: string; value: string; reference: string } }>();
    snapshot.import.rows.forEach((row, index) => {
      const key = row.stableKey ? `stable:${row.stableKey}` : `row:${index}`;
      const group: { sources: string[]; linkage?: { kind: string; value: string; reference: string } } = groups.get(key) ?? { sources: [], ...(row.stableKey ? { linkage: {
        kind: "organizer-stable-key", value: row.stableKey, reference: draft.officialSource.url!,
      } } : {}) };
      group.sources.push(...row.codes.map((code) => `${row.dayId}:${code}`));
      groups.set(key, group);
    });
    const grouping = { schema: "circle-identity-groups/1", eventId: snapshot.eventId, groups: [...groups.values()] };
    parseCircleIdentityGrouping(grouping, snapshot.eventId, official);
    const scoped = draft.event.days.length * draft.venue.assignments.length > 1;
    const expectedScopes = new Set<string>();
    const manifest = [];
    for (const day of draft.event.days) for (const assignment of draft.venue.assignments) {
      const key = `${day.id}\0${assignment.venueSpaceId}`;
      expectedScopes.add(key);
      const matches = snapshot.maps.filter((map) => map.periodKey === day.id && map.venueSpaceId === assignment.venueSpaceId);
      if (matches.length !== 1 || !matches[0].id || !Number.isSafeInteger(matches[0].mapRevision) || matches[0].mapRevision < 1) fail("每個活動日與使用空間必須恰好有一份核准地圖。");
      const map = matches[0];
      const authoring = resolveCandidateAuthoringScope({ candidateId: snapshot.candidateId, draft, importedRows: snapshot.import.rows }, day.id, assignment.venueSpaceId)!;
      const path = scoped ? eventMapArtifactPath(day.id, assignment.venueSpaceId) : "map.json";
      const scope = { ...authoring, eventId: snapshot.eventId, periodAliases: [day.id], targetPath: path };
      const checked = validateMapContributionDraft(map.content, scope);
      if (!checked.ok) fail(`核准地圖無效：${checked.problems.map((problem) => problem.message).join("；")}`);
      inputs.push({ path: prefix + path, content: buildMapCandidate({ scope, draftId: map.id, draftRevision: map.mapRevision,
        layout: checked.content.layout, previous: null, now: timestamp }).candidate });
      manifest.push({ periodKey: day.id, venueSpaceId: assignment.venueSpaceId, path });
    }
    if (snapshot.maps.length !== expectedScopes.size) fail("snapshot 含未選取的地圖範圍。");
    if (scoped) inputs.push({ path: prefix + "map-manifest.json", content: { schema: "event-map-manifest/1", eventId: snapshot.eventId, maps: manifest } });
    inputs.push({ path: prefix + "event.json", content: event }, { path: prefix + "official-booths.json", content: official },
      { path: prefix + "circle-identity-groups.json", content: grouping }, { path: prefix + "reference-selection.json", content: snapshot.references.selection },
      { path: prefix + "NOTICE", content: `${draft.officialSource.label}\n${draft.officialSource.url}\n` });
    return { snapshot, event, official, grouping, files: await assemblePublicationStage("data", snapshot.eventId, inputs) };
  } catch (error) {
    if (error instanceof PublicationFailure) throw error;
    return fail(`核准資料無法產檔：${error instanceof Error ? error.message : "資料格式無效"}`);
  }
}

/** Null is an observed absence at baseCommit; an omitted path is not evidence. */
export async function buildPublicationDataStage(source: ApprovedArtifactSource, base: {
  commit: string; eventDirectoryExists: boolean; references: ReadonlyMap<string, string | null>;
}) {
  requireCommit(base.commit);
  if (base.eventDirectoryExists !== false) fail("活動資料目錄已存在，首次發布不能覆寫。", "event_id_collision");
  const artifacts = await buildApprovedPublicationArtifacts(source);
  const files: PublicationBundleFile[] = [];
  const allFiles: PublicationBundleFile[] = [];
  for (const file of artifacts.files) {
    if (!file.path.startsWith("references/")) { files.push(file); allFiles.push(file); continue; }
    if (!base.references.has(file.path)) fail(`尚未核對固定 base 的 reference：${file.path}`);
    const existing = base.references.get(file.path);
    if (existing === null) { files.push(file); allFiles.push(file); continue; }
    try {
      if (typeof existing !== "string" || semanticJson(existing) !== semanticJson(file.text)) throw new Error("different");
    } catch { fail(`既有 reference 不同或損壞，拒絕覆寫：${file.path}`, "reference_conflict"); }
    allFiles.push({ path: file.path, text: existing!, sha256: await sha256Hex(existing!) });
  }
  return { eventId: artifacts.snapshot.eventId, baseCommit: base.commit, files, allFiles };
}

export async function buildPublicationMainStage(source: ApprovedArtifactSource, input: {
  dataCommit: string; dataFiles: ReadonlyMap<string, string>; mainCommit: string;
  publishedEventsJson: string; existingPinJson: string | null; allocationsJson: string; evidenceJson: string;
}) {
  try {
  requireCommit(input.dataCommit); requireCommit(input.mainCommit);
  const artifacts = await buildApprovedPublicationArtifacts(source);
  const { snapshot, official, grouping } = artifacts;
  const published = parsePublishedEvents(JSON.parse(input.publishedEventsJson));
  if (published.includes(snapshot.eventId) || input.existingPinJson !== null) fail("活動已存在公開清單或 pin，首次發布不能覆寫。", "event_id_collision");
  const files = [];
  for (const expected of artifacts.files) {
    const actual = input.dataFiles.get(expected.path);
    if (typeof actual !== "string") fail(`data 合併結果缺少：${expected.path}`);
    const same = expected.path.startsWith("references/") ? semanticJson(actual!) === semanticJson(expected.text) : actual === expected.text;
    if (!same) fail(`data 合併內容與核准 snapshot 不符：${expected.path}`, "snapshot_mismatch");
    if (!expected.path.endsWith("/NOTICE")) files.push({ path: expected.path, sha256: await sha256Hex(actual!) });
  }
  const pin = parseEventDataPin({ schema: "event-data-pin/2", eventId: snapshot.eventId, repository: EVENT_DATA_REPOSITORY, commit: input.dataCommit, files });
  const registry = planCircleIdentityRegistryUpdate({ eventId: snapshot.eventId, official, grouping,
    allocations: JSON.parse(input.allocationsJson), evidence: JSON.parse(input.evidenceJson), today: () => snapshot.contentUpdatedAt.slice(0, 10) });
  return { eventId: snapshot.eventId, baseCommit: input.mainCommit, files: await assemblePublicationStage("main", snapshot.eventId, [
    { path: "data/published-events.json", content: serialize({ schema: "published-events/1", events: [...published, snapshot.eventId] }) },
    { path: `data/event-data-pins/${snapshot.eventId}.json`, content: pin },
    { path: "data/circle-identities/allocations.json", content: registry.allocations },
    { path: "data/circle-identities/evidence.json", content: registry.evidence },
  ]) };
  } catch (error) {
    if (error instanceof PublicationFailure) throw error;
    return fail(`合併資料無法產檔：${error instanceof Error ? error.message : "資料格式無效"}`);
  }
}
