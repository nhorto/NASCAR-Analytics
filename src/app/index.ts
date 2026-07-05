import { createProviders } from "../providers/index.ts";
import { ingestionService, ingestionConfig } from "../domains/data-ingestion/index.ts";

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
  default:
    console.log(`nascar-analytics ingestion CLI

Usage:
  bun run src/app/index.ts backfill [--from YEAR] [--to YEAR] [--series ID] [--force]
  bun run src/app/index.ts sync [--series ID]
  bun run src/app/index.ts status [--series ID]`);
    if (command !== undefined) process.exit(1);
}
