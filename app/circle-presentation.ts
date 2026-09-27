import type { SourceContentType } from "./circle-records";

/**
 * Words a reader sees next to circle-authored content, shared by the map panel,
 * the circle's own page and the portal, so an author picks a link kind by the
 * name readers will see and every surface dates the same row the same way.
 */
export const LINK_KIND_LABEL = {
  social: "社群與作者",
  support: "贊助平台",
  website: "網站與其他連結",
  announcement: "本次預告",
  catalog: "品書",
  store: "預購／通販",
  sample: "試閱",
} as const;

function sourceDate(value: string) {
  const date = value.slice(0, 10).replaceAll("-", ".");
  return date || "時間不明";
}

/** Organizer rows were imported; circle rows were typed here, so they read as an update. */
export function sourceDateLabel(source: { contentType: SourceContentType; fetchedAt: string }) {
  return `${source.contentType === "circle" ? "最後更新" : "匯入"} ${sourceDate(source.fetchedAt)}`;
}
