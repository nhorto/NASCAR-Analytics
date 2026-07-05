import { createProviders } from "../providers/index.ts";
import { ingestionService, ingestionConfig } from "../domains/data-ingestion/index.ts";
import { analyticsService } from "../domains/analytics/index.ts";
import { driversService } from "../domains/drivers/index.ts";

const DATA_DIR = "data";

function providers() {
  return createProviders({
    dbPath: `${DATA_DIR}/nascar.db`,
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
    const { pages } = await exportSite(`${DATA_DIR}/nascar.db`, log);
    console.log(`Exported ${pages} pages to dist/`);
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
  bun run src/app/index.ts export`);
    if (command !== undefined) process.exit(1);
}
