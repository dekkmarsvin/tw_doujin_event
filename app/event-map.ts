export const EVENT_MAP_VERSION = 2 as const;

export type MapRect = { x: number; y: number; width: number; height: number };
export type MapOrientation = "vertical" | "horizontal";

export type BoothSlot = {
  code: string;
  rect: MapRect;
};

export type BoothRow = {
  label: string;
  orientation: MapOrientation;
  confidence: number;
  slots: BoothSlot[];
};

export type MapPillar = MapRect & { id: string };

export type MapAccessPoint = {
  id: string;
  kind: "entrance" | "exit";
  direction: "north" | "south";
  x: number;
  y: number;
  label: string;
};

export type MapLandmarkKind = "enterprise" | "stage" | "other";

export type MapLandmark = {
  id: string;
  kind?: MapLandmarkKind;
  rect: MapRect;
  label: string;
};

export function resolveMapLandmarkKind(landmark: Pick<MapLandmark, "kind" | "label">): MapLandmarkKind {
  if (landmark.kind) return landmark.kind;
  if (landmark.label === "企業攤") return "enterprise";
  if (landmark.label === "舞台") return "stage";
  return "other";
}

export function scaleMapLandmarks(
  landmarks: MapLandmark[],
  sourceSize: Pick<EventMapLayout, "width" | "height">,
  targetSize: Pick<EventMapLayout, "width" | "height">,
): MapLandmark[] {
  const scaleX = targetSize.width / sourceSize.width;
  const scaleY = targetSize.height / sourceSize.height;
  return landmarks.map((landmark) => ({
    ...landmark,
    rect: {
      x: landmark.rect.x * scaleX,
      y: landmark.rect.y * scaleY,
      width: landmark.rect.width * scaleX,
      height: landmark.rect.height * scaleY,
    },
  }));
}

export type EventMapLayout = {
  version: typeof EVENT_MAP_VERSION;
  template: string;
  width: number;
  height: number;
  floor: MapRect;
  rows: BoothRow[];
  pillars: MapPillar[];
  accessPoints: MapAccessPoint[];
  landmarks: MapLandmark[];
};

export type MapRecognitionReport = {
  layout: EventMapLayout;
  confidence: number;
  warnings: string[];
  diagnostics: {
    rowCount: number;
    slotCount: number;
    pillarCount: number;
    accessPointCount: number;
  };
};

export type PublishedEventMap = {
  eventId: string;
  revision: number;
  sourceName: string;
  confidence: number;
  updatedAt: string;
  layout: EventMapLayout;
};

export type LayoutValidation = { ok: true; errors: [] } | { ok: false; errors: string[] };

function finiteRect(rect: MapRect, width: number, height: number) {
  return Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) && Number.isFinite(rect.height) &&
    rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width + 1 && rect.y + rect.height <= height + 1;
}

export function validateEventMapLayout(value: unknown): LayoutValidation {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return { ok: false, errors: ["layout 必須是物件。"] };
  const layout = value as Partial<EventMapLayout>;
  if (layout.version !== EVENT_MAP_VERSION) errors.push(`layout version 必須是 ${EVENT_MAP_VERSION}。`);
  if (typeof layout.template !== "string" || !layout.template.trim()) errors.push("layout template 必須是非空字串。" );
  if (!Number.isFinite(layout.width) || Number(layout.width) <= 0 || !Number.isFinite(layout.height) || Number(layout.height) <= 0) errors.push("layout 尺寸無效。" );
  const width = Number(layout.width) || 0;
  const height = Number(layout.height) || 0;
  if (!layout.floor || !finiteRect(layout.floor, width, height)) errors.push("場館範圍無效。" );
  if (!Array.isArray(layout.rows)) errors.push("rows 必須是陣列。" );
  if (!Array.isArray(layout.pillars)) errors.push("pillars 必須是陣列。" );
  if (!Array.isArray(layout.accessPoints)) errors.push("accessPoints 必須是陣列。" );
  if (!Array.isArray(layout.landmarks)) errors.push("landmarks 必須是陣列。" );
  if (Array.isArray(layout.rows)) {
    const labels = layout.rows.map((row) => row.label);
    const uniqueLabels = new Set(labels);
    if (uniqueLabels.size !== labels.length) errors.push("row label 不可重複。" );

    const codes = new Set<string>();
    layout.rows.forEach((row) => {
      if (typeof row.label !== "string" || !row.label.trim()) errors.push("每一排都必須有標籤。" );
      if (row.orientation !== "vertical" && row.orientation !== "horizontal") errors.push(`${row.label || "未命名"} 排方向無效。`);
      if (!Array.isArray(row.slots)) errors.push(`${row.label || "未命名"} 排的 slots 必須是陣列。`);
      row.slots?.forEach((slot) => {
        if (typeof slot.code !== "string" || !slot.code.trim()) errors.push(`${row.label || "未命名"} 排有攤位缺少代碼。`);
        if (codes.has(slot.code)) errors.push(`攤位代碼 ${slot.code} 重複。`);
        codes.add(slot.code);
        if (!finiteRect(slot.rect, width, height)) errors.push(`${slot.code} 的矩形座標無效。`);
      });
    });
  }

  layout.pillars?.forEach((pillar) => { if (!finiteRect(pillar, width, height)) errors.push(`柱子 ${pillar.id} 的矩形座標無效。`); });
  layout.accessPoints?.forEach((point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > width || point.y > height) errors.push(`出入口 ${point.id} 的座標無效。`);
  });
  if (Array.isArray(layout.landmarks)) {
    const landmarkIds = new Set<string>();
    layout.landmarks.forEach((landmark) => {
      if (!landmark || typeof landmark !== "object") { errors.push("非一般攤位區必須是物件。" ); return; }
      if (typeof landmark.id !== "string" || !landmark.id.trim()) errors.push("每一個非一般攤位區都必須有 id。" );
      else if (landmarkIds.has(landmark.id)) errors.push(`非一般攤位區 id ${landmark.id} 重複。`);
      else landmarkIds.add(landmark.id);
      if (typeof landmark.label !== "string" || !landmark.label.trim()) errors.push(`非一般攤位區 ${landmark.id || "未命名"} 必須有顯示名稱。`);
      if (landmark.kind !== undefined && !["enterprise", "stage", "other"].includes(landmark.kind)) errors.push(`非一般攤位區 ${landmark.id || "未命名"} 的類型無效。`);
      if (!landmark.rect || !finiteRect(landmark.rect, width, height)) errors.push(`非一般攤位區 ${landmark.id || "未命名"} 的矩形座標無效。`);
    });
  }

  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

export function isPublishedEventMap(value: unknown): value is PublishedEventMap {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PublishedEventMap>;
  return typeof candidate.eventId === "string" && typeof candidate.revision === "number" && typeof candidate.sourceName === "string" && typeof candidate.updatedAt === "string" && validateEventMapLayout(candidate.layout).ok;
}
