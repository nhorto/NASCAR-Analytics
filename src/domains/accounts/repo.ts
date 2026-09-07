// Accounts repo — owns users, sessions, auth_tokens, auth_attempts. All
// policy (hashing, TTLs, limits) lives in the service; this file only
// reads/writes rows. Token columns hold SHA-256 hashes, never raw tokens.
import type { Database } from "bun:sqlite";
import type { AuthTokenRecord, SessionRecord, TokenPurpose, User, UserRecord } from "./types.ts";

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
