import type { RefObject } from "react";
import { buildBuilding25dPolygons, type OverviewPoint, type VenueOverviewRecord } from "./venue-overview.mjs";

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
    const poly = buildBuilding25dPolygons(building);
    const palette = interactive
      ? ACTIVE_COLORS
      : building.kind === "service"
        ? SERVICE_COLORS
        : CONTEXT_COLORS;
    const labelColor = interactive ? "#FFFFFF" : building.kind === "service" ? "#FFFFFF" : "#5F6368";

    const content = (
      <>
        <rect
          x={poly.shadow.x}
          y={poly.shadow.y}
          width={poly.shadow.width}
          height={poly.shadow.height}
          rx={2}
          fill="rgba(32,33,36,0.13)"
        />
        <polygon points={poly.southWall} fill={palette.southWall} />
        <polygon points={poly.eastWall} fill={palette.eastWall} />
        {poly.backSlope && <polygon points={poly.backSlope} fill={palette.backSlope} />}
        <polygon points={poly.frontSlope} fill={palette.frontSlope} data-roof-lit />
        {poly.ridgeLine && (
          <line
            x1={poly.ridgeLine.x1}
            y1={poly.ridgeLine.y1}
            x2={poly.ridgeLine.x2}
            y2={poly.ridgeLine.y2}
            stroke={palette.ridge}
            strokeWidth={1.2}
          />
        )}
        <polygon
          points={poly.outline}
          fill="none"
          stroke={isCurrent ? "#1A73E8" : palette.outline}
          strokeWidth={isCurrent ? 2.8 : 1}
        />
        {displayLabel && (
          building.calloutAbove ? (
            <text
              x={poly.labelAnchor.x}
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
              x={poly.labelAnchor.x}
              y={poly.labelAnchor.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={building.kind === "warehouse" ? 13 : 9.5}
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
          <g transform={`translate(${poly.labelAnchor.x}, ${building.rect.y + building.rect.height + 14})`} pointerEvents="none">
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
          const fill = area.kind === "park" ? "#CCEAD5" : area.kind === "corridor" ? "#E3EFE6" : "#F8F7F2";
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
            return <polygon key={area.id} points={pointsString(area.points)} fill={fill} />;
          }
          if (area.rect) {
            return (
              <rect
                key={area.id}
                x={area.rect.x}
                y={area.rect.y}
                width={area.rect.width}
                height={area.rect.height}
                rx={4}
                fill={fill}
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

      {/* 3. 道路網 */}
      <g data-overview-layer="roads">
        {layers?.roads?.map((road) => (
          <polyline
            key={`${road.id}-casing`}
            points={pointsString(road.points)}
            fill="none"
            stroke="#D2D6DC"
            strokeWidth={road.width + 3}
            strokeLinecap="square"
          />
        ))}
        {layers?.roads?.map((road) => (
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
              stroke="#34A853"
              strokeWidth={3}
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

      {/* 5. 建築群（背景先畫、活動可切換場館在前景） */}
      <g data-overview-layer="buildings">
        {overview.buildings
          .filter((building) => !(building.venueSpaceId && spaceNames.has(building.venueSpaceId)))
          .map(renderBuilding)}
        {overview.buildings
          .filter((building) => Boolean(building.venueSpaceId && spaceNames.has(building.venueSpaceId)))
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
              fontSize={11.5}
              fontWeight={600}
              fill="#5F6368"
              stroke="#FFFFFF"
              strokeWidth={3.5}
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
            const pillColor = station.color === "blue" ? "#1A73E8" : "#34A853";
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
