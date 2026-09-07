// `bun run sync --source nascar-data` (WS-C): ingest official results from the
// nascaR.data Parquet release instead of the NASCAR CDN. App-layer composition:
// the provider downloads/parses the release, the data-ingestion domain supplies
// the joins (points-race ordinals, driver index) and the atomic writes, and the
// data-health domain does the pure mapping. Two modes:
//   - default: fill races that have no results yet (the actual fallback)
//   - --verify-last N: no writes; compare the release's rows for the last N
//     completed races against the CDN-ingested rows (finish, start, laps led)
//     — the WS-C acceptance evidence.
import type { Providers } from "../providers/index.ts";
import { ingestionService } from "../domains/data-ingestion/index.ts";
import { dataHealthService } from "../domains/data-health/index.ts";
import type { NascarDataRow } from "../domains/data-health/index.ts";
import { fetchSeriesRelease } from "../providers/nascar-data.ts";

export interface FallbackSyncOptions {
  seriesId: number;
  season: number;
  /** Compare-only mode: check the last N mapped races against stored CDN rows. */
  verifyLast?: number;
  /** Injectable release rows (tests); defaults to downloading the real release. */
  rows?: NascarDataRow[];
  log: { info: (m: string) => void; warn: (m: string) => void };
}

export interface VerifyMismatch {
  driverId: number;
  field: "finish" | "start" | "lapsLed";
  cdn: number | null;
  fallback: number | null;
}

export interface VerifyRaceReport {
  raceId: number;
  ordinal: number;
  compared: number;
  onlyInCdn: number;
  onlyInFallback: number;
  mismatches: VerifyMismatch[];
}

export interface FallbackSyncOutcome {
  mappedRaces: number;
  skippedRaces: Array<{ ordinal: number; reason: string }>;
  unmatchedDrivers: string[];
  racesWritten: number;
  rowsWritten: number;
  verify: VerifyRaceReport[] | null;
}

export async function fallbackSync(p: Providers, opts: FallbackSyncOptions): Promise<FallbackSyncOutcome> {
  const { log } = opts;
  const rows = opts.rows ?? (await fetchSeriesRelease(opts.seriesId));
  const seasonRows = rows.filter((r) => r.season === opts.season);
  const raceRefs = ingestionService.pointsRaceRefs(p, opts.season, opts.seriesId);
  const drivers = ingestionService.allDrivers(p);
  const mapping = dataHealthService.mapFallbackResults(seasonRows, raceRefs, drivers);

  for (const s of mapping.skippedRaces) log.warn(`ordinal ${s.ordinal} skipped: ${s.reason}`);
  if (mapping.unmatchedDrivers.length > 0)
    log.warn(`unmatched driver name(s), rows dropped: ${mapping.unmatchedDrivers.join(", ")}`);

  const outcome: FallbackSyncOutcome = {
    mappedRaces: mapping.races.length,
    skippedRaces: mapping.skippedRaces,
    unmatchedDrivers: mapping.unmatchedDrivers,
    racesWritten: 0,
    rowsWritten: 0,
    verify: null,
  };

  if (opts.verifyLast !== undefined) {
    const last = [...mapping.races].sort((a, b) => a.ordinal - b.ordinal).slice(-opts.verifyLast);
    outcome.verify = last.map((race) => {
      // finish 0 = withdrawn/DNQ entries the CDN keeps in the results array but
      // the release (rightly) omits — not comparable results.
      const cdn = new Map(
        ingestionService
          .raceResults(p, race.raceId)
          .filter((r) => r.finish > 0)
          .map((r) => [r.driverId, { finish: r.finish, start: r.start, lapsLed: r.lapsLed }]),
      );
      const report: VerifyRaceReport = {
        raceId: race.raceId,
        ordinal: race.ordinal,
        compared: 0,
        onlyInCdn: cdn.size,
        onlyInFallback: 0,
        mismatches: [],
      };
      for (const row of race.rows) {
        const official = cdn.get(row.driverId);
        if (!official) {
          report.onlyInFallback++;
          continue;
        }
        report.compared++;
        report.onlyInCdn--;
        if (official.finish !== row.finishingPosition)
          report.mismatches.push({ driverId: row.driverId, field: "finish", cdn: official.finish, fallback: row.finishingPosition });
        if (official.start !== row.startingPosition)
          report.mismatches.push({ driverId: row.driverId, field: "start", cdn: official.start, fallback: row.startingPosition });
        if (official.lapsLed !== row.lapsLed)
          report.mismatches.push({ driverId: row.driverId, field: "lapsLed", cdn: official.lapsLed, fallback: row.lapsLed });
      }
      const verdict = report.mismatches.length === 0 && report.onlyInCdn === 0 && report.onlyInFallback === 0 ? "✓ exact match" : `✗ ${report.mismatches.length} mismatch(es), ${report.onlyInCdn} only-CDN, ${report.onlyInFallback} only-fallback`;
      log.info(`race ${race.raceId} (ordinal ${race.ordinal}): ${report.compared} drivers compared — ${verdict}`);
      for (const m of report.mismatches)
        log.warn(`  driver ${m.driverId} ${m.field}: cdn=${m.cdn} fallback=${m.fallback}`);
      return report;
    });
    return outcome;
  }

  const missing = mapping.races.filter((r) => !ingestionService.raceHasResults(p, r.raceId));
  if (missing.length === 0) {
    log.info(`season ${opts.season}: every mapped points race already has results — nothing to fill`);
    return outcome;
  }
  const written = ingestionService.applyFallbackResults(p, missing, log);
  outcome.racesWritten = written.racesWritten;
  outcome.rowsWritten = written.rowsWritten;
  return outcome;
}
