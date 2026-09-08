// Typed server configuration from the process environment. `readServerEnv`
// never throws — malformed values come back as `problems` so the CLI can
// decide: production boots fail fast on any problem (`requireServerEnv`),
// dev falls back to defaults and keeps going.

export interface ServerConfig {
  /** APP_ENV=production or NODE_ENV=production. Gates HSTS, fail-fast, request logs. */
  production: boolean;
  port: number;
  dataDir: string;
  /** Origin of the live-companion Worker; overridable so the page + CSP move together. */
  liveApiBase: string;
  plausibleDomain: string | null;
  plausibleHost: string;
  /** Run the weekly refresh cron in-process (launch plan D18). */
  enableRefreshCron: boolean;
  /** Run the daily upstream-feed canary in-process (launch plan WS-C). */
  enableCanaryCron: boolean;
  /** Run the Thursday/Saturday predictions crons in-process (WS-F). */
  enablePredictionsCron: boolean;
  /** Send the Monday recap / Thursday preview digests after refresh/predict
   *  runs (WS-G). Off by default so no mail leaves a machine by accident. */
  enableEmailDigests: boolean;
  /** Resend webhook signing secret (bounce/complaint suppression, WS-G).
   *  Null leaves /webhooks/resend answering 503 instead of trusting input. */
  resendWebhookSecret: string | null;
  /** Stripe webhook signing secret (entitlement source of truth, WS-E).
   *  Null leaves /webhooks/stripe answering 503 instead of trusting input. */
  stripeWebhookSecret: string | null;
  /** RevenueCat webhook shared secret (the second entitlement writer, WS-J).
   *  Null leaves /webhooks/revenuecat answering 503 instead of trusting
   *  input; unset until the owner has a RevenueCat account (J1). */
  revenuecatWebhookSecret: string | null;
  /** True when both VAPID keys are present — push is offered only then (WS-H). */
  pushConfigured: boolean;
  /** Poll the live Worker and push race alerts to subscribers (WS-H). */
  enablePushDispatcher: boolean;
  /** Emit a JSON log line per request. Defaults to `production`. */
  logRequests: boolean;
  /** Absolute origin for links in auth emails (WS-D). Null → derived from the
   *  bound port in dev; required in production (verify/reset links break
   *  silently otherwise). */
  appBaseUrl: string | null;
}

export const DEFAULT_LIVE_API_BASE = "https://looplab-live.nhorton.workers.dev";
export const DEFAULT_PLAUSIBLE_HOST = "https://plausible.io";

export interface ServerEnvResult {
  config: ServerConfig;
  /** Malformed values (wrong type/shape). Fatal in production. */
  problems: string[];
  /** Missing-but-optional capabilities worth a boot log line. */
  warnings: string[];
}

type Env = Record<string, string | undefined>;

function parseBool(raw: string | undefined, fallback: boolean): boolean | null {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return null;
}

function validUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function readServerEnv(env: Env): ServerEnvResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  const production = env.APP_ENV === "production" || env.NODE_ENV === "production";

  let port = 3000;
  if (env.PORT !== undefined && env.PORT !== "") {
    const parsed = Number.parseInt(env.PORT, 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 65535 || String(parsed) !== env.PORT.trim()) {
      problems.push(`PORT must be an integer 0–65535, got "${env.PORT}"`);
    } else {
      port = parsed;
    }
  }

  let liveApiBase = DEFAULT_LIVE_API_BASE;
  if (env.LIVE_API_BASE) {
    if (validUrl(env.LIVE_API_BASE)) liveApiBase = env.LIVE_API_BASE.replace(/\/$/, "");
    else problems.push(`LIVE_API_BASE must be an http(s) URL, got "${env.LIVE_API_BASE}"`);
  }

  let plausibleHost = DEFAULT_PLAUSIBLE_HOST;
  if (env.PLAUSIBLE_HOST) {
    if (validUrl(env.PLAUSIBLE_HOST)) plausibleHost = env.PLAUSIBLE_HOST.replace(/\/$/, "");
    else problems.push(`PLAUSIBLE_HOST must be an http(s) URL, got "${env.PLAUSIBLE_HOST}"`);
  }

  let appBaseUrl: string | null = null;
  if (env.APP_BASE_URL) {
    if (validUrl(env.APP_BASE_URL)) appBaseUrl = env.APP_BASE_URL.replace(/\/$/, "");
    else problems.push(`APP_BASE_URL must be an http(s) URL, got "${env.APP_BASE_URL}"`);
  } else if (production) {
    problems.push("APP_BASE_URL is required in production (verify/reset email links)");
  }

  const enableRefreshCron = parseBool(env.ENABLE_REFRESH_CRON, false);
  if (enableRefreshCron === null)
    problems.push(`ENABLE_REFRESH_CRON must be 1/0/true/false, got "${env.ENABLE_REFRESH_CRON}"`);

  const enableCanaryCron = parseBool(env.ENABLE_CANARY_CRON, false);
  if (enableCanaryCron === null)
    problems.push(`ENABLE_CANARY_CRON must be 1/0/true/false, got "${env.ENABLE_CANARY_CRON}"`);

  const enablePredictionsCron = parseBool(env.ENABLE_PREDICTIONS_CRON, false);
  if (enablePredictionsCron === null)
    problems.push(`ENABLE_PREDICTIONS_CRON must be 1/0/true/false, got "${env.ENABLE_PREDICTIONS_CRON}"`);

  const enableEmailDigests = parseBool(env.ENABLE_EMAIL_DIGESTS, false);
  if (enableEmailDigests === null)
    problems.push(`ENABLE_EMAIL_DIGESTS must be 1/0/true/false, got "${env.ENABLE_EMAIL_DIGESTS}"`);

  const enablePushDispatcher = parseBool(env.ENABLE_PUSH_DISPATCHER, false);
  if (enablePushDispatcher === null)
    problems.push(`ENABLE_PUSH_DISPATCHER must be 1/0/true/false, got "${env.ENABLE_PUSH_DISPATCHER}"`);

  const logRequests = parseBool(env.LOG_REQUESTS, production);
  if (logRequests === null)
    problems.push(`LOG_REQUESTS must be 1/0/true/false, got "${env.LOG_REQUESTS}"`);

  if (production) {
    if (!env.PLAUSIBLE_DOMAIN) warnings.push("PLAUSIBLE_DOMAIN not set — analytics tag disabled");
    if (!env.CLOUDFLARE_API_TOKEN)
      warnings.push("CLOUDFLARE_API_TOKEN not set — refresh will skip the static-fallback publish");
    if (!env.LITESTREAM_REPLICA_URL)
      warnings.push("LITESTREAM_REPLICA_URL not set — the db is NOT being replicated");
    if (!env.RESEND_API_KEY)
      warnings.push("RESEND_API_KEY not set — verify/reset/alert emails will only be logged");
    if (!env.RESEND_WEBHOOK_SECRET)
      warnings.push("RESEND_WEBHOOK_SECRET not set — bounce/complaint suppression is disabled");
    if (!env.STRIPE_WEBHOOK_SECRET)
      warnings.push("STRIPE_WEBHOOK_SECRET not set — Stripe billing webhooks are disabled");
    if (!env.STRIPE_SECRET_KEY)
      warnings.push("STRIPE_SECRET_KEY not set — account deletion cannot cancel subscriptions at Stripe");
    if (!env.REVENUECAT_WEBHOOK_SECRET)
      warnings.push("REVENUECAT_WEBHOOK_SECRET not set — RevenueCat billing webhooks are disabled (WS-J, owner-gated)");
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY)
      warnings.push("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — race push alerts are disabled");
  }

  return {
    config: {
      production,
      port,
      dataDir: env.NASCAR_DATA_DIR ?? "data",
      liveApiBase,
      plausibleDomain: env.PLAUSIBLE_DOMAIN || null,
      plausibleHost,
      enableRefreshCron: enableRefreshCron ?? false,
      enableCanaryCron: enableCanaryCron ?? false,
      enablePredictionsCron: enablePredictionsCron ?? false,
      enableEmailDigests: enableEmailDigests ?? false,
      resendWebhookSecret: env.RESEND_WEBHOOK_SECRET || null,
      stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || null,
      revenuecatWebhookSecret: env.REVENUECAT_WEBHOOK_SECRET || null,
      pushConfigured: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
      enablePushDispatcher: enablePushDispatcher ?? false,
      logRequests: logRequests ?? production,
      appBaseUrl,
    },
    problems,
    warnings,
  };
}

/** Boot-time entry: fail fast in production on malformed env; warn otherwise. */
export function requireServerEnv(env: Env): ServerEnvResult {
  const result = readServerEnv(env);
  if (result.config.production && result.problems.length > 0) {
    throw new Error(`Invalid server environment:\n  - ${result.problems.join("\n  - ")}`);
  }
  return result;
}
