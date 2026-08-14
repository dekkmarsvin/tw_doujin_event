import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// No table in this project reaches D1 through a migration. Pages Functions have
// no migration step, so each repository creates what it needs on the request
// path: `ensureTables()` in `db/identity-repository.ts` for the eight identity
// tables, `ensureTable()` in `db/event-map-repository.ts` for `event_maps`.
// This Drizzle entrypoint deliberately covers only local map authoring. Identity
// schema authority is `db/identity-runtime-schema.ts` and is consumed directly
// by Pages Functions; maintaining a second Drizzle copy caused real drift.

export const eventMaps = sqliteTable("event_maps", {
  eventId: text("event_id").primaryKey(),
  revision: integer("revision").notNull().default(1),
  sourceName: text("source_name").notNull(),
  confidence: integer("confidence").notNull(),
  layoutJson: text("layout_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
