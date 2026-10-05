import type { EventDefinition } from "./event-catalog";
import { defaultEventUrlState, parseEventUrlState, serializeEventUrlState } from "./event-url-state";
import { parsePublicSearch, writePublicSearch } from "./public-search-url";
import type { PublicScope, PublicSearch } from "./public-circle-search";
import { DEFAULT_LOCALE, LOCALE_QUERY_PARAM, localeFromUrl, type Locale } from "./i18n/locale";

export type CatalogBrowseState = PublicScope & PublicSearch;
export const readerView = (url: URL): "browse" | "map" => url.searchParams.get("view") === "browse" ? "browse" : "map";

export function parseCatalogBrowseUrl(event: EventDefinition, url: URL): CatalogBrowseState {
  const map = parseEventUrlState(event, url).state;
  const hasSpace = ["venueSpaceId", "area", "hall"].some((key) => url.searchParams.has(key));
  return {
    ...parsePublicSearch(event, url),
    day: url.searchParams.has("day") ? map.day : null,
    venueSpaceId: hasSpace ? map.venueSpaceId : null,
  };
}

/** Build from a clean root: private and unknown parameters never reach a share.
 * The interface language is the one parameter carried over (#524). */
export function catalogBrowseUrl(event: EventDefinition, state: CatalogBrowseState, origin: string, locale: Locale = DEFAULT_LOCALE): URL {
  const url = new URL("/", origin);
  url.searchParams.set("event", event.id);
  url.searchParams.set("view", "browse");
  if (state.day !== null) url.searchParams.set("day", String(state.day));
  if (state.venueSpaceId !== null) url.searchParams.set("venueSpaceId", state.venueSpaceId);
  writePublicSearch(event, state, url);
  if (locale !== DEFAULT_LOCALE) url.searchParams.set(LOCALE_QUERY_PARAM, locale);
  return url;
}

export function switchReaderViewUrl(event: EventDefinition, input: URL): URL {
  const locale = localeFromUrl(input) ?? DEFAULT_LOCALE;
  if (readerView(input) === "map") return catalogBrowseUrl(event, parseEventUrlState(event, input).state, input.origin, locale);
  const browse = parseCatalogBrowseUrl(event, input);
  const defaults = defaultEventUrlState(event);
  const base = new URL("/", input.origin);
  if (locale !== DEFAULT_LOCALE) base.searchParams.set(LOCALE_QUERY_PARAM, locale);
  return serializeEventUrlState(event, {
    ...defaults, ...browse, day: browse.day ?? defaults.day,
    venueSpaceId: browse.venueSpaceId ?? defaults.venueSpaceId,
  }, base);
}
