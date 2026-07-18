// Calibrate per-track strategy constants from the historical backfill and bake
// them for the edge live model:
//   • typicalStintLaps — median clean green-flag run (behavioral pit cadence)
//   • tireSeconds/tirePerLap/tireTier — tire severity from the pit-DISCONTINUITY
//     (fresh-vs-worn lap time), which orders tracks correctly where a within-stint
//     OLS slope does not (fuel-burn-confounded; removed after the 2026-07-05 validation).
//
//   bun run calibrate [--series 1] [--min-races 3]
//
// Reads the backfill DB (lap_times, cautions, races, results) plus the raw
// archived weekend-feed.json pit_reports, runs the PURE extraction functions in
// the live domain (reconstructStints / greenStintLengths / tireDropForStop /
// tireTierOf / median), aggregates per track / track-type, and writes
// dist/data/track-strategy-{series}.json + regenerates worker/track-strategy.ts.
//
// MUST run where the backfill exists (locally). See
// docs/exec-plans/active/2026-07-06-strategy-model-calibration.md.
import { Database } from "bun:sqlite";
import { liveService, liveConfig } from "../src/domains/live/index.ts";
import type {
  NormalizedPitStop,
  Stint,
  TireTier,
  TrackStrategy,
  TrackStrategyTable,
} from "../src/domains/live/index.ts";

const DATA_DIR = process.env.NASCAR_DATA_DIR ?? "data";
const DB_PATH = `${DATA_DIR}/nascar.db`;
const arg = (flag: string, fallback: number) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : Number.parseInt(process.argv[i + 1] ?? "", 10) || fallback;
};
const SERIES = arg("--series", 1);
const MIN_RACES = arg("--min-races", 3);
// Refuse to (re)bake unless this many races had parseable pit archives. The raw
// weekend-feed archives exist only where the full backfill ran (locally) — CI
// keeps just the DB, so a CI run sees ≤ a handful of new races and would bake a
// near-empty table over the good committed one. Local calibrations see 100+.
const MIN_PIT_RACES = arg("--min-pit-races", 10);
// Drop worn−fresh gaps beyond this (sec) — lapped traffic / damage / pit-cycle
// artifacts, not tire wear. Real tire deg tops out ~2s even at Darlington.
const TIRE_DROP_CAP_SEC = 8;

/**
 * Normalize the historical weekend-feed `pit_reports` to the shared shape.
 * Validated locally (2026-07-05): 256/909 archives carry non-empty pit_reports
 * with these keys. No `driver_id` in pit_reports (only `driver_name`) — the tire
 * join uses results.car_number → driver_id instead.
 */
function pitStopsFromWeekendPitReports(reports: any[]): NormalizedPitStop[] {
  if (!Array.isArray(reports)) return [];
  const pick = (o: any, keys: string[]) => {
    for (const k of keys) if (o[k] != null) return o[k];
    return undefined;
  };
  const out: NormalizedPitStop[] = [];
  for (const r of reports) {
    const lap = Number(pick(r, ["lap_count", "pit_in_lap_count", "leader_lap", "lap"])) || 0;
    if (lap <= 0) continue;
    const tires = [
      r.left_front_tire_changed, r.left_rear_tire_changed,
      r.right_front_tire_changed, r.right_rear_tire_changed,
    ].filter(Boolean).length;
    out.push({
      carNumber: String(pick(r, ["vehicle_number", "car_number"]) ?? ""),
      driverId: pick(r, ["driver_id", "nascar_driver_id"]) ?? null,
      lap,
      flagStatus: Number(pick(r, ["pit_in_flag_status", "flag_status"]) ?? 0),
      tiresChanged: tires,
    });
  }
  return out;
}

interface RaceRow { race_id: number; track_id: number; track_type: string; season: number; actual_laps: number | null }

const db = new Database(DB_PATH, { readonly: true });
const races = db
  .query<RaceRow, [number]>(
    `SELECT race_id, track_id, track_type, season, actual_laps
       FROM races WHERE series_id = ? AND actual_laps IS NOT NULL ORDER BY season, race_id`,
  )
  .all(SERIES);

// Accumulate per track.
interface Acc { trackType: string; greenStints: number[]; tireDrops: number[]; races: Set<number> }
const byTrack = new Map<number, Acc>();
let racesWithPits = 0, totalPitStops = 0;

for (const race of races) {
  const laps = race.actual_laps ?? 0;
  if (laps <= 0) continue;

  // Pit stops → stints → clean green typical-run samples.
  const archivePath = `${DATA_DIR}/raw/${race.season}/${SERIES}/${race.race_id}/weekend-feed.json`;
  const file = Bun.file(archivePath);
  let pits: NormalizedPitStop[] = [];
  if (await file.exists()) {
    try {
      const wf = await file.json();
      const reports = wf?.weekend_race?.[0]?.pit_reports ?? [];
      pits = pitStopsFromWeekendPitReports(reports);
    } catch { /* skip unreadable archive */ }
  }
  if (!pits.length) continue;
  racesWithPits++; totalPitStops += pits.length;

  const stints: Stint[] = liveService.reconstructStints(pits, laps);
  const greens = liveService.greenStintLengths(stints);

  // Tire severity: worn−fresh lap-time gap across each GREEN 4-tire stop.
  // Need green-lap awareness + a per-driver lap-time lookup for the race.
  const cautions = db
    .query<{ start_lap: number; end_lap: number }, [number]>(
      `SELECT start_lap, end_lap FROM cautions WHERE race_id = ?`,
    )
    .all(race.race_id);
  const isGreenLap = (lap: number) => !cautions.some((c) => lap >= c.start_lap && lap <= c.end_lap);

  const carToDriver = new Map<string, number>();
  for (const r of db
    .query<{ car_number: string; driver_id: number }, [number]>(
      `SELECT car_number, driver_id FROM results WHERE race_id = ?`,
    )
    .all(race.race_id)) {
    if (r.car_number != null) carToDriver.set(String(r.car_number), r.driver_id);
  }

  // Preload the race's lap times, keyed driverId → (lap → lapTime).
  const lapByDriver = new Map<number, Map<number, number>>();
  for (const l of db
    .query<{ driver_id: number; lap: number; lap_time: number | null }, [number]>(
      `SELECT driver_id, lap, lap_time FROM lap_times WHERE race_id = ?`,
    )
    .all(race.race_id)) {
    if (l.lap_time == null) continue;
    let m = lapByDriver.get(l.driver_id);
    if (!m) { m = new Map(); lapByDriver.set(l.driver_id, m); }
    m.set(l.lap, l.lap_time);
  }

  const tireDrops: number[] = [];
  for (const p of pits) {
    if (p.flagStatus !== liveConfig.PIT_FLAG_GREEN || p.tiresChanged < 4) continue; // green 4-tire only
    const driverId = carToDriver.get(p.carNumber);
    if (driverId == null) continue;
    const laptimes = lapByDriver.get(driverId);
    if (!laptimes) continue;
    const drop = liveService.tireDropForStop(p.lap, {
      lapTimeAt: (lap) => laptimes.get(lap) ?? null,
      isGreenLap,
    });
    if (drop != null && Math.abs(drop) < TIRE_DROP_CAP_SEC) tireDrops.push(drop);
  }

  const acc = byTrack.get(race.track_id) ?? { trackType: race.track_type, greenStints: [], tireDrops: [], races: new Set() };
  acc.greenStints.push(...greens);
  acc.tireDrops.push(...tireDrops);
  acc.races.add(race.race_id);
  byTrack.set(race.track_id, acc);
}

if (racesWithPits < MIN_PIT_RACES) {
  console.warn(
    `⚠ series ${SERIES}: only ${racesWithPits}/${races.length} races had parseable raw pit archives ` +
      `(< ${MIN_PIT_RACES}) — skipping calibration, keeping the existing bake. ` +
      `Run where the full backfill's data/raw exists (see the 2026-07-18 refresh-worker-bake plan).`,
  );
  db.close();
  process.exit(0);
}

// Build a strategy record from raw samples (per-track or per-type), applying the
// min-sample gates. Fields below the floor stay null (the consumer falls back).
function build(trackId: number, trackType: string, greens: number[], drops: number[], races: number): TrackStrategy {
  const typicalStintLaps = greens.length >= liveConfig.MIN_GREEN_STINT_SAMPLES ? liveService.median(greens) : null;
  const tireSeconds = drops.length >= liveConfig.MIN_TIRE_SAMPLES ? liveService.median(drops) : null;
  const tirePerLap = tireSeconds != null && typicalStintLaps ? tireSeconds / typicalStintLaps : null;
  return {
    trackId,
    trackType,
    typicalStintLaps,
    stintN: greens.length,
    tireSeconds,
    tirePerLap,
    tireTier: liveService.tireTierOf(tireSeconds),
    tireN: drops.length,
    races,
  };
}

// Per-track-type aggregates first (used to backfill thin per-track fields).
const typeAgg = new Map<string, { greens: number[]; drops: number[]; races: number }>();
for (const [, acc] of byTrack) {
  const t = typeAgg.get(acc.trackType) ?? { greens: [], drops: [], races: 0 };
  t.greens.push(...acc.greenStints); t.drops.push(...acc.tireDrops); t.races += acc.races.size;
  typeAgg.set(acc.trackType, t);
}
const byTrackType: Record<string, TrackStrategy> = {};
for (const [type, t] of typeAgg) byTrackType[type] = build(-1, type, t.greens, t.drops, t.races);

// Per-track records, with any null field backfilled from the track-type aggregate
// so `strategyFor` can stay a simple id→record lookup.
const byTrackId: Record<string, TrackStrategy> = {};
for (const [trackId, acc] of byTrack) {
  if (acc.races.size < MIN_RACES) continue; // too thin to trust per-track
  const rec = build(trackId, acc.trackType, acc.greenStints, acc.tireDrops, acc.races.size);
  const fb = byTrackType[acc.trackType];
  if (fb) {
    rec.typicalStintLaps ??= fb.typicalStintLaps;
    if (rec.tireSeconds == null) { rec.tireSeconds = fb.tireSeconds; rec.tirePerLap = fb.tirePerLap; rec.tireTier = fb.tireTier; }
  }
  byTrackId[String(trackId)] = rec;
}

// Every track id → type across ALL races (not just the well-sampled ones), so
// the live model can reach the track-type fallback for tracks that lack a
// per-track record (the live feed gives track_id but not track type).
const typeByTrackId: Record<string, string> = {};
for (const r of races) typeByTrackId[String(r.track_id)] = r.track_type;

const table: TrackStrategyTable = { byTrackId, byTrackType, typeByTrackId };

// Emit this series' artifact, then regenerate the COMBINED worker bake keyed by
// series — re-reading every per-series artifact that exists so calibrating one
// series doesn't clobber the others (track ids are shared across series but the
// strategy differs: Cup Darlington ≈32-lap runs, Trucks ≈21).
await Bun.write(`dist/data/track-strategy-${SERIES}.json`, JSON.stringify(table, null, 2));

const bySeries: Record<string, TrackStrategyTable> = {};
for (const s of [1, 2, 3]) {
  const f = Bun.file(`dist/data/track-strategy-${s}.json`);
  if (await f.exists()) bySeries[String(s)] = (await f.json()) as TrackStrategyTable;
}
const body = `// GENERATED — do not edit by hand. Run: bun run calibrate --series 1|2|3 (then redeploy worker).
import type { TrackStrategy, TrackStrategyTable } from "../src/domains/live/index.ts";

export const TRACK_STRATEGY_BY_SERIES: Record<string, TrackStrategyTable> = ${JSON.stringify(bySeries, null, 2)};

/** Per-track strategy for a live series; falls back to the track-type aggregate
 *  (type resolved from track_id when the caller doesn't supply it), then to the
 *  Cup (series 1) table if the series was never calibrated. */
export function strategyFor(seriesId: number, trackId: number, trackType?: string | null): TrackStrategy | null {
  const table = TRACK_STRATEGY_BY_SERIES[String(seriesId)] ?? TRACK_STRATEGY_BY_SERIES["1"];
  if (!table) return null;
  const byId = table.byTrackId[String(trackId)];
  if (byId) return byId;
  const type = trackType ?? table.typeByTrackId[String(trackId)];
  if (type && table.byTrackType[type]) return table.byTrackType[type];
  return null;
}
`;
await Bun.write("worker/track-strategy.ts", body);

const tierMark = (t: TireTier | null) => (t === "high" ? "🔴" : t === "moderate" ? "🟡" : t === "low" ? "🟢" : "·");
console.log(`calibrated series ${SERIES}: ${races.length} races, ${racesWithPits} with pit data (${totalPitStops} stops)`);
console.log(`  per-track entries: ${Object.keys(byTrackId).length} (min ${MIN_RACES} races); track-types: ${Object.keys(byTrackType).length}`);
for (const [id, s] of Object.entries(byTrackId)) {
  console.log(
    `  track ${id.padStart(3)} (${s.trackType.padEnd(13)}): run ${String(s.typicalStintLaps ?? "?").padStart(4)} laps (n=${s.stintN}), ` +
    `tire ${tierMark(s.tireTier)} ${s.tireSeconds?.toFixed(2) ?? "?"}s (${s.tirePerLap?.toFixed(3) ?? "?"} s/lap, n=${s.tireN}), ${s.races} races`,
  );
}
db.close();
