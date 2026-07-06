// Calibrate per-track strategy constants (fuel window + tire falloff) from the
// historical backfill, and bake them for the edge live model.
//
//   bun run calibrate [--series 1] [--min-races 3]
//
// Reads the backfill DB (lap_times, cautions, races, results) plus the raw
// archived weekend-feed.json pit_reports, runs the PURE extraction functions in
// the live domain (reconstructStints / greenStintLengths / fitFalloff), and
// writes dist/data/track-strategy-{series}.json + regenerates worker/track-strategy.ts.
//
// MUST run where the backfill exists (locally). This session's cloud env cannot
// reach the CDN, so the checked-in worker/track-strategy.ts is an empty stub until
// this is run locally and the worker redeployed. See
// docs/exec-plans/active/2026-07-06-strategy-model-calibration.md.
import { Database } from "bun:sqlite";
import { liveService, liveConfig } from "../src/domains/live/index.ts";
import type {
  NormalizedPitStop,
  Stint,
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

/**
 * Normalize the historical weekend-feed `pit_reports` to the shared shape.
 * Defensive: the exact keys vary across seasons; we read the first present
 * lap / flag / tire fields. Validated locally (the repo fixture's pit_reports
 * is empty). Adjust the key lists here if a season parses to 0 stops.
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
interface Acc { trackType: string; greenStints: number[]; falloffs: number[]; races: Set<number> }
const byTrack = new Map<number, Acc>();
let racesWithPits = 0, totalPitStops = 0;

for (const race of races) {
  const laps = race.actual_laps ?? 0;
  if (laps <= 0) continue;

  // Pit stops → stints → clean green fuel-window samples.
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
  if (pits.length) { racesWithPits++; totalPitStops += pits.length; }

  const stints: Stint[] = liveService.reconstructStints(pits, laps);
  const greens = liveService.greenStintLengths(stints);

  // Tire falloff: fit lap-time vs lap-into-stint over each car's green run,
  // excluding caution laps. Map car → driver via results to join lap_times.
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

  const falloffs: number[] = [];
  for (const st of stints) {
    if (!st.greenRun || st.laps < liveConfig.MIN_FALLOFF_SAMPLES) continue;
    const driverId = carToDriver.get(st.carNumber);
    if (driverId == null) continue;
    const lapRows = db
      .query<{ lap: number; lap_time: number | null }, [number, number, number, number]>(
        `SELECT lap, lap_time FROM lap_times
          WHERE race_id = ? AND driver_id = ? AND lap > ? AND lap <= ? ORDER BY lap`,
      )
      .all(race.race_id, driverId, st.startLap, st.endLap);
    const samples = lapRows
      .filter((l) => l.lap_time != null && isGreenLap(l.lap))
      .map((l) => ({ lapIntoStint: l.lap - st.startLap, lapTime: l.lap_time as number }));
    const fit = liveService.fitFalloff(samples);
    if (fit && fit.r2 >= 0.1) falloffs.push(fit.slopeSecPerLap); // keep only runs with a real trend
  }

  const acc = byTrack.get(race.track_id) ?? { trackType: race.track_type, greenStints: [], falloffs: [], races: new Set() };
  acc.greenStints.push(...greens);
  acc.falloffs.push(...falloffs);
  acc.races.add(race.race_id);
  byTrack.set(race.track_id, acc);
}

// Build per-track records + per-track-type aggregates.
const byTrackId: Record<string, TrackStrategy> = {};
const typeAgg = new Map<string, { greens: number[]; falloffs: number[]; races: number }>();
for (const [trackId, acc] of byTrack) {
  if (acc.races.size < MIN_RACES) continue; // too thin to trust per-track
  byTrackId[String(trackId)] = {
    trackId,
    trackType: acc.trackType,
    greenStintLaps: liveService.median(acc.greenStints),
    greenStintN: acc.greenStints.length,
    falloffSecPerLap: liveService.median(acc.falloffs),
    falloffN: acc.falloffs.length,
    races: acc.races.size,
  };
  const t = typeAgg.get(acc.trackType) ?? { greens: [], falloffs: [], races: 0 };
  t.greens.push(...acc.greenStints); t.falloffs.push(...acc.falloffs); t.races += acc.races.size;
  typeAgg.set(acc.trackType, t);
}
const byTrackType: Record<string, TrackStrategy> = {};
for (const [type, t] of typeAgg) {
  byTrackType[type] = {
    trackId: -1, trackType: type,
    greenStintLaps: liveService.median(t.greens), greenStintN: t.greens.length,
    falloffSecPerLap: liveService.median(t.falloffs), falloffN: t.falloffs.length,
    races: t.races,
  };
}

const table: TrackStrategyTable = { byTrackId, byTrackType };

// Emit the artifact + regenerate the worker bake.
await Bun.write(`dist/data/track-strategy-${SERIES}.json`, JSON.stringify(table, null, 2));
const body = `// GENERATED — do not edit by hand. Run: bun run calibrate (then redeploy worker).
import type { TrackStrategyTable } from "../src/domains/live/index.ts";

export const TRACK_STRATEGY: TrackStrategyTable = ${JSON.stringify(table, null, 2)};

export function strategyFor(trackId: number, trackType?: string | null) {
  const byId = TRACK_STRATEGY.byTrackId[String(trackId)];
  if (byId) return byId;
  if (trackType && TRACK_STRATEGY.byTrackType[trackType]) return TRACK_STRATEGY.byTrackType[trackType];
  return null;
}
`;
await Bun.write("worker/track-strategy.ts", body);

console.log(`calibrated series ${SERIES}: ${races.length} races, ${racesWithPits} with pit data (${totalPitStops} stops)`);
console.log(`  per-track entries: ${Object.keys(byTrackId).length} (min ${MIN_RACES} races); track-types: ${Object.keys(byTrackType).length}`);
for (const [id, s] of Object.entries(byTrackId)) {
  console.log(`  track ${id} (${s.trackType}): fuel window ${s.greenStintLaps ?? "?"} laps (n=${s.greenStintN}), falloff ${s.falloffSecPerLap?.toFixed(3) ?? "?"} s/lap (n=${s.falloffN}), ${s.races} races`);
}
if (racesWithPits === 0) {
  console.warn("⚠ 0 races had parseable pit_reports — check the pit_reports key names in pitStopsFromWeekendPitReports().");
}
db.close();
