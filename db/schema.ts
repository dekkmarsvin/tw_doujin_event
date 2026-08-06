import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const eventMaps = sqliteTable("event_maps", {
  eventId: text("event_id").primaryKey(),
  revision: integer("revision").notNull().default(1),
  sourceName: text("source_name").notNull(),
  confidence: integer("confidence").notNull(),
  layoutJson: text("layout_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
