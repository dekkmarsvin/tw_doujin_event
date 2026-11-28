export const VENUE_OVERVIEW_SCHEMA = "venue-overview/1";

export type OverviewPoint = { x: number; y: number };
export type OverviewRect = { x: number; y: number; width: number; height: number };

export type OverviewEllipse = { cx: number; cy: number; rx: number; ry: number };

export type OverviewArea = {
  id: string;
  kind: "plaza" | "park" | "corridor" | "block" | "track" | "courtyard";
  points?: OverviewPoint[];
  rect?: OverviewRect;
  ellipse?: OverviewEllipse;
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
  kind?: "arterial" | "local" | "elevated" | "path";
  label?: string;
  labelAt?: OverviewPoint;
  labelAngle?: number;
};

export type OverviewRailColor = "green" | "blue" | "red" | "brown";

export type OverviewStation = {
  id: string;
  code: string;
  name: string;
  color: OverviewRailColor;
  x: number;
  y: number;
  secondaryCode?: string;
  secondaryName?: string;
};

export type OverviewRail = {
  id: string;
  points: OverviewPoint[];
  color?: OverviewRailColor;
  stations: OverviewStation[];
};

export type OverviewLandmark = {
  id: string;
  kind: "arch" | "pier2-logo" | "label" | "compass" | "water-label" | "shield" | "exit" | "bus" | "parking";
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
  points?: OverviewPoint[];
  orientation: "horizontal" | "vertical";
  roof: "gable" | "flat" | "dome" | "floor";
  kind: "warehouse" | "hall" | "service" | "context";
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

export type Polygon25dPolygons = {
  shadow: string;
  walls: Array<{ points: string; shade: "south" | "east" }>;
  roof: string;
  labelAnchor: OverviewPoint;
};

export function parseVenueOverviewRecord(value: unknown, label?: string): VenueOverviewRecord;
export function venueOverviewSpaceIds(overview: VenueOverviewRecord): Set<string>;
export function buildBuilding25dPolygons(building: OverviewBuilding): Building25dPolygons;
export function buildPolygon25dPolygons(points: readonly OverviewPoint[], kind: OverviewBuilding["kind"]): Polygon25dPolygons;
