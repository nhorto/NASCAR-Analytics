import { createProviders } from "../providers/index.ts";
import { ingestionService, ingestionConfig } from "../domains/data-ingestion/index.ts";
import { analyticsService } from "../domains/analytics/index.ts";
import { driversService } from "../domains/drivers/index.ts";

// Where the DB + raw archive live. Overridable so a Cloudflare Container (or any
// other runner) can point at an R2-synced volume without code changes.
const DATA_DIR = process.env.NASCAR_DATA_DIR ?? "data";
const DB_PATH = `${DATA_DIR}/nascar.db`;

function providers() {
  return createProviders({
    dbPath: DB_PATH,
    archiveDir: `${DATA_DIR}/raw`,
    cdn: {
      delayMs: ingestionConfig.FETCH_DELAY_MS,
      retries: ingestionConfig.FETCH_RETRIES,
      retryBaseDelayMs: ingestionConfig.FETCH_RETRY_BASE_DELAY_MS,
      userAgent: ingestionConfig.USER_AGENT,
    },
  });
}

const log = {
  info: (m: string) => console.log(m),
  warn: (m: string) => console.warn(`⚠ ${m}`),
};

function argValue(flag: string, fallback: number): number {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  const raw = process.argv[idx + 1];
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    console.error(`Invalid value for ${flag}: ${raw}`);
    process.exit(1);
  }
  return parsed;
}

function argString(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const raw = process.argv[idx + 1];
  if (raw === undefined) {
    console.error(`Missing value for ${flag}`);
    process.exit(1);
  }
  return raw;
}

function fmt(n: number | null, digits = 1): string {
  return n === null ? "-" : n.toFixed(digits);
}

const command = process.argv[2];

switch (command) {
  case "backfill": {
    const p = providers();
    await ingestionService.backfill(
      p,
      {
        fromSeason: argValue("--from", ingestionConfig.BACKFILL_FIRST_SEASON),
        toSeason: argValue("--to", new Date().getUTCFullYear()),
        seriesId: argValue("--series", ingestionConfig.SERIES.cup),
        force: process.argv.includes("--force"),
      },
      log,
    );
    break;
  }
  case "sync": {
    const p = providers();
    const seriesId = argValue("--series", ingestionConfig.SERIES.cup);
    const source = argString("--source");
    if (source === "nascar-data") {
      // WS-C fallback path: official results from the nascaR.data Parquet
      // release instead of the CDN. --verify-last N compares instead of writing.
      const { fallbackSync } = await import("./fallback-sync.ts");
      const verifyIdx = process.argv.indexOf("--verify-last");
      await fallbackSync(p, {
        seriesId,
        season: argValue("--season", new Date().getUTCFullYear()),
        verifyLast: verifyIdx === -1 ? undefined : argValue("--verify-last", 3),
        log,
      });
      break;
    }
    if (source !== null) {
      console.error(`Unknown --source "${source}" (supported: nascar-data)`);
      process.exit(1);
    }
    await ingestionService.syncLatest(p, seriesId, log);
    break;
  }
  case "status": {
    const p = providers();
    const rows = ingestionService.coverage(p, argValue("--series", ingestionConfig.SERIES.cup));
    if (rows.length === 0) {
      console.log("No data ingested yet. Run: bun run backfill");
      break;
    }
    console.log("season  scheduled  results  loopstats  laptimes");
    for (const r of rows) {
      console.log(
        `${String(r.season).padEnd(7)} ${String(r.scheduledRaces).padEnd(10)} ` +
          `${String(r.racesWithResults).padEnd(8)} ${String(r.racesWithLoopStats).padEnd(10)} ` +
          `${r.racesWithLapTimes}`,
      );
    }
    break;
  }
  case "compute": {
    const p = providers();
    const s = analyticsService.computeAll(p, argValue("--series", ingestionConfig.SERIES.cup), log);
    console.log(
      `computed: ${s.seasonStatsRows} season rows, ${s.trackTypeStatsRows} track-type rows, ` +
        `${s.formRows} form rows, ${s.raceStandoutRows} race-standout rows ` +
        `(from ${s.resultRows} results, ${s.loopRows} loop rows)`,
    );
    break;
  }
  case "driver": {
    const p = providers();
    const seriesId = argValue("--series", ingestionConfig.SERIES.cup);
    const name = argString("--name");
    const query = name ?? argValue("--id", -1);
    if (query === -1) {
      console.error(`Usage: driver --name "Chase Elliott" | --id 4062 [--series ID]`);
      process.exit(1);
    }
    const d = driversService.findDriver(p, query, seriesId);
    if (!d) {
      console.error(`No driver found for: ${query}`);
      process.exit(1);
    }
    console.log(
      `${d.fullName} (#${d.latestCarNumber ?? "?"}, ${d.latestTeam ?? "?"}) — ` +
        `${d.races} points races ${d.firstSeason}–${d.lastSeason}, ${d.wins} wins\n`,
    );
    const seasons = analyticsService.seasonStatsForDriver(p, d.driverId, seriesId);
    if (seasons.length === 0) {
      console.log("No computed stats yet. Run: bun run compute");
      break;
    }
    console.log("season  races  wins  top5  top10  avgFin  rating  adjPE  closer");
    for (const s of seasons) {
      console.log(
        `${String(s.season).padEnd(7)} ${String(s.races).padEnd(6)} ${String(s.wins).padEnd(5)} ` +
          `${String(s.top5s).padEnd(5)} ${String(s.top10s).padEnd(6)} ` +
          `${fmt(s.avgFinish).padEnd(7)} ${fmt(s.avgRating).padEnd(7)} ` +
          `${fmt(s.adjPassEfficiency).padEnd(6)} ${fmt(s.closerScore, 2)}`,
      );
    }
    break;
  }
  case "serve": {
    // Production entrypoint (and still the dev server). Env is validated up
    // front — a malformed value refuses to boot in production; the in-process
    // weekly-refresh cron (launch plan D18) arms when ENABLE_REFRESH_CRON is set.
    const { requireServerEnv } = await import("./env.ts");
    const { config, problems, warnings } = requireServerEnv(process.env);
    for (const w of warnings) log.warn(w);
    for (const prob of problems) log.warn(`env: ${prob} (using default)`);
    const p = providers();
    const port = argValue("--port", config.port);
    const { createServer } = await import("./server.ts");
    const server = createServer(p, port, config);
    if (config.enableRefreshCron) {
      const { startRefreshScheduler } = await import("./scheduler.ts");
      startRefreshScheduler({ db: p.db, log });
    }
    if (config.enableCanaryCron) {
      const { startCanaryScheduler } = await import("./scheduler.ts");
      startCanaryScheduler({ log });
    }
    console.log(`Looplab running at ${server.url}`);
    break;
  }
  case "export": {
    const { exportSite } = await import("./export.ts");
    const { pages } = await exportSite(DB_PATH, log);
    console.log(`Exported ${pages} pages to dist/`);
    break;
  }
  case "capture": {
    // Live-feed capture for the race companion. Poll the CDN live feed and save
    // raw snapshots (feed + flag + pit) for parser validation / fixtures.
    const series = process.argv.includes("--series") ? argValue("--series", 1) : undefined;
    const intervalMs = argValue("--interval", 5) * 1000;
    const ticks = argValue("--ticks", 0); // 0 = until Ctrl-C
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = argString("--out") ?? `${DATA_DIR}/captures/${stamp}`;
    const { captureLive } = await import("./capture.ts");
    await captureLive({ series, intervalMs, ticks, outDir, log });
    break;
  }
  case "canary": {
    // Upstream-feed health: every CDN endpoint pattern we depend on, checked
    // against our own normalizers for the latest completed race + live feeds.
    // Non-zero exit on any failure so a scheduler can alert (see canary.ts).
    const series = argValue("--series", ingestionConfig.SERIES.cup);
    const jsonOut = argString("--json");
    const { runCanary, recordAndAlert } = await import("./canary.ts");
    const { dataHealthService } = await import("../domains/data-health/index.ts");
    const { emailClientFromEnv } = await import("../providers/email.ts");
    const report = await runCanary({ seriesId: series });
    console.log(dataHealthService.formatReport(report));
    if (jsonOut) await Bun.write(jsonOut, JSON.stringify(report, null, 2));
    // v1: persist to feed_status; email the owner when a check crosses the
    // consecutive-failure threshold (no-ops to a log line without a Resend key).
    const outcome = await recordAndAlert(providers(), report, emailClientFromEnv(process.env, log.warn));
    if (outcome.alerted.length > 0)
      log.warn(`ALERT sent for ${outcome.alerted.map((o) => o.checkId).join(", ")} — ${outcome.emailDetail}`);
    else if (outcome.outages.length > 0)
      log.warn(`ongoing outage (already alerted): ${outcome.outages.map((o) => o.checkId).join(", ")}`);
    if (!report.healthy) process.exit(1);
    break;
  }
  case "grant": {
    // Manual Pro grants for testers/support (spec §7 `grant` source; pulled
    // forward from WS-E so WS-D gating is testable end to end).
    const email = argString("--email");
    if (!email) {
      console.error(`Usage: grant --email a@b.c [--until 2027-12-31] [--revoke]`);
      process.exit(1);
    }
    const { accountsService } = await import("../domains/accounts/index.ts");
    const { billingService } = await import("../domains/billing/index.ts");
    const p = providers();
    const user = accountsService.findUserByEmail(p, email!);
    if (!user) {
      console.error(`No account for ${email}`);
      process.exit(1);
    }
    if (process.argv.includes("--revoke")) {
      billingService.revoke(p, user.userId);
      console.log(`✓ revoked Pro for ${user.email}`);
      break;
    }
    const until = argString("--until") ?? `${new Date().getUTCFullYear() + 1}-12-31T23:59:59Z`;
    const e = billingService.grantPro(p, user.userId, until, "grant", new Date());
    console.log(`✓ ${user.email} is Pro until ${e.proUntil} (source: grant)`);
    break;
  }
  case "refresh": {
    // The portable weekend loop: backfill -> compute (all series) -> export ->
    // deploy. This is the single command any scheduler runs (GitHub Actions now,
    // a Cloudflare Container later). Deploy self-gates on CLOUDFLARE_API_TOKEN.
    const allSeries = [
      ingestionConfig.SERIES.cup,
      ingestionConfig.SERIES.xfinity,
      ingestionConfig.SERIES.trucks,
    ];
    const toSeason = new Date().getUTCFullYear();
    const p = providers();

    for (const seriesId of allSeries) {
      log.info(`\n▶ backfill series ${seriesId} (${ingestionConfig.BACKFILL_FIRST_SEASON}–${toSeason})`);
      await ingestionService.backfill(
        p,
        { fromSeason: ingestionConfig.BACKFILL_FIRST_SEASON, toSeason, seriesId },
        log,
      );
    }
    for (const seriesId of allSeries) {
      const s = analyticsService.computeAll(p, seriesId, log);
      log.info(`▶ computed series ${seriesId}: ${s.seasonStatsRows} season, ${s.raceStandoutRows} standout rows`);
    }

    const { exportSite } = await import("./export.ts");
    const { pages } = await exportSite(DB_PATH, log);
    log.info(`▶ exported ${pages} pages to dist/`);

    // Keep the edge model in lockstep with the freshly computed dataset.
    // Calibration fails safely if the required raw pit archives are absent.
    const runStep = async (args: string[], label: string, cwd?: string) => {
      log.info(`▶ ${label}`);
      const child = Bun.spawn(args, {
        cwd,
        stdout: "inherit",
        stderr: "inherit",
        env: process.env,
      });
      const childCode = await child.exited;
      if (childCode !== 0) throw new Error(`${label} exited ${childCode}`);
    };
    await runStep(["bun", "run", "scripts/gen-worker-baselines.ts"], "regenerating Worker baselines");
    for (const seriesId of allSeries) {
      await runStep(
        ["bun", "run", "calibrate", "--series", String(seriesId)],
        `calibrating Worker strategy for series ${seriesId}`,
      );
    }

    if (process.argv.includes("--no-deploy")) {
      console.log("--no-deploy set — skipping Pages and Worker deploys (artifacts are ready).");
      break;
    }
    if (!process.env.CLOUDFLARE_API_TOKEN) {
      console.log("CLOUDFLARE_API_TOKEN not set — skipping Pages and Worker deploys (artifacts are ready).");
      break;
    }
    const project = process.env.NASCAR_PAGES_PROJECT ?? "looplab";
    log.info(`▶ deploying dist/ to Cloudflare Pages project "${project}"`);
    const proc = Bun.spawn(
      ["bunx", "wrangler", "pages", "deploy", "dist", `--project-name=${project}`],
      { stdout: "inherit", stderr: "inherit", env: process.env },
    );
    const code = await proc.exited;
    if (code !== 0) {
      console.error(`wrangler deploy exited ${code}`);
      process.exit(code || 1);
    }
    console.log("✓ Pages deployed");

    await runStep(["bunx", "wrangler", "deploy"], "deploying live Worker", "worker");
    console.log("✓ live Worker deployed");
    break;
  }
  default:
    console.log(`nascar-analytics CLI

Usage:
  bun run src/app/index.ts backfill [--from YEAR] [--to YEAR] [--series ID] [--force]
  bun run src/app/index.ts sync [--series ID] [--source nascar-data [--season YEAR] [--verify-last N]]
  bun run src/app/index.ts status [--series ID]
  bun run src/app/index.ts compute [--series ID]
  bun run src/app/index.ts driver --name "Chase Elliott" | --id 4062 [--series ID]
  bun run src/app/index.ts serve [--port 3000]
  bun run src/app/index.ts export
  bun run src/app/index.ts capture [--series ID] [--interval SEC] [--ticks N] [--out DIR]  # capture live feed
  bun run src/app/index.ts canary [--series ID] [--json PATH]   # upstream-feed health check (exit 1 on failure)
  bun run src/app/index.ts grant --email a@b.c [--until ISO] [--revoke]   # manual Pro grant (testers)
  bun run src/app/index.ts refresh [--no-deploy]   # data+site+Worker artifacts; deploy both, all series

Env: NASCAR_DATA_DIR (default data), NASCAR_PAGES_PROJECT (default looplab),
     CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (enable Pages + Worker deploys)
serve env: APP_ENV=production (strict env + HSTS + request logs), PORT,
     APP_BASE_URL (auth email links; required in production),
     LIVE_API_BASE, PLAUSIBLE_DOMAIN [+ PLAUSIBLE_HOST],
     ENABLE_REFRESH_CRON=1 (in-process Monday 12:00 UTC refresh),
     ENABLE_CANARY_CRON=1 (in-process daily 09:00 UTC canary), LOG_REQUESTS
canary env: RESEND_API_KEY + ALERT_EMAIL_TO [+ EMAIL_FROM] (owner outage emails)`);
    if (command !== undefined) process.exit(1);
}
