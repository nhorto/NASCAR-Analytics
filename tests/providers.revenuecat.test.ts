// RevenueCat provider (WS-J): Authorization header verification. Unlike
// Stripe, RevenueCat's webhook auth is a static shared secret echoed back
// verbatim, not a computed signature — these are the negative cases (wrong
// secret, missing header, `Bearer ` prefix handling).
import { describe, expect, test } from "bun:test";
import { verifyRevenueCatAuthorization } from "../src/providers/revenuecat.ts";

const SECRET = "rc_whsec_test_secret";

describe("verifyRevenueCatAuthorization", () => {
  test("the bare configured secret verifies", () => {
    expect(verifyRevenueCatAuthorization({ secret: SECRET, header: SECRET })).toBe(true);
  });

  test("a Bearer-prefixed header also verifies", () => {
    expect(verifyRevenueCatAuthorization({ secret: SECRET, header: `Bearer ${SECRET}` })).toBe(true);
  });

  test("a wrong secret is rejected", () => {
    expect(verifyRevenueCatAuthorization({ secret: SECRET, header: "wrong" })).toBe(false);
    expect(verifyRevenueCatAuthorization({ secret: SECRET, header: `Bearer wrong` })).toBe(false);
  });

  test("a missing header is rejected", () => {
    expect(verifyRevenueCatAuthorization({ secret: SECRET, header: null })).toBe(false);
  });

  test("an empty header is rejected", () => {
    expect(verifyRevenueCatAuthorization({ secret: SECRET, header: "" })).toBe(false);
  });

  test("a header that is a prefix or superset of the secret is rejected", () => {
    expect(verifyRevenueCatAuthorization({ secret: SECRET, header: SECRET.slice(0, -1) })).toBe(false);
    expect(verifyRevenueCatAuthorization({ secret: SECRET, header: `${SECRET}x` })).toBe(false);
  });
});
