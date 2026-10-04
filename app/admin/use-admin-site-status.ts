import { useCallback, useEffect, useRef, useState } from "react";
import { readAdminSiteSettings, requestAdminServiceCheck } from "../circle-editor-client";
import type { AdminSiteSettings } from "../site-settings";

/** Settings and overview share the same explicit diagnostic and bounded wait. */
export function useAdminSiteStatus(onLoaded?: (answer: AdminSiteSettings) => void) {
  const [data, setData] = useState<AdminSiteSettings | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const mounted = useRef(false);
  const diagnosticInFlight = useRef(false);
  const version = useRef({ value: 0 });
  const applySaved = useCallback((answer: AdminSiteSettings) => {
    if (!mounted.current) return;
    setData(answer); setUpdatedAt(Date.now()); setError("");
    // A saved request remains pending across navigation; resume its existing
    // bounded, read-only wait rather than presenting it as never checked.
    if (!diagnosticInFlight.current) setChecking(answer.services?.checkedAt === null);
    onLoaded?.(answer);
  }, [onLoaded]);
  const load = useCallback(async () => {
    const request = ++version.current.value;
    try {
      const answer = await readAdminSiteSettings();
      if (request === version.current.value) applySaved(answer);
    } catch (failure) {
      if (mounted.current && request === version.current.value) setError(failure instanceof Error ? failure.message : "無法取得營運設定。");
    }
  }, [applySaved]);
  useEffect(() => {
    mounted.current = true;
    const requests = version.current;
    void load();
    return () => { mounted.current = false; ++requests.value; };
  }, [load]);
  const requestedAt = data?.services?.requestedAt;
  const checkedAt = data?.services?.checkedAt;
  useEffect(() => {
    if (!checking || requestedAt === undefined || checkedAt !== null) return;
    const deadline = Date.now() + 90_000;
    let active = true;
    const timer = window.setInterval(() => {
      if (Date.now() >= deadline) {
        window.clearInterval(timer); setChecking(false); setError("尚未收到排程服務的檢查結果，請稍後重新檢查。"); return;
      }
      void readAdminSiteSettings().then(answer => {
        if (!active) return;
        setData(current => current ? { ...current, services: answer.services, publicationActivities: answer.publicationActivities } : current);
        if (answer.services?.requestedAt !== requestedAt || answer.services.checkedAt !== null) setChecking(false);
      }).catch(failure => {
        if (active) { setChecking(false); setError(failure instanceof Error ? failure.message : "無法取得檢查結果。"); }
      });
    }, 3_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [checking, requestedAt, checkedAt]);
  const checkServices = async () => {
    if (diagnosticInFlight.current) return;
    diagnosticInFlight.current = true;
    ++version.current.value;
    setChecking(true); setError("");
    try {
      const answer = await requestAdminServiceCheck();
      if (mounted.current) {
        ++version.current.value;
        setData(current => current ? { ...current, services: answer.services } : current);
        setChecking(answer.services.checkedAt === null);
      }
    } catch (failure) {
      if (mounted.current) { setChecking(false); setError(failure instanceof Error ? failure.message : "無法開始檢查。"); }
    } finally { diagnosticInFlight.current = false; }
  };
  return { data, error, setError, checking, updatedAt, load, applySaved, checkServices };
}
