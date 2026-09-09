// Railway infrastructure-as-code for the production server (launch plan D10 as
// amended by WS-B2 — this file is the `fly.toml` replacement).
//
// What the server needs from a host, and where each is satisfied below:
//   persistent /data   the db is a SQLite file that must survive restarts
//   exactly 1 replica  refresh / canary / predictions crons run IN-PROCESS;
//                      a second copy would double-run them, a sleeping one
//                      would never run them
//   no app sleep       same reason
//   /health check      already built, already returns the right shape
//
// Apply with:  railway config plan   (preview, changes nothing)
//              railway config apply  (asks before applying)

import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

// ---------------------------------------------------------------------------
// The one place a name lives.
//
// D2 (the product name) is still open — Spotter and Trioval were the September
// shortlist, and "LoopLab" was only ever a placeholder. The last time a
// placeholder got hardcoded it ended up in ~20 files, so everything
// name-bearing is derived from this object and nothing else.
//
// APP_BASE_URL deliberately holds a Railway *reference*, not a literal: Railway
// resolves ${{RAILWAY_PUBLIC_DOMAIN}} at deploy time to whatever domain the
// service actually has. So there is no placeholder domain to remember, and the
// verify/reset email links are correct from the first boot. When D2 lands and a
// custom domain is attached, `baseUrl` below becomes that domain — one line.
// ---------------------------------------------------------------------------
const APP = {
  project: "nascar-analytics",
  service: "web",
  volume: "nascar-data",
  region: "us-east4", // US East, closest to NASCAR's CDN and most of the audience
  baseUrl: "https://${{RAILWAY_PUBLIC_DOMAIN}}",

  // WS-B2 specifies 3072 (3 GB): nascar.db plus data/raw/**, the verbatim CDN
  // archive that is the insurance policy against the unofficial feed vanishing.
  // Railway's Trial plan hard-caps a volume at 500 MB (maxSizeMB in the
  // workspace plan limits), and an apply that asks for more fails the whole
  // change set. 500 holds the db and a season of archives — enough to prove the
  // deploy — so it stands until a payment method is on the account, then this
  // becomes 3072 and `railway volume update` grows it in place.
  volumeSizeMB: 500,
} as const;

export default defineRailway(() => {
  const data = volume(APP.volume, {
    sizeMB: APP.volumeSizeMB,
    region: APP.region,
  });

  const web = service(APP.service, {
    source: github("nhorto/NASCAR-Analytics", { branch: "main" }),

    // Build the repo's Dockerfile, not a detected buildpack: the image also
    // carries the Litestream binary, and scripts/docker-entrypoint.sh is what
    // restores-then-replicates around the server.
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },

    // No start command on purpose. The Dockerfile's ENTRYPOINT is
    // docker-entrypoint.sh; overriding it here would start bare `bun serve`
    // and silently drop Litestream replication — i.e. run with no backups
    // while looking perfectly healthy.
    healthcheck: "/health",
    healthcheckTimeout: 30,

    // Exactly one replica, pinned to one region. `replicas` is a region->count
    // map, which is also how the region is expressed — there is no separate
    // region field for a service.
    replicas: { [APP.region]: 1 },

    deploy: {
      sleepApplication: false, // the in-process crons must keep running between requests
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },

    // Keyed by MOUNT PATH, with the volume as the value. Keying by volume name
    // and passing { mountPath } instead is accepted silently and produces a
    // volume attached to no service, mounted at /tmp — i.e. a server whose
    // SQLite db quietly lives on ephemeral container disk.
    volumeMounts: { "/data": data },

    env: {
      APP_ENV: "production",
      NASCAR_DATA_DIR: "/data",
      PORT: "8080",
      APP_BASE_URL: APP.baseUrl,

      // In-process crons (D18 / WS-C / WS-F). These are the reason the service
      // must never sleep and must never run two replicas.
      ENABLE_REFRESH_CRON: "1", // Monday 12:00 UTC
      ENABLE_CANARY_CRON: "1", // daily 09:00 UTC upstream-feed check
      ENABLE_PREDICTIONS_CRON: "1", // Thursday 16:00 + Saturday 22:00 UTC

      // Off until the owner steps behind them are done. With digests on and no
      // Resend key, every digest is a logged failure rather than an email
      // (A4); the push dispatcher needs the VAPID pair (J5/WS-H).
      ENABLE_EMAIL_DIGESTS: "0",
      ENABLE_PUSH_DISPATCHER: "0",

      // Secrets: set with `railway variables --set NAME=value`, never here.
      // preserve() declares that this config knows about them and must not
      // clear them on apply — without these lines, `railway config apply`
      // treats the env block as the whole truth and deletes anything it does
      // not mention, which for LITESTREAM_REPLICA_URL means silently dropping
      // replication.
      LITESTREAM_REPLICA_URL: preserve(),
      LITESTREAM_ACCESS_KEY_ID: preserve(),
      LITESTREAM_SECRET_ACCESS_KEY: preserve(),
      CLOUDFLARE_API_TOKEN: preserve(), // static-fallback deploy leg of the refresh
      RESEND_API_KEY: preserve(),
      RESEND_WEBHOOK_SECRET: preserve(),
      EMAIL_FROM: preserve(),
      ALERT_EMAIL_TO: preserve(), // canary + error alerts to the owner
      STRIPE_SECRET_KEY: preserve(),
      STRIPE_WEBHOOK_SECRET: preserve(),
      REVENUECAT_WEBHOOK_SECRET: preserve(),
      VAPID_PUBLIC_KEY: preserve(),
      VAPID_PRIVATE_KEY: preserve(),
      VAPID_SUBJECT: preserve(),
      PLAUSIBLE_DOMAIN: preserve(),
    },
  });

  return project(APP.project, { resources: [data, web] });
});
