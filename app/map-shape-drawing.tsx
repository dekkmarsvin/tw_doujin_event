import type { SVGProps } from "react";
import type { MapShape } from "./map-shape-geometry";

export function MapShapeDrawing({ shape, ...props }: { shape: MapShape } & Omit<SVGProps<SVGElement>, "ref">) {
  return shape.points ? <polygon {...props} points={shape.points.map(point => `${point.x},${point.y}`).join(" ")} />
    : <rect {...props} x={shape.x} y={shape.y} width={shape.width} height={shape.height} />;
}
