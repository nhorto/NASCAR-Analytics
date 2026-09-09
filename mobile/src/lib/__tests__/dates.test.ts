import { expect, test } from "bun:test";
import { fmtProUntil } from "../dates.ts";

test("a date-only pro_until keeps its calendar date west of UTC", () => {
  // Parsed as UTC midnight; local formatting would render "12/30/2027".
  expect(fmtProUntil("2027-12-31")).toBe(new Date("2027-12-31").toLocaleDateString(undefined, { timeZone: "UTC" }));
  expect(fmtProUntil("2027-12-31")).toContain("2027");
});

test("missing and malformed values render as an em dash", () => {
  expect(fmtProUntil(null)).toBe("—");
  expect(fmtProUntil("not-a-date")).toBe("—");
});
