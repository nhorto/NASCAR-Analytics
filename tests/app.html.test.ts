import { expect, test } from "bun:test";
import { fmtDate } from "../src/app/html.ts";

test("date-only values keep their calendar date regardless of local zone", () => {
  // "2027-12-31" parses as UTC midnight. Formatted in local time west of UTC
  // it renders as Dec 30 — a Pro expiry a day early on the account page.
  expect(fmtDate("2027-12-31")).toBe("Dec 31, 2027");
  expect(fmtDate("2026-01-01")).toBe("Jan 1, 2026");
});

test("timestamps still render in the viewer's local zone", () => {
  const iso = "2026-09-06T18:00:00Z";
  expect(fmtDate(iso)).toBe(
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
  );
});

test("missing and malformed values render as an em dash", () => {
  expect(fmtDate(null)).toBe("—");
  expect(fmtDate("nope")).toBe("—");
});
