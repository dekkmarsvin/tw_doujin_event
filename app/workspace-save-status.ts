import { useEffect, useId, useSyncExternalStore } from "react";

type SaveState = { dirty: boolean; saving: boolean; savedAt?: number };
const editors = new Map<string, SaveState>();
const listeners = new Set<() => void>();
function notify() { for (const listener of listeners) listener(); }

export function useEditorSaveStatus(dirty: boolean, saving: boolean, savedAt?: number) {
  const id = useId();
  useEffect(() => {
    editors.set(id, { dirty, saving, savedAt });
    notify();
    return () => { editors.delete(id); notify(); };
  }, [id, dirty, saving, savedAt]);
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function snapshot() {
  const states = [...editors.values()];
  if (states.some(s => s.saving)) return "saving";
  if (states.some(s => s.dirty)) return "dirty";
  return Math.max(0, ...states.map(s => s.savedAt ?? 0));
}
export function useWorkspaceSaveStatus() { return useSyncExternalStore(subscribe, snapshot, () => 0); }
