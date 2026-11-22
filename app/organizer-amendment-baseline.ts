import { buildApprovedPublicationArtifacts } from "./publication-artifacts";
import type { parseEventDataPin } from "./event-data-pin.mjs";
import { planOrganizerAmendment } from "./organizer-amendment.mjs";
import { parseOrganizerEventDraft, type OrganizerEventDraft } from "./organizer-event";
import type { OrganizerNormalizedImportRow } from "./organizer-import";
import { sha256Hex } from "./portal-crypto";
import { assertBaselineProvenance, type OrganizerBaselineAdoption } from "./organizer-baseline-adoption";

export type AmendmentPublishedSource = {
  candidateId: string; candidateVersion: number; jobId: string; snapshotId: string; approvalHash: string;
  snapshotJson: string; dataCommit: string; mainCommit: string; publishedAt: number;
};
type Artifacts = Awaited<ReturnType<typeof buildApprovedPublicationArtifacts>>;
export type OrganizerAmendmentBaseline = {
  /** `/3` is read from the event data bucket (#546) and pins its version instead of Git commits. */
  schema: "organizer-amendment-baseline/1" | "organizer-amendment-baseline/2" | "organizer-amendment-baseline/3";
  adoption?: { record: OrganizerBaselineAdoption; sha256: string };
  source: Omit<AmendmentPublishedSource, "snapshotJson">;
  version?: string;
  mainCommit?: string; pin?: ReturnType<typeof parseEventDataPin>;
  event: Artifacts["event"]; official: Artifacts["official"]; grouping: Artifacts["grouping"];
  allocations: unknown; evidence: unknown; draft: OrganizerEventDraft;
  references: Artifacts["snapshot"]["references"];
  maps: Artifacts["snapshot"]["maps"];
};
export class AmendmentBaselineError extends Error {
  constructor(public code: "amendment_baseline_changed" | "amendment_publication_pending" | "amendment_baseline_unavailable",
    message: string, public status: 409 | 503 = 409) { super(message); }
}
export async function readOrganizerAmendmentBaseline(json: string, expectedHash: string) {
  if (await sha256Hex(json) !== expectedHash) throw new Error("修正基準的完整性檢查失敗。");
  const baseline = JSON.parse(json) as OrganizerAmendmentBaseline;
  if (!parseOrganizerEventDraft(baseline.draft)) throw new Error("修正基準格式無效。");
  await assertBaselineProvenance(baseline);
  return baseline;
}

export function planOrganizerAmendmentCandidate(baseline: OrganizerAmendmentBaseline, changes: unknown[], today: () => string) {
  const plan = planOrganizerAmendment({ ...baseline, changes, today });
  const rows: OrganizerNormalizedImportRow[] = [];
  for (const day of plan.official.days) for (const booth of day.booths) {
    const areaId = booth.areaId ?? baseline.event.areas[0].id;
    const venue = baseline.draft.venue.assignments.find((assignment) => assignment.areaIds.includes(areaId));
    if (!venue) throw new Error("修正攤位沒有對應的場地。");
    rows.push({ sourceRow: rows.length + 1, dayId: String(day.day), venueSpaceId: venue.venueSpaceId,
      areaId, codes: [...booth.codes], circleName: booth.name, stableKey: null, identityGroup: null });
  }
  if (rows.length > 20_000 || rows.some((row) => row.circleName.length > 200 || row.codes.some((code) => code.length > 80))) {
    throw new Error("修正名單超出既有 20,000 列、社團名稱 200 字或攤位代碼 80 字限制。");
  }
  if (new TextEncoder().encode(JSON.stringify(rows)).byteLength > 8 * 1024 * 1024) throw new Error("修正名單超過 8 MB。");
  // Identity comes from the amendment's reviewed baseline/declarations, never
  // from a made-up organizer stable key inserted into these derived map rows.
  return { ...plan, rows };
}
