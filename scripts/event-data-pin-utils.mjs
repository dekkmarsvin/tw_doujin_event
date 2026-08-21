import { createHash } from "node:crypto";

export const EVENT_DATA_PIN_SCHEMA = "event-data-pin/1";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseEventDataPin(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema !== EVENT_DATA_PIN_SCHEMA) {
    throw new Error("Unsupported event data pin schema.");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value.eventId ?? "")) throw new Error("Invalid event data pin eventId.");
  if (!/^[\w.-]+\/[\w.-]+$/.test(value.repository ?? "")) throw new Error("Invalid event data pin repository.");
  if (!/^[0-9a-f]{40}$/.test(value.commit ?? "")) throw new Error("Event data pin must use a full commit SHA.");
  if (!Array.isArray(value.files) || value.files.length === 0) throw new Error("Event data pin must list files.");
  const seen = new Set();
  for (const file of value.files) {
    if (!file || typeof file !== "object" || !/^[a-zA-Z0-9._/-]+$/.test(file.path ?? "")
      || file.path.startsWith("/") || file.path.includes("..") || !/^[0-9a-f]{64}$/.test(file.sha256 ?? "")) {
      throw new Error("Invalid event data pin file entry.");
    }
    if (seen.has(file.path)) throw new Error(`Duplicate event data pin path: ${file.path}`);
    seen.add(file.path);
  }
  return value;
}

export function rawFileUrl(pin, file) {
  return `https://raw.githubusercontent.com/${pin.repository}/${pin.commit}/${file.path}`;
}
