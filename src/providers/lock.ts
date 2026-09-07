// Cross-process advisory locks backed by the app_locks table. Used by the
// in-process weekly-refresh cron so two schedulers (or a scheduler and a
// manual run) can never refresh concurrently. Locks carry a TTL so a crashed
// holder cannot wedge the system: an expired lock is taken over silently.
import type { Database } from "bun:sqlite";

/** Try to take (or self-renew) a named lock. Returns false when another live holder has it. */
export function acquireLock(
  db: Database,
  name: string,
  holder: string,
  ttlMs: number,
  now: number = Date.now(),
): boolean {
  db.query(`DELETE FROM app_locks WHERE name = ? AND expires_at <= ?`).run(name, now);
  const inserted = db
    .query(`INSERT OR IGNORE INTO app_locks (name, holder, expires_at) VALUES (?, ?, ?)`)
    .run(name, holder, now + ttlMs);
  if (inserted.changes === 1) return true;
  // Already held — renew only if we are the holder.
  const renewed = db
    .query(`UPDATE app_locks SET expires_at = ? WHERE name = ? AND holder = ?`)
    .run(now + ttlMs, name, holder);
  return renewed.changes === 1;
}

/** Release a lock we hold. Returns false (and leaves the lock) for a non-holder. */
export function releaseLock(db: Database, name: string, holder: string): boolean {
  const deleted = db.query(`DELETE FROM app_locks WHERE name = ? AND holder = ?`).run(name, holder);
  return deleted.changes === 1;
}
