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
