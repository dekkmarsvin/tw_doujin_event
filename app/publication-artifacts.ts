import { parseOrganizerEventDraft, validateOrganizerEventDraft, type OrganizerEventDraft } from "./organizer-event";
import { AmendmentSettingsError, applyAmendmentSettings, normalizeAmendmentSettings, type OrganizerAmendmentSettings } from "./organizer-amendment-settings";
import { eventDateFields } from "./event-calendar";
import { publishedEventImage } from "./event-image";
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
import { planOrganizerAmendment } from "./organizer-amendment.mjs";
import type { OrganizerAmendmentBaseline } from "./organizer-amendment-baseline";

export type ApprovedArtifactSource = { snapshotJson: string; approvalHash: string };
type Snapshot = {
  schema: string; candidateId: string; candidateVersion: number; eventId: string; draft: unknown; contentUpdatedAt: string;
  operation?: "CREATE" | "AMEND";
  amendment?: { baselineJson: string; baselineSha256: string; changes: unknown[]; settings?: OrganizerAmendmentSettings | null };
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
const sameJson = (a: unknown, b: unknown) => semanticJson(JSON.stringify(a)) === semanticJson(JSON.stringify(b));

/** A matching event id alone never authorizes an update. Callers must observe
 * this pin at the fixed main base (and again before the eventual merge). */
export function assertAmendmentPublishedBaseline(baseline: OrganizerAmendmentBaseline, publishedEventsJson: string, existingPinJson: string | null) {
  try {
    if (!parsePublishedEvents(JSON.parse(publishedEventsJson)).includes(baseline.event.id) || existingPinJson === null
      || !sameJson(parseEventDataPin(JSON.parse(existingPinJson)), baseline.pin)) throw new Error("changed");
  } catch { fail("已發布活動已變更或原 pin 不符，請從最新公開版本重新開始修正。", "amendment_baseline_changed"); }
}

/** Key order is part of the approved bytes: an older snapshot must rebuild the
 * exact event.json it was approved with, so optional fields appear only when set. */
function snapshotEvent(snapshot: Snapshot, draft: NonNullable<ReturnType<typeof parseOrganizerEventDraft>>, templates: string[], areaIds: string[], dates: string[], officialUrl: string) {
  const { dateRangeLabel, eventEndsAt } = eventDateFields(dates);
  return {
    schema: "event-definition/3", id: snapshot.eventId, name: draft.event.name,
    ...(draft.event.aliases?.length ? { aliases: draft.event.aliases } : {}),
    dateRangeLabel,
    dataUpdatedAt: snapshot.contentUpdatedAt, eventEndsAt,
    mapTemplate: templates[0], areaMode: areaIds.length === 1 ? "single" : "switchable",
    days: draft.event.days.map((day) => ({ id: day.id, label: day.label, dateLabel: day.date })),
    areas: areaIds.map((id) => ({ id, label: id, shortLabel: id })),
    organizerAssignments: draft.references!.organizerAssignments, categoryCatalog: draft.references!.categoryCatalog,
    venueAssignments: draft.venue.assignments.map(({ venueId, venueSpaceId, areaIds }) => ({ venueId, venueSpaceId, areaIds })),
    officialData: { adapter: "organizer-import/1", eventUrl: officialUrl,
      boothListUrls: Object.fromEntries(draft.event.days.map((day) => [day.id, officialUrl])) },
    ...(draft.event.image ? { image: publishedEventImage(draft.event.image) } : {}),
  };
}
/** The published baseline event with a correction's declared settings applied:
 * what the rebuilt event.json must equal, apart from dataUpdatedAt. Every field
 * outside the allow-list therefore still has to match the baseline exactly. */
function amendedBaselineEvent(event: OrganizerAmendmentBaseline["event"], settings: OrganizerAmendmentSettings | null) {
  if (!settings) return event;
  const dates = new Map((settings.days ?? []).map((day) => [day.id, day.date]));
  const days = event.days.map((day) => dates.has(String(day.id)) ? { ...day, dateLabel: dates.get(String(day.id))! } : day);
  const aliases = settings.aliases ?? event.aliases ?? [];
  const next: Record<string, unknown> = { ...event, name: settings.name ?? event.name, days,
    ...(settings.days ? eventDateFields(days.map((day) => day.dateLabel).sort()) : {}) };
  delete next.aliases;
  if (settings.image === null) delete next.image;
  else if (settings.image) next.image = publishedEventImage(settings.image);
  return aliases.length > 0 ? { ...next, aliases } : next;
}

type PublicationArtifacts = {
  snapshot: Snapshot; operation: "CREATE" | "AMEND";
  amendment: { baseline: OrganizerAmendmentBaseline; changes: unknown[]; settings: OrganizerAmendmentSettings | null } | null;
  /** The draft this publication publishes: the approved one, or a correction's baseline with its settings applied. */
  draft: OrganizerEventDraft;
  event: ReturnType<typeof snapshotEvent>;
  official: { schemaVersion: number; days: Array<{ day: string; url: string; booths: Array<{ codes: string[]; name: string; areaId: string }> }> };
  grouping: { schema: string; eventId: string; groups: Array<{ sources: string[]; linkage?: { kind: string; value: string; reference: string } }>; transitions?: never[] };
  files: PublicationBundleFile[];
};

/** Pure approved input conversion; no catalog, clock, repository or network reads. */
export async function buildApprovedPublicationArtifacts(source: ApprovedArtifactSource): Promise<PublicationArtifacts> {
  try {
    if (await sha256Hex(source.snapshotJson) !== source.approvalHash) fail("核准 snapshot 的內容與 hash 不符。", "snapshot_mismatch");
    const snapshot = JSON.parse(source.snapshotJson) as Snapshot;
    if (!["organizer-submission-snapshot/3", "organizer-submission-snapshot/4"].includes(snapshot.schema)) fail("此歷史 snapshot 缺少完整發布資料，請重新整理並送審。");
    const operation = snapshot.schema === "organizer-submission-snapshot/4" ? "AMEND" as const : "CREATE" as const;
    if (operation === "AMEND" ? snapshot.operation !== "AMEND" || !snapshot.amendment
      : (snapshot.operation !== undefined && snapshot.operation !== "CREATE") || snapshot.amendment !== undefined) fail("snapshot 的發布操作不符。", "snapshot_mismatch");
    const snapshotDraft = parseOrganizerEventDraft(snapshot.draft);
    if (!snapshotDraft || !snapshot.candidateId || !Number.isSafeInteger(snapshot.candidateVersion) || snapshot.candidateVersion < 1
      || snapshot.eventId !== snapshotDraft.event.id || !snapshotDraft.references?.categoryCatalog
      || validateOrganizerEventDraft(snapshotDraft).some((issue) => issue.severity === "error")
      || !Array.isArray(snapshot.import?.rows) || !snapshot.import.rows.length || !Array.isArray(snapshot.maps)) fail("核准 snapshot 的活動資料不完整。");
    const timestamp = Date.parse(snapshot.contentUpdatedAt);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== snapshot.contentUpdatedAt) fail("核准內容時間無效。");
    let amendment: PublicationArtifacts["amendment"] = null;
    if (operation === "AMEND") {
      const approved = snapshot.amendment!;
      if (typeof approved.baselineJson !== "string" || await sha256Hex(approved.baselineJson) !== approved.baselineSha256) fail("修正基準的核准 hash 不符。", "snapshot_mismatch");
      const baseline = JSON.parse(approved.baselineJson) as OrganizerAmendmentBaseline;
      if (baseline.schema !== "organizer-amendment-baseline/1" || !Array.isArray(approved.changes)
        || baseline.source.candidateId === snapshot.candidateId || !Number.isSafeInteger(baseline.source.candidateVersion) || baseline.source.candidateVersion < 1
        || !COMMIT.test(baseline.source.dataCommit) || !COMMIT.test(baseline.source.mainCommit) || !COMMIT.test(baseline.mainCommit)
        || baseline.event.id !== snapshot.eventId || baseline.pin.eventId !== snapshot.eventId || baseline.pin.commit !== baseline.source.dataCommit
        || !sameJson(parseEventDataPin(baseline.pin), baseline.pin)
        || !sameJson(snapshotDraft, baseline.draft) || !sameJson(snapshot.references, baseline.references)) fail("修正 snapshot 與固定基準的活動、reference 或版本不符。", "snapshot_mismatch");
      // The declaration must already be in its one stored form; an approval
      // cannot carry values the save path would have rejected or dropped.
      let settings: OrganizerAmendmentSettings | null;
      try { settings = normalizeAmendmentSettings(baseline.draft, approved.settings ?? null); }
      catch (error) { return fail(error instanceof AmendmentSettingsError ? error.message : "活動設定宣告無效。"); }
      if (!sameJson(settings, approved.settings ?? null)) fail("修正的活動設定宣告與保存格式不符。", "snapshot_mismatch");
      amendment = { baseline, changes: approved.changes, settings };
    }
    // What gets published: the approved draft, or for a correction the fixed
    // baseline with its declared settings applied. The draft itself never moves.
    const draft = amendment ? applyAmendmentSettings(snapshotDraft, amendment.settings) : snapshotDraft;
    const templates = [...new Set(draft.venue.assignments.map((assignment) => assignment.mapTemplate))];
    if (templates.length !== 1) fail("目前公開活動格式要求所有場地採同一地圖模板。");
    const areaIds = draft.venue.assignments.flatMap((assignment) => assignment.areaIds);
    if (!areaIds.length || new Set(areaIds).size !== areaIds.length) fail("各場地的展區必須明確且不可重複。");
    const dates = draft.event.days.map((day) => day.date).sort();
    const officialUrl = new URL(draft.officialSource.url!).href;
    const event = snapshotEvent(snapshot, draft, templates, areaIds, dates, officialUrl);
    if (amendment && !sameJson({ ...event, dataUpdatedAt: amendment.baseline.event.dataUpdatedAt },
      amendedBaselineEvent(amendment.baseline.event, amendment.settings))) fail("修正活動定義與已發布基準不符。", "snapshot_mismatch");
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
    const official = { schemaVersion: 1, days: draft.event.days.map((day) => ({ day: day.id, url: officialUrl,
      booths: snapshot.import.rows.filter((row) => row.dayId === day.id).map((row) => ({ codes: row.codes, name: row.circleName, areaId: row.areaId })) })) };
    parseOfficialBoothData(official, event);
    const groups = new Map<string, { sources: string[]; linkage?: { kind: string; value: string; reference: string } }>();
    snapshot.import.rows.forEach((row, index) => {
      const key = row.stableKey ? `stable:${row.stableKey}` : `row:${index}`;
      const group: { sources: string[]; linkage?: { kind: string; value: string; reference: string } } = groups.get(key) ?? { sources: [], ...(row.stableKey ? { linkage: {
        kind: "organizer-stable-key", value: row.stableKey, reference: officialUrl,
      } } : {}) };
      group.sources.push(...row.codes.map((code) => `${row.dayId}:${code}`));
      groups.set(key, group);
    });
    let grouping: PublicationArtifacts["grouping"] = { schema: "circle-identity-groups/1", eventId: snapshot.eventId, groups: [...groups.values()] };
    if (amendment) {
      const plan = planOrganizerAmendment({ ...amendment.baseline, changes: amendment.changes, today: () => snapshot.contentUpdatedAt.slice(0, 10) });
      if (snapshot.import.rows.some((row) => row.stableKey !== null || row.identityGroup !== null)
        || !sameJson(official, plan.official)) fail("修正名單與已核准宣告不符，不能從缺列推論退出。", "snapshot_mismatch");
      // Published grouping describes the resulting ownership. Declarations
      // remain in the approval and are applied once when preparing main's
      // ledger; the normal Reader staging check must not replay them.
      grouping = { ...plan.grouping, transitions: [] };
    }
    parseCircleIdentityGrouping(grouping, snapshot.eventId, official);
    const scoped = draft.event.days.length * draft.venue.assignments.length > 1;
    const expectedScopes = new Set<string>();
    const manifest = [];
    for (const day of draft.event.days) for (const assignment of draft.venue.assignments) {
      const key = `${day.id}\0${assignment.venueSpaceId}`;
      expectedScopes.add(key);
      const matches = snapshot.maps.filter((map) => map.periodKey === day.id && map.venueSpaceId === assignment.venueSpaceId);
      if (matches.length !== 1 || !matches[0].id || !Number.isSafeInteger(matches[0].mapRevision) || matches[0].mapRevision < 1) fail("每個活動日與場地必須恰好有一份核准地圖。");
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
      { path: prefix + "NOTICE", content: `${draft.officialSource.label}\n${officialUrl}\n` });
    return { snapshot, operation, amendment, draft, event, official, grouping, files: await assemblePublicationStage("data", snapshot.eventId, inputs) };
  } catch (error) {
    if (error instanceof PublicationFailure) throw error;
    return fail(`核准資料無法產檔：${error instanceof Error ? error.message : "資料格式無效"}`);
  }
}

/** Null is an observed absence at baseCommit; an omitted path is not evidence. */
export async function buildPublicationDataStage(source: ApprovedArtifactSource, base: {
  commit: string; eventDirectoryExists: boolean; references: ReadonlyMap<string, string | null>;
  /** Complete observed event-directory leaves at commit, required for AMEND. */
  eventFiles?: ReadonlyMap<string, string>;
}) {
  requireCommit(base.commit);
  const artifacts = await buildApprovedPublicationArtifacts(source);
  if (artifacts.amendment) {
    const prefix = `events/${artifacts.snapshot.eventId}/`;
    const pinned = artifacts.amendment.baseline.pin.files.filter((file: { path: string }) => file.path.startsWith(prefix));
    const expected = new Set([...pinned.map((file: { path: string }) => file.path), prefix + "NOTICE"]);
    if (base.eventDirectoryExists !== true || !base.eventFiles || base.eventFiles.size !== expected.size
      || [...base.eventFiles.keys()].some((path) => !expected.has(path))) fail("尚未完整核對原活動的固定資料基準。", "amendment_baseline_changed");
    for (const file of pinned) {
      const text = base.eventFiles.get(file.path);
      if (typeof text !== "string" || await sha256Hex(text) !== file.sha256) fail(`原活動資料已變更：${file.path}`, "amendment_baseline_changed");
    }
    const notice = artifacts.files.find((file) => file.path === prefix + "NOTICE")!;
    if (base.eventFiles.get(notice.path) !== notice.text) fail("原活動來源說明已變更。", "amendment_baseline_changed");
    if (artifacts.files.filter((file) => file.path.startsWith(prefix)).some((file) => !expected.has(file.path))) fail("修正不能改變基準活動的檔案範圍。");
  } else if (base.eventDirectoryExists !== false) fail("活動資料目錄已存在，首次發布不能覆寫。", "event_id_collision");
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
  if (artifacts.amendment) assertAmendmentPublishedBaseline(artifacts.amendment.baseline, input.publishedEventsJson, input.existingPinJson);
  else if (published.includes(snapshot.eventId) || input.existingPinJson !== null) fail("活動已存在公開清單或 pin，首次發布不能覆寫。", "event_id_collision");
  const files = [];
  for (const expected of artifacts.files) {
    const actual = input.dataFiles.get(expected.path);
    if (typeof actual !== "string") fail(`data 合併結果缺少：${expected.path}`);
    const same = expected.path.startsWith("references/") ? semanticJson(actual!) === semanticJson(expected.text) : actual === expected.text;
    if (!same) fail(`data 合併內容與核准 snapshot 不符：${expected.path}`, "snapshot_mismatch");
    if (!expected.path.endsWith("/NOTICE")) files.push({ path: expected.path, sha256: await sha256Hex(actual!) });
  }
  const pin = parseEventDataPin({ schema: "event-data-pin/2", eventId: snapshot.eventId, repository: EVENT_DATA_REPOSITORY, commit: input.dataCommit, files });
  const allocations = JSON.parse(input.allocationsJson), evidence = JSON.parse(input.evidenceJson);
  const today = () => snapshot.contentUpdatedAt.slice(0, 10);
  if (artifacts.amendment) {
    // Other events may allocate ids while this candidate is being edited.
    // Accept that growth, but never silently rebind the reviewed old circles.
    const baseline = artifacts.amendment.baseline;
    const old = planOrganizerAmendment({ ...baseline, changes: [], today });
    const current = planOrganizerAmendment({ ...baseline, allocations, evidence, changes: [], today });
    const eventEvidence = (registry: { entries: Array<{ sources: Array<{ eventId: string }>; retiredSources?: Array<{ eventId: string }> }> }) => registry.entries
      .filter((entry) => [...entry.sources, ...(entry.retiredSources ?? [])].some((source) => source.eventId === snapshot.eventId));
    if (!sameJson(old.summary.groups, current.summary.groups) || !sameJson(eventEvidence(old.evidence), eventEvidence(current.evidence))) fail("修正來源的公開社團身分或退出歷史已變更。", "amendment_baseline_changed");
  }
  const registry = artifacts.amendment
    ? planOrganizerAmendment({ ...artifacts.amendment.baseline, allocations, evidence, changes: artifacts.amendment.changes, today })
    : planCircleIdentityRegistryUpdate({ eventId: snapshot.eventId, official, grouping, allocations, evidence, today });
  return { eventId: snapshot.eventId, baseCommit: input.mainCommit, files: await assemblePublicationStage("main", snapshot.eventId, [
    { path: "data/published-events.json", content: artifacts.amendment ? input.publishedEventsJson : serialize({ schema: "published-events/1", events: [...published, snapshot.eventId] }) },
    { path: `data/event-data-pins/${snapshot.eventId}.json`, content: pin },
    { path: "data/circle-identities/allocations.json", content: registry.allocations },
    { path: "data/circle-identities/evidence.json", content: registry.evidence },
  ]) };
  } catch (error) {
    if (error instanceof PublicationFailure) throw error;
    return fail(`合併資料無法產檔：${error instanceof Error ? error.message : "資料格式無效"}`);
  }
}
