// Data-health repo — owns the feed_status table (one row per canary check per
// run). Streak/outage math lives in the service; this file only reads/writes.
import type { Database } from "bun:sqlite";
import type { CanaryReport, FeedStatusRow } from "./types.ts";

export function recordReport(db: Database, report: CanaryReport): void {
  const stmt = db.query(
    `INSERT OR REPLACE INTO feed_status (check_id, run_at, ok, http_status, problem, ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction(() => {
    for (const r of report.results) {
      stmt.run(r.id, report.at, r.ok ? 1 : 0, r.status, r.problem, Math.round(r.ms));
    }
  });
  run();
}

/** Latest runs for one check, newest first. */
export function latestRuns(db: Database, checkId: string, limit: number): FeedStatusRow[] {
  const rows = db
    .query(
      `SELECT check_id AS checkId, run_at AS runAt, ok, http_status AS httpStatus, problem, ms
       FROM feed_status WHERE check_id = ? ORDER BY run_at DESC LIMIT ?`,
    )
    .all(checkId, limit) as unknown as Array<Omit<FeedStatusRow, "ok"> & { ok: number }>;
  return rows.map((r) => ({ ...r, ok: r.ok === 1 }));
}

/** Every check id that has ever been recorded. */
export function checkIds(db: Database): string[] {
  const rows = db
    .query(`SELECT DISTINCT check_id AS id FROM feed_status ORDER BY check_id`)
    .all() as Array<{ id: string }>;
  return rows.map((r) => r.id);
}
