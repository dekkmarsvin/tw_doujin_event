import { useEffect, useState } from "react";

export type TextScale = "standard" | "large" | "extra";

const TEXT_SCALE_STORAGE_KEY = "event-map-text-scale";
const LEGACY_TEXT_SCALE_STORAGE_KEY = "ff47-event-map-text-scale";

export function useReaderTextScale() {
  const [textScale, setTextScale] = useState<TextScale>("standard");
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TEXT_SCALE_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_TEXT_SCALE_STORAGE_KEY);
      if (stored === "standard" || stored === "large" || stored === "extra") queueMicrotask(() => setTextScale(stored));
    } catch {
      // Font scaling remains available for this session when storage is blocked.
    }
  }, []);

  const changeTextScale = (next: TextScale) => {
    setTextScale(next);
    try { window.localStorage.setItem(TEXT_SCALE_STORAGE_KEY, next); } catch { /* Keep the in-memory preference. */ }
  };

  const fontScale = textScale === "extra" ? 1.24 : textScale === "large" ? 1.12 : 1;
  return { textScale, changeTextScale, fontScale };
}
