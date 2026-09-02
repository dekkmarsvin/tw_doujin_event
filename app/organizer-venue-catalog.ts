export type OrganizerVenueSpaceAreaMode = "imported" | "none";

export type OrganizerVenueCatalogSpace = {
  id: string;
  venueId: string;
  name: string;
  sourceUrl: string | null;
  /** Suggested for a new event; the event assignment owns the final choice. */
  defaultAreaMode: OrganizerVenueSpaceAreaMode;
};

export type OrganizerVenueCatalogVenue = {
  id: string;
  name: string;
  sourceUrl: string | null;
  spaces: OrganizerVenueCatalogSpace[];
};

export type OrganizerVenueCatalog = {
  venues: OrganizerVenueCatalogVenue[];
};

type OrganizerVenueCatalogSeed = Omit<OrganizerVenueCatalogVenue, "spaces"> & {
  spaces: Array<Omit<OrganizerVenueCatalogSpace, "venueId">>;
};

export const INITIAL_ORGANIZER_VENUE_CATALOG: readonly OrganizerVenueCatalogSeed[] = [
  {
    id: "taipei-nangang-exhibition-center-hall-1",
    name: "台北南港展覽館 1 館",
    sourceUrl: "https://www.tainex.com.tw/venue/showgrounds/1/1",
    spaces: [
      {
        id: "taipei-nangang-exhibition-center-hall-1-1f",
        name: "1F 展場",
        sourceUrl: "https://www.tainex.com.tw/venue/showgrounds/1/1",
        defaultAreaMode: "imported",
      },
      {
        id: "taipei-nangang-exhibition-center-hall-1-4f",
        name: "4F 展場",
        sourceUrl: "https://www.tainex.com.tw/venue/showgrounds/1/4",
        defaultAreaMode: "imported",
      },
    ],
  },
  {
    id: "taipei-nangang-exhibition-center-hall-2",
    name: "台北南港展覽館 2 館",
    sourceUrl: "https://www.tainex.com.tw/venue/showgrounds/2/1",
    spaces: [
      {
        id: "taipei-nangang-exhibition-center-hall-2-1f",
        name: "1F 展場",
        sourceUrl: "https://www.tainex.com.tw/venue/showgrounds/2/1",
        defaultAreaMode: "imported",
      },
      {
        id: "taipei-nangang-exhibition-center-hall-2-4f",
        name: "4F 展場",
        sourceUrl: "https://www.tainex.com.tw/venue/showgrounds/2/4",
        defaultAreaMode: "imported",
      },
    ],
  },
  {
    id: "taipei-hakka-cultural-center",
    name: "客家文化中心",
    sourceUrl: "https://ssl.thcp.org.tw/rental",
    spaces: [
      {
        id: "taipei-hakka-cultural-center-5f-exhibition-hall",
        name: "5F 展場",
        sourceUrl: "https://ssl.thcp.org.tw/uploads/articles/3jmFK3EnXv72urguT9Qxmxl2nBD3HS.pdf",
        defaultAreaMode: "none",
      },
    ],
  },
  {
    // FF47 already publishes these identifiers. Keep them stable and change
    // only the Organizer-facing space label from the old generic 「展區」.
    id: "taipei-expo-park-zhengyan-hall",
    name: "花博公園爭艷館",
    sourceUrl: "https://www.expopark.taipei/FieldInfo_Detail.aspx?n=205&s=1",
    spaces: [
      {
        id: "zhengyan-exhibition-area",
        name: "全館",
        sourceUrl: "https://ws.expopark.taipei/Download.ashx?u=LzAwMS9VcGxvYWQvNDAwL3JlbGZpbGUvOTAyMi8xLzQzNGEzOWM4LWZlMWYtNDIxMi05MDc3LWJhZGY0NDc2NTI5ZS5wZGY%3d&n=6Iqx5Y2a5YWs5ZyS54it6Im36aSo5bGV5Y2A5bmz6Z2i6YWN572u5ZyWLnBkZg%3d%3d",
        defaultAreaMode: "none",
      },
    ],
  },
] as const;

export function normalizeOrganizerVenueName(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return normalized.length > 0 && normalized.length <= 120 ? normalized : null;
}

export function organizerVenueNameKey(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-Hant");
}

export function normalizeOrganizerVenueSourceUrl(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function isOrganizerVenueSpaceAreaMode(value: unknown): value is OrganizerVenueSpaceAreaMode {
  return value === "imported" || value === "none";
}

export function validateOrganizerVenueCatalogAssignments(
  assignments: readonly { venueId: string; venueSpaceId: string }[],
  catalog: OrganizerVenueCatalog,
) {
  const venues = new Map(catalog.venues.map((venue) => [venue.id, venue]));
  const spaces = new Map(catalog.venues.flatMap((venue) => venue.spaces).map((space) => [space.id, space]));
  return assignments.flatMap((assignment, row) => {
    const venue = venues.get(assignment.venueId);
    if (!venue) return [{
      severity: "error" as const,
      step: "venue" as const,
      code: "unknown_venue",
      row: row + 1,
      target: `venue.assignments.${row}.venueId`,
      message: "選取的場館已不存在，請重新選擇或建立新場館。",
    }];
    const space = spaces.get(assignment.venueSpaceId);
    if (!space) return [{
      severity: "error" as const,
      step: "venue" as const,
      code: "unknown_venue_space",
      row: row + 1,
      target: `venue.assignments.${row}.venueSpaceId`,
      message: "選取的使用空間已不存在，請重新選擇或新增使用空間。",
    }];
    return space.venueId === venue.id ? [] : [{
      severity: "error" as const,
      step: "venue" as const,
      code: "venue_space_mismatch",
      row: row + 1,
      target: `venue.assignments.${row}.venueSpaceId`,
      message: "選取的使用空間不屬於這個場館，請重新選擇。",
    }];
  });
}
