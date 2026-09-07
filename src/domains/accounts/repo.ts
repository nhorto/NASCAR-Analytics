// Accounts repo — owns users, sessions, auth_tokens, auth_attempts. All
// policy (hashing, TTLs, limits) lives in the service; this file only
// reads/writes rows. Token columns hold SHA-256 hashes, never raw tokens.
import type { Database } from "bun:sqlite";
import type {
  AuthTokenRecord,
  DigestRecipient,
  EmailKind,
  EmailPrefs,
  SessionRecord,
  SuppressionReason,
  TokenPurpose,
  User,
  UserRecord,
} from "./types.ts";

const USER_COLS = `user_id AS userId, email, password_hash AS passwordHash,
  created_at AS createdAt, verified_at AS verifiedAt`;

// --- users ---

export function insertUser(
  db: Database,
  email: string,
  passwordHash: string,
  createdAt: string,
): User {
  const row = db
    .query(
      `INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)
       RETURNING user_id AS userId, email, created_at AS createdAt, verified_at AS verifiedAt`,
    )
    .get(email, passwordHash, createdAt) as User;
  return row;
}

export function userByEmail(db: Database, email: string): UserRecord | null {
  return db.query(`SELECT ${USER_COLS} FROM users WHERE email = ?`).get(email) as UserRecord | null;
}

export function userById(db: Database, userId: number): UserRecord | null {
  return db
    .query(`SELECT ${USER_COLS} FROM users WHERE user_id = ?`)
    .get(userId) as UserRecord | null;
}

export function markVerified(db: Database, userId: number, at: string): void {
  db.query(`UPDATE users SET verified_at = ? WHERE user_id = ? AND verified_at IS NULL`).run(
    at,
    userId,
  );
}

export function updatePassword(db: Database, userId: number, passwordHash: string): void {
  db.query(`UPDATE users SET password_hash = ? WHERE user_id = ?`).run(passwordHash, userId);
}

/** Removes the user and every accounts-owned row for them. */
export function deleteUser(db: Database, userId: number): void {
  db.query(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  db.query(`DELETE FROM auth_tokens WHERE user_id = ?`).run(userId);
  db.query(`DELETE FROM email_prefs WHERE user_id = ?`).run(userId);
  db.query(`DELETE FROM email_sends WHERE user_id = ?`).run(userId);
  db.query(`DELETE FROM users WHERE user_id = ?`).run(userId);
}

// --- sessions ---

export function insertSession(db: Database, s: SessionRecord): void {
  db.query(
    `INSERT INTO sessions (token_hash, user_id, created_at, refreshed_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(s.tokenHash, s.userId, s.createdAt, s.refreshedAt, s.expiresAt);
}

export function sessionByHash(db: Database, tokenHash: string): SessionRecord | null {
  return db
    .query(
      `SELECT token_hash AS tokenHash, user_id AS userId, created_at AS createdAt,
              refreshed_at AS refreshedAt, expires_at AS expiresAt
       FROM sessions WHERE token_hash = ?`,
    )
    .get(tokenHash) as SessionRecord | null;
}

export function refreshSession(
  db: Database,
  tokenHash: string,
  refreshedAt: number,
  expiresAt: number,
): void {
  db.query(`UPDATE sessions SET refreshed_at = ?, expires_at = ? WHERE token_hash = ?`).run(
    refreshedAt,
    expiresAt,
    tokenHash,
  );
}

export function deleteSession(db: Database, tokenHash: string): void {
  db.query(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
}

export function deleteSessionsForUser(db: Database, userId: number): void {
  db.query(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
}

// --- verify / reset tokens ---

export function insertToken(db: Database, t: AuthTokenRecord): void {
  db.query(
    `INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at, used_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(t.tokenHash, t.userId, t.purpose, t.expiresAt, t.usedAt);
}

export function tokenByHash(
  db: Database,
  tokenHash: string,
  purpose: TokenPurpose,
): AuthTokenRecord | null {
  return db
    .query(
      `SELECT token_hash AS tokenHash, user_id AS userId, purpose,
              expires_at AS expiresAt, used_at AS usedAt
       FROM auth_tokens WHERE token_hash = ? AND purpose = ?`,
    )
    .get(tokenHash, purpose) as AuthTokenRecord | null;
}

/** Single-use enforcement: marks used only if unused; true when this call won. */
export function consumeToken(db: Database, tokenHash: string, usedAt: number): boolean {
  const res = db
    .query(`UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL`)
    .run(usedAt, tokenHash);
  return res.changes === 1;
}

// --- rate-limit attempts ---

export function recordAttempt(db: Database, key: string, at: number): void {
  db.query(`INSERT INTO auth_attempts (key, at) VALUES (?, ?)`).run(key, at);
}

export function countAttempts(db: Database, key: string, since: number): number {
  const row = db
    .query(`SELECT COUNT(*) AS n FROM auth_attempts WHERE key = ? AND at >= ?`)
    .get(key, since) as { n: number };
  return row.n;
}

export function oldestAttemptSince(db: Database, key: string, since: number): number | null {
  const row = db
    .query(`SELECT MIN(at) AS oldest FROM auth_attempts WHERE key = ? AND at >= ?`)
    .get(key, since) as { oldest: number | null };
  return row.oldest;
}

export function pruneAttempts(db: Database, before: number): void {
  db.query(`DELETE FROM auth_attempts WHERE at < ?`).run(before);
}

// --- email preferences + deliverability (WS-G) ---

const PREFS_COLS = `user_id AS userId, recap, preview, unsub_token AS unsubToken,
  bounced_at AS bouncedAt, complained_at AS complainedAt, updated_at AS updatedAt`;

interface PrefsRow {
  userId: number;
  recap: number;
  preview: number;
  unsubToken: string;
  bouncedAt: string | null;
  complainedAt: string | null;
  updatedAt: string;
}

function toPrefs(row: PrefsRow | null): EmailPrefs | null {
  return row === null ? null : { ...row, recap: row.recap === 1, preview: row.preview === 1 };
}

export function prefsFor(db: Database, userId: number): EmailPrefs | null {
  return toPrefs(
    db.query(`SELECT ${PREFS_COLS} FROM email_prefs WHERE user_id = ?`).get(userId) as PrefsRow | null,
  );
}

export function prefsByToken(db: Database, unsubToken: string): EmailPrefs | null {
  return toPrefs(
    db
      .query(`SELECT ${PREFS_COLS} FROM email_prefs WHERE unsub_token = ?`)
      .get(unsubToken) as PrefsRow | null,
  );
}

export function insertPrefs(db: Database, userId: number, unsubToken: string, at: string): void {
  db.query(
    `INSERT OR IGNORE INTO email_prefs (user_id, recap, preview, unsub_token, updated_at)
     VALUES (?, 0, 0, ?, ?)`,
  ).run(userId, unsubToken, at);
}

/** Sets one list on/off. The column name comes from a closed union, never input. */
export function setPref(db: Database, userId: number, kind: EmailKind, on: boolean, at: string): void {
  const column = kind === "recap" ? "recap" : "preview";
  db.query(`UPDATE email_prefs SET ${column} = ?, updated_at = ? WHERE user_id = ?`).run(
    on ? 1 : 0,
    at,
    userId,
  );
}

/**
 * Opted-in, email-verified, non-suppressed users for one list. Pro-ness is NOT
 * checked here — accounts may not read billing; the app layer filters.
 */
export function digestRecipients(db: Database, kind: EmailKind): DigestRecipient[] {
  const column = kind === "recap" ? "recap" : "preview";
  return db
    .query(
      `SELECT u.user_id AS userId, u.email, p.unsub_token AS unsubToken
         FROM email_prefs p
         JOIN users u ON u.user_id = p.user_id
        WHERE p.${column} = 1
          AND u.verified_at IS NOT NULL
          AND p.bounced_at IS NULL
          AND p.complained_at IS NULL
        ORDER BY u.user_id`,
    )
    .all() as DigestRecipient[];
}

/** Marks an address undeliverable. False when no account owns it. */
export function suppressAddress(
  db: Database,
  email: string,
  reason: SuppressionReason,
  at: string,
): boolean {
  const column = reason === "bounced" ? "bounced_at" : "complained_at";
  const res = db
    .query(
      `UPDATE email_prefs SET ${column} = ?, updated_at = ?
        WHERE user_id = (SELECT user_id FROM users WHERE email = ?)`,
    )
    .run(at, at, email);
  return res.changes === 1;
}

/** Clears both suppression stamps (owner support path / address fixed). */
export function unsuppress(db: Database, userId: number, at: string): void {
  db.query(
    `UPDATE email_prefs SET bounced_at = NULL, complained_at = NULL, updated_at = ? WHERE user_id = ?`,
  ).run(at, userId);
}

/** Records a provider event. False when the event id was already stored. */
export function insertEvent(
  db: Database,
  e: { eventId: string; type: string; email: string; receivedAt: string; detail: string | null },
): boolean {
  const res = db
    .query(
      `INSERT OR IGNORE INTO email_events (event_id, type, email, received_at, detail)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(e.eventId, e.type, e.email, e.receivedAt, e.detail);
  return res.changes === 1;
}

/**
 * Claims one (user, kind, race) send. True on the first claim, and again for a
 * claim whose send is recorded as FAILED — a delivery that never happened must
 * stay retryable, or one unconfigured/erroring run would permanently skip that
 * subscriber for that race. A recorded success is never re-claimable, which is
 * what keeps a re-run of the same refresh from double-sending.
 */
export function claimSend(
  db: Database,
  userId: number,
  kind: EmailKind,
  refId: number,
  at: string,
): boolean {
  const inserted = db
    .query(
      `INSERT OR IGNORE INTO email_sends (user_id, kind, ref_id, sent_at, ok) VALUES (?, ?, ?, ?, 0)`,
    )
    .run(userId, kind, refId, at);
  if (inserted.changes === 1) return true;
  // `detail IS NOT NULL` means an outcome was actually recorded, i.e. the
  // previous attempt finished and failed. A claim still in flight (detail
  // NULL) is left alone, so two overlapping runs can never both send.
  const retried = db
    .query(
      `UPDATE email_sends SET sent_at = ?, detail = NULL
        WHERE user_id = ? AND kind = ? AND ref_id = ? AND ok = 0 AND detail IS NOT NULL`,
    )
    .run(at, userId, kind, refId);
  return retried.changes === 1;
}

export function recordSendOutcome(
  db: Database,
  userId: number,
  kind: EmailKind,
  refId: number,
  ok: boolean,
  detail: string,
): void {
  db.query(
    `UPDATE email_sends SET ok = ?, detail = ? WHERE user_id = ? AND kind = ? AND ref_id = ?`,
  ).run(ok ? 1 : 0, detail, userId, kind, refId);
}

export function sendCount(db: Database, kind: EmailKind, refId: number): number {
  const row = db
    .query(`SELECT COUNT(*) AS n FROM email_sends WHERE kind = ? AND ref_id = ?`)
    .get(kind, refId) as { n: number };
  return row.n;
}
