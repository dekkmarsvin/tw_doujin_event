import { CIRCLE_CATALOG_SCHEMA, isCircleCatalogPayload, type CircleCatalogPayload } from "./circle-records";

/** Where a circle's introduction page carries its own slice of the reviewed base. */
export const CIRCLE_PAGE_DATA_ID = "circle-page-data";
export const CIRCLE_PAGE_ROOT_ID = "circle-page-root";
/** Where the page script puts the favourite and share actions, under the name. */
export const CIRCLE_PAGE_ACTIONS_ID = "circle-page-actions";
/** Marks the one booth card per day that holds that day's plan action; the value is the day id. */
export const CIRCLE_PAGE_PLAN_DAY_ATTRIBUTE = "data-circle-plan-day";

/**
 * The one circle a page is about, as a catalog of one.
 *
 * The page is static and already prints the name and every placement; its
 * script needs the same facts as data so it can run the reader's own projection
 * and write planning entries keyed exactly as the reader writes them — a day id
 * of `1` and one of `"1"` are different plans. Carrying the slice here instead
 * of fetching `circles.json` keeps a shared link from downloading the whole
 * event's catalog to show one circle.
 *
 * Fields are copied by name: whatever else a payload object happens to hold
 * must never reach public HTML.
 */
export function circlePageData(catalog: CircleCatalogPayload, circleId: string): CircleCatalogPayload {
  const circle = catalog.circles.find((candidate) => candidate.id === circleId);
  if (!circle) throw new Error(`Circle ${circleId} is not in catalog ${catalog.eventId}.`);
  return {
    schema: CIRCLE_CATALOG_SCHEMA,
    eventId: catalog.eventId,
    generatedAt: catalog.generatedAt,
    circles: [{ id: circle.id, name: circle.name }],
    placements: catalog.placements.filter((placement) => placement.circleId === circleId)
      .map(({ id, circleId: owner, day, area, boothCode, status, tone }) => ({ id, circleId: owner, day, area, boothCode, status, tone })),
  };
}

/** `<` is escaped so a circle name can never close the script element early. */
export function circlePageDataHtml(data: CircleCatalogPayload) {
  return `<script type="application/json" id="${CIRCLE_PAGE_DATA_ID}">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

/** The page's slice, or null when it is missing or is not exactly one circle. */
export function readCirclePageData(text: string | null | undefined): CircleCatalogPayload | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return isCircleCatalogPayload(value) && value.circles.length === 1 ? value : null;
}
