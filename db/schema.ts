import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Re-exported so one import path covers every table's types.
//
// No table in this project reaches D1 through a migration. Pages Functions have
// no migration step, so each repository creates what it needs on the request
// path: `ensureTables()` in `db/identity-repository.ts` for the eight identity
// tables, `ensureTable()` in `db/event-map-repository.ts` for `event_maps`.
// These definitions and `drizzle/` are therefore a schema record, not a
// deployment input — changing a column here changes nothing until the
// corresponding DDL changes too.
export * from "./identity-schema";

export const eventMaps = sqliteTable("event_maps", {
  eventId: text("event_id").primaryKey(),
  revision: integer("revision").notNull().default(1),
  sourceName: text("source_name").notNull(),
  confidence: integer("confidence").notNull(),
  layoutJson: text("layout_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
