import type { SourceContentType } from "./circle-records";
import type { Locale } from "./i18n/locale";
import { defineMessages, translate } from "./i18n/messages";

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

const linkMessages = defineMessages({
  "zh-Hant": LINK_KIND_LABEL,
  en: { social: "Social & creators", support: "Support platforms", website: "Website & other links", announcement: "Event announcement", catalog: "Catalog", store: "Pre-order / mail order", sample: "Sample pages" },
  ja: { social: "SNS・作者", support: "支援サービス", website: "Webサイト・その他リンク", announcement: "告知", catalog: "お品書き", store: "予約・通販", sample: "サンプル" },
});

export function linkKindLabel(kind: keyof typeof LINK_KIND_LABEL, locale: Locale = "zh-Hant"): string {
  return translate(linkMessages, locale, kind);
}

function sourceDate(value: string) {
  const date = value.slice(0, 10).replaceAll("-", ".");
  return date || "時間不明";
}

/** Organizer rows were imported; circle rows were typed here, so they read as an update. */
export function sourceDateLabel(source: { contentType: SourceContentType; fetchedAt: string }, locale: Locale = "zh-Hant"): string {
  if (locale !== "zh-Hant") {
    const date = source.fetchedAt.slice(0, 10).replaceAll("-", ".");
    if (!date) return locale === "en" ? "Date unknown" : "日付不明";
    const labels = locale === "en" ? { circle: "Updated", imported: "Imported" } : { circle: "更新", imported: "取込" };
    return `${source.contentType === "circle" ? labels.circle : labels.imported} ${date}`;
  }
  return `${source.contentType === "circle" ? "最後更新" : "匯入"} ${sourceDate(source.fetchedAt)}`;
}
