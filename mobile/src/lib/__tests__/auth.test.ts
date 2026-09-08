// Pure pieces of the auth flow. RN's fetch follows the server's PRG 303s, so
// outcome classification over (status, final path, form error) is the part
// that must be exactly right — and the part that can rot silently.
import { describe, expect, test } from "bun:test";
import { classifyAuthResponse, extractFormError, parseMe } from "../auth.ts";
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
    // after a redirect quirk. The error text decides.
    expect(classifyAuthResponse(200, "/account", "Something failed")).toMatchObject({ ok: false });
  });

  test("429 and 403 map to rate_limited and csrf", () => {
    expect(classifyAuthResponse(429, "", null)).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(classifyAuthResponse(403, "", null)).toMatchObject({ ok: false, reason: "csrf" });
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
