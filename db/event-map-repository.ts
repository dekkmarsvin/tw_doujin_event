import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { eventMaps } from "./schema";
import { isPublishedEventMap, validateEventMapLayout, type EventMapLayout, type PublishedEventMap } from "../app/event-map";

function toPublished(row: typeof eventMaps.$inferSelect): PublishedEventMap {
  const value = {
    eventId: row.eventId,
    revision: row.revision,
    sourceName: row.sourceName,
    confidence: row.confidence / 100,
    updatedAt: row.updatedAt,
    layout: JSON.parse(row.layoutJson) as EventMapLayout,
  };
  if (!isPublishedEventMap(value)) throw new Error(`Stored map for ${row.eventId} is invalid.`);
  return value;
}

export function createEventMapRepository(database: D1Database) {
  const db = drizzle(database, { schema: { eventMaps } });
  let tableReady: Promise<void> | null = null;

  async function ensureTable() {
    if (!tableReady) {
      tableReady = database.prepare(`
        CREATE TABLE IF NOT EXISTS event_maps (
          event_id TEXT PRIMARY KEY NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          source_name TEXT NOT NULL,
          confidence INTEGER NOT NULL,
          layout_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `).run().then(() => undefined).catch((error: unknown) => {
        tableReady = null;
        throw error;
      });
    }
    return tableReady;
  }

  async function getEventMap(eventId: string): Promise<PublishedEventMap | null> {
    await ensureTable();
    const [row] = await db.select().from(eventMaps).where(eq(eventMaps.eventId, eventId)).limit(1);
    return row ? toPublished(row) : null;
  }

  async function publishEventMap(input: { eventId: string; sourceName: string; confidence: number; layout: EventMapLayout }): Promise<PublishedEventMap> {
    const validation = validateEventMapLayout(input.layout);
    if (!validation.ok) throw new Error(validation.errors.join("\n"));
    await ensureTable();
    const confidence = Math.max(0, Math.min(100, Math.round(input.confidence * 100)));
    const [row] = await db.insert(eventMaps).values({
      eventId: input.eventId,
      sourceName: input.sourceName,
      confidence,
      layoutJson: JSON.stringify(input.layout),
    }).onConflictDoUpdate({
      target: eventMaps.eventId,
      set: {
        sourceName: input.sourceName,
        confidence,
        layoutJson: JSON.stringify(input.layout),
        revision: sql`${eventMaps.revision} + 1`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    }).returning();
    return toPublished(row);
  }

  return { getEventMap, publishEventMap };
}

export type EventMapRepository = ReturnType<typeof createEventMapRepository>;
