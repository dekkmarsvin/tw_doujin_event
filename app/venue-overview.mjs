import { validateReferenceProvenance, validateReferenceSources } from "./reference-provenance.mjs";

export const VENUE_OVERVIEW_SCHEMA = "venue-overview/1";

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const BUILDING_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ORIENTATIONS = new Set(["horizontal", "vertical"]);
const ROOFS = new Set(["gable", "flat", "dome", "floor"]);
const BUILDING_KINDS = new Set(["warehouse", "hall", "service", "context"]);
const AREA_KINDS = new Set(["plaza", "park", "corridor", "block", "track", "courtyard"]);
const ROAD_KINDS = new Set(["arterial", "local", "elevated", "path"]);
const RAIL_COLORS = new Set(["green", "blue", "red", "brown"]);
const STATION_COLORS = new Set(["green", "blue", "red", "brown"]);
const LANDMARK_KINDS = new Set(["arch", "pier2-logo", "label", "compass", "water-label", "shield", "exit", "bus", "parking"]);

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function fail(message) {
  throw new Error(message);
}

function requireRecord(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object.`);
  return value;
}

function requireKeys(value, required, allowed, label) {
  for (const key of required) if (!(key in value)) fail(`${label} is missing ${key}.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} has unknown property ${key}.`);
}

function hasControlChar(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function requireText(value, label, maxLength = 80, allowEmpty = false) {
  if (typeof value !== "string") fail(`${label} must be a string.`);
  if (hasControlChar(value)) fail(`${label} contains control characters.`);
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) fail(`${label} must not be empty.`);
  if (value.length > maxLength) fail(`${label} exceeds ${maxLength} characters.`);
  return value;
}

function requireFinite(value, label, min = -100000, max = 100000) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label} must be a finite number.`);
  }
  return value;
}

function validatePoint(value, label, viewBox) {
  const point = requireRecord(value, label);
  requireKeys(point, ["x", "y"], ["x", "y"], label);
  return {
    x: requireFinite(point.x, `${label}.x`, 0, viewBox.width),
    y: requireFinite(point.y, `${label}.y`, 0, viewBox.height),
  };
}

function validatePointList(value, label, viewBox, min = 2, max = 200) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(`${label} must have ${min}-${max} points.`);
  }
  return value.map((point, index) => validatePoint(point, `${label}[${index}]`, viewBox));
}

function validateRect(value, label, viewBox) {
  const rect = requireRecord(value, label);
  requireKeys(rect, ["x", "y", "width", "height"], ["x", "y", "width", "height"], label);
  const x = requireFinite(rect.x, `${label}.x`, 0, viewBox.width);
  const y = requireFinite(rect.y, `${label}.y`, 0, viewBox.height);
  const width = requireFinite(rect.width, `${label}.width`, 0.1, viewBox.width);
  const height = requireFinite(rect.height, `${label}.height`, 0.1, viewBox.height);
  if (x + width > viewBox.width || y + height > viewBox.height) {
    fail(`${label} must stay within viewBox.`);
  }
  return { x, y, width, height };
}

function validateLayers(value, label, viewBox) {
  const layers = requireRecord(value, label);
  requireKeys(layers, [], ["areas", "water", "roads", "rail", "landmarks"], label);

  if (layers.areas !== undefined) {
    if (!Array.isArray(layers.areas) || layers.areas.length > 60) fail(`${label}.areas is invalid.`);
    for (const [index, entry] of layers.areas.entries()) {
      const area = requireRecord(entry, `${label}.areas[${index}]`);
      requireKeys(area, ["id", "kind"], ["id", "kind", "points", "rect", "ellipse", "strokeWidth"], `${label}.areas[${index}]`);
      requireText(area.id, `${label}.areas[${index}].id`, 64);
      if (!AREA_KINDS.has(area.kind)) fail(`${label}.areas[${index}].kind is invalid.`);
      if (area.points !== undefined) validatePointList(area.points, `${label}.areas[${index}].points`, viewBox, 2, 200);
      if (area.rect !== undefined) validateRect(area.rect, `${label}.areas[${index}].rect`, viewBox);
      if (area.ellipse !== undefined) {
        const ellipse = requireRecord(area.ellipse, `${label}.areas[${index}].ellipse`);
        requireKeys(ellipse, ["cx", "cy", "rx", "ry"], ["cx", "cy", "rx", "ry"], `${label}.areas[${index}].ellipse`);
        const cx = requireFinite(ellipse.cx, `${label}.areas[${index}].ellipse.cx`, 0, viewBox.width);
        const cy = requireFinite(ellipse.cy, `${label}.areas[${index}].ellipse.cy`, 0, viewBox.height);
        const rx = requireFinite(ellipse.rx, `${label}.areas[${index}].ellipse.rx`, 1, viewBox.width);
        const ry = requireFinite(ellipse.ry, `${label}.areas[${index}].ellipse.ry`, 1, viewBox.height);
        if (cx - rx < 0 || cx + rx > viewBox.width || cy - ry < 0 || cy + ry > viewBox.height) {
          fail(`${label}.areas[${index}].ellipse must stay within viewBox.`);
        }
      }
      if (area.strokeWidth !== undefined) requireFinite(area.strokeWidth, `${label}.areas[${index}].strokeWidth`, 1, 200);
    }
  }

  if (layers.water !== undefined) {
    if (!Array.isArray(layers.water) || layers.water.length > 20) fail(`${label}.water is invalid.`);
    for (const [index, entry] of layers.water.entries()) {
      const water = requireRecord(entry, `${label}.water[${index}]`);
      requireKeys(water, ["id", "points"], ["id", "points", "shoreline", "bridge"], `${label}.water[${index}]`);
      requireText(water.id, `${label}.water[${index}].id`, 64);
      validatePointList(water.points, `${label}.water[${index}].points`, viewBox, 3, 200);
      if (water.shoreline !== undefined) validatePointList(water.shoreline, `${label}.water[${index}].shoreline`, viewBox, 2, 200);
      if (water.bridge !== undefined) {
        const bridge = requireRecord(water.bridge, `${label}.water[${index}].bridge`);
        requireKeys(bridge, ["rect"], ["rect", "circle", "tower"], `${label}.water[${index}].bridge`);
        validateRect(bridge.rect, `${label}.water[${index}].bridge.rect`, viewBox);
        if (bridge.circle !== undefined) {
          const circle = requireRecord(bridge.circle, `${label}.water[${index}].bridge.circle`);
          requireKeys(circle, ["cx", "cy", "r"], ["cx", "cy", "r"], `${label}.water[${index}].bridge.circle`);
          const cx = requireFinite(circle.cx, `${label}.water[${index}].bridge.circle.cx`, 0, viewBox.width);
          const cy = requireFinite(circle.cy, `${label}.water[${index}].bridge.circle.cy`, 0, viewBox.height);
          const r = requireFinite(circle.r, `${label}.water[${index}].bridge.circle.r`, 1, 200);
          if (cx - r < 0 || cx + r > viewBox.width || cy - r < 0 || cy + r > viewBox.height) {
            fail(`${label}.water[${index}].bridge.circle must stay within viewBox.`);
          }
        }
        if (bridge.tower !== undefined) validatePointList(bridge.tower, `${label}.water[${index}].bridge.tower`, viewBox, 3, 20);
      }
    }
  }

  if (layers.roads !== undefined) {
    if (!Array.isArray(layers.roads) || layers.roads.length > 80) fail(`${label}.roads is invalid.`);
    for (const [index, entry] of layers.roads.entries()) {
      const road = requireRecord(entry, `${label}.roads[${index}]`);
      requireKeys(road, ["id", "width", "points"], ["id", "width", "points", "kind", "label", "labelAt", "labelAngle"], `${label}.roads[${index}]`);
      requireText(road.id, `${label}.roads[${index}].id`, 64);
      requireFinite(road.width, `${label}.roads[${index}].width`, 1, 100);
      validatePointList(road.points, `${label}.roads[${index}].points`, viewBox, 2, 100);
      if (road.kind !== undefined && !ROAD_KINDS.has(road.kind)) fail(`${label}.roads[${index}].kind is invalid.`);
      if (road.label !== undefined) requireText(road.label, `${label}.roads[${index}].label`, 40);
      if (road.labelAt !== undefined) validatePoint(road.labelAt, `${label}.roads[${index}].labelAt`, viewBox);
      if (road.labelAngle !== undefined) requireFinite(road.labelAngle, `${label}.roads[${index}].labelAngle`, -360, 360);
    }
  }

  if (layers.rail !== undefined) {
    if (!Array.isArray(layers.rail) || layers.rail.length > 20) fail(`${label}.rail is invalid.`);
    for (const [index, entry] of layers.rail.entries()) {
      const rail = requireRecord(entry, `${label}.rail[${index}]`);
      requireKeys(rail, ["id", "points", "stations"], ["id", "points", "color", "stations"], `${label}.rail[${index}]`);
      requireText(rail.id, `${label}.rail[${index}].id`, 64);
      validatePointList(rail.points, `${label}.rail[${index}].points`, viewBox, 2, 200);
      if (rail.color !== undefined && !RAIL_COLORS.has(rail.color)) fail(`${label}.rail[${index}].color is invalid.`);
      if (!Array.isArray(rail.stations) || rail.stations.length > 40) fail(`${label}.rail[${index}].stations is invalid.`);
      for (const [stationIndex, stationValue] of rail.stations.entries()) {
        const station = requireRecord(stationValue, `${label}.rail[${index}].stations[${stationIndex}]`);
        requireKeys(
          station,
          ["id", "code", "name", "color", "x", "y"],
          ["id", "code", "name", "color", "x", "y", "secondaryCode", "secondaryName"],
          `${label}.rail[${index}].stations[${stationIndex}]`,
        );
        requireText(station.id, `${label}.rail[${index}].stations[${stationIndex}].id`, 64);
        requireText(station.code, `${label}.rail[${index}].stations[${stationIndex}].code`, 12);
        requireText(station.name, `${label}.rail[${index}].stations[${stationIndex}].name`, 40);
        if (!STATION_COLORS.has(station.color)) fail(`${label}.rail[${index}].stations[${stationIndex}].color is invalid.`);
        requireFinite(station.x, `${label}.rail[${index}].stations[${stationIndex}].x`, 0, viewBox.width);
        requireFinite(station.y, `${label}.rail[${index}].stations[${stationIndex}].y`, 0, viewBox.height);
        if (station.secondaryCode !== undefined) requireText(station.secondaryCode, `${label}.rail[${index}].stations[${stationIndex}].secondaryCode`, 12);
        if (station.secondaryName !== undefined) requireText(station.secondaryName, `${label}.rail[${index}].stations[${stationIndex}].secondaryName`, 40);
      }
    }
  }

  if (layers.landmarks !== undefined) {
    if (!Array.isArray(layers.landmarks) || layers.landmarks.length > 80) fail(`${label}.landmarks is invalid.`);
    for (const [index, entry] of layers.landmarks.entries()) {
      const landmark = requireRecord(entry, `${label}.landmarks[${index}]`);
      requireKeys(landmark, ["id", "kind", "x", "y"], ["id", "kind", "x", "y", "label", "subLabel"], `${label}.landmarks[${index}]`);
      requireText(landmark.id, `${label}.landmarks[${index}].id`, 64);
      if (!LANDMARK_KINDS.has(landmark.kind)) fail(`${label}.landmarks[${index}].kind is invalid.`);
      requireFinite(landmark.x, `${label}.landmarks[${index}].x`, 0, viewBox.width);
      requireFinite(landmark.y, `${label}.landmarks[${index}].y`, 0, viewBox.height);
      if (landmark.label !== undefined) requireText(landmark.label, `${label}.landmarks[${index}].label`, 40);
      if (landmark.subLabel !== undefined) requireText(landmark.subLabel, `${label}.landmarks[${index}].subLabel`, 40);
    }
  }
}

export function parseVenueOverviewRecord(value, label = "venue-overview") {
  const record = requireRecord(value, label);
  requireKeys(
    record,
    ["schema", "venueId", "viewBox", "buildings", "sources", "provenance"],
    ["schema", "venueId", "viewBox", "layers", "buildings", "sources", "provenance"],
    label,
  );
  if (record.schema !== VENUE_OVERVIEW_SCHEMA) fail(`${label} uses unsupported schema ${record.schema ?? "(missing)"}.`);
  if (typeof record.venueId !== "string" || !ID.test(record.venueId)) fail(`${label}.venueId is invalid.`);

  const viewBox = requireRecord(record.viewBox, `${label}.viewBox`);
  requireKeys(viewBox, ["width", "height"], ["width", "height"], `${label}.viewBox`);
  const parsedViewBox = {
    width: requireFinite(viewBox.width, `${label}.viewBox.width`, 100, 10000),
    height: requireFinite(viewBox.height, `${label}.viewBox.height`, 100, 10000),
  };

  if (record.layers !== undefined) validateLayers(record.layers, `${label}.layers`, parsedViewBox);

  if (!Array.isArray(record.buildings) || record.buildings.length === 0 || record.buildings.length > 100) {
    fail(`${label}.buildings must list 1-100 buildings.`);
  }
  const buildingIds = new Set();
  const venueSpaceIds = new Set();
  for (const [index, entry] of record.buildings.entries()) {
    const itemLabel = `${label}.buildings[${index}]`;
    const building = requireRecord(entry, itemLabel);
    requireKeys(
      building,
      ["id", "label", "rect", "orientation", "roof", "kind"],
      ["id", "venueSpaceId", "label", "rect", "points", "orientation", "roof", "kind", "calloutAbove"],
      itemLabel,
    );
    if (typeof building.id !== "string" || !BUILDING_ID.test(building.id)) fail(`${itemLabel}.id is invalid.`);
    if (buildingIds.has(building.id)) fail(`${label} has duplicate building id ${building.id}.`);
    buildingIds.add(building.id);

    if (building.venueSpaceId !== undefined) {
      if (typeof building.venueSpaceId !== "string" || !ID.test(building.venueSpaceId)) fail(`${itemLabel}.venueSpaceId is invalid.`);
      if (venueSpaceIds.has(building.venueSpaceId)) fail(`${label} has duplicate venueSpaceId ${building.venueSpaceId}.`);
      venueSpaceIds.add(building.venueSpaceId);
    }

    if (!ORIENTATIONS.has(building.orientation)) fail(`${itemLabel}.orientation is invalid.`);
    if (!ROOFS.has(building.roof)) fail(`${itemLabel}.roof is invalid.`);
    if (!BUILDING_KINDS.has(building.kind)) fail(`${itemLabel}.kind is invalid.`);
    requireText(building.label, `${itemLabel}.label`, 40, building.kind === "context");
    validateRect(building.rect, `${itemLabel}.rect`, parsedViewBox);
    if (building.points !== undefined) validatePointList(building.points, `${itemLabel}.points`, parsedViewBox, 3, 32);
    if (building.calloutAbove !== undefined && typeof building.calloutAbove !== "boolean") {
      fail(`${itemLabel}.calloutAbove must be boolean.`);
    }
  }

  const sourceIds = validateReferenceSources(record.sources, `${label}.sources`);
  validateReferenceProvenance(record.provenance, sourceIds, ["/viewBox", "/buildings"], `${label}.provenance`);
  return record;
}

export function venueOverviewSpaceIds(overview) {
  return new Set(
    overview.buildings
      .map((building) => building.venueSpaceId)
      .filter((venueSpaceId) => typeof venueSpaceId === "string" && venueSpaceId.length > 0),
  );
}

function fmtPoints(points) {
  return points.map(([px, py]) => `${Math.round(px * 10) / 10},${Math.round(py * 10) / 10}`).join(" ");
}

/**
 * Pure 2.5D oblique extrusion helper shared by the overview renderer.
 * Roofs shift up-left (`eave: -4,-10`; gable ridge: `-7,-18`) so south and
 * east elevations remain consistently lit across horizontal and vertical halls.
 */
export function buildBuilding25dPolygons(building) {
  const { x, y, width: w, height: h } = building.rect;
  const large = building.kind === "warehouse" || building.kind === "hall";
  const edx = large ? -4 : -3;
  const edy = large ? -10 : -8;
  const rdx = large ? -7 : -5;
  const rdy = large ? -18 : -14;

  const nw = [x + edx, y + edy];
  const ne = [x + w + edx, y + edy];
  const se = [x + w + edx, y + h + edy];
  const sw = [x + edx, y + h + edy];

  const shadow = { x: x + 4, y: y + 5, width: w, height: h };

  if (building.roof === "flat") {
    return {
      shadow,
      southWall: fmtPoints([[x, y + h], [x + w, y + h], se, sw]),
      eastWall: fmtPoints([[x + w, y + h], [x + w, y], ne, se]),
      backSlope: null,
      frontSlope: fmtPoints([nw, ne, se, sw]),
      ridgeLine: null,
      outline: fmtPoints([nw, ne, [x + w, y], [x + w, y + h], [x, y + h], sw]),
      labelAnchor: { x: x + w / 2 + edx, y: y + h / 2 + edy },
    };
  }

  if (building.orientation === "vertical") {
    const midX = x + w / 2;
    const rTop = [midX + rdx, y + rdy];
    const rBot = [midX + rdx, y + h + rdy];
    return {
      shadow,
      southWall: fmtPoints([[x, y + h], [x + w, y + h], se, rBot, sw]),
      eastWall: fmtPoints([[x + w, y + h], [x + w, y], ne, se]),
      backSlope: fmtPoints([nw, rTop, rBot, sw]),
      frontSlope: fmtPoints([rTop, ne, se, rBot]),
      ridgeLine: { x1: rTop[0], y1: rTop[1], x2: rBot[0], y2: rBot[1] },
      outline: fmtPoints([nw, rTop, ne, [x + w, y], [x + w, y + h], [x, y + h], sw]),
      labelAnchor: { x: midX + (edx + rdx) / 2, y: y + h / 2 + (edy + rdy) / 2 },
    };
  }

  const midY = y + h / 2;
  const rLeft = [x + rdx, midY + rdy];
  const rRight = [x + w + rdx, midY + rdy];
  return {
    shadow,
    southWall: fmtPoints([[x, y + h], [x + w, y + h], se, sw]),
    eastWall: fmtPoints([[x + w, y + h], [x + w, y], ne, rRight, se]),
    backSlope: fmtPoints([nw, ne, rRight, rLeft]),
    frontSlope: fmtPoints([rLeft, rRight, se, sw]),
    ridgeLine: { x1: rLeft[0], y1: rLeft[1], x2: rRight[0], y2: rRight[1] },
    outline: fmtPoints([nw, ne, [x + w, y], [x + w, y + h], [x, y + h], sw, rLeft]),
    labelAnchor: { x: x + w / 2 + (edx + rdx) / 2, y: midY + (edy + rdy) / 2 + 4 },
  };
}

/**
 * Pure 2.5D oblique extrusion helper for polygonal building footprints
 * (e.g. chamfered exhibition halls and stepped stadiums).
 */
export function buildPolygon25dPolygons(points, kind) {
  const large = kind === "warehouse" || kind === "hall";
  const edx = large ? -4 : -3;
  const edy = large ? -10 : -8;
  const shadow = fmtPoints(points.map((point) => [point.x + 5, point.y + 4]));
  const roofCoords = points.map((point) => [point.x + edx, point.y + edy]);
  const roof = fmtPoints(roofCoords);
  const walls = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const nextRoof = roofCoords[(index + 1) % roofCoords.length];
    const eastFacing = Math.abs(next.y - point.y) > Math.abs(next.x - point.x);
    return {
      points: fmtPoints([[point.x, point.y], [next.x, next.y], nextRoof, roofCoords[index]]),
      shade: eastFacing ? "east" : "south",
    };
  });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [rx, ry] of roofCoords) {
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }
  return {
    shadow,
    walls,
    roof,
    labelAnchor: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}
