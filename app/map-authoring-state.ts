import type { EventMapLayout } from "./event-map";

export type MapGuide = { id: string; axis: "x" | "y"; position: number; locked: boolean };
export type MapAuthoringState = { guides: MapGuide[] };
export const EMPTY_MAP_AUTHORING: MapAuthoringState = { guides: [] };
export const MAX_MAP_GUIDES = 256;

/** Private draft metadata. Public layouts never carry these construction lines. */
export function validMapAuthoringState(value: unknown, bounds: Pick<EventMapLayout, "width" | "height">): value is MapAuthoringState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  if (Object.keys(state).some(key => key !== "guides") || !Array.isArray(state.guides) || state.guides.length > MAX_MAP_GUIDES) return false;
  const ids = new Set<string>();
  return state.guides.every(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const guide = value as Record<string, unknown>;
    if (Object.keys(guide).some(key => !["id", "axis", "position", "locked"].includes(key))) return false;
    if (typeof guide.id !== "string" || !guide.id.trim() || guide.id.length > 80 || ids.has(guide.id)) return false;
    if (guide.axis !== "x" && guide.axis !== "y" || typeof guide.locked !== "boolean" || typeof guide.position !== "number" || !Number.isFinite(guide.position)) return false;
    if (guide.position < 0 || guide.position > (guide.axis === "x" ? bounds.width : bounds.height)) return false;
    ids.add(guide.id);
    return true;
  });
}

export function scaleMapAuthoringState(state: MapAuthoringState, from: Pick<EventMapLayout, "width" | "height">, to: Pick<EventMapLayout, "width" | "height">): MapAuthoringState {
  return { guides: state.guides.map(guide => ({ ...guide, position: guide.position * (guide.axis === "x" ? to.width / from.width : to.height / from.height) })) };
}
