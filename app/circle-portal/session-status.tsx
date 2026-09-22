import { useEffect } from "react";
import { SESSION_EXPIRED_EVENT, type PortalSession } from "../circle-editor-client";

/** Control surfaces use the server's deadline and leave on any session 401. */
export function useSessionExpiry(session: PortalSession | null, onExpired: () => void) {
  const expiresAt = session?.expiresAt;
  const signedIn = session !== null;
  useEffect(() => {
    if (!signedIn) return;
    const check = () => { if (expiresAt !== undefined && Date.now() >= expiresAt) onExpired(); };
    const timer = expiresAt === undefined ? undefined
      : window.setTimeout(check, Math.max(0, expiresAt - Date.now()));
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    };
  }, [expiresAt, signedIn, onExpired]);
}

export function SessionDeadline({ session }: { session: PortalSession }) {
  if (session.expiresAt === undefined) return null;
  const date = new Date(session.expiresAt);
  return <small>登入有效至 <time dateTime={date.toISOString()}>{date.toLocaleString("zh-TW", { hour12: false })}</time></small>;
}
