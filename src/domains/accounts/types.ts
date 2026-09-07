// Accounts domain types: users, sessions, auth tokens, rate limiting.
// Zero runtime imports (architecture rule).

export interface User {
  userId: number;
  /** Stored lowercased; the service normalizes on the way in. */
  email: string;
  createdAt: string;
  /** ISO timestamp when the email was verified; null until then. */
  verifiedAt: string | null;
}

/** Repo-facing user row including the secret hash (never leaves the domain). */
export interface UserRecord extends User {
  passwordHash: string;
}

export interface SessionRecord {
  tokenHash: string;
  userId: number;
  createdAt: number;
  refreshedAt: number;
  expiresAt: number;
}

export type TokenPurpose = "verify" | "reset";

export interface AuthTokenRecord {
  tokenHash: string;
  userId: number;
  purpose: TokenPurpose;
  expiresAt: number;
  usedAt: number | null;
}

/** Sliding-window rate-limit rule: at most `max` events per `windowMs`. */
export interface RateLimitRule {
  max: number;
  windowMs: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** Seconds until the oldest counted attempt ages out (0 when allowed). */
  retryAfterSeconds: number;
}

/** Sign-up / sign-in / reset outcomes. `reason` is safe to show the user. */
export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; reason: string };

// --- email preferences + deliverability (WS-G) ---

/** The two digest lists. Recap is free + opt-in; preview is Pro + opt-in. */
export type EmailKind = "recap" | "preview";

export interface EmailPrefs {
  userId: number;
  recap: boolean;
  preview: boolean;
  /** Per-user secret in unsubscribe links. Never reused across users. */
  unsubToken: string;
  /** Set by a hard bounce — suppresses every future digest to this address. */
  bouncedAt: string | null;
  /** Set by a spam complaint — same suppression, different cause. */
  complainedAt: string | null;
  updatedAt: string;
}

/** A user eligible for one digest list: verified, opted in, not suppressed. */
export interface DigestRecipient {
  userId: number;
  email: string;
  unsubToken: string;
}

/** Why an address stopped receiving mail. */
export type SuppressionReason = "bounced" | "complained";
