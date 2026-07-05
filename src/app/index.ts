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
    await ingestionService.syncLatest(p, argValue("--series", ingestionConfig.SERIES.cup), log);
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
    const p = providers();
    const port = argValue("--port", 3000);
    const { createServer } = await import("./server.ts");
    const server = createServer(p, port);
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

    if (process.argv.includes("--no-deploy")) {
      console.log("--no-deploy set — skipping deploy (dist/ is ready).");
      break;
    }
    if (!process.env.CLOUDFLARE_API_TOKEN) {
      console.log("CLOUDFLARE_API_TOKEN not set — skipping deploy (dist/ is ready to upload).");
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
    console.log("✓ deployed");
    break;
  }
  default:
    console.log(`nascar-analytics CLI

Usage:
  bun run src/app/index.ts backfill [--from YEAR] [--to YEAR] [--series ID] [--force]
  bun run src/app/index.ts sync [--series ID]
  bun run src/app/index.ts status [--series ID]
  bun run src/app/index.ts compute [--series ID]
  bun run src/app/index.ts driver --name "Chase Elliott" | --id 4062 [--series ID]
  bun run src/app/index.ts serve [--port 3000]
  bun run src/app/index.ts export
  bun run src/app/index.ts capture [--series ID] [--interval SEC] [--ticks N] [--out DIR]  # capture live feed
  bun run src/app/index.ts refresh [--no-deploy]   # backfill+compute+export+deploy, all series

Env: NASCAR_DATA_DIR (default data), NASCAR_PAGES_PROJECT (default looplab),
     CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (enable the deploy step)`);
    if (command !== undefined) process.exit(1);
}
