export const VENUE_OVERVIEW_SCHEMA = "venue-overview/1";

export type OverviewPoint = { x: number; y: number };
export type OverviewRect = { x: number; y: number; width: number; height: number };

export type OverviewArea = {
  id: string;
  kind: "plaza" | "park" | "corridor";
  points?: OverviewPoint[];
  rect?: OverviewRect;
  strokeWidth?: number;
};

export type OverviewWater = {
  id: string;
  points: OverviewPoint[];
  shoreline?: OverviewPoint[];
  bridge?: {
    rect: OverviewRect;
    circle?: { cx: number; cy: number; r: number };
    tower?: OverviewPoint[];
  };
};

export type OverviewRoad = {
  id: string;
  width: number;
  points: OverviewPoint[];
  label?: string;
  labelAt?: OverviewPoint;
  labelAngle?: number;
};

export type OverviewStation = {
  id: string;
  code: string;
  name: string;
  color: "green" | "blue";
  x: number;
  y: number;
  secondaryCode?: string;
  secondaryName?: string;
};

export type OverviewRail = {
  id: string;
  points: OverviewPoint[];
  stations: OverviewStation[];
};

export type OverviewLandmark = {
  id: string;
  kind: "arch" | "pier2-logo" | "label" | "compass" | "water-label";
  x: number;
  y: number;
  label?: string;
  subLabel?: string;
};

export type OverviewBuilding = {
  id: string;
  venueSpaceId?: string;
  label: string;
  rect: OverviewRect;
  orientation: "horizontal" | "vertical";
  roof: "gable" | "flat";
  kind: "warehouse" | "service" | "context";
  calloutAbove?: boolean;
};

export type VenueOverviewSource = {
  id: string;
  kind: "organizer-official" | "venue-official";
  url: string;
  retrievedAt: string;
  note?: string;
};

export type VenueOverviewRecord = {
  schema: typeof VENUE_OVERVIEW_SCHEMA;
  venueId: string;
  viewBox: { width: number; height: number };
  layers?: {
    areas?: OverviewArea[];
    water?: OverviewWater[];
    roads?: OverviewRoad[];
    rail?: OverviewRail[];
    landmarks?: OverviewLandmark[];
  };
  buildings: OverviewBuilding[];
  sources: VenueOverviewSource[];
  provenance: Record<string, string[]>;
};

export type Building25dPolygons = {
  shadow: OverviewRect;
  southWall: string;
  eastWall: string;
  backSlope: string | null;
  frontSlope: string;
  ridgeLine: { x1: number; y1: number; x2: number; y2: number } | null;
  outline: string;
  labelAnchor: OverviewPoint;
};

export function parseVenueOverviewRecord(value: unknown, label?: string): VenueOverviewRecord;
export function venueOverviewSpaceIds(overview: VenueOverviewRecord): Set<string>;
export function buildBuilding25dPolygons(building: OverviewBuilding): Building25dPolygons;
