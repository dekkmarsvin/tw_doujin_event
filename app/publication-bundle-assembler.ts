type PublicationFileInput = { path: string; content: string | unknown };

export type PublicationBundleFile = { path: string; text: string; sha256: string };

const EVENT_ID = /^[a-z0-9][a-z0-9-]*$/u;
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

/** An approval may only produce this event's own files and the reference
 * records it names, never a path outside them. */
function publicationPathAllowed(eventId: string, path: string) {
  if (!EVENT_ID.test(eventId) || !path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")
    || path === ".github" || path.startsWith(".github/")) return false;
  const eventPrefix = `events/${eventId}/`;
  if (path.startsWith(eventPrefix)) {
    const relative = path.slice(eventPrefix.length);
    return /^(?:event|official-booths|circle-identity-groups|map|map-manifest|reference-selection)\.json$/u.test(relative)
      || /^maps\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*\.json$/u.test(relative)
      || relative === "NOTICE";
  }
  return /^references\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.json$/u.test(path);
}

/** The files an approval produces, sorted, serialized and hashed. */
export async function assemblePublicationFiles(eventId: string, files: readonly PublicationFileInput[]) {
  const seen = new Set<string>();
  const output: PublicationBundleFile[] = [];
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path, "en-US"))) {
    if (!publicationPathAllowed(eventId, file.path)) throw new Error(`publication path is not allowed: ${file.path}`);
    if (seen.has(file.path)) throw new Error(`Duplicate publication path: ${file.path}`);
    seen.add(file.path);
    const text = serialized(file.content);
    output.push({ path: file.path, text, sha256: await sha256(text) });
  }
  return output;
}
