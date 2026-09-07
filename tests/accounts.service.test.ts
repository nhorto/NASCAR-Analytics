// Accounts domain: password policy, sign-up/sign-in, sessions (rolling
// expiry), verify + reset tokens (single-use, expiring), deletion, rate
// limits. Negative cases are the point — every guard has a test that trips it.
import { describe, expect, test } from "bun:test";
import { accountsService, accountsConfig } from "../src/domains/accounts/index.ts";
import { testDb, seedUser } from "./seed.ts";

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

// --- email preferences + deliverability (WS-G) ---

describe("email preferences", () => {
  test("first read creates the row with both lists off and a stable token", () => {
    const p = freshP();
    const userId = seedUser(p.db, { email: "a@example.com" });

    const first = svc.emailPrefs(p, userId, T0);
    expect(first.recap).toBe(false);
    expect(first.preview).toBe(false);
    expect(first.unsubToken.length).toBeGreaterThan(20);

    // Reading again must not mint a new token — live links would break.
    expect(svc.emailPrefs(p, userId, later(DAY)).unsubToken).toBe(first.unsubToken);
  });

  test("each account gets its own unsubscribe token", () => {
    const p = freshP();
    const a = svc.emailPrefs(p, seedUser(p.db, { email: "a@example.com" }), T0);
    const b = svc.emailPrefs(p, seedUser(p.db, { email: "b@example.com" }), T0);
    expect(a.unsubToken).not.toBe(b.unsubToken);
  });

  test("setting one list leaves the other alone", () => {
    const p = freshP();
    const userId = seedUser(p.db, { email: "a@example.com" });

    svc.setEmailPref(p, userId, "recap", true, T0);
    const prefs = svc.setEmailPref(p, userId, "preview", true, T0);
    expect(prefs.recap).toBe(true);
    expect(prefs.preview).toBe(true);

    const off = svc.setEmailPref(p, userId, "preview", false, T0);
    expect(off.recap).toBe(true);
    expect(off.preview).toBe(false);
  });

  test("digest recipients exclude unverified, opted-out, and suppressed addresses", () => {
    const p = freshP();
    const inList = seedUser(p.db, { email: "in@example.com" });
    const unverified = seedUser(p.db, { email: "unverified@example.com", verified: false });
    const optedOut = seedUser(p.db, { email: "out@example.com" });
    const bounced = seedUser(p.db, { email: "bounced@example.com" });
    for (const id of [inList, unverified, bounced]) svc.setEmailPref(p, id, "recap", true, T0);
    svc.setEmailPref(p, optedOut, "recap", false, T0);
    svc.suppressAddress(p, "bounced@example.com", "bounced", T0);

    expect(svc.digestRecipients(p, "recap").map((r) => r.email)).toEqual(["in@example.com"]);
    expect(svc.digestRecipients(p, "preview")).toEqual([]);
  });

  test("unsubscribe by token turns off exactly the named list", () => {
    const p = freshP();
    const userId = seedUser(p.db, { email: "a@example.com" });
    svc.setEmailPref(p, userId, "recap", true, T0);
    svc.setEmailPref(p, userId, "preview", true, T0);
    const token = svc.emailPrefs(p, userId, T0).unsubToken;

    expect(svc.unsubscribe(p, token, "recap", T0)).toBe(userId);
    const after = svc.emailPrefs(p, userId, T0);
    expect(after.recap).toBe(false);
    expect(after.preview).toBe(true);
  });

  test("undo re-subscribes with the same token", () => {
    const p = freshP();
    const userId = seedUser(p.db, { email: "a@example.com" });
    const token = svc.emailPrefs(p, userId, T0).unsubToken;
    svc.unsubscribe(p, token, "recap", T0);

    expect(svc.resubscribe(p, token, "recap", T0)).toBe(userId);
    expect(svc.emailPrefs(p, userId, T0).recap).toBe(true);
  });

  test("an unknown or forged token changes nothing", () => {
    const p = freshP();
    const userId = seedUser(p.db, { email: "a@example.com" });
    svc.setEmailPref(p, userId, "recap", true, T0);

    expect(svc.unsubscribe(p, "not-a-real-token", "recap", T0)).toBeNull();
    expect(svc.resubscribe(p, "not-a-real-token", "recap", T0)).toBeNull();
    expect(svc.emailPrefs(p, userId, T0).recap).toBe(true);
  });

  test("suppression targets a real account only, and can be cleared", () => {
    const p = freshP();
    const userId = seedUser(p.db, { email: "a@example.com" });
    svc.emailPrefs(p, userId, T0);

    expect(svc.suppressAddress(p, "nobody@example.com", "bounced", T0)).toBe(false);
    expect(svc.suppressAddress(p, "A@Example.com", "bounced", T0)).toBe(true); // case-insensitive
    expect(svc.emailPrefs(p, userId, T0).bouncedAt).toBe(T0.toISOString());

    svc.clearSuppression(p, userId, later(HOUR));
    expect(svc.emailPrefs(p, userId, T0).bouncedAt).toBeNull();
  });

  test("a provider event is recorded once; retries report as duplicates", () => {
    const p = freshP();
    expect(svc.recordEmailEvent(p, { eventId: "evt_1", type: "email.bounced", email: "a@b.c" }, T0)).toBe(true);
    expect(svc.recordEmailEvent(p, { eventId: "evt_1", type: "email.bounced", email: "a@b.c" }, T0)).toBe(false);
  });

  test("a digest send is claimable exactly once per user, kind, and race", () => {
    const p = freshP();
    const userId = seedUser(p.db, { email: "a@example.com" });

    expect(svc.claimDigestSend(p, userId, "recap", 5555, T0)).toBe(true);
    // Still in flight (no outcome recorded): an overlapping run must not send.
    expect(svc.claimDigestSend(p, userId, "recap", 5555, T0)).toBe(false);
    // A different race, or a different list, is a separate claim.
    expect(svc.claimDigestSend(p, userId, "recap", 5556, T0)).toBe(true);
    expect(svc.claimDigestSend(p, userId, "preview", 5555, T0)).toBe(true);
    expect(svc.digestSendCount(p, "recap", 5555)).toBe(1);
  });

  test("a failed send stays retryable; a successful one never re-sends", () => {
    const p = freshP();
    const userId = seedUser(p.db, { email: "a@example.com" });

    // Attempt 1 fails (no provider key, transport error, provider 500…).
    expect(svc.claimDigestSend(p, userId, "recap", 7, T0)).toBe(true);
    svc.recordDigestOutcome(p, userId, "recap", 7, false, "email not configured");
    // …so the next run may try again — otherwise that race is lost forever.
    expect(svc.claimDigestSend(p, userId, "recap", 7, later(HOUR))).toBe(true);

    svc.recordDigestOutcome(p, userId, "recap", 7, true, "sent");
    expect(svc.claimDigestSend(p, userId, "recap", 7, later(2 * HOUR))).toBe(false);
  });

  test("deleting an account removes its preferences and send history", async () => {
    const { p, user } = await signedUp();
    svc.setEmailPref(p, user.userId, "recap", true, T0);
    svc.claimDigestSend(p, user.userId, "recap", 1, T0);

    const deleted = await svc.deleteAccount(p, user.userId, PW);
    expect(deleted.ok).toBe(true);
    expect(svc.digestRecipients(p, "recap")).toEqual([]);
    expect(svc.digestSendCount(p, "recap", 1)).toBe(0);
  });
});

describe("config sanity", () => {
  test("policy constants match the spec", () => {
    expect(accountsConfig.PASSWORD_MIN_LENGTH).toBe(10);
    expect(accountsConfig.SESSION_TTL_MS).toBe(30 * DAY);
    expect(accountsConfig.RESET_TOKEN_TTL_MS).toBe(30 * 60 * 1000);
    expect(accountsConfig.EMAIL_KINDS).toEqual(["recap", "preview"]);
  });
});
