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
import { PublicationFailure } from "./organizer-publication";
import registeredAdoptions from "../data/organizer-baseline-adoptions.json";
import { adoptionMatchesSource, assertBaselineProvenance, baselineCanonicalJson, baselineEventEvidence, parseBaselineAdoption,
  type OrganizerBaselineAdoption } from "./organizer-baseline-adoption";

export type AmendmentPublishedSource = {
  candidateId: string; candidateVersion: number; jobId: string; snapshotId: string; approvalHash: string;
  snapshotJson: string; dataCommit: string; mainCommit: string; publishedAt: number;
};
type Artifacts = Awaited<ReturnType<typeof buildApprovedPublicationArtifacts>>;
export type OrganizerAmendmentBaseline = {
  schema: "organizer-amendment-baseline/1" | "organizer-amendment-baseline/2";
  adoption?: { record: OrganizerBaselineAdoption; sha256: string };
  source: Omit<AmendmentPublishedSource, "snapshotJson">;
  mainCommit: string; pin: ReturnType<typeof parseEventDataPin>;
  event: Artifacts["event"]; official: Artifacts["official"]; grouping: Artifacts["grouping"];
  allocations: unknown; evidence: unknown; draft: OrganizerEventDraft;
  references: Artifacts["snapshot"]["references"];
  maps: Artifacts["snapshot"]["maps"];
};
const semantic = baselineCanonicalJson;

export class AmendmentBaselineError extends Error {
  constructor(public code: "amendment_baseline_changed" | "amendment_publication_pending" | "amendment_baseline_unavailable",
    message: string, public status: 409 | 503 = 409) { super(message); }
}
const changed = () => new AmendmentBaselineError("amendment_baseline_changed", "此活動的公開資料與發布紀錄不一致，暫時無法開始修正。");
const unavailable = () => new AmendmentBaselineError("amendment_baseline_unavailable", "暫時無法核對公開版本，請稍後再試。", 503);
export type AmendmentBaselineDiagnostic = {
  stage: "github_ref" | "github_commit" | "github_tree" | "github_blob" | "published_catalog";
  repository: "main" | "data" | null;
  failure: "timeout" | "network" | "invalid_json" | "unexpected" | "github_app_config" | "github_app_key"
    | "github_app_token" | "github_app_request" | "github_api_request" | "github_api_response";
  httpStatus: number | null;
  elapsedMs: number;
};
const diagnosticCodes = new Set(["github_app_config", "github_app_key", "github_app_token", "github_app_request", "github_api_request", "github_api_response"]);

/** Only called after candidate authorization; reads fixed Git trees and the
 * currently served catalog. The browser cannot supply any baseline bytes. */
export function createPublishedAmendmentBaselineLoader(options: Pick<GitHubAdapterOptions, "tokenProvider" | "fetch"> & {
  published: (eventId: string) => Promise<{ dataCommit: string; catalog: unknown } | null>;
  /** Server-owned configuration only. Never read from the HTTP request. */
  adoptions?: readonly unknown[];
  /** Fixed fields only: never pass tokens, URLs, response bodies or raw errors. */
  onUnavailable?: (diagnostic: AmendmentBaselineDiagnostic) => void;
}) {
  async function readUpstream<T>(diagnostic: Pick<AmendmentBaselineDiagnostic, "stage" | "repository">,
    read: (transport: { httpStatus: number | null; failure: "timeout" | "network" | null; signal?: AbortSignal }) => Promise<T>): Promise<T> {
    const started = Date.now();
    const transport: { httpStatus: number | null; failure: "timeout" | "network" | null; signal?: AbortSignal } = { httpStatus: null, failure: null };
    try { return await read(transport); } catch (error) {
      const code = error instanceof PublicationFailure && diagnosticCodes.has(error.code)
        ? error.code as AmendmentBaselineDiagnostic["failure"] : null;
      // A rejected API token can trigger authentication after that fetch has
      // finished. Its old timeout/status must not describe a token failure.
      const authenticationFailure = code?.startsWith("github_app_") ? code : null;
      const failure = authenticationFailure ?? (transport.signal?.aborted ? "timeout" : transport.failure
        ?? code ?? (error instanceof SyntaxError ? "invalid_json" : "unexpected"));
      try { options.onUnavailable?.({ ...diagnostic, failure, httpStatus: authenticationFailure ? null : transport.httpStatus,
        elapsedMs: Math.max(0, Date.now() - started) }); }
      catch { /* A diagnostic sink must not change the established API error. */ }
      throw unavailable();
    }
  }
  function readGit<T>(repository: string, stage: Exclude<AmendmentBaselineDiagnostic["stage"], "published_catalog">,
    read: (adapter: ReturnType<typeof createGitHubPublicationAdapter>) => Promise<T>) {
    return readUpstream({ stage, repository: repository === GITHUB_PUBLICATION_REPOSITORIES[1] ? "main" : "data" }, async (transport) => {
      // Each read owns its transport diagnostics; parallel blob reads must not
      // attribute one response's status to another operation. The shared token
      // provider still coalesces authentication and reuses its existing token.
      const adapter = createGitHubPublicationAdapter({ owner: GITHUB_PUBLICATION_OWNER, tokenProvider: options.tokenProvider,
        fetch: async (url, init) => {
          const signal = AbortSignal.timeout(8_000);
          transport.signal = signal;
          transport.httpStatus = null;
          transport.failure = null;
          try {
            const response = await (options.fetch ?? globalThis.fetch)(url, { ...init, signal });
            transport.httpStatus = response.status;
            return response;
          } catch (error) {
            transport.failure = signal.aborted || (error instanceof Error && error.name === "TimeoutError") ? "timeout" : "network";
            throw error;
          }
        } });
      return read(adapter);
    });
  }
  async function files(repository: string, commit: string, paths: string[]) {
    const record = await readGit(repository, "github_commit", (adapter) => adapter.readCommit(repository, commit));
    const tree = await readGit(repository, "github_tree", (adapter) => adapter.readTree(repository, record.tree.sha));
    return new Map(await Promise.all(paths.map(async (path) => {
      const entry = tree.find((item) => item.path === path);
      if (!entry || entry.type !== "blob" || entry.mode !== "100644") throw changed();
      return [path, await readGit(repository, "github_blob", (adapter) => adapter.readBlob(repository, entry.sha))] as const;
    })));
  }
  return async (source: AmendmentPublishedSource): Promise<OrganizerAmendmentBaseline> => {
    try {
      const artifacts = await buildApprovedPublicationArtifacts({ snapshotJson: source.snapshotJson, approvalHash: source.approvalHash }).catch(() => { throw changed(); });
      if (artifacts.snapshot.candidateId !== source.candidateId || artifacts.snapshot.candidateVersion !== source.candidateVersion
        || !/^[a-f0-9]{40}$/.test(source.mainCommit) || !/^[a-f0-9]{40}$/.test(source.dataCommit)) throw changed();
      const eventId = artifacts.event.id;
      const pinPath = `data/event-data-pins/${eventId}.json`;
      const mainRepo = GITHUB_PUBLICATION_REPOSITORIES[1];
      const dataRepo = GITHUB_PUBLICATION_REPOSITORIES[0];
      const mainCommit = await readGit(mainRepo, "github_ref", async (adapter) => {
        const commit = await adapter.readRef(mainRepo, "main");
        if (!commit) throw new PublicationFailure("github_api_response", "GitHub main ref is unavailable.", true);
        return commit;
      });
      const [mainFiles, originalFiles, published] = await Promise.all([
        files(mainRepo, mainCommit, [pinPath, "data/published-events.json", "data/circle-identities/allocations.json", "data/circle-identities/evidence.json"]),
        files(mainRepo, source.mainCommit, [pinPath]),
        readUpstream({ stage: "published_catalog", repository: null }, () => options.published(eventId)),
      ]);
      const pin = parseEventDataPin(JSON.parse(mainFiles.get(pinPath)!));
      const originalPin = parseEventDataPin(JSON.parse(originalFiles.get(pinPath)!));
      if (pin.eventId !== eventId || originalPin.eventId !== eventId || originalPin.commit !== source.dataCommit
        || !parsePublishedEvents(JSON.parse(mainFiles.get("data/published-events.json")!)).includes(eventId)) throw changed();
      let adoption: OrganizerAmendmentBaseline["adoption"];
      if (semantic(pin) !== semantic(originalPin)) {
        const records = (options.adoptions ?? registeredAdoptions.records).map(parseBaselineAdoption)
          .filter((record) => adoptionMatchesSource(record, source, eventId));
        if (records.length !== 1) throw changed();
        const record = records[0];
        const targetFiles = await files(mainRepo, record.target.mainCommit, [pinPath, "data/circle-identities/evidence.json"]);
        if (await sha256Hex(baselineCanonicalJson(pin)) !== record.target.pinSha256
          || semantic(pin) !== semantic(JSON.parse(targetFiles.get(pinPath)!))
          || await sha256Hex(baselineCanonicalJson(baselineEventEvidence(JSON.parse(targetFiles.get("data/circle-identities/evidence.json")!), eventId))) !== record.target.evidenceSha256) throw changed();
        // Only the reviewed grouping file may differ. No event/map/reference
        // edits can ride along with this identity-only adoption.
        const groupingPath = `events/${eventId}/circle-identity-groups.json`;
        if (pin.files.length !== originalPin.files.length || pin.commit === source.dataCommit
          || pin.files.some((file: { path: string; sha256: string }) => !originalPin.files.some((old: { path: string; sha256: string }) =>
            old.path === file.path && (file.path === groupingPath || old.sha256 === file.sha256)))) throw changed();
        adoption = { record, sha256: await sha256Hex(baselineCanonicalJson(record)) };
      }
      if (!published || published.dataCommit !== pin.commit) throw new AmendmentBaselineError("amendment_publication_pending", "公開版本尚未與活動資料一致，請稍後再試。");
      const dataFiles = await files(dataRepo, pin.commit, pin.files.map((file: { path: string }) => file.path));
      // Verify the original grouping against the original approval as well;
      // the replacement is authorized by the deployed adoption record.
      if (adoption) {
        const path = `events/${eventId}/circle-identity-groups.json`;
        const old = await files(dataRepo, source.dataCommit, [path]);
        const original = originalPin.files.find((file: { path: string }) => file.path === path);
        if (!original || await sha256Hex(old.get(path)!) !== original.sha256
          || old.get(path) !== artifacts.files.find((file) => file.path === path)?.text) throw changed();
      }
      for (const file of pin.files) {
        const text = dataFiles.get(file.path)!;
        const approved = artifacts.files.find((entry) => entry.path === file.path);
        if (await sha256Hex(text) !== file.sha256 || !approved
          || (!(adoption && file.path === `events/${eventId}/circle-identity-groups.json`)
            && (file.path.startsWith("references/") ? semantic(JSON.parse(text)) !== semantic(JSON.parse(approved.text)) : text !== approved.text))) {
          throw changed();
        }
      }
      if (artifacts.files.filter((file) => !file.path.endsWith("/NOTICE")).length !== pin.files.length) throw changed();
      const allocations: unknown = JSON.parse(mainFiles.get("data/circle-identities/allocations.json")!);
      const evidence: unknown = JSON.parse(mainFiles.get("data/circle-identities/evidence.json")!);
      const grouping = adoption ? JSON.parse(dataFiles.get(`events/${eventId}/circle-identity-groups.json`)!) : artifacts.grouping;
      const current = planOrganizerAmendment({ event: artifacts.event, official: artifacts.official, grouping,
        allocations, evidence, changes: [], today: () => artifacts.snapshot.contentUpdatedAt.slice(0, 10) });
      const projected = buildOfficialCatalogPayload({ eventId, event: artifacts.event, official: current.official, evidence: current.evidence });
      if (semantic(projected) !== semantic(published.catalog)) throw changed();
      const { snapshotJson: _snapshotJson, ...identity } = source;
      void _snapshotJson;
      const baseline: OrganizerAmendmentBaseline = { schema: adoption ? "organizer-amendment-baseline/2" : "organizer-amendment-baseline/1",
        ...(adoption ? { adoption } : {}), source: identity, mainCommit, pin,
        event: artifacts.event, official: artifacts.official, grouping, allocations, evidence,
        // The draft as published: after an earlier correction with settings this
        // is its baseline with those settings applied, so the next correction
        // starts from the event readers actually see (ADR-0068).
        draft: artifacts.draft, references: artifacts.snapshot.references,
        // Do not embed the previous amendment's baseline recursively.
        maps: artifacts.snapshot.maps };
      await assertBaselineProvenance(baseline).catch(() => { throw changed(); });
      return baseline;
    } catch (error) {
      if (error instanceof AmendmentBaselineError) throw error;
      throw changed();
    }
  };
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
