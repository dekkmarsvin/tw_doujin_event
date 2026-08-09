import templateData from "./ff47-circle-templates.generated.json";

export type CircleTemplateLinkKind = "social" | "support" | "website" | "announcement" | "catalog" | "store" | "sample";

export type CircleTemplateLink = {
  provider: string;
  kind: CircleTemplateLinkKind;
  url: string;
};

export type CircleTemplate = {
  id: string;
  sourceRow: number;
  name: string;
  pen?: string;
  placements: Record<"1" | "2" | "3", string[]>;
  creatorTypes: string[];
  ageRatings: string[];
  workTypes: string[];
  referencedWorks: string[];
  saleInfo?: string;
  specialTags: string[];
  confidence?: string;
  surveyUrls: string[];
  links: CircleTemplateLink[];
  thumbnail?: {
    sourceUrl: string;
    url: string;
    provider: string;
  };
};

export const FF47_CIRCLE_TEMPLATES = templateData as CircleTemplate[];

export function normalizeCircleTemplateName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-Hant");
}

const templatesByName = new Map<string, CircleTemplate[]>();
const templatesByPlacement = new Map<string, CircleTemplate[]>();

for (const template of FF47_CIRCLE_TEMPLATES) {
  const nameKey = normalizeCircleTemplateName(template.name);
  templatesByName.set(nameKey, [...(templatesByName.get(nameKey) ?? []), template]);
  for (const day of [1, 2, 3] as const) {
    for (const code of template.placements[String(day) as "1" | "2" | "3"]) {
      const placementKey = `${day}\u0000${code}\u0000${nameKey}`;
      templatesByPlacement.set(placementKey, [...(templatesByPlacement.get(placementKey) ?? []), template]);
    }
  }
}

/** Match only exact Excel evidence: same normalized name and, when present, the same day/booth. */
export function findCircleTemplate(name: string, day: 1 | 2 | 3, boothCode: string) {
  const nameKey = normalizeCircleTemplateName(name);
  const placementMatches = templatesByPlacement.get(`${day}\u0000${boothCode.toUpperCase()}\u0000${nameKey}`) ?? [];
  if (placementMatches.length === 1) return placementMatches[0];
  const nameMatches = templatesByName.get(nameKey) ?? [];
  return nameMatches.length === 1 ? nameMatches[0] : undefined;
}
