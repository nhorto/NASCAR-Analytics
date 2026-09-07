// Accounts service — the only writer of the accounts tables. Passwords are
// argon2id via Bun.password (spec §6); session/verify/reset tokens are random
// 256-bit values whose SHA-256 (only) is stored. Failure reasons never reveal
// whether an email exists.
import type { Providers } from "../../providers/index.ts";
import type {
  AuthResult,
  DigestRecipient,
  EmailKind,
  EmailPrefs,
  RateLimitRule,
  RateLimitVerdict,
  SuppressionReason,
  TokenPurpose,
  User,
  UserRecord,
} from "./types.ts";
import {
  COMMON_PASSWORDS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RESET_TOKEN_TTL_MS,
  SESSION_REFRESH_AFTER_MS,
  SESSION_TTL_MS,
  VERIFY_TOKEN_TTL_MS,
} from "./config.ts";
import * as repo from "./repo.ts";

type P = Pick<Providers, "db">;

const INVALID_CREDENTIALS = "Invalid email or password.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 254;
}

/** Password policy (spec §6). Returns a user-safe reason, or null when fine. */
export function validatePassword(password: string, email: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (COMMON_PASSWORDS.has(password.toLowerCase()))
    return "That password appears in breach lists — pick something less common.";
  if (password.toLowerCase() === normalizeEmail(email))
    return "Password can't be your email address.";
  return null;
}

function sha256Hex(raw: string): string {
  return new Bun.CryptoHasher("sha256").update(raw).digest("hex");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toBase64({ alphabet: "base64url", omitPadding: true });
}

function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

// Verified against a fixed hash when the email doesn't exist, so a sign-in
// probe can't distinguish "no user" from "wrong password" by timing.
let dummyHash: string | null = null;
async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= await hashPassword(randomToken());
  await Bun.password.verify(password, dummyHash);
}

function toUser(u: UserRecord): User {
  return { userId: u.userId, email: u.email, createdAt: u.createdAt, verifiedAt: u.verifiedAt };
}

// --- sign-up / sign-in ---

export async function signUp(
  p: P,
  rawEmail: string,
  password: string,
  now: Date,
): Promise<AuthResult> {
  const email = normalizeEmail(rawEmail);
  if (!validEmail(email)) return { ok: false, reason: "Enter a valid email address." };
  const problem = validatePassword(password, email);
  if (problem) return { ok: false, reason: problem };
  if (repo.userByEmail(p.db, email))
    return { ok: false, reason: "An account with that email already exists — sign in instead." };
  const hash = await hashPassword(password);
  const user = repo.insertUser(p.db, email, hash, now.toISOString());
  return { ok: true, user };
}

export async function signIn(
  p: P,
  rawEmail: string,
  password: string,
  now: Date,
): Promise<AuthResult> {
  void now;
  const record = repo.userByEmail(p.db, normalizeEmail(rawEmail));
  if (!record) {
    await verifyAgainstDummy(password);
    return { ok: false, reason: INVALID_CREDENTIALS };
  }
  const good = await Bun.password.verify(password, record.passwordHash);
  return good ? { ok: true, user: toUser(record) } : { ok: false, reason: INVALID_CREDENTIALS };
}

/** Public (hash-free) lookup for the CLI grant command and admin paths. */
export function findUserByEmail(p: P, rawEmail: string): User | null {
  const record = repo.userByEmail(p.db, normalizeEmail(rawEmail));
  return record ? toUser(record) : null;
}

// --- sessions ---

/** Creates a session; the returned raw token goes in the cookie (never stored). */
export function createSession(p: P, userId: number, now: Date): string {
  const raw = randomToken();
  const t = now.getTime();
  repo.insertSession(p.db, {
    tokenHash: sha256Hex(raw),
    userId,
    createdAt: t,
    refreshedAt: t,
    expiresAt: t + SESSION_TTL_MS,
  });
  return raw;
}

/** Cookie token → user; extends the rolling expiry at most daily. */
export function resolveSession(p: P, rawToken: string, now: Date): User | null {
  const t = now.getTime();
  const session = repo.sessionByHash(p.db, sha256Hex(rawToken));
  if (!session || session.expiresAt <= t) return null;
  const user = repo.userById(p.db, session.userId);
  if (!user) return null;
  if (t - session.refreshedAt > SESSION_REFRESH_AFTER_MS)
    repo.refreshSession(p.db, session.tokenHash, t, t + SESSION_TTL_MS);
  return toUser(user);
}

export function signOut(p: P, rawToken: string): void {
  repo.deleteSession(p.db, sha256Hex(rawToken));
}

export function signOutEverywhere(p: P, userId: number): void {
  repo.deleteSessionsForUser(p.db, userId);
}

// --- email verification + password reset ---

function issueToken(p: P, userId: number, purpose: TokenPurpose, ttlMs: number, now: Date): string {
  const raw = randomToken();
  repo.insertToken(p.db, {
    tokenHash: sha256Hex(raw),
    userId,
    purpose,
    expiresAt: now.getTime() + ttlMs,
    usedAt: null,
  });
  return raw;
}

export function createVerifyToken(p: P, userId: number, now: Date): string {
  return issueToken(p, userId, "verify", VERIFY_TOKEN_TTL_MS, now);
}

export function verifyEmail(p: P, rawToken: string, now: Date): AuthResult {
  const stale = { ok: false as const, reason: "That verification link is invalid or expired." };
  const token = repo.tokenByHash(p.db, sha256Hex(rawToken), "verify");
  if (!token || token.expiresAt <= now.getTime()) return stale;
  if (!repo.consumeToken(p.db, token.tokenHash, now.getTime())) return stale;
  repo.markVerified(p.db, token.userId, now.toISOString());
  const user = repo.userById(p.db, token.userId);
  return user ? { ok: true, user: toUser(user) } : stale;
}

/** Null when the email has no account — the caller answers identically. */
export function requestReset(p: P, rawEmail: string, now: Date): { token: string; user: User } | null {
  const record = repo.userByEmail(p.db, normalizeEmail(rawEmail));
  if (!record) return null;
  return { token: issueToken(p, record.userId, "reset", RESET_TOKEN_TTL_MS, now), user: toUser(record) };
}

/** Consumes the single-use token, sets the password, revokes every session. */
export async function resetPassword(
  p: P,
  rawToken: string,
  password: string,
  now: Date,
): Promise<AuthResult> {
  const stale = { ok: false as const, reason: "That reset link is invalid, used, or expired." };
  const token = repo.tokenByHash(p.db, sha256Hex(rawToken), "reset");
  if (!token || token.expiresAt <= now.getTime() || token.usedAt !== null) return stale;
  const user = repo.userById(p.db, token.userId);
  if (!user) return stale;
  const problem = validatePassword(password, user.email);
  if (problem) return { ok: false, reason: problem };
  const hash = await hashPassword(password);
  if (!repo.consumeToken(p.db, token.tokenHash, now.getTime())) return stale;
  repo.updatePassword(p.db, user.userId, hash);
  repo.deleteSessionsForUser(p.db, user.userId);
  return { ok: true, user: toUser(user) };
}

// --- deletion ---

/** Password-confirmed, immediate (spec §6). Billing rows are the app's job. */
export async function deleteAccount(p: P, userId: number, password: string): Promise<AuthResult> {
  const record = repo.userById(p.db, userId);
  if (!record) return { ok: false, reason: "Account not found." };
  const good = await Bun.password.verify(password, record.passwordHash);
  if (!good) return { ok: false, reason: "Password is incorrect." };
  repo.deleteUser(p.db, userId);
  return { ok: true, user: toUser(record) };
}

// --- rate limiting ---

/** Counts, and when allowed also records this attempt. Prunes expired rows. */
export function rateLimit(p: P, key: string, rule: RateLimitRule, now: Date): RateLimitVerdict {
  const t = now.getTime();
  const since = t - rule.windowMs;
  repo.pruneAttempts(p.db, t - 24 * 60 * 60 * 1000);
  if (repo.countAttempts(p.db, key, since) >= rule.max) {
    const oldest = repo.oldestAttemptSince(p.db, key, since) ?? t;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - t) / 1000)) };
  }
  repo.recordAttempt(p.db, key, t);
  return { allowed: true, retryAfterSeconds: 0 };
}

// --- email preferences + deliverability (WS-G) ---

/**
 * Preferences for a user, creating the row (both lists off) on first read so
 * every account has a stable unsubscribe token from the moment it is touched.
 */
export function emailPrefs(p: P, userId: number, now: Date): EmailPrefs {
  const existing = repo.prefsFor(p.db, userId);
  if (existing) return existing;
  repo.insertPrefs(p.db, userId, randomToken(), now.toISOString());
  return repo.prefsFor(p.db, userId)!;
}

export function setEmailPref(
  p: P,
  userId: number,
  kind: EmailKind,
  on: boolean,
  now: Date,
): EmailPrefs {
  emailPrefs(p, userId, now); // ensure the row exists
  repo.setPref(p.db, userId, kind, on, now.toISOString());
  return repo.prefsFor(p.db, userId)!;
}

/**
 * One-tap unsubscribe. Returns the affected user id so the caller can offer
 * an undo, or null when the token is unknown (expired account, typo, forged).
 */
export function unsubscribe(p: P, unsubToken: string, kind: EmailKind, now: Date): number | null {
  const prefs = repo.prefsByToken(p.db, unsubToken);
  if (!prefs) return null;
  repo.setPref(p.db, prefs.userId, kind, false, now.toISOString());
  return prefs.userId;
}

/** Undo for the unsubscribe landing page — same token, opposite direction. */
export function resubscribe(p: P, unsubToken: string, kind: EmailKind, now: Date): number | null {
  const prefs = repo.prefsByToken(p.db, unsubToken);
  if (!prefs) return null;
  repo.setPref(p.db, prefs.userId, kind, true, now.toISOString());
  return prefs.userId;
}

/** Opted-in verified non-suppressed users. Pro filtering happens in the app. */
export function digestRecipients(p: P, kind: EmailKind): DigestRecipient[] {
  return repo.digestRecipients(p.db, kind);
}

export function suppressAddress(
  p: P,
  email: string,
  reason: SuppressionReason,
  now: Date,
): boolean {
  return repo.suppressAddress(p.db, normalizeEmail(email), reason, now.toISOString());
}

export function clearSuppression(p: P, userId: number, now: Date): void {
  repo.unsuppress(p.db, userId, now.toISOString());
}

/** False when this provider event was already recorded (webhooks retry). */
export function recordEmailEvent(
  p: P,
  e: { eventId: string; type: string; email: string; detail?: string | null },
  now: Date,
): boolean {
  return repo.insertEvent(p.db, {
    eventId: e.eventId,
    type: e.type,
    email: normalizeEmail(e.email),
    receivedAt: now.toISOString(),
    detail: e.detail ?? null,
  });
}

/** True exactly once per (user, kind, race) — the digest idempotency guard. */
export function claimDigestSend(
  p: P,
  userId: number,
  kind: EmailKind,
  refId: number,
  now: Date,
): boolean {
  return repo.claimSend(p.db, userId, kind, refId, now.toISOString());
}

export function recordDigestOutcome(
  p: P,
  userId: number,
  kind: EmailKind,
  refId: number,
  ok: boolean,
  detail: string,
): void {
  repo.recordSendOutcome(p.db, userId, kind, refId, ok, detail);
}

export function digestSendCount(p: P, kind: EmailKind, refId: number): number {
  return repo.sendCount(p.db, kind, refId);
}
