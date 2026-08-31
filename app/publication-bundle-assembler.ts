export type PublicationFileInput = { path: string; content: string | unknown };

export type PublicationBundleInput = {
  candidateId: string;
  eventId: string;
  candidateVersion: number;
  approvalHash: string;
  dataFiles: readonly PublicationFileInput[];
  mainFiles: readonly PublicationFileInput[];
};

export type PublicationBundleFile = { path: string; text: string; sha256: string };
export type PublicationBundle = {
  schema: "organizer-publication-bundle/1";
  candidateId: string;
  eventId: string;
  candidateVersion: number;
  approvalHash: string;
  stages: readonly [
    { repository: "data"; files: PublicationBundleFile[] },
    { repository: "main"; files: PublicationBundleFile[] },
  ];
  bundleHash: string;
};

const EVENT_ID = /^[a-z0-9][a-z0-9-]*$/u;
const HASH = /^[0-9a-f]{64}$/u;
const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(text: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

function serialized(content: unknown) {
  return typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
}

export function publicationPathAllowed(repository: "data" | "main", eventId: string, path: string) {
  if (!EVENT_ID.test(eventId) || !path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")
    || path === ".github" || path.startsWith(".github/")) return false;
  if (repository === "data") {
    const eventPrefix = `events/${eventId}/`;
    if (path.startsWith(eventPrefix)) {
      const relative = path.slice(eventPrefix.length);
      return /^(?:event|official-booths|circle-identity-groups|map|map-manifest|reference-selection)\.json$/u.test(relative)
        || /^maps\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*\.json$/u.test(relative)
        || relative === "NOTICE";
    }
    return /^references\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.json$/u.test(path);
  }
  return path === "data/published-events.json"
    || path === "data/circle-identities/allocations.json"
    || path === "data/circle-identities/evidence.json"
    || path === `data/event-data-pins/${eventId}.json`;
}

async function stage(repository: "data" | "main", eventId: string, files: readonly PublicationFileInput[]) {
  const seen = new Set<string>();
  const output: PublicationBundleFile[] = [];
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path, "en-US"))) {
    if (!publicationPathAllowed(repository, eventId, file.path)) throw new Error(`${repository} publication path is not allowed: ${file.path}`);
    if (seen.has(file.path)) throw new Error(`Duplicate publication path: ${file.path}`);
    seen.add(file.path);
    const text = serialized(file.content);
    output.push({ path: file.path, text, sha256: await sha256(text) });
  }
  return output;
}

/** Pure assembler: callers provide already validated generator/identity/pin
 * outputs. CLI and web adapters decide where the returned bytes go. */
export async function assemblePublicationBundle(input: PublicationBundleInput): Promise<PublicationBundle> {
  if (!input.candidateId || !EVENT_ID.test(input.eventId) || !Number.isSafeInteger(input.candidateVersion)
    || input.candidateVersion < 1 || !HASH.test(input.approvalHash)) throw new Error("Publication bundle identity is invalid.");
  const dataFiles = await stage("data", input.eventId, input.dataFiles);
  const mainFiles = await stage("main", input.eventId, input.mainFiles);
  const hashInput = JSON.stringify({
    schema: "organizer-publication-bundle/1", candidateId: input.candidateId, eventId: input.eventId,
    candidateVersion: input.candidateVersion, approvalHash: input.approvalHash,
    stages: [{ repository: "data", files: dataFiles }, { repository: "main", files: mainFiles }],
  });
  return {
    schema: "organizer-publication-bundle/1", candidateId: input.candidateId, eventId: input.eventId,
    candidateVersion: input.candidateVersion, approvalHash: input.approvalHash,
    stages: [{ repository: "data", files: dataFiles }, { repository: "main", files: mainFiles }],
    bundleHash: await sha256(hashInput),
  };
}

async function hmacKey(secret: string, usage: KeyUsage[]) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}

export async function verifyGitHubWebhookSignature(secret: string, body: string, signature: string | null) {
  if (!signature?.startsWith("sha256=")) return false;
  const value = signature.slice(7);
  if (!/^[0-9a-f]{64}$/u.test(value)) return false;
  const bytes = new Uint8Array(value.match(/../gu)!.map((pair) => Number.parseInt(pair, 16)));
  return crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]), bytes, encoder.encode(body));
}

/** Exported solely to construct exact signatures in runtime-agnostic tests. */
export async function signGitHubWebhookForTest(secret: string, body: string) {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), encoder.encode(body));
  return `sha256=${hex(signature)}`;
}
