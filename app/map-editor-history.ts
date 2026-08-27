import type { EventMapLayout } from "./event-map";

/** How many layout snapshots the editor keeps behind the current one. Each
 * entry is a whole layout clone, and an FF47-scale map is ~1000 slots, so the
 * cap trades unlimited undo for bounded memory. Steps older than the cap are
 * dropped from the oldest end; the baseline restore in the importer remains the
 * way back to where the session started. */
export const LAYOUT_HISTORY_LIMIT = 50;

export type LayoutHistory = {
  past: readonly EventMapLayout[];
  present: EventMapLayout;
  future: readonly EventMapLayout[];
  /** Coalescing key of the push that produced `present`. Consecutive pushes
   * sharing a key replace the entry instead of adding one, so a pointer drag
   * or a typed field is a single undo step rather than one step per event. */
  lastKey: string | null;
};

export function createLayoutHistory(present: EventMapLayout): LayoutHistory {
  return { past: [], present, future: [], lastKey: null };
}

export function canUndoLayoutHistory(history: LayoutHistory) {
  return history.past.length > 0;
}

export function canRedoLayoutHistory(history: LayoutHistory) {
  return history.future.length > 0;
}

function trim(past: readonly EventMapLayout[]) {
  return past.length > LAYOUT_HISTORY_LIMIT ? past.slice(past.length - LAYOUT_HISTORY_LIMIT) : past;
}

/** Records `next` as the current layout. A redo branch is always discarded:
 * once the maintainer edits after undoing, the abandoned states are gone. */
export function pushLayoutHistory(history: LayoutHistory, next: EventMapLayout, coalesceKey: string | null = null): LayoutHistory {
  if (coalesceKey !== null && coalesceKey === history.lastKey) {
    return { past: history.past, present: next, future: [], lastKey: coalesceKey };
  }
  return { past: trim([...history.past, history.present]), present: next, future: [], lastKey: coalesceKey };
}

/** Ends the current coalescing run so the next push starts its own entry, even
 * when it carries the same key — dragging the same element twice with one
 * pointer would otherwise collapse into a single step. */
export function sealLayoutHistory(history: LayoutHistory): LayoutHistory {
  return history.lastKey === null ? history : { ...history, lastKey: null };
}

export function undoLayoutHistory(history: LayoutHistory): LayoutHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    lastKey: null,
  };
}

export function redoLayoutHistory(history: LayoutHistory): LayoutHistory {
  const [next, ...rest] = history.future;
  if (!next) return history;
  return { past: trim([...history.past, history.present]), present: next, future: rest, lastKey: null };
}
