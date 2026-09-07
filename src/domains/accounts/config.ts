// Accounts policy knobs (spec §6). No external imports (architecture rule).
import type { RateLimitRule } from "./types.ts";

export const PASSWORD_MIN_LENGTH = 10;
/** Upper bound guards the hasher against absurd inputs. */
export const PASSWORD_MAX_LENGTH = 200;

/** Sessions: 30-day rolling expiry; refreshed when last touched > 24 h ago. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

/** Email verification links: single-use, 48 h. */
export const VERIFY_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;
/** Password reset links: single-use, 30 minutes (spec §6). */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export const SESSION_COOKIE = "session";
export const CSRF_COOKIE = "csrf";

export const RATE_LIMITS: Record<
  "signinIp" | "signinEmail" | "signupIp" | "resetEmail" | "resetIp",
  RateLimitRule
> = {
  signinIp: { max: 10, windowMs: 15 * 60 * 1000 },
  signinEmail: { max: 10, windowMs: 15 * 60 * 1000 },
  signupIp: { max: 5, windowMs: 60 * 60 * 1000 },
  resetEmail: { max: 3, windowMs: 60 * 60 * 1000 },
  resetIp: { max: 10, windowMs: 60 * 60 * 1000 },
};

/**
 * v1 breached-password stand-in: the passwords that dominate every breach
 * corpus (lowercased; candidate passwords are lowercased before comparison).
 * A live HIBP k-anonymity check is tracked as tech debt.
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "1234567890", "12345678910", "0123456789", "1234567891", "9876543210",
  "q1w2e3r4t5y6", "1q2w3e4r5t6y", "qwertyuiop", "qwerty1234", "qwerty12345",
  "qwertyui123", "asdfghjkl1", "zaq12wsxcde3", "1qaz2wsx3edc", "qazwsxedc123",
  "password12", "password123", "password1234", "password12345", "passw0rd123",
  "p@ssw0rd123", "password!23", "mypassword1", "mypassword123", "newpassword1",
  "superman123", "batman12345", "letmein12345", "welcome12345", "welcome123",
  "iloveyou123", "sunshine123", "princess123", "football123", "baseball123",
  "basketball1", "liverpool123", "arsenal12345", "chelsea12345", "monkey12345",
  "dragon12345", "master12345", "shadow12345", "michael12345", "jordan12345",
  "harley12345", "ranger12345", "soccer12345", "hockey12345", "killer12345",
  "george12345", "charlie1234", "andrew12345", "thomas12345", "jessica12345",
  "michelle1234", "jennifer1234", "hunter12345", "buster12345", "tigger12345",
  "1q2w3e4r5t", "zxcvbnm123", "asdf1234567", "abcd1234567", "abc123456789",
  "a1b2c3d4e5", "aaaaaaaaaa", "1111111111", "1234512345", "123123123123",
  "112233445566", "121212121212", "789456123789", "159753159753", "147258369147",
  "computer1234", "internet1234", "whatever1234", "trustno1trustno1",
  "secret12345", "freedom12345", "starwars1234", "pokemon12345", "nintendo123",
  "minecraft123", "samsung12345", "google12345", "facebook1234", "linkedin1234",
]);

/**
 * Digest lists (WS-G). Both default OFF — the Monday recap is opt-in by plan,
 * and the Thursday preview is opt-in *and* Pro-gated at send time.
 */
export const EMAIL_KINDS = ["recap", "preview"] as const;

export const EMAIL_KIND_LABELS: Record<string, string> = {
  recap: "Monday race recap",
  preview: "Thursday race preview (Pro)",
};
