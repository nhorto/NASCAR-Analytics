// Accounts domain: password policy, sign-up/sign-in, sessions (rolling
// expiry), verify + reset tokens (single-use, expiring), deletion, rate
// limits. Negative cases are the point — every guard has a test that trips it.
import { describe, expect, test } from "bun:test";
import { accountsService, accountsConfig } from "../src/domains/accounts/index.ts";
import { testDb } from "./seed.ts";

const svc = accountsService;
const T0 = new Date("2026-09-07T12:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const PW = "orange-gearbox-77";

function freshP() {
  return { db: testDb() };
}

async function signedUp(p = freshP()) {
  const result = await svc.signUp(p, "nick@example.com", PW, T0);
  if (!result.ok) throw new Error(result.reason);
  return { p, user: result.user };
}

describe("password policy", () => {
  test("rejects short, common, and email-equal passwords with exact reasons", () => {
    expect(svc.validatePassword("short-1", "a@b.c")).toBe(
      "Password must be at least 10 characters.",
    );
    expect(svc.validatePassword("password12345", "a@b.c")).toBe(
      "That password appears in breach lists — pick something less common.",
    );
    expect(svc.validatePassword("Nick@Example.com", "nick@example.com")).toBe(
      "Password can't be your email address.",
    );
    expect(svc.validatePassword(PW, "a@b.c")).toBeNull();
  });
});

describe("sign-up", () => {
  test("creates an unverified user with a lowercased email", async () => {
    const { user } = await signedUp();
    expect(user.email).toBe("nick@example.com");
    expect(user.verifiedAt).toBeNull();
  });

  test("rejects malformed emails and duplicates (case-insensitively)", async () => {
    const { p } = await signedUp();
    expect((await svc.signUp(p, "not-an-email", PW, T0)).ok).toBe(false);
    const dup = await svc.signUp(p, "NICK@example.com", "different-pw-99", T0);
    expect(dup).toEqual({
      ok: false,
      reason: "An account with that email already exists — sign in instead.",
    });
  });
});

describe("sign-in", () => {
  test("wrong password and unknown email fail with the same generic reason", async () => {
    const { p } = await signedUp();
    const wrongPw = await svc.signIn(p, "nick@example.com", "wrong-password-1", T0);
    const noUser = await svc.signIn(p, "ghost@example.com", PW, T0);
    expect(wrongPw).toEqual({ ok: false, reason: "Invalid email or password." });
    expect(noUser).toEqual({ ok: false, reason: "Invalid email or password." });
  });

  test("correct credentials succeed regardless of email case", async () => {
    const { p, user } = await signedUp();
    const result = await svc.signIn(p, " NICK@example.com ", PW, T0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.userId).toBe(user.userId);
  });
});

describe("sessions", () => {
  test("token resolves to the user; a garbage token resolves to nobody", async () => {
    const { p, user } = await signedUp();
    const token = svc.createSession(p, user.userId, T0);
    expect(svc.resolveSession(p, token, T0)?.userId).toBe(user.userId);
    expect(svc.resolveSession(p, "not-a-real-token", T0)).toBeNull();
  });

  test("expires after 30 days idle, but daily activity keeps it rolling", async () => {
    const { p, user } = await signedUp();
    const idle = svc.createSession(p, user.userId, T0);
    expect(svc.resolveSession(p, idle, later(31 * DAY))).toBeNull();

    const active = svc.createSession(p, user.userId, T0);
    // Touch every 20 days: each touch (>24 h since last) extends 30 more days.
    expect(svc.resolveSession(p, active, later(20 * DAY))).not.toBeNull();
    expect(svc.resolveSession(p, active, later(40 * DAY))).not.toBeNull();
    expect(svc.resolveSession(p, active, later(80 * DAY))).toBeNull();
  });

  test("signOut kills one session, signOutEverywhere kills them all", async () => {
    const { p, user } = await signedUp();
    const a = svc.createSession(p, user.userId, T0);
    const b = svc.createSession(p, user.userId, T0);
    svc.signOut(p, a);
    expect(svc.resolveSession(p, a, T0)).toBeNull();
    expect(svc.resolveSession(p, b, T0)).not.toBeNull();
    svc.signOutEverywhere(p, user.userId);
    expect(svc.resolveSession(p, b, T0)).toBeNull();
  });
});

describe("email verification", () => {
  test("token verifies once; reuse and expiry both fail", async () => {
    const { p, user } = await signedUp();
    const token = svc.createVerifyToken(p, user.userId, T0);
    const ok = svc.verifyEmail(p, token, later(HOUR));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.user.verifiedAt).not.toBeNull();
    expect(svc.verifyEmail(p, token, later(2 * HOUR)).ok).toBe(false); // reuse

    const expired = svc.createVerifyToken(p, user.userId, T0);
    expect(svc.verifyEmail(p, expired, later(49 * HOUR))).toEqual({
      ok: false,
      reason: "That verification link is invalid or expired.",
    });
  });
});

describe("password reset", () => {
  test("unknown email yields null (caller answers identically)", async () => {
    const { p } = await signedUp();
    expect(svc.requestReset(p, "ghost@example.com", T0)).toBeNull();
  });

  test("reset sets the password, revokes sessions, and burns the token", async () => {
    const { p, user } = await signedUp();
    const session = svc.createSession(p, user.userId, T0);
    const reset = svc.requestReset(p, "nick@example.com", T0)!;
    const result = await svc.resetPassword(p, reset.token, "new-sturdy-pw-42", later(60_000));
    expect(result.ok).toBe(true);
    expect(svc.resolveSession(p, session, later(60_000))).toBeNull(); // signed out everywhere
    expect((await svc.signIn(p, "nick@example.com", PW, T0)).ok).toBe(false); // old pw dead
    expect((await svc.signIn(p, "nick@example.com", "new-sturdy-pw-42", T0)).ok).toBe(true);

    // Reused token fails with the exact stale reason.
    expect(await svc.resetPassword(p, reset.token, "another-fine-pw-9", later(120_000))).toEqual({
      ok: false,
      reason: "That reset link is invalid, used, or expired.",
    });
  });

  test("token expires after 30 minutes; weak replacement passwords are refused", async () => {
    const { p } = await signedUp();
    const expired = svc.requestReset(p, "nick@example.com", T0)!;
    expect((await svc.resetPassword(p, expired.token, "new-sturdy-pw-42", later(31 * 60_000))).ok).toBe(false);

    const fresh = svc.requestReset(p, "nick@example.com", T0)!;
    const weak = await svc.resetPassword(p, fresh.token, "short", later(60_000));
    expect(weak.ok).toBe(false);
    // A refused password must NOT burn the token — retry with a good one works.
    expect((await svc.resetPassword(p, fresh.token, "new-sturdy-pw-42", later(120_000))).ok).toBe(true);
  });
});

describe("account deletion", () => {
  test("requires the correct password, then removes user and sessions", async () => {
    const { p, user } = await signedUp();
    const session = svc.createSession(p, user.userId, T0);
    expect(await svc.deleteAccount(p, user.userId, "wrong-password-1")).toEqual({
      ok: false,
      reason: "Password is incorrect.",
    });
    expect((await svc.deleteAccount(p, user.userId, PW)).ok).toBe(true);
    expect(svc.resolveSession(p, session, T0)).toBeNull();
    expect(svc.findUserByEmail(p, "nick@example.com")).toBeNull();
  });
});

describe("rate limiting", () => {
  const RULE = { max: 3, windowMs: 15 * 60 * 1000 };

  test("allows up to max in the window, then trips with a Retry-After", () => {
    const p = freshP();
    for (let i = 0; i < 3; i++) expect(svc.rateLimit(p, "signin:ip:1.2.3.4", RULE, T0).allowed).toBe(true);
    const tripped = svc.rateLimit(p, "signin:ip:1.2.3.4", RULE, later(60_000));
    expect(tripped.allowed).toBe(false);
    expect(tripped.retryAfterSeconds).toBe(14 * 60); // oldest attempt ages out then
    // A different key is unaffected.
    expect(svc.rateLimit(p, "signin:ip:5.6.7.8", RULE, later(60_000)).allowed).toBe(true);
  });

  test("the window slides: old attempts age out and free the key", () => {
    const p = freshP();
    for (let i = 0; i < 3; i++) svc.rateLimit(p, "k", RULE, T0);
    expect(svc.rateLimit(p, "k", RULE, later(RULE.windowMs - 1000)).allowed).toBe(false);
    expect(svc.rateLimit(p, "k", RULE, later(RULE.windowMs + 1000)).allowed).toBe(true);
  });
});

describe("config sanity", () => {
  test("policy constants match the spec", () => {
    expect(accountsConfig.PASSWORD_MIN_LENGTH).toBe(10);
    expect(accountsConfig.SESSION_TTL_MS).toBe(30 * DAY);
    expect(accountsConfig.RESET_TOKEN_TTL_MS).toBe(30 * 60 * 1000);
  });
});
