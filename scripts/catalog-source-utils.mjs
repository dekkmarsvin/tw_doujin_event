export function normalizeTextSource(value) {
  return value.replace(/\r\n?/g, "\n");
}
