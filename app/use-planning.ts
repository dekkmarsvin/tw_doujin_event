"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_PLANNING_DOCUMENT,
  PLANNING_CHANGED_EVENT,
  PLANNING_STORAGE_KEY,
  inspectPlanningStorage,
  savePlanningDocument,
  type PlanningDocument,
} from "./planning-store";
import { LEGACY_CIRCLE_RECORD_IDS } from "./circle-records";

export function usePlanning(eventId: string) {
  const [document, setDocument] = useState<PlanningDocument>(EMPTY_PLANNING_DOCUMENT);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [unsupportedRaw, setUnsupportedRaw] = useState<string | null>(null);
  const writable = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      const snapshot = inspectPlanningStorage(localStorage, eventId, (circleId) => LEGACY_CIRCLE_RECORD_IDS.get(circleId) ?? [circleId]);
      writable.current = snapshot.writable;
      setDocument(snapshot.document);
      setStorageError(snapshot.error);
      setUnsupportedRaw(snapshot.writable ? null : snapshot.raw);
    };
    const onStorage = (event: StorageEvent) => { if (event.key === PLANNING_STORAGE_KEY) reload(); };
    queueMicrotask(() => {
      if (cancelled) return;
      const initial = inspectPlanningStorage(localStorage, eventId, (circleId) => LEGACY_CIRCLE_RECORD_IDS.get(circleId) ?? [circleId]);
      writable.current = initial.writable;
      setStorageError(initial.error);
      setUnsupportedRaw(initial.writable ? null : initial.raw);
      try { setDocument(initial.writable ? savePlanningDocument(localStorage, initial.document) : initial.document); } catch { setDocument(initial.document); setStorageError("瀏覽器無法寫入規劃資料；目前內容只存在這個分頁。請先匯出備份。"); }
      setReady(true);
    });
    window.addEventListener("storage", onStorage);
    window.addEventListener(PLANNING_CHANGED_EVENT, reload);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PLANNING_CHANGED_EVENT, reload);
    };
  }, [eventId]);

  const update = useCallback((change: (current: PlanningDocument) => PlanningDocument) => {
    setDocument((current) => {
      if (!writable.current) return current;
      const next = change(current);
      try {
        const saved = savePlanningDocument(localStorage, next);
        queueMicrotask(() => window.dispatchEvent(new CustomEvent(PLANNING_CHANGED_EVENT)));
        return saved;
      } catch {
        setStorageError("瀏覽器無法儲存這次變更；目前內容只存在這個分頁。請先匯出備份。");
        return next;
      }
    });
  }, []);

  const replace = useCallback((next: PlanningDocument) => {
    try {
      const saved = savePlanningDocument(localStorage, next);
      writable.current = true;
      setStorageError("");
      setUnsupportedRaw(null);
      setDocument(saved);
      window.dispatchEvent(new CustomEvent(PLANNING_CHANGED_EVENT));
    } catch {
      setStorageError("瀏覽器無法儲存這次變更；目前內容只存在這個分頁。請先匯出備份。");
      setDocument(next);
    }
  }, []);

  return { document, ready, update, replace, storageError, unsupportedRaw };
}
