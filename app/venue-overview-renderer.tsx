import type { RefObject } from "react";
import { buildBuilding25dPolygons, buildPolygon25dPolygons, type OverviewPoint, type VenueOverviewRecord } from "./venue-overview.mjs";

export type VenueOverviewSpaceItem = {
  venueSpaceId: string;
  name: string;
};

export type VenueOverviewRendererProps = {
  overview: VenueOverviewRecord;
  venueName: string;
  spaces: readonly VenueOverviewSpaceItem[];
  currentVenueSpaceId: string;
  labels: {
    regionLabel: string;
    currentTag: string;
    spaceAriaLabel: (name: string, isCurrent: boolean) => string;
  };
  currentSpaceRef?: RefObject<SVGGElement | null>;
  onSelectVenueSpace: (venueSpaceId: string) => void;
};

function pointsString(points: readonly OverviewPoint[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

const ACTIVE_COLORS = {
  southWall: "#9E1C4D",
  eastWall: "#78133A",
  backSlope: "#C92A66",
  frontSlope: "#E8437F",
  outline: "rgba(120,19,58,0.48)",
  ridge: "rgba(255,255,255,0.55)",
};

const SERVICE_COLORS = {
  southWall: "#4B5563",
  eastWall: "#374151",
  backSlope: "#5B6472",
  frontSlope: "#6B7280",
  outline: "#4B5563",
  ridge: "rgba(255,255,255,0.35)",
};

const CONTEXT_COLORS = {
  southWall: "#C4CBD4",
  eastWall: "#AEB6C2",
  backSlope: "#D8DEE6",
  frontSlope: "#E8ECEF",
  outline: "#CFD5DD",
  ridge: "rgba(255,255,255,0.6)",
};

const RAIL_COLORS = {
  green: "#34A853",
  blue: "#0070BD",
  red: "#E3002C",
  brown: "#C48C31",
} as const;

const AREA_FILLS = {
  park: "#CCEAD5",
  corridor: "#E3EFE6",
  plaza: "#F8F7F2",
  block: "#DFE2E6",
  track: "#C4E6C7",
  courtyard: "#F8F7F2",
} as const;

/**
 * Pure 2.5D schematic SVG renderer for a single venue's campus/buildings.
 * Reads no catalog, planning store, or URL state.
 */
export default function VenueOverviewRenderer({
  overview,
  venueName,
  spaces,
  currentVenueSpaceId,
  labels,
  currentSpaceRef,
  onSelectVenueSpace,
}: VenueOverviewRendererProps) {
  const { width, height } = overview.viewBox;
  const spaceNames = new Map(spaces.map((space) => [space.venueSpaceId, space.name]));
  const layers = overview.layers;

  const renderBuilding = (building: VenueOverviewRecord["buildings"][number]) => {
    const spaceId = building.venueSpaceId;
    const assignedName = spaceId ? spaceNames.get(spaceId) : undefined;
    const interactive = Boolean(spaceId && assignedName !== undefined);
    const isCurrent = interactive && spaceId === currentVenueSpaceId;
    const displayLabel = assignedName ?? building.label;
    const palette = interactive
      ? ACTIVE_COLORS
      : building.kind === "service"
        ? SERVICE_COLORS
        : CONTEXT_COLORS;
    const labelColor = interactive ? "#FFFFFF" : building.kind === "service" ? "#FFFFFF" : "#5F6368";
    const isLarge = building.kind === "warehouse" || building.kind === "hall";

    let labelAnchor: OverviewPoint;
    let bodyNodes;

    if (building.roof === "floor") {
      const { x, y, width: w, height: h } = building.rect;
      labelAnchor = { x: x + w / 2, y: y + h / 2 };
      bodyNodes = (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={6}
          fill={interactive ? "rgba(120,19,58,0.92)" : palette.southWall}
          stroke={isCurrent ? "#1A73E8" : "rgba(255,255,255,0.72)"}
          strokeWidth={isCurrent ? 2.6 : 1.2}
          data-roof-lit
        />
      );
    } else if (building.roof === "dome") {
      const { x, y, width: w, height: h } = building.rect;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const rx = w / 2;
      const ry = h / 2;
      labelAnchor = { x: cx - 2, y: cy - 6 };
      bodyNodes = (
        <>
          <ellipse cx={cx + 4} cy={cy + 5} rx={rx} ry={ry} fill="rgba(32,33,36,0.16)" />
          <ellipse cx={cx} cy={cy + 4} rx={rx} ry={ry} fill={palette.eastWall} />
          <ellipse
            cx={cx - 2}
            cy={cy - 4}
            rx={rx}
            ry={ry}
            fill={palette.frontSlope}
            stroke={isCurrent ? "#1A73E8" : palette.outline}
            strokeWidth={isCurrent ? 2.8 : 1.2}
            data-roof-lit
          />
          <ellipse cx={cx - 2} cy={cy - 6} rx={rx * 0.74} ry={ry * 0.66} fill={palette.backSlope} stroke="rgba(255,255,255,0.45)" strokeWidth={1.2} />
          <ellipse cx={cx - 2} cy={cy - 8} rx={rx * 0.44} ry={ry * 0.36} fill={palette.frontSlope} stroke="rgba(255,255,255,0.58)" strokeWidth={1.1} />
        </>
      );
    } else if (building.points) {
      const poly = buildPolygon25dPolygons(building.points, building.kind);
      labelAnchor = poly.labelAnchor;
      bodyNodes = (
        <>
          <polygon points={poly.shadow} fill="rgba(32,33,36,0.14)" />
          {poly.walls.map((wall, index) => (
            <polygon key={index} points={wall.points} fill={wall.shade === "east" ? palette.eastWall : palette.southWall} />
          ))}
          <polygon points={poly.roof} fill={palette.frontSlope} data-roof-lit />
          <polygon
            points={poly.roof}
            fill="none"
            stroke={isCurrent ? "#1A73E8" : palette.outline}
            strokeWidth={isCurrent ? 2.8 : 1.1}
          />
        </>
      );
    } else {
      const geometry = buildBuilding25dPolygons(building);
      labelAnchor = geometry.labelAnchor;
      bodyNodes = (
        <>
          <rect
            x={geometry.shadow.x}
            y={geometry.shadow.y}
            width={geometry.shadow.width}
            height={geometry.shadow.height}
            rx={2}
            fill="rgba(32,33,36,0.13)"
          />
          <polygon points={geometry.southWall} fill={palette.southWall} />
          <polygon points={geometry.eastWall} fill={palette.eastWall} />
          {geometry.backSlope && <polygon points={geometry.backSlope} fill={palette.backSlope} />}
          <polygon points={geometry.frontSlope} fill={palette.frontSlope} data-roof-lit />
          {geometry.ridgeLine && (
            <line
              x1={geometry.ridgeLine.x1}
              y1={geometry.ridgeLine.y1}
              x2={geometry.ridgeLine.x2}
              y2={geometry.ridgeLine.y2}
              stroke={palette.ridge}
              strokeWidth={1.2}
            />
          )}
          <polygon
            points={geometry.outline}
            fill="none"
            stroke={isCurrent ? "#1A73E8" : palette.outline}
            strokeWidth={isCurrent ? 2.8 : 1}
          />
        </>
      );
    }

    const content = (
      <>
        {bodyNodes}
        {displayLabel && (
          building.calloutAbove ? (
            <text
              x={labelAnchor.x}
              y={building.rect.y - 24}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill={interactive ? "#9E1C4D" : "#3C4043"}
              stroke="#FFFFFF"
              strokeWidth={3}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {displayLabel}
            </text>
          ) : (
            <text
              x={labelAnchor.x}
              y={labelAnchor.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={building.roof === "floor" ? 11.5 : isLarge ? 13 : 9.5}
              fontWeight={700}
              fill={labelColor}
              stroke={interactive ? "rgba(105,13,48,0.72)" : "none"}
              strokeWidth={interactive ? 2.4 : 0}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {displayLabel}
            </text>
          )
        )}
        {isCurrent && (
          <g transform={`translate(${labelAnchor.x}, ${building.rect.y + building.rect.height + 14})`} pointerEvents="none">
            <rect x={-32} y={-10} width={64} height={18} rx={9} fill="#1A73E8" stroke="#FFFFFF" strokeWidth={1.4} />
            <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700} fill="#FFFFFF">
              {labels.currentTag}
            </text>
          </g>
        )}
      </>
    );

    if (!interactive || !spaceId) {
      return (
        <g key={building.id} data-overview-building={building.id} pointerEvents="none">
          {content}
        </g>
      );
    }

    return (
      <g
        key={building.id}
        ref={isCurrent ? currentSpaceRef : undefined}
        data-overview-building={building.id}
        data-overview-venue-space={spaceId}
        data-current={isCurrent ? "true" : undefined}
        role="button"
        tabIndex={0}
        aria-current={isCurrent ? "location" : undefined}
        aria-label={labels.spaceAriaLabel(displayLabel, isCurrent)}
        style={{ cursor: "pointer", outline: "none" }}
        onClick={(event) => {
          event.stopPropagation();
          onSelectVenueSpace(spaceId);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            onSelectVenueSpace(spaceId);
          }
        }}
      >
        {content}
      </g>
    );
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="region"
      aria-label={labels.regionLabel}
      style={{ width: "100%", height: "100%", display: "block", userSelect: "none" }}
      data-venue-overview={overview.venueId}
      data-venue-name={venueName}
    >
      {/* 1. 土地與區域鋪面 */}
      <g data-overview-layer="land">
        <rect x={0} y={0} width={width} height={height} fill="#EFF1F3" />
        {layers?.areas?.map((area) => {
          const fill = AREA_FILLS[area.kind];
          if (area.points && area.strokeWidth) {
            return (
              <polyline
                key={area.id}
                points={pointsString(area.points)}
                fill="none"
                stroke={fill}
                strokeWidth={area.strokeWidth}
                strokeLinecap="round"
              />
            );
          }
          if (area.points) {
            return (
              <polygon
                key={area.id}
                points={pointsString(area.points)}
                fill={fill}
                stroke={area.kind === "courtyard" ? "#94A3B8" : undefined}
                strokeWidth={area.kind === "courtyard" ? 1.2 : undefined}
                strokeDasharray={area.kind === "courtyard" ? "4,3" : undefined}
              />
            );
          }
          if (area.ellipse) {
            return (
              <g key={area.id}>
                <ellipse
                  cx={area.ellipse.cx}
                  cy={area.ellipse.cy}
                  rx={area.ellipse.rx}
                  ry={area.ellipse.ry}
                  fill={fill}
                  stroke={area.kind === "track" ? "#64A86D" : area.kind === "park" ? "#7FC188" : undefined}
                  strokeWidth={area.kind === "track" ? 2 : area.kind === "park" ? 1.2 : undefined}
                />
                {area.kind === "track" && (
                  <ellipse
                    cx={area.ellipse.cx}
                    cy={area.ellipse.cy}
                    rx={area.ellipse.rx * 0.74}
                    ry={area.ellipse.ry * 0.78}
                    fill="#CFEAD2"
                    stroke="#82BD89"
                    strokeWidth={1.2}
                  />
                )}
              </g>
            );
          }
          if (area.rect) {
            return (
              <rect
                key={area.id}
                x={area.rect.x}
                y={area.rect.y}
                width={area.rect.width}
                height={area.rect.height}
                rx={area.kind === "courtyard" ? 8 : 4}
                fill={fill}
                stroke={area.kind === "courtyard" ? "#94A3B8" : undefined}
                strokeWidth={area.kind === "courtyard" ? 1.3 : undefined}
                strokeDasharray={area.kind === "courtyard" ? "4,3" : undefined}
              />
            );
          }
          return null;
        })}
      </g>

      {/* 2. 水域與橋樑 */}
      <g data-overview-layer="water">
        {layers?.water?.map((water) => (
          <g key={water.id}>
            <polygon points={pointsString(water.points)} fill="#94BCF9" />
            {water.shoreline && (
              <polyline
                points={pointsString(water.shoreline)}
                fill="none"
                stroke="#669DF6"
                strokeWidth={5}
                strokeLinejoin="miter"
              />
            )}
            {water.bridge && (
              <g>
                <rect
                  x={water.bridge.rect.x + 5}
                  y={water.bridge.rect.y + 4}
                  width={water.bridge.rect.width}
                  height={water.bridge.rect.height}
                  fill="rgba(23,58,122,0.16)"
                />
                <rect
                  x={water.bridge.rect.x}
                  y={water.bridge.rect.y}
                  width={water.bridge.rect.width}
                  height={water.bridge.rect.height}
                  fill="#FFFFFF"
                  stroke="#CFD4DA"
                  strokeWidth={1.5}
                />
                {water.bridge.circle && (
                  <circle
                    cx={water.bridge.circle.cx}
                    cy={water.bridge.circle.cy}
                    r={water.bridge.circle.r}
                    fill="#FFFFFF"
                    stroke="#CFD4DA"
                    strokeWidth={1.5}
                  />
                )}
                {water.bridge.tower && (
                  <polygon
                    points={pointsString(water.bridge.tower)}
                    fill="#E8EAED"
                    stroke="#BDC1C6"
                    strokeWidth={1}
                  />
                )}
              </g>
            )}
          </g>
        ))}
      </g>

      {/* 3. 道路網（步道、巷弄與一般道路；高架道於軌道之上繪製） */}
      <g data-overview-layer="roads">
        {layers?.roads
          ?.filter((road) => road.kind === "path")
          .map((road) => (
            <polyline
              key={road.id}
              points={pointsString(road.points)}
              fill="none"
              stroke="#F4F1E8"
              strokeWidth={road.width}
              strokeLinecap="round"
            />
          ))}
        {layers?.roads
          ?.filter((road) => road.kind !== "elevated" && road.kind !== "path")
          .map((road) => (
            <polyline
              key={`${road.id}-casing`}
              points={pointsString(road.points)}
              fill="none"
              stroke="#D2D6DC"
              strokeWidth={road.width + 3}
              strokeLinecap="square"
            />
          ))}
        {layers?.roads
          ?.filter((road) => road.kind !== "elevated" && road.kind !== "path")
          .map((road) => (
            <polyline
              key={road.id}
              points={pointsString(road.points)}
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={road.width}
              strokeLinecap="square"
            />
          ))}
      </g>

      {/* 4. 軌道路線 */}
      <g data-overview-layer="rail">
        {layers?.rail?.map((rail) => (
          <g key={rail.id}>
            <polyline
              points={pointsString(rail.points)}
              fill="none"
              stroke={RAIL_COLORS[rail.color ?? "green"]}
              strokeWidth={3.5}
              strokeLinecap="round"
            />
            <polyline
              points={pointsString(rail.points)}
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={1.2}
              strokeDasharray="5,6"
              strokeLinecap="round"
            />
          </g>
        ))}
      </g>

      {/* 4b. 高架道路 */}
      {layers?.roads?.some((road) => road.kind === "elevated") && (
        <g data-overview-layer="elevated-roads">
          {layers.roads
            .filter((road) => road.kind === "elevated")
            .map((road) => (
              <g key={`${road.id}-elevated`}>
                <polyline
                  points={pointsString(road.points)}
                  fill="none"
                  stroke="#5F7694"
                  strokeWidth={road.width + 5}
                  strokeLinecap="round"
                />
                <polyline
                  points={pointsString(road.points)}
                  fill="none"
                  stroke="#859EC0"
                  strokeWidth={road.width}
                  strokeLinecap="round"
                />
              </g>
            ))}
        </g>
      )}

      {/* 5. 建築群（非互動背景 → 可切換建築殼層 → 可切換樓層卡） */}
      <g data-overview-layer="buildings">
        {overview.buildings
          .filter((building) => !(building.venueSpaceId && spaceNames.has(building.venueSpaceId)))
          .map(renderBuilding)}
        {overview.buildings
          .filter((building) => Boolean(building.venueSpaceId && spaceNames.has(building.venueSpaceId)) && building.roof !== "floor")
          .map(renderBuilding)}
        {overview.buildings
          .filter((building) => Boolean(building.venueSpaceId && spaceNames.has(building.venueSpaceId)) && building.roof === "floor")
          .map(renderBuilding)}
      </g>

      {/* 6. 地標、道路名與站牌 */}
      <g data-overview-layer="labels" pointerEvents="none">
        {layers?.roads?.map((road) =>
          road.label && road.labelAt ? (
            <text
              key={`${road.id}-label`}
              x={road.labelAt.x}
              y={road.labelAt.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={road.kind === "local" ? 9.5 : 11.5}
              fontWeight={600}
              fill={road.kind === "elevated" ? "#334155" : road.kind === "local" ? "#70757A" : "#5F6368"}
              stroke="#FFFFFF"
              strokeWidth={3.4}
              paintOrder="stroke"
              strokeLinejoin="round"
              transform={road.labelAngle ? `rotate(${road.labelAngle} ${road.labelAt.x} ${road.labelAt.y})` : undefined}
            >
              {road.label}
            </text>
          ) : null,
        )}

        {layers?.landmarks?.map((landmark) => {
          if (landmark.kind === "pier2-logo") {
            return (
              <g key={landmark.id} transform={`translate(${landmark.x}, ${landmark.y})`}>
                <rect x={2} y={3} width={26} height={28} rx={2} fill="rgba(32,33,36,0.14)" />
                <rect x={0} y={0} width={13} height={14} fill="#D93025" stroke="#FFFFFF" strokeWidth={1.2} />
                <rect x={13} y={10} width={14} height={16} fill="#D93025" stroke="#FFFFFF" strokeWidth={1.2} />
                <circle cx={6.5} cy={7} r={2.5} fill="#FFFFFF" />
                <circle cx={20} cy={18} r={2.5} fill="#FFFFFF" />
              </g>
            );
          }
          if (landmark.kind === "arch") {
            return (
              <g key={landmark.id} transform={`translate(${landmark.x}, ${landmark.y})`}>
                <rect x={-12} y={-7} width={24} height={14} rx={2} fill="#D93025" stroke="#FFFFFF" strokeWidth={1.2} />
                <rect x={-9} y={-11} width={18} height={4} rx={1} fill="#B31412" />
                {landmark.label && (
                  <text x={-18} y={-13} textAnchor="end" fontSize={11} fontWeight={600} fill="#B31412" stroke="#FFFFFF" strokeWidth={3} paintOrder="stroke">
                    {landmark.label}
                  </text>
                )}
              </g>
            );
          }
          if (landmark.kind === "shield") {
            if (landmark.subLabel === "city") {
              return (
                <g key={landmark.id} transform={`translate(${landmark.x}, ${landmark.y})`}>
                  <rect x={-13} y={-8} width={26} height={16} rx={3} fill="#FFFFFF" stroke="#5F6368" strokeWidth={1.2} />
                  <text x={0} y={0.5} textAnchor="middle" dominantBaseline="central" fontSize={8.5} fontWeight={700} fill="#3C4043">
                    {landmark.label}
                  </text>
                </g>
              );
            }
            return (
              <g key={landmark.id} transform={`translate(${landmark.x}, ${landmark.y})`}>
                <polygon points="0,-10 11,-4 8,9 -8,9 -11,-4" fill="#1D63B8" stroke="#FFFFFF" strokeWidth={1.2} />
                <text x={0} y={1.5} textAnchor="middle" dominantBaseline="central" fontSize={8.5} fontWeight={700} fill="#FFFFFF">
                  {landmark.label}
                </text>
              </g>
            );
          }
          if (landmark.kind === "exit" && landmark.label) {
            const w = Math.max(24, landmark.label.length * 11 + 12);
            return (
              <g key={landmark.id} transform={`translate(${landmark.x}, ${landmark.y})`}>
                <rect x={-w / 2} y={-9.5} width={w} height={19} rx={4} fill="#FFFFFF" stroke="#16A34A" strokeWidth={1.3} />
                <text x={0} y={0.5} textAnchor="middle" dominantBaseline="central" fontSize={9.5} fontWeight={700} fill="#15803D">
                  {landmark.label}
                </text>
              </g>
            );
          }
          if (landmark.kind === "bus" && landmark.label) {
            if (landmark.subLabel === "vertical") {
              return (
                <g key={landmark.id} transform={`translate(${landmark.x}, ${landmark.y})`}>
                  <rect x={-13} y={-38} width={26} height={76} rx={13} fill="#EFF6FF" stroke="#3B82F6" strokeWidth={1.3} />
                  <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={9.5} fontWeight={700} fill="#1D4ED8" writingMode="tb">
                    {landmark.label}
                  </text>
                </g>
              );
            }
            const w = Math.max(76, landmark.label.length * 11 + 20);
            return (
              <g key={landmark.id} transform={`translate(${landmark.x}, ${landmark.y})`}>
                <rect x={-w / 2} y={-11} width={w} height={22} rx={11} fill="#EFF6FF" stroke="#3B82F6" strokeWidth={1.3} />
                <text x={0} y={0.5} textAnchor="middle" dominantBaseline="central" fontSize={9.5} fontWeight={700} fill="#1D4ED8">
                  {landmark.label}
                </text>
              </g>
            );
          }
          if (landmark.kind === "parking") {
            if (landmark.label) {
              const w = Math.max(92, landmark.label.length * 11 + 32);
              return (
                <g key={landmark.id} transform={`translate(${landmark.x}, ${landmark.y})`}>
                  <rect x={-w / 2} y={-10} width={w} height={20} rx={5} fill="#FFFFFF" stroke="#2563EB" strokeWidth={1.2} />
                  <circle cx={-w / 2 + 13} cy={0} r={6.5} fill="#2563EB" />
                  <text x={-w / 2 + 13} y={0.5} textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight={700} fill="#FFFFFF">P</text>
                  <text x={8} y={0.5} textAnchor="middle" dominantBaseline="central" fontSize={9.5} fontWeight={700} fill="#1E3A8A">
                    {landmark.label}
                  </text>
                </g>
              );
            }
            return (
              <g key={landmark.id} transform={`translate(${landmark.x}, ${landmark.y})`}>
                <circle cx={0} cy={0} r={10} fill="#1D63B8" stroke="#FFFFFF" strokeWidth={1.5} />
                <text x={0} y={0.5} textAnchor="middle" dominantBaseline="central" fontSize={10.5} fontWeight={700} fill="#FFFFFF">P</text>
              </g>
            );
          }
          if (landmark.kind === "compass") {
            return (
              <g key={landmark.id} transform={`translate(${landmark.x}, ${landmark.y})`}>
                <circle cx={0} cy={0} r={16} fill="rgba(255,255,255,0.92)" stroke="#DADCE0" />
                <polygon points="0,-11 -4.5,1 0,-1.5 4.5,1" fill="#EA4335" />
                <polygon points="0,11 -4.5,1 0,3.5 4.5,1" fill="#9AA0A6" />
                <text x={0} y={-19} textAnchor="middle" fontSize={9} fontWeight={700} fill="#5F6368">N</text>
              </g>
            );
          }
          if (landmark.kind === "water-label" && landmark.label) {
            return (
              <text
                key={landmark.id}
                x={landmark.x}
                y={landmark.y}
                textAnchor="middle"
                fontSize={22}
                fontWeight={700}
                fill="#3B6AB8"
                letterSpacing={10}
                opacity={0.85}
              >
                {landmark.label}
              </text>
            );
          }
          if (landmark.label) {
            return (
              <g key={landmark.id}>
                <text x={landmark.x} y={landmark.y} textAnchor="middle" fontSize={11} fontWeight={600} fill="#3C4043" stroke="#FFFFFF" strokeWidth={3} paintOrder="stroke">
                  {landmark.label}
                </text>
                {landmark.subLabel && (
                  <text x={landmark.x} y={landmark.y + 14} textAnchor="middle" fontSize={11} fontWeight={600} fill="#3C4043" stroke="#FFFFFF" strokeWidth={3} paintOrder="stroke">
                    {landmark.subLabel}
                  </text>
                )}
              </g>
            );
          }
          return null;
        })}

        {layers?.rail?.flatMap((rail) =>
          rail.stations.map((station) => {
            const pillColor = RAIL_COLORS[station.color];
            if (station.secondaryCode && station.secondaryName) {
              return (
                <g key={station.id} transform={`translate(${station.x}, ${station.y})`}>
                  <rect x={0} y={0} width={132} height={40} rx={8} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={1.2} />
                  <circle cx={14} cy={12} r={6} fill={pillColor} />
                  <text x={14} y={15} textAnchor="middle" fill="#FFFFFF" fontSize={7.5} fontWeight={700}>{station.code}</text>
                  <text x={24} y={15} fontSize={10.5} fontWeight={700} fill="#1E293B">{station.name}</text>
                  <circle cx={14} cy={28} r={6} fill="#34A853" />
                  <text x={14} y={31} textAnchor="middle" fill="#FFFFFF" fontSize={7} fontWeight={700}>{station.secondaryCode}</text>
                  <text x={24} y={31} fontSize={10.5} fontWeight={700} fill="#1E293B">{station.secondaryName}</text>
                </g>
              );
            }
            const pillWidth = Math.max(96, 36 + station.name.length * 12);
            return (
              <g key={station.id} transform={`translate(${station.x}, ${station.y})`}>
                <rect x={0} y={0} width={pillWidth} height={26} rx={13} fill="#FFFFFF" stroke={pillColor} strokeWidth={1.5} />
                <circle cx={14} cy={13} r={8} fill={pillColor} />
                <text x={14} y={16.5} textAnchor="middle" fill="#FFFFFF" fontSize={8.5} fontWeight={700}>{station.code}</text>
                <text x={26} y={17} fontSize={10.5} fontWeight={700} fill="#1E293B">{station.name}</text>
              </g>
            );
          }),
        )}
      </g>
    </svg>
  );
}
