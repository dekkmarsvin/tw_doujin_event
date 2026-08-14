import { isAllowedThumbnailHost, isHttpsUrl, THUMBNAIL_HOST_ALLOWLIST } from "./circle-overrides";

/**
 * Human-readable reasons the circle editor refuses a value.
 *
 * These exist so an author sees which row is wrong instead of the shared
 * validator's single "資料格式不符或超出長度限制。" for the whole document. They
 * are built on the exported predicates rather than re-deriving the rules: a
 * second copy would eventually accept something `isCircleOverrideFields`
 * rejects, and the author would be told to fix a field that was already fine.
 *
 * An empty string means "no problem", so a caller can `.filter(Boolean)`.
 */

export function linkUrlProblem(url: string) {
  if (!url.trim()) return "請填寫網址。";
  return isHttpsUrl(url) ? "" : "網址必須是 https:// 開頭的有效網址。";
}

export function thumbnailUrlProblem(url: string) {
  const problem = linkUrlProblem(url);
  if (problem) return problem;
  return isAllowedThumbnailHost(url)
    ? ""
    : `這個網域不在允許清單內。可用：${THUMBNAIL_HOST_ALLOWLIST.join("、")}`;
}
