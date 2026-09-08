// Server env validation: defaults, parsing, malformed values, production fail-fast.
import { describe, expect, test } from "bun:test";
import {
  readServerEnv,
  requireServerEnv,
  DEFAULT_LIVE_API_BASE,
  DEFAULT_PLAUSIBLE_HOST,
} from "../src/app/env.ts";

describe("readServerEnv", () => {
  test("empty env yields dev defaults with no problems", () => {
    const { config, problems, warnings } = readServerEnv({});
    expect(problems).toEqual([]);
    expect(warnings).toEqual([]);
    expect(config).toEqual({
      production: false,
      port: 3000,
      dataDir: "data",
      liveApiBase: DEFAULT_LIVE_API_BASE,
      plausibleDomain: null,
      plausibleHost: DEFAULT_PLAUSIBLE_HOST,
      enableRefreshCron: false,
      enableCanaryCron: false,
      enablePredictionsCron: false,
    enableEmailDigests: false,
    resendWebhookSecret: null,
    stripeWebhookSecret: null,
    pushConfigured: false,
    enablePushDispatcher: false,
      logRequests: false,
      appBaseUrl: null,
    });
  });

  test("APP_ENV=production flips production, and logRequests defaults on", () => {
    const { config } = readServerEnv({ APP_ENV: "production" });
    expect(config.production).toBe(true);
    expect(config.logRequests).toBe(true);
  });

  test("NODE_ENV=production also counts as production", () => {
    expect(readServerEnv({ NODE_ENV: "production" }).config.production).toBe(true);
  });

  test("valid overrides are honored, with trailing slashes trimmed off URLs", () => {
    const { config, problems } = readServerEnv({
      PORT: "8080",
      NASCAR_DATA_DIR: "/data",
      LIVE_API_BASE: "https://live.example.com/",
      PLAUSIBLE_DOMAIN: "example.com",
      PLAUSIBLE_HOST: "https://stats.example.com/",
      ENABLE_REFRESH_CRON: "1",
      LOG_REQUESTS: "true",
    });
    expect(problems).toEqual([]);
    expect(config.port).toBe(8080);
    expect(config.dataDir).toBe("/data");
    expect(config.liveApiBase).toBe("https://live.example.com");
    expect(config.plausibleDomain).toBe("example.com");
    expect(config.plausibleHost).toBe("https://stats.example.com");
    expect(config.enableRefreshCron).toBe(true);
    expect(config.logRequests).toBe(true);
  });

  test("non-numeric PORT is a problem and falls back to 3000", () => {
    const { config, problems } = readServerEnv({ PORT: "eight" });
    expect(problems).toEqual([`PORT must be an integer 0–65535, got "eight"`]);
    expect(config.port).toBe(3000);
  });

  test("out-of-range and fractional ports are problems", () => {
    expect(readServerEnv({ PORT: "70000" }).problems.length).toBe(1);
    expect(readServerEnv({ PORT: "80.5" }).problems.length).toBe(1);
    expect(readServerEnv({ PORT: "-1" }).problems.length).toBe(1);
  });

  test("non-URL LIVE_API_BASE is a problem and falls back to the default", () => {
    const { config, problems } = readServerEnv({ LIVE_API_BASE: "not a url" });
    expect(problems).toEqual([`LIVE_API_BASE must be an http(s) URL, got "not a url"`]);
    expect(config.liveApiBase).toBe(DEFAULT_LIVE_API_BASE);
  });

  test("non-http(s) schemes are rejected", () => {
    expect(readServerEnv({ LIVE_API_BASE: "ftp://x.example" }).problems.length).toBe(1);
    expect(readServerEnv({ PLAUSIBLE_HOST: "javascript:alert(1)" }).problems.length).toBe(1);
  });

  test("bad booleans are problems and fall back", () => {
    const cron = readServerEnv({ ENABLE_REFRESH_CRON: "yes" });
    expect(cron.problems).toEqual([`ENABLE_REFRESH_CRON must be 1/0/true/false, got "yes"`]);
    expect(cron.config.enableRefreshCron).toBe(false);
    const logs = readServerEnv({ LOG_REQUESTS: "maybe" });
    expect(logs.problems.length).toBe(1);
    expect(logs.config.logRequests).toBe(false);
  });

  test("production warns about absent optional capabilities; dev stays quiet", () => {
    const prod = readServerEnv({ APP_ENV: "production" });
    expect(prod.warnings).toEqual([
      "PLAUSIBLE_DOMAIN not set — analytics tag disabled",
      "CLOUDFLARE_API_TOKEN not set — refresh will skip the static-fallback publish",
      "LITESTREAM_REPLICA_URL not set — the db is NOT being replicated",
      "RESEND_API_KEY not set — verify/reset/alert emails will only be logged",
      "RESEND_WEBHOOK_SECRET not set — bounce/complaint suppression is disabled",
      "STRIPE_WEBHOOK_SECRET not set — Stripe billing webhooks are disabled",
      "STRIPE_SECRET_KEY not set — account deletion cannot cancel subscriptions at Stripe",
      "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — race push alerts are disabled",
    ]);
    expect(readServerEnv({}).warnings).toEqual([]);
  });

  test("APP_BASE_URL: optional in dev, required + validated in production (WS-D)", () => {
    expect(readServerEnv({}).config.appBaseUrl).toBeNull();
    expect(readServerEnv({}).problems).toEqual([]);
    const ok = readServerEnv({ APP_BASE_URL: "https://looplab.example/" });
    expect(ok.config.appBaseUrl).toBe("https://looplab.example");
    expect(readServerEnv({ APP_BASE_URL: "not a url" }).problems).toEqual([
      `APP_BASE_URL must be an http(s) URL, got "not a url"`,
    ]);
    const prod = readServerEnv({ APP_ENV: "production" });
    expect(prod.problems).toContain(
      "APP_BASE_URL is required in production (verify/reset email links)",
    );
    expect(() =>
      requireServerEnv({ APP_ENV: "production", APP_BASE_URL: "https://looplab.example" }),
    ).not.toThrow();
  });
});

describe("requireServerEnv", () => {
  test("throws in production on any malformed value, naming it", () => {
    expect(() => requireServerEnv({ APP_ENV: "production", PORT: "eight" })).toThrow(
      /PORT must be an integer/,
    );
  });

  test("does not throw in dev for the same malformed value", () => {
    const { config } = requireServerEnv({ PORT: "eight" });
    expect(config.port).toBe(3000);
  });
});
