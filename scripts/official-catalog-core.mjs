export function consumeOrganizerEvidenceKey(consumed, key) {
  if (consumed.has(key)) throw new Error(`Official booth ${key} appears more than once.`);
  consumed.add(key);
}

export function assertExactOrganizerEvidenceCoverage(expected, consumed) {
  const missing = [...expected].filter((key) => !consumed.has(key));
  const unexpected = [...consumed].filter((key) => !expected.has(key));
  if (missing.length || unexpected.length) {
    throw new Error(`Organizer evidence coverage mismatch (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}).`);
  }
}
