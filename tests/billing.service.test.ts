// Billing (WS-D slice): entitlement boundaries, manual grants, the
// verified-email purchase guard, and the gate matrix from src/app/gate.ts.
import { describe, expect, test } from "bun:test";
import { billingService } from "../src/domains/billing/index.ts";
import { featureEnabled, seriesGated, raceGated, jsonRequestBlocked } from "../src/app/gate.ts";
import { testDb } from "./seed.ts";

const T0 = new Date("2026-09-07T12:00:00Z");

describe("entitlements", () => {
  test("no row means not Pro", () => {
    const p = { db: testDb() };
    expect(billingService.proStatus(p, 1, T0)).toEqual({ pro: false, proUntil: null, proSource: null });
  });

  test("pro_until boundaries: future on, past off, exactly-now off", () => {
    const p = { db: testDb() };
    billingService.grantPro(p, 1, "2026-09-08T00:00:00Z", "grant", T0);
    expect(billingService.isPro(p, 1, T0)).toBe(true);
    expect(billingService.isPro(p, 1, new Date("2026-09-08T00:00:00Z"))).toBe(false); // not strictly future
    expect(billingService.isPro(p, 1, new Date("2026-09-09T00:00:00Z"))).toBe(false);
  });

  test("grants overwrite (extension/downgrade) and revoke removes the row", () => {
    const p = { db: testDb() };
    billingService.grantPro(p, 1, "2027-01-01T00:00:00Z", "season_pass", T0);
    billingService.grantPro(p, 1, "2026-09-08T00:00:00Z", "subscription", T0);
    expect(billingService.proStatus(p, 1, T0).proSource).toBe("subscription");
    billingService.revoke(p, 1);
    expect(billingService.proStatus(p, 1, T0).pro).toBe(false);
  });

  test("a malformed pro_until date is rejected loudly", () => {
    const p = { db: testDb() };
    expect(() => billingService.grantPro(p, 1, "whenever", "grant", T0)).toThrow(/ISO date/);
  });
});

describe("purchase guard (unverified user attempting checkout)", () => {
  const base = { userId: 1, email: "a@b.c", createdAt: "2026-09-07" };
  test("anonymous and unverified users are refused; verified pass", () => {
    expect(billingService.canPurchase(null)).toEqual({ ok: false, reason: "Sign in first." });
    expect(billingService.canPurchase({ ...base, verifiedAt: null })).toEqual({
      ok: false,
      reason: "Verify your email address before upgrading.",
    });
    expect(billingService.canPurchase({ ...base, verifiedAt: "2026-09-07" })).toEqual({
      ok: true,
      reason: null,
    });
  });
});

describe("gate matrix", () => {
  const free = { pro: false };
  const pro = { pro: true };

  test("series gate: Cup is free for everyone; Xfinity/Trucks need Pro", () => {
    expect(seriesGated(1, free)).toBe(false);
    expect(seriesGated(2, free)).toBe(true);
    expect(seriesGated(3, free)).toBe(true);
    expect(seriesGated(2, pro)).toBe(false);
    expect(raceGated(3, free)).toBe(true);
    expect(raceGated(1, free)).toBe(false);
  });

  test("every Pro feature flag follows viewer.pro", () => {
    for (const f of ["predictions", "dfs", "export", "push", "compare4"] as const) {
      expect(featureEnabled(f, free)).toBe(false);
      expect(featureEnabled(f, pro)).toBe(true);
    }
  });

  test("JSON gate blocks non-Cup /data files and ?series= API calls for free viewers only", () => {
    const u = (s: string) => new URL(`http://x${s}`);
    expect(jsonRequestBlocked(u("/data/season-stats-2.json"), free)).toBe(true);
    expect(jsonRequestBlocked(u("/data/tracktype-3.json"), free)).toBe(true);
    expect(jsonRequestBlocked(u("/data/season-stats-1.json"), free)).toBe(false);
    expect(jsonRequestBlocked(u("/api/drivers?series=2"), free)).toBe(true);
    expect(jsonRequestBlocked(u("/api/drivers?series=1"), free)).toBe(false);
    expect(jsonRequestBlocked(u("/api/drivers"), free)).toBe(false); // defaults to Cup
    expect(jsonRequestBlocked(u("/data/season-stats-2.json"), pro)).toBe(false);
    expect(jsonRequestBlocked(u("/api/metrics?series=3"), pro)).toBe(false);
  });
});
