import { isHttpsUrl } from "./circle-overrides";

/**
 * Human-readable reasons the circle editor refuses a value.
 *
 * These exist so an author sees which row is wrong instead of the shared
 * validator's single sentence for the whole document. They are built on the
 * exported predicates rather than re-deriving the rules: a second copy would
 * eventually accept something `isCircleOverrideFields` rejects, and the author
 * would be told to fix a field that was already fine.
 *
 * An empty string means "no problem", so a caller can `.filter(Boolean)`.
 */

export function linkUrlProblem(url: string) {
  if (!url.trim()) return "請填寫網址。";
  return isHttpsUrl(url) ? "" : "網址必須是 https:// 開頭的有效網址。";
}

/**
 * The host allowlist is gone (ADR-0052); what remains is the protocol rule and,
 * in the editor, whether the browser can actually load the address as an image.
 * A network check cannot live here — this module is synchronous and shared with
 * the write route — so the editor does the loading and reports the result.
 */
export function thumbnailUrlProblem(url: string) {
  return linkUrlProblem(url);
}

export const THUMBNAIL_NOT_AN_IMAGE = "這個網址載不出圖片，請改用可直接開啟的圖片網址。";
