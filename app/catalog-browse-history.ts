export const BROWSE_BATCH_SIZE = 24;
type BrowseHistory = { key: string; shown: number; textShown: number; y: number };
export function readBrowseHistory(state: unknown, key: string): BrowseHistory {
  const saved = (state && typeof state === "object" && "catalogBrowse" in state ? state.catalogBrowse : null) as Partial<BrowseHistory> | null;
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= BROWSE_BATCH_SIZE ? value : BROWSE_BATCH_SIZE;
  return {
    key, shown: saved?.key === key ? count(saved.shown) : BROWSE_BATCH_SIZE,
    textShown: saved?.key === key ? count(saved.textShown) : BROWSE_BATCH_SIZE,
    y: saved?.key === key && typeof saved.y === "number" && Number.isFinite(saved.y) ? Math.max(0, saved.y) : 0,
  };
}
export function saveBrowseHistory(value: BrowseHistory) {
  if (window.location.href !== value.key) return;
  window.history.replaceState({ ...window.history.state, catalogBrowse: value }, "", value.key);
}
