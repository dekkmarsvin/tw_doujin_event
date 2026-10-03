import { createIdentityInitializer } from "./identity-runtime-initializer";
import type { ShareSnapshot } from "../app/planning-share-snapshot";

export type PlanningShareRow = { event_id: string; items_json: string; expires_at: number };

export function createPlanningShareRepository(database: D1Database) {
  const ready = createIdentityInitializer(database);
  return {
    async create(shareId: string, snapshot: ShareSnapshot, now: number, expiresAt: number, ipHash: string | null) {
      await ready();
      // Count and insert atomically: two simultaneous requests cannot both take
      // the last slot. One write, no separate quota counter or audit record.
      const result = await database.prepare(`INSERT INTO planning_shares
        (share_id, event_id, items_json, created_at, expires_at, request_ip_hash)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6
        WHERE ?6 IS NULL OR (SELECT COUNT(*) FROM planning_shares
          WHERE request_ip_hash = ?6 AND created_at >= ?7) < 30`)
        .bind(shareId, snapshot.eventId, JSON.stringify(snapshot.items), now, expiresAt, ipHash, now - 60 * 60 * 1000).run();
      return result.meta.changes === 1;
    },
    async get(shareId: string) {
      await ready();
      return database.prepare("SELECT event_id, items_json, expires_at FROM planning_shares WHERE share_id = ?1")
        .bind(shareId).first<PlanningShareRow>();
    },
  };
}
