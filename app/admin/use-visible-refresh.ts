import { useEffect, useRef } from "react";

/**
 * Admin panels refresh on their own instead of offering a 重新整理 button:
 * when the window regains focus, when the tab becomes visible, and — given an
 * interval — on that interval while the tab stays visible.
 */
export function useVisibleRefresh(refresh: () => void, interval?: number) {
  const latest = useRef(refresh);
  useEffect(() => { latest.current = refresh; });
  useEffect(() => {
    const run = () => { if (document.visibilityState === "visible") latest.current(); };
    const timer = interval ? window.setInterval(run, interval) : undefined;
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
    };
  }, [interval]);
}
