import { buildApprovedPublicationArtifacts, type ApprovedArtifactSource } from "./publication-artifacts";
import { planCircleIdentityRegistryUpdate } from "./circle-identity-registry.mjs";
import { planOrganizerAmendment } from "./organizer-amendment.mjs";
import { parseOfficialBoothData } from "./official-booth-data.mjs";
import { selectEventReferenceRecords, verifyReferenceFiles } from "./reference-selection.mjs";
import { buildOfficialCatalogPayload } from "../scripts/official-catalog-core.mjs";
import { PublicationFailure } from "./organizer-publication";
import { AmendmentBaselineError, type AmendmentPublishedSource, type OrganizerAmendmentBaseline } from "./organizer-amendment-baseline";
import {
  EVENT_INDEX_KEY, EVENT_INDEX_SCHEMA, eventFileKey, eventSourceKey, indexHistoryKey, newEventDataVersion, readBucketJson, readEventIndexObject, registryKey,
  type EventDataBucket, type EventIndex, type EventIndexEntry,
} from "./event-data-store";

const GROUPING_FILE = "circle-identity-groups.json";
const JSON_TYPE = { httpMetadata: { contentType: "application/json" } };
const semantic = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const fail = (code: string, message: string, retryable = false): never => { throw new PublicationFailure(code, message, retryable); };

async function readRegistry(bucket: EventDataBucket, index: EventIndex) {
  if (!index.registry) fail("registry_unavailable", "活動資料尚未上傳社團配號表。", true);
  const [allocations, evidence] = await Promise.all([
    readBucketJson(bucket, registryKey(index.registry!, "allocations.json")),
    readBucketJson(bucket, registryKey(index.registry!, "evidence.json")),
  ]);
  return { allocations, evidence };
}

/** The events of one evidence ledger that carry this event's sources. */
function eventEvidence(registry: unknown, eventId: string) {
  return (registry as { entries: Array<{ sources: Array<{ eventId: string }>; retiredSources?: Array<{ eventId: string }> }> }).entries
    .filter((entry) => [...entry.sources, ...(entry.retiredSources ?? [])].some((source) => source.eventId === eventId));
}

type Artifacts = Awaited<ReturnType<typeof buildApprovedPublicationArtifacts>>;

/** Reader files and publication inputs, byte for byte what the data-repository staging produced. */
function publishedFiles(artifacts: Artifacts, evidence: unknown) {
  const { snapshot, official } = artifacts;
  const eventId = snapshot.eventId;
  const prefix = `events/${eventId}/`;
  const reader = new Map<string, string>();
  const sources = new Map<string, string>();
  for (const file of artifacts.files) {
    if (!file.path.startsWith(prefix)) continue;
    const name = file.path.slice(prefix.length);
    if (name === "event.json" || name === "map.json" || name === "map-manifest.json" || name.startsWith("maps/")) reader.set(name, file.text);
    if (name === GROUPING_FILE) sources.set(name, file.text);
  }
  const definition = JSON.parse(reader.get("event.json")!);
  const referenceFiles = new Map(snapshot.references.files.map((file) => [file.path, new TextEncoder().encode(file.content)]));
  const verified = verifyReferenceFiles(snapshot.references.selection, referenceFiles, eventId);
  const references = selectEventReferenceRecords(snapshot.references.selection, verified.records, definition);
  reader.set("reference-records.json", `${JSON.stringify(references, null, 2)}\n`);
  const catalog = buildOfficialCatalogPayload({ eventId, event: definition, official: parseOfficialBoothData(official, definition), evidence });
  reader.set("circles.json", `${JSON.stringify(catalog)}\n`);
  return { reader, sources, definition, references };
}

/** Whether the index already serves this approval; cheap enough to ask on every step. */
export async function isApprovalPublished(bucket: Pick<EventDataBucket, "get">, snapshotJson: string, approvalHash: string) {
  const eventId = (JSON.parse(snapshotJson) as { eventId?: unknown }).eventId;
  const current = await readEventIndexObject(bucket);
  return current?.index.events.some((entry) => entry.eventId === eventId && entry.source?.approvalHash === approvalHash) ?? false;
}

/** Unique even when two publications start in the same second, and still sortable. */
function uniqueVersion(now: number) {
  const suffix = [...crypto.getRandomValues(new Uint8Array(3))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${newEventDataVersion(now)}-${suffix}`;
}

/**
 * Publishes an approved snapshot as a new version in the event data bucket
 * (#546): the reader files, the publication inputs a later correction starts
 * from, and the updated circle identity registry, then `index.json` last.
 *
 * Re-running for the same approval is a no-op once the index names it, so an
 * interrupted request can simply be retried. Every refusal happens before
 * `beforeWrite`, which callers use to record that remote writes began.
 */
export async function publishApprovedSnapshot(bucket: EventDataBucket, source: ApprovedArtifactSource & { candidateId: string; candidateVersion: number },
  now = Date.now, beforeWrite: () => Promise<void> = async () => {}) {
  if (await isApprovalPublished(bucket, source.snapshotJson, source.approvalHash)) return { alreadyPublished: true };
  const artifacts = await buildApprovedPublicationArtifacts(source);
  const { snapshot, official, grouping } = artifacts;
  const eventId = snapshot.eventId;
  const current = await readEventIndexObject(bucket);
  if (!current) return fail("event_index_unavailable", "活動資料尚未上傳，無法發布。", true);
  const { index, etag } = current;
  if (!etag) fail("event_index_unversioned", "活動資料索引缺少版本標記，無法安全發布。", true);
  const existing = index.events.find((entry) => entry.eventId === eventId);
  if (existing?.source?.approvalHash === source.approvalHash) return { alreadyPublished: true };

  const today = () => snapshot.contentUpdatedAt.slice(0, 10);
  const { allocations, evidence } = await readRegistry(bucket, index);
  let registry: { allocations: unknown; evidence: unknown };
  if (artifacts.amendment) {
    const baseline = artifacts.amendment.baseline;
    if (baseline.schema !== "organizer-amendment-baseline/3") fail("amendment_baseline_legacy", "這筆修正是在改用新發布方式前開始的，請從目前的公開版本重新開始修正。");
    if (!existing || existing.version !== baseline.version) fail("amendment_base_conflict", "這場活動在修正期間已有新的發布，請從目前的公開版本重新開始修正。");
    // Other events may allocate ids while this candidate is being edited.
    // Accept that growth, but never silently rebind the reviewed old circles.
    const before = planOrganizerAmendment({ ...baseline, changes: [], today });
    const latest = planOrganizerAmendment({ ...baseline, allocations, evidence, changes: [], today });
    if (semantic(before.summary.groups) !== semantic(latest.summary.groups)
      || semantic(eventEvidence(before.evidence, eventId)) !== semantic(eventEvidence(latest.evidence, eventId))) {
      fail("amendment_baseline_changed", "修正來源的公開社團身分或退出歷史已變更。");
    }
    registry = planOrganizerAmendment({ ...baseline, allocations, evidence, changes: artifacts.amendment.changes, today });
  } else {
    if (existing) fail("event_id_collision", "活動已公開，首次發布不能覆寫。");
    registry = planCircleIdentityRegistryUpdate({ eventId, official, grouping, allocations, evidence, today });
  }
  const { reader, sources, definition, references } = publishedFiles(artifacts, registry.evidence);

  await beforeWrite();
  const version = uniqueVersion(now());
  await Promise.all([
    ...[...reader].map(([file, text]) => bucket.put(eventFileKey(eventId, version, file), text, JSON_TYPE)),
    ...[...sources].map(([file, text]) => bucket.put(eventSourceKey(eventId, version, file), text, JSON_TYPE)),
    bucket.put(registryKey(version, "allocations.json"), `${JSON.stringify(registry.allocations, null, 2)}\n`, JSON_TYPE),
    bucket.put(registryKey(version, "evidence.json"), `${JSON.stringify(registry.evidence, null, 2)}\n`, JSON_TYPE),
  ]);
  const entry: EventIndexEntry = {
    eventId, version, files: [...reader.keys()].sort(), definition, references,
    source: { candidateId: source.candidateId, candidateVersion: source.candidateVersion, approvalHash: source.approvalHash },
    sourceFiles: [...sources.keys()],
  };
  const next: EventIndex = {
    schema: EVENT_INDEX_SCHEMA, registry: version,
    events: existing ? index.events.map((item) => item.eventId === eventId ? entry : item) : [...index.events, entry],
  };
  const text = `${JSON.stringify(next)}\n`;
  // Every index stays restorable as a whole: a rollback copies one back.
  await bucket.put(indexHistoryKey(version), text, JSON_TYPE);
  // Only the index read above may be replaced: another publication that
  // finished in between keeps its version, and this one is retried.
  const written = await bucket.put(EVENT_INDEX_KEY, text, { ...JSON_TYPE, onlyIf: { etagMatches: etag! } });
  if (written === null) fail("event_index_changed", "另一筆發布剛完成，請重試。", true);
  return { version, alreadyPublished: false };
}

/**
 * The published state a correction starts from, read from the event data
 * bucket. The browser supplies nothing: the source snapshot comes from D1 and
 * is checked against the catalog readers are served.
 */
export function createR2AmendmentBaselineLoader(bucket: EventDataBucket) {
  return async (source: AmendmentPublishedSource): Promise<OrganizerAmendmentBaseline> => {
    const changed = () => new AmendmentBaselineError("amendment_baseline_changed", "此活動的公開資料與發布紀錄不一致，暫時無法開始修正。");
    let current: Awaited<ReturnType<typeof readEventIndexObject>>;
    try { current = await readEventIndexObject(bucket); }
    catch { throw new AmendmentBaselineError("amendment_baseline_unavailable", "暫時無法核對公開版本，請稍後再試。", 503); }
    const artifacts = await buildApprovedPublicationArtifacts({ snapshotJson: source.snapshotJson, approvalHash: source.approvalHash }).catch(() => { throw changed(); });
    if (artifacts.snapshot.candidateId !== source.candidateId || artifacts.snapshot.candidateVersion !== source.candidateVersion) throw changed();
    const eventId = artifacts.event.id;
    const entry = current?.index.events.find((item) => item.eventId === eventId);
    if (!current || !entry || (entry.source && entry.source.approvalHash !== source.approvalHash)) throw changed();
    try {
      const { allocations, evidence } = await readRegistry(bucket, current.index);
      // Maintainers may have adjusted a published grouping; the published copy wins.
      const grouping = entry.sourceFiles?.includes(GROUPING_FILE)
        ? await readBucketJson(bucket, eventSourceKey(eventId, entry.version, GROUPING_FILE)) as typeof artifacts.grouping
        : artifacts.grouping;
      const today = () => artifacts.snapshot.contentUpdatedAt.slice(0, 10);
      const plan = planOrganizerAmendment({ event: artifacts.event, official: artifacts.official, grouping, allocations, evidence, changes: [], today });
      // Every reader file must be what the source snapshot produces: a map or
      // event change uploaded since would otherwise be undone by the correction.
      const { reader } = publishedFiles(artifacts, plan.evidence);
      if (reader.size !== entry.files.length || entry.files.some((file) => !reader.has(file))) throw changed();
      for (const [file, text] of reader) {
        const served = await readBucketJson(bucket, eventFileKey(eventId, entry.version, file));
        if (semantic(served) !== semantic(JSON.parse(text))) throw changed();
      }
      const { snapshotJson: _snapshotJson, ...identity } = source;
      void _snapshotJson;
      return {
        schema: "organizer-amendment-baseline/3", source: identity, version: entry.version,
        event: artifacts.event, official: artifacts.official, grouping, allocations, evidence,
        // The draft as published: after an earlier correction with settings this
        // is its baseline with those settings applied (ADR-0068).
        draft: artifacts.draft, references: artifacts.snapshot.references, maps: artifacts.snapshot.maps,
      };
    } catch (error) {
      if (error instanceof AmendmentBaselineError) throw error;
      throw changed();
    }
  };
}
