import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// `drizzle.config.ts` points at this file alone, so the identity tables are
// re-exported here to stay visible to `npm run db:generate`.
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
