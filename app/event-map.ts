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

/** Authoring starts here whenever recognition cannot: a new template with no
 * adapter, or a venue whose plan is only ever traced by hand. The floor fills
 * the sheet so the maintainer can place the first row before deciding where the
 * hall outline actually sits. */
export function createBlankEventMapLayout(template: string, width: number, height: number): EventMapLayout {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  return {
    version: EVENT_MAP_VERSION,
    template,
    width: safeWidth,
    height: safeHeight,
    floor: { x: 0, y: 0, width: safeWidth, height: safeHeight },
    rows: [],
    pillars: [],
    accessPoints: [],
    landmarks: [],
  };
}

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
    const labels = new Set<string>();
    const codes = new Set<string>();
    layout.rows.forEach((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) { errors.push("每一排都必須是物件。" ); return; }
      const row = candidate as Partial<BoothRow>;
      if (typeof row.label !== "string" || !row.label.trim()) errors.push("每一排都必須有標籤。" );
      else if (labels.has(row.label)) errors.push("row label 不可重複。" );
      else labels.add(row.label);
      if (row.orientation !== "vertical" && row.orientation !== "horizontal") errors.push(`${row.label || "未命名"} 排方向無效。`);
      if (!Number.isFinite(row.confidence) || Number(row.confidence) < 0 || Number(row.confidence) > 1) errors.push(`${row.label || "未命名"} 排 confidence 必須介於 0 與 1。`);
      if (!Array.isArray(row.slots)) errors.push(`${row.label || "未命名"} 排的 slots 必須是陣列。`);
      if (Array.isArray(row.slots)) row.slots.forEach((candidateSlot) => {
        if (!candidateSlot || typeof candidateSlot !== "object" || Array.isArray(candidateSlot)) { errors.push(`${row.label || "未命名"} 排的攤位必須是物件。`); return; }
        const slot = candidateSlot as Partial<BoothSlot>;
        if (typeof slot.code !== "string" || !slot.code.trim()) errors.push(`${row.label || "未命名"} 排有攤位缺少代碼。`);
        else if (codes.has(slot.code)) errors.push(`攤位代碼 ${slot.code} 重複。`);
        else codes.add(slot.code);
        if (!slot.rect || !finiteRect(slot.rect, width, height)) errors.push(`${slot.code || "未命名攤位"} 的矩形座標無效。`);
      });
    });
  }

  if (Array.isArray(layout.pillars)) {
    const pillarIds = new Set<string>();
    layout.pillars.forEach((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) { errors.push("每一根柱子都必須是物件。" ); return; }
      const pillar = candidate as Partial<MapPillar>;
      if (typeof pillar.id !== "string" || !pillar.id.trim()) errors.push("每一根柱子都必須有 id。" );
      else if (pillarIds.has(pillar.id)) errors.push(`柱子 id ${pillar.id} 重複。`);
      else pillarIds.add(pillar.id);
      if (!finiteRect(pillar as MapRect, width, height)) errors.push(`柱子 ${pillar.id || "未命名"} 的矩形座標無效。`);
    });
  }
  if (Array.isArray(layout.accessPoints)) {
    const accessIds = new Set<string>();
    layout.accessPoints.forEach((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) { errors.push("每一個出入口都必須是物件。" ); return; }
      const point = candidate as Partial<MapAccessPoint>;
      if (typeof point.id !== "string" || !point.id.trim()) errors.push("每一個出入口都必須有 id。" );
      else if (accessIds.has(point.id)) errors.push(`出入口 id ${point.id} 重複。`);
      else accessIds.add(point.id);
      if (point.kind !== "entrance" && point.kind !== "exit") errors.push(`出入口 ${point.id || "未命名"} 的類型無效。`);
      if (point.direction !== "north" && point.direction !== "south") errors.push(`出入口 ${point.id || "未命名"} 的方向無效。`);
      if (typeof point.label !== "string" || !point.label.trim()) errors.push(`出入口 ${point.id || "未命名"} 必須有顯示名稱。`);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || Number(point.x) < 0 || Number(point.y) < 0 || Number(point.x) > width || Number(point.y) > height) errors.push(`出入口 ${point.id || "未命名"} 的座標無效。`);
    });
  }
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
  return typeof candidate.eventId === "string" && candidate.eventId.length > 0
    && Number.isSafeInteger(candidate.revision) && Number(candidate.revision) > 0
    && typeof candidate.sourceName === "string"
    && typeof candidate.confidence === "number" && candidate.confidence >= 0 && candidate.confidence <= 1
    && typeof candidate.updatedAt === "string" && !Number.isNaN(Date.parse(candidate.updatedAt))
    && validateEventMapLayout(candidate.layout).ok;
}
