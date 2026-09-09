// Pure pieces of the auth flow. RN's fetch follows the server's PRG 303s, so
// outcome classification over (status, final path, form error) is the part
// that must be exactly right — and the part that can rot silently.
import { describe, expect, test } from "bun:test";
import { classifyAuthResponse, extractFormError, inconclusive, parseMe } from "../auth.ts";
import { parseSetCookie, splitSetCookie } from "../cookies.ts";
import { normalizeBase } from "../config.ts";

describe("classifyAuthResponse", () => {
  test("a followed 303 that landed on /account is success", () => {
    expect(classifyAuthResponse(200, "/account", null)).toEqual({ ok: true });
  });

  test("an unfollowed 303 is success", () => {
    expect(classifyAuthResponse(303, "", null)).toEqual({ ok: true });
  });

  test("401 is invalid credentials, keeping the server's own words", () => {
    expect(classifyAuthResponse(401, "/auth/signin", "Invalid email or password.")).toEqual({
      ok: false,
      reason: "invalid_credentials",
      detail: "Invalid email or password.",
    });
  });

  test("400 carries the server's form error (password rules, breached password)", () => {
    const detail = "That password appeared in a known breach — pick another.";
    expect(classifyAuthResponse(400, "/auth/signup", detail)).toEqual({
      ok: false,
      reason: "rejected",
      detail,
    });
  });

  test("a 200 re-render WITH a form error is not success", () => {
    // Reset-request always 200s (enumeration-safe); a signup re-render can too
    // after a redirect quirk. The error text decides — on an *auth* page.
    expect(classifyAuthResponse(200, "/signup", "Something failed")).toMatchObject({ ok: false });
  });

  test("landing on /account is success even when that page carries a form error", () => {
    // Regression (2026-09-09 Android drive): the signed-in account page always
    // renders "Email not verified — required before upgrading" as a
    // form-error, and verification mail cannot be sent yet (A4), so every real
    // account hit this. Reading it as a rejection reported a successful
    // sign-in as failure AND made it conclusive, skipping the /api/me
    // fallback — the app stayed signed out with a session on the server.
    const landed = classifyAuthResponse(200, "/account", "Email not verified — required before upgrading.");
    expect(landed).toEqual({ ok: true });
  });

  test("429 and 403 map to rate_limited and csrf", () => {
    expect(classifyAuthResponse(429, "", null)).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(classifyAuthResponse(403, "", null)).toMatchObject({ ok: false, reason: "csrf" });
  });
});

describe("inconclusive (decides whether to confirm against /api/me)", () => {
  test("a successful sign-in that bounced to /signin is inconclusive, not a rejection", () => {
    // The observed bug: POST /auth/signin 303 (session created) -> GET /account
    // goes out before RN applies the cookie -> 303 -> GET /signin 200, no error.
    expect(inconclusive(classifyAuthResponse(200, "/signin", null))).toBe(true);
  });

  test("the server's own refusals are conclusive and must not be second-guessed", () => {
    expect(inconclusive(classifyAuthResponse(401, "/auth/signin", "Invalid email or password."))).toBe(false);
    expect(inconclusive(classifyAuthResponse(429, "", null))).toBe(false);
    expect(inconclusive(classifyAuthResponse(403, "", null))).toBe(false);
  });

  test("a rejection carrying the server's words is conclusive", () => {
    // Signing up with a taken address while already signed in as someone else
    // must stay a failure — /api/me would otherwise report the old session.
    const taken = "An account with that email already exists — sign in instead.";
    expect(inconclusive(classifyAuthResponse(400, "/auth/signup", taken))).toBe(false);
    expect(inconclusive(classifyAuthResponse(200, "/account", "Something failed"))).toBe(false);
  });

  test("success is never inconclusive", () => {
    expect(inconclusive(classifyAuthResponse(303, "", null))).toBe(false);
    expect(inconclusive(classifyAuthResponse(200, "/account", null))).toBe(false);
  });
});

describe("extractFormError", () => {
  test("pulls the server's form-error paragraph, dropping the glyph", () => {
    const html = `<form><p class="note form-error" role="alert">⚠ Invalid email or password.</p></form>`;
    expect(extractFormError(html)).toBe("Invalid email or password.");
  });

  test("null when the page has no error", () => {
    expect(extractFormError("<html><body>fine</body></html>")).toBeNull();
  });
});

describe("set-cookie parsing (RN merges repeated headers with commas)", () => {
  test("splits two cookies merged into one header", () => {
    const merged =
      "csrf=abc-123; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200, session=tok_9; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000";
    expect(splitSetCookie(merged).length).toBe(2);
    expect(parseSetCookie(merged)).toEqual({ csrf: "abc-123", session: "tok_9" });
  });

  test("a single cookie parses and attributes are dropped", () => {
    expect(parseSetCookie("csrf=x_y-z; Path=/; HttpOnly")).toEqual({ csrf: "x_y-z" });
  });

  test("null header parses to nothing", () => {
    expect(parseSetCookie(null)).toEqual({});
  });
});

describe("parseMe", () => {
  test("accepts the server's /api/me shape", () => {
    expect(
      parseMe({ email: "a@b.c", verifiedAt: null, pro: true, proUntil: "2099-01-01T00:00:00.000Z", proSource: "grant" }),
    ).toEqual({ email: "a@b.c", verifiedAt: null, pro: true, proUntil: "2099-01-01T00:00:00.000Z", proSource: "grant" });
  });

  test("rejects shapes without the load-bearing fields", () => {
    expect(parseMe({ pro: true })).toBeNull();
    expect(parseMe("nope")).toBeNull();
    expect(parseMe(null)).toBeNull();
  });

  test("an unknown proSource degrades to null, not a crash", () => {
    expect(parseMe({ email: "a@b.c", pro: false, proSource: "iap_subscription" })?.proSource).toBeNull();
  });
});

describe("normalizeBase", () => {
  test("trims trailing slashes and refuses junk", () => {
    expect(normalizeBase("http://10.0.0.5:3000/")).toBe("http://10.0.0.5:3000");
    expect(normalizeBase("https://example.com")).toBe("https://example.com");
    expect(normalizeBase("ftp://example.com")).toBeNull();
    expect(normalizeBase("not a url")).toBeNull();
    expect(normalizeBase("   ")).toBeNull();
  });
});
