export const NUDGE_STEPS = [.1, .5, 1, 5, 10] as const;
export const DEFAULT_BACKGROUND_OPACITY = 30;
export const MAP_EDITOR_PREFERENCES_KEY = "map-editor-display/1";
export type MapEditorPreferences = { showBackground: boolean; backgroundOpacity: number; tracing: boolean; nudge: number };
export const DEFAULT_MAP_EDITOR_PREFERENCES: MapEditorPreferences = { showBackground: true, backgroundOpacity: DEFAULT_BACKGROUND_OPACITY, tracing: false, nudge: 1 };

/** How the maintainer wants to look at the plan while tracing it — how far the
 * source image shows through, whether the vectors are reduced to outlines, and
 * how far an arrow key moves. None of it describes the venue, so none of it
 * enters a map draft, its revision history or anything published: it stays in
 * this browser and never advances a candidate revision.
 *
 * Reading `localStorage` throws outright where site data is blocked rather than
 * returning nothing, so the storage is resolved through a guard and every
 * caller keeps working with the defaults when there is none. */
export function mapEditorPreferenceStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try { return localStorage; } catch { return null; }
}

/** Each field is taken only when it is still one of the values the toolbar can
 * show, so a stored preference from a newer build, a hand-edited entry or a
 * half-written one falls back to its default instead of leaving a control with
 * no matching option. */
export function readMapEditorPreferences(storage: Pick<Storage, "getItem"> | null): MapEditorPreferences {
  let parsed: unknown;
  try { parsed = JSON.parse(storage?.getItem(MAP_EDITOR_PREFERENCES_KEY) ?? "null"); } catch { return DEFAULT_MAP_EDITOR_PREFERENCES; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return DEFAULT_MAP_EDITOR_PREFERENCES;
  const stored = parsed as Record<string, unknown>;
  return {
    showBackground: typeof stored.showBackground === "boolean" ? stored.showBackground : DEFAULT_MAP_EDITOR_PREFERENCES.showBackground,
    backgroundOpacity: typeof stored.backgroundOpacity === "number" && Number.isFinite(stored.backgroundOpacity)
      ? Math.max(0, Math.min(100, stored.backgroundOpacity))
      : DEFAULT_BACKGROUND_OPACITY,
    tracing: stored.tracing === true,
    nudge: NUDGE_STEPS.some(step => step === stored.nudge) ? stored.nudge as number : DEFAULT_MAP_EDITOR_PREFERENCES.nudge,
  };
}

export function saveMapEditorPreferences(storage: Pick<Storage, "setItem"> | null, preferences: MapEditorPreferences) {
  try { storage?.setItem(MAP_EDITOR_PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* A full or blocked store only costs the next session's defaults. */ }
}
