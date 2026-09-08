// The marketing landing page (/welcome). What matters here is the contract the
// copy has to keep: conversion CTAs present, the working name isolated to one
// swappable constant, the NASCAR/gambling disclaimers on the page, and the
// brand asset wired into both hosts' caching. The CSP bar (no inline scripts /
// handlers) is enforced for /welcome by app.csp.test.ts like every other page.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { welcomePage, BRAND_NAME, LANDING_SHOTS } from "../src/app/pages/welcome.ts";
import { cacheClassFor } from "../src/app/http.ts";
import { headersFile } from "../src/app/export.ts";

const html = welcomePage();

describe("welcome page markup", () => {
  test("is a complete standalone document", () => {
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("</html>");
    expect(html).toContain('<meta name="description"');
  });

  test("carries the conversion CTAs", () => {
    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/signin"');
  });

  test("the wordmark comes from the swappable constant, lettered over the blank tire", () => {
    expect(html).toContain(BRAND_NAME.toUpperCase());
    expect(html).toContain("/brand/tire-master.jpg");
    // The tire art itself is unlettered; the name only exists as SVG text.
    expect(html).toContain("textPath");
  });

  test("shows the real product: every listed screenshot is embedded and exists on disk", () => {
    for (const shot of LANDING_SHOTS) {
      expect(html).toContain(`/shots/${shot}`);
      expect(
        existsSync(fileURLToPath(new URL(`../src/app/static/shots/${shot}`, import.meta.url))),
        `${shot} missing from static/shots`,
      ).toBe(true);
    }
  });

  test("offers a way into the app that isn't the root (which is this page)", () => {
    expect(html).toContain('href="/home"');
  });

  test("states the required disclaimers", () => {
    expect(html).toContain("Not affiliated with or endorsed by NASCAR");
    expect(html).toContain("not gambling advice");
  });

  test("quotes the spec §4 pricing", () => {
    expect(html).toContain("$9.99");
    expect(html).toContain("$69");
    expect(html).toContain("7-day free trial");
  });
});

describe("brand asset caching", () => {
  test("the server treats /brand/* as a long-lived asset", () => {
    expect(cacheClassFor("/brand/tire-master.jpg", 200)).toBe("asset");
  });

  test("the static export's _headers carries a /brand/* cache rule", () => {
    expect(headersFile({})).toContain("/brand/*");
  });
});
