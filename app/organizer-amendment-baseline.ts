import { createGitHubPublicationAdapter, type GitHubAdapterOptions } from "./github-publication";
import { GITHUB_PUBLICATION_OWNER, GITHUB_PUBLICATION_REPOSITORIES } from "./github-remote-auditor";
import { buildApprovedPublicationArtifacts } from "./publication-artifacts";
import { parseEventDataPin } from "./event-data-pin.mjs";
import { parsePublishedEvents } from "./published-events.mjs";
import { planOrganizerAmendment } from "./organizer-amendment.mjs";
import { buildOfficialCatalogPayload } from "../scripts/official-catalog-core.mjs";
import { parseOrganizerEventDraft, type OrganizerEventDraft } from "./organizer-event";
import type { OrganizerNormalizedImportRow } from "./organizer-import";
import { sha256Hex } from "./portal-crypto";

export type AmendmentPublishedSource = {
  candidateId: string; candidateVersion: number; jobId: string; snapshotId: string; approvalHash: string;
  snapshotJson: string; dataCommit: string; mainCommit: string; publishedAt: number;
};
type Artifacts = Awaited<ReturnType<typeof buildApprovedPublicationArtifacts>>;
export type OrganizerAmendmentBaseline = {
  schema: "organizer-amendment-baseline/1";
  source: Omit<AmendmentPublishedSource, "snapshotJson">;
  mainCommit: string; pin: ReturnType<typeof parseEventDataPin>;
  event: Artifacts["event"]; official: Artifacts["official"]; grouping: Artifacts["grouping"];
  allocations: unknown; evidence: unknown; draft: OrganizerEventDraft;
  references: Artifacts["snapshot"]["references"];
  maps: Artifacts["snapshot"]["maps"];
};
const semantic = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === "object" && !Array.isArray(child)
  ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : child);

/** Only called after candidate authorization; reads fixed Git trees and the
 * currently served catalog. The browser cannot supply any baseline bytes. */
export function createPublishedAmendmentBaselineLoader(options: Pick<GitHubAdapterOptions, "tokenProvider" | "fetch"> & {
  published: (eventId: string) => Promise<{ dataCommit: string; catalog: unknown } | null>;
}) {
  const adapter = createGitHubPublicationAdapter({ owner: GITHUB_PUBLICATION_OWNER, tokenProvider: options.tokenProvider,
    fetch: (url, init) => (options.fetch ?? globalThis.fetch)(url, { ...init, signal: AbortSignal.timeout(8_000) }) });
  async function files(repository: string, commit: string, paths: string[]) {
    const record = await adapter.readCommit(repository, commit);
    const tree = await adapter.readTree(repository, record.tree.sha);
    return new Map(await Promise.all(paths.map(async (path) => {
      const entry = tree.find((item) => item.path === path);
      if (!entry || entry.type !== "blob" || entry.mode !== "100644") throw new Error(`已發布基準缺少一般檔案：${path}`);
      return [path, await adapter.readBlob(repository, entry.sha)] as const;
    })));
  }
  return async (source: AmendmentPublishedSource): Promise<OrganizerAmendmentBaseline> => {
    const artifacts = await buildApprovedPublicationArtifacts({ snapshotJson: source.snapshotJson, approvalHash: source.approvalHash });
    if (artifacts.snapshot.candidateId !== source.candidateId || artifacts.snapshot.candidateVersion !== source.candidateVersion
      || !/^[a-f0-9]{40}$/.test(source.mainCommit) || !/^[a-f0-9]{40}$/.test(source.dataCommit)) throw new Error("已發布來源與核准版本不符。");
    const eventId = artifacts.event.id;
    const pinPath = `data/event-data-pins/${eventId}.json`;
    const mainRepo = GITHUB_PUBLICATION_REPOSITORIES[1];
    const dataRepo = GITHUB_PUBLICATION_REPOSITORIES[0];
    const mainCommit = await adapter.readRef(mainRepo, "main");
    if (!mainCommit) throw new Error("目前無法讀取已發布基準。");
    const [mainFiles, originalFiles, published] = await Promise.all([
      files(mainRepo, mainCommit, [pinPath, "data/published-events.json", "data/circle-identities/allocations.json", "data/circle-identities/evidence.json"]),
      files(mainRepo, source.mainCommit, [pinPath]), options.published(eventId),
    ]);
    const pin = parseEventDataPin(JSON.parse(mainFiles.get(pinPath)!));
    if (!published || pin.eventId !== eventId || pin.commit !== source.dataCommit || published.dataCommit !== pin.commit
      || semantic(pin) !== semantic(JSON.parse(originalFiles.get(pinPath)!))
      || !parsePublishedEvents(JSON.parse(mainFiles.get("data/published-events.json")!)).includes(eventId)) {
      throw new Error("已發布版本已更新或尚未公開，請重新載入最新活動。");
    }
    const dataFiles = await files(dataRepo, pin.commit, pin.files.map((file: { path: string }) => file.path));
    for (const file of pin.files) {
      const text = dataFiles.get(file.path)!;
      const approved = artifacts.files.find((entry) => entry.path === file.path);
      if (await sha256Hex(text) !== file.sha256 || !approved
        || (file.path.startsWith("references/") ? semantic(JSON.parse(text)) !== semantic(JSON.parse(approved.text)) : text !== approved.text)) {
        throw new Error(`已發布檔案與核准基準不符：${file.path}`);
      }
    }
    if (artifacts.files.filter((file) => !file.path.endsWith("/NOTICE")).length !== pin.files.length) throw new Error("已發布基準檔案不完整。");
    const allocations: unknown = JSON.parse(mainFiles.get("data/circle-identities/allocations.json")!);
    const evidence: unknown = JSON.parse(mainFiles.get("data/circle-identities/evidence.json")!);
    const current = planOrganizerAmendment({ event: artifacts.event, official: artifacts.official, grouping: artifacts.grouping,
      allocations, evidence, changes: [], today: () => artifacts.snapshot.contentUpdatedAt.slice(0, 10) });
    const projected = buildOfficialCatalogPayload({ eventId, event: artifacts.event, official: current.official, evidence: current.evidence });
    if (semantic(projected) !== semantic(published.catalog)) throw new Error("目前公開名單與已發布身分基準不一致。");
    const { snapshotJson: _snapshotJson, ...identity } = source;
    void _snapshotJson;
    return { schema: "organizer-amendment-baseline/1", source: identity, mainCommit, pin,
      event: artifacts.event, official: artifacts.official, grouping: artifacts.grouping, allocations, evidence,
      // The draft as published: after an earlier correction with settings this
      // is its baseline with those settings applied, so the next correction
      // starts from the event readers actually see (ADR-0068).
      draft: artifacts.draft, references: artifacts.snapshot.references,
      // Do not embed the previous amendment's baseline recursively.
      maps: artifacts.snapshot.maps };
  };
}

export async function readOrganizerAmendmentBaseline(json: string, expectedHash: string) {
  if (await sha256Hex(json) !== expectedHash) throw new Error("修正基準的完整性檢查失敗。");
  const baseline = JSON.parse(json) as OrganizerAmendmentBaseline;
  if (baseline.schema !== "organizer-amendment-baseline/1" || !parseOrganizerEventDraft(baseline.draft)) throw new Error("修正基準格式無效。");
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
