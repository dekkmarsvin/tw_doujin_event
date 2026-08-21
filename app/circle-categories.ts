export const CIRCLE_CATEGORY_CATALOG_SCHEMA = "circle-category-catalog/1" as const;
export const ALL_CIRCLE_CATEGORIES = "全部類別" as const;

export type CircleCategoryDefinition = {
  id: string;
  label: string;
  description: string;
};

export type CircleCategoryCatalog = {
  schema: typeof CIRCLE_CATEGORY_CATALOG_SCHEMA;
  source: {
    provider: string;
    url: string;
    retrievedAt: string;
  };
  categories: readonly CircleCategoryDefinition[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpsUrl(value: unknown): value is string {
  if (!nonempty(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Organizer vocabularies are event data, not UI constants. Strict parsing
 * keeps a malformed future event from silently publishing an incomplete
 * filter or offering values the write route would later reject. */
export function parseCircleCategoryCatalog(value: unknown): CircleCategoryCatalog {
  if (!isRecord(value) || value.schema !== CIRCLE_CATEGORY_CATALOG_SCHEMA) {
    throw new Error("Unsupported circle category catalog schema.");
  }
  if (!isRecord(value.source) || !nonempty(value.source.provider) || !isHttpsUrl(value.source.url)
    || !nonempty(value.source.retrievedAt) || Number.isNaN(Date.parse(value.source.retrievedAt))) {
    throw new Error("Circle category catalog source is invalid.");
  }
  if (!Array.isArray(value.categories) || value.categories.length === 0 || !value.categories.every((category) =>
    isRecord(category) && nonempty(category.id) && /^[a-z0-9][a-z0-9-]*$/.test(category.id)
      && nonempty(category.label) && nonempty(category.description))) {
    throw new Error("Circle category catalog categories are invalid.");
  }
  const categories = value.categories as CircleCategoryDefinition[];
  if (new Set(categories.map(({ id }) => id)).size !== categories.length
    || new Set(categories.map(({ label }) => label)).size !== categories.length
    || categories.some(({ label }) => label === ALL_CIRCLE_CATEGORIES)) {
    throw new Error("Circle category catalog ids and labels must be unique.");
  }
  return {
    schema: CIRCLE_CATEGORY_CATALOG_SCHEMA,
    source: value.source as CircleCategoryCatalog["source"],
    categories: categories.map((category) => ({ ...category })),
  };
}

export function circleCategoryLabels(catalog: CircleCategoryCatalog) {
  return [ALL_CIRCLE_CATEGORIES, ...catalog.categories.map(({ label }) => label)] as const;
}

export function findCircleCategory(catalog: CircleCategoryCatalog, label: string) {
  return catalog.categories.find((category) => category.label === label) ?? null;
}

export function isCircleCategoryLabel(catalog: CircleCategoryCatalog, value: unknown): value is string {
  return typeof value === "string" && (value === "" || findCircleCategory(catalog, value) !== null);
}
