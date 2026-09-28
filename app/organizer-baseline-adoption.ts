import { parseEventDataPin } from "./event-data-pin.mjs";
import { sha256Hex } from "./portal-crypto";

export type PublishedSourceIdentity = {
  candidateId: string; candidateVersion: number; jobId: string; snapshotId: string;
  approvalHash: string; dataCommit: string; mainCommit: string;
};
/** A reviewed, deployed record authorizes one exact historical correction.
 * This is not a caller-supplied replacement snapshot or a general import API. */
export type OrganizerBaselineAdoption = {
  schema: "organizer-baseline-adoption/1";
  id: string;
  kind: "reviewed-cross-day-grouping";
  eventId: string;
  source: PublishedSourceIdentity;
  target: { mainCommit: string; pinSha256: string; groupingSha256: string; evidenceSha256: string };
  authorization: { pullRequest: string; decision: "ADR-0071" };
};

export const baselineCanonicalJson = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === "object" && !Array.isArray(child)
  ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : child);

export function baselineEventEvidence(evidence: unknown, eventId: string): unknown {
  const registry = evidence as { entries: Array<{ circleId: string; sources: Array<{ eventId: string }>; retiredSources?: Array<{ eventId: string }> }> };
  return registry.entries.filter((entry) => [...entry.sources, ...(entry.retiredSources ?? [])].some((source) => source.eventId === eventId))
    .sort((a, b) => a.circleId.localeCompare(b.circleId));
}

const COMMIT = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
export function parseBaselineAdoption(value: unknown): OrganizerBaselineAdoption {
  const record = value as OrganizerBaselineAdoption;
  if (record?.schema !== "organizer-baseline-adoption/1" || record.kind !== "reviewed-cross-day-grouping"
    || !/^[a-z0-9][a-z0-9-]*$/.test(record.id ?? "") || !/^[a-z0-9][a-z0-9-]*$/.test(record.eventId ?? "")
    || !record.source || !record.target || !record.authorization
    || ![record.source.candidateId, record.source.jobId, record.source.snapshotId].every((id) => typeof id === "string" && id.length > 0)
    || !Number.isSafeInteger(record.source.candidateVersion) || record.source.candidateVersion < 1
    || ![record.source.dataCommit, record.source.mainCommit, record.target.mainCommit].every((sha) => COMMIT.test(sha))
    || ![record.source.approvalHash, record.target.pinSha256, record.target.groupingSha256, record.target.evidenceSha256].every((sha) => HASH.test(sha))
    || record.authorization.decision !== "ADR-0071"
    || !/^https:\/\/github\.com\/dekkmarsvin\/tw_doujin_event\/pull\/[1-9][0-9]*$/.test(record.authorization.pullRequest)) {
    throw new Error("修正基準承接紀錄無效。");
  }
  return record;
}

export function adoptionMatchesSource(record: OrganizerBaselineAdoption, source: PublishedSourceIdentity, eventId: string) {
  return record.eventId === eventId && (Object.keys(record.source) as Array<keyof PublishedSourceIdentity>)
    .every((key) => record.source[key] === source[key]);
}

type BaselineIdentity = {
  schema: string; source: PublishedSourceIdentity; event: { id: string };
  pin: ReturnType<typeof parseEventDataPin>; grouping: unknown; evidence: unknown;
  adoption?: { record: OrganizerBaselineAdoption; sha256: string };
};

/** Pure verification shared by stored baselines and the publication Worker.
 * Authorization happens in the loader against its deployed allow-list; this
 * frozen proof travels inside the subsequently approved snapshot. */
export async function assertBaselineProvenance(baseline: BaselineIdentity) {
  if (baseline.schema === "organizer-amendment-baseline/1") {
    if (baseline.adoption !== undefined || baseline.pin.commit !== baseline.source.dataCommit) throw new Error("修正基準與原發布版本不符。");
    return;
  }
  if (baseline.schema !== "organizer-amendment-baseline/2" || !baseline.adoption) throw new Error("修正基準格式無效。");
  const { record: value, sha256 } = baseline.adoption;
  const record = parseBaselineAdoption(value);
  if (!adoptionMatchesSource(record, baseline.source, baseline.event.id)
    || baseline.pin.eventId !== record.eventId || baseline.pin.commit === record.source.dataCommit
    || await sha256Hex(baselineCanonicalJson(record)) !== sha256
    || await sha256Hex(baselineCanonicalJson(parseEventDataPin(baseline.pin))) !== record.target.pinSha256
    || await sha256Hex(baselineCanonicalJson(baseline.grouping)) !== record.target.groupingSha256
    || await sha256Hex(baselineCanonicalJson(baselineEventEvidence(baseline.evidence, record.eventId))) !== record.target.evidenceSha256) {
    throw new Error("修正基準與核准承接紀錄不符。");
  }
}
