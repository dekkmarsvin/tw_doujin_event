"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "./i18n/locale-context";
import {
  EMPTY_PLANNING_DOCUMENT,
  PLANNING_CHANGED_EVENT,
  PLANNING_STORAGE_KEY,
  inspectPlanningStorage,
  planningStorageMessage,
  savePlanningDocument,
  type PlanningDocument,
  type PlanningStorageIssue,
} from "./planning-store";

/**
 * Load planning data once the catalog has settled. Legacy favorites are
 * migrated to canonical circle IDs through the catalog, and the migrated
 * document is written back, so reading storage against an empty catalog would
 * freeze unmigrated IDs into the current schema.
 */
export function usePlanning(eventId: string, catalogSettled: boolean) {
  const [document, setDocument] = useState<PlanningDocument>(EMPTY_PLANNING_DOCUMENT);
  const [ready, setReady] = useState(false);
  // Kept as an issue, not a sentence, so a language switch re-renders it without reloading storage.
  const [storageIssue, setStorageIssue] = useState<PlanningStorageIssue | null>(null);
  const { locale } = useLocale();
  const [unsupportedRaw, setUnsupportedRaw] = useState<string | null>(null);
  const writable = useRef(true);

  useEffect(() => {
    if (!catalogSettled) return;
    let cancelled = false;
    const reload = () => {
      const snapshot = inspectPlanningStorage(localStorage, eventId);
      writable.current = snapshot.writable;
      setDocument(snapshot.document);
      setStorageIssue(snapshot.issue);
      setUnsupportedRaw(snapshot.writable ? null : snapshot.raw);
    };
    const onStorage = (event: StorageEvent) => { if (event.key === PLANNING_STORAGE_KEY) reload(); };
    queueMicrotask(() => {
      if (cancelled) return;
      const initial = inspectPlanningStorage(localStorage, eventId);
      writable.current = initial.writable;
      setStorageIssue(initial.issue);
      setUnsupportedRaw(initial.writable ? null : initial.raw);
      try { setDocument(initial.writable ? savePlanningDocument(localStorage, initial.document) : initial.document); } catch { setDocument(initial.document); setStorageIssue("write-blocked"); }
      setReady(true);
    });
    window.addEventListener("storage", onStorage);
    window.addEventListener(PLANNING_CHANGED_EVENT, reload);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PLANNING_CHANGED_EVENT, reload);
    };
  }, [catalogSettled, eventId]);

  const update = useCallback((change: (current: PlanningDocument) => PlanningDocument) => {
    setDocument((current) => {
      if (!writable.current) return current;
      const next = change(current);
      try {
        const saved = savePlanningDocument(localStorage, next);
        queueMicrotask(() => window.dispatchEvent(new CustomEvent(PLANNING_CHANGED_EVENT)));
        return saved;
      } catch {
        setStorageIssue("save-failed");
        return next;
      }
    });
  }, []);

  // Complete replacements commit only after storage succeeds; callers can report success from the boolean.
  const replace = useCallback((next: PlanningDocument): boolean => {
    try {
      const saved = savePlanningDocument(localStorage, next);
      writable.current = true;
      setStorageIssue(null);
      setUnsupportedRaw(null);
      setDocument(saved);
      window.dispatchEvent(new CustomEvent(PLANNING_CHANGED_EVENT));
      return true;
    } catch {
      setStorageIssue("save-failed");
      return false;
    }
  }, []);

  const storageError = storageIssue ? planningStorageMessage(storageIssue, locale) : "";
  return { document, ready, update, replace, storageError, unsupportedRaw };
}
