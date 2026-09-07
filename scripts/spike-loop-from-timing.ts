// WS-C spike — can we recompute official loop-data metrics from lap timing?
//
// `bun run scripts/spike-loop-from-timing.ts [--season 2025] [--series 1]`
//
// For every race with BOTH lap_times and loop_stats, recompute per-driver
// metrics from per-lap running positions + the caution segments, then measure
// agreement with the official loop_stats. This is the mitigation the data-risk
// analysis rates highest: if it works, any lap-timing source keeps the
// proprietary metrics alive without NASCAR's loopstats endpoint.
//
// Method notes (why perfect agreement is impossible): official loop data is
// measured at multiple scoring loops per lap, so passes that happen and are
// undone within one lap are invisible to per-lap positions — our pass counts
// are a floor. Position-derived metrics (avg pos, top-15 laps, lead laps)
// should agree almost exactly.
import { Database } from "bun:sqlite";

const DATA_DIR = process.env.NASCAR_DATA_DIR ?? "data";

function argValue(flag: string, fallback: number): number {
  const idx = process.argv.indexOf(flag);
  const raw = idx === -1 ? undefined : process.argv[idx + 1];
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const season = argValue("--season", 2025);
const seriesId = argValue("--series", 1);

interface LapRow {
  driverId: number;
  lap: number;
  lapTime: number | null;
  runningPos: number;
}

interface Computed {
  laps: number;
  avgPs: number;
  leadLaps: number;
  top15Laps: number;
  fastLaps: number;
  passesGf: number;
  passedGf: number;
  qualityPasses: number;
}

/** Recompute loop-style metrics for one race from per-lap positions. */
export function computeFromTiming(
  lapRows: LapRow[],
  cautionLaps: Set<number>,
): Map<number, Computed> {
  const byLap = new Map<number, Map<number, { pos: number; time: number | null }>>();
  const byDriver = new Map<number, LapRow[]>();
  for (const r of lapRows) {
    let lapMap = byLap.get(r.lap);
    if (!lapMap) byLap.set(r.lap, (lapMap = new Map()));
    lapMap.set(r.driverId, { pos: r.runningPos, time: r.lapTime });
    const d = byDriver.get(r.driverId);
    if (d) d.push(r);
    else byDriver.set(r.driverId, [r]);
  }

  const out = new Map<number, Computed>();
  for (const [driverId, rows] of byDriver) {
    // Lap 0 is the grid; official "laps" are completed laps.
    const completed = rows.filter((r) => r.lap > 0);
    const positions = completed.map((r) => r.runningPos);
    out.set(driverId, {
      laps: completed.length,
      avgPs: positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : 0,
      leadLaps: positions.filter((p) => p === 1).length,
      top15Laps: positions.filter((p) => p <= 15).length,
      fastLaps: 0,
      passesGf: 0,
      passedGf: 0,
      qualityPasses: 0,
    });
  }

  const lapNumbers = [...byLap.keys()].sort((a, b) => a - b);
  for (const lap of lapNumbers) {
    if (lap === 0) continue;
    const field = byLap.get(lap)!;
    // Green laps only from here: official fast laps are green-flag fastest
    // laps (verified empirically — all-laps counting overshoots by ~1.1/driver),
    // and pass counting under yellow is meaningless.
    if (cautionLaps.has(lap)) continue;

    // Fast lap: the best recorded time on this green lap.
    let best: { driverId: number; time: number } | null = null;
    for (const [driverId, { time }] of field) {
      if (time !== null && time > 0 && (best === null || time < best.time))
        best = { driverId, time };
    }
    if (best) out.get(best.driverId)!.fastLaps++;

    const prev = byLap.get(lap - 1);
    if (!prev) continue;
    for (const [driverId, { pos }] of field) {
      const was = prev.get(driverId)?.pos;
      if (was === undefined) continue;
      const stats = out.get(driverId)!;
      if (pos < was) {
        stats.passesGf += was - pos;
        // Cars passed now sit in positions [pos+1 … was]; before the swap they
        // ran [pos … was-1]. Quality passes = those that ran in the top 15.
        stats.qualityPasses += Math.max(0, Math.min(was - 1, 15) - pos + 1);
      } else if (pos > was) {
        stats.passedGf += pos - was;
      }
    }
  }
  return out;
}

interface Pair {
  computed: number;
  official: number;
}

function agreement(pairs: Pair[]): { n: number; exact: number; within1: number; mae: number; r: number } {
  const n = pairs.length;
  if (n === 0) return { n, exact: 0, within1: 0, mae: 0, r: 0 };
  let exact = 0;
  let within1 = 0;
  let mae = 0;
  for (const p of pairs) {
    const d = Math.abs(p.computed - p.official);
    if (d < 0.5) exact++;
    if (d <= 1) within1++;
    mae += d;
  }
  mae /= n;
  const mx = pairs.reduce((a, p) => a + p.computed, 0) / n;
  const my = pairs.reduce((a, p) => a + p.official, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of pairs) {
    sxy += (p.computed - mx) * (p.official - my);
    sxx += (p.computed - mx) ** 2;
    syy += (p.official - my) ** 2;
  }
  const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  return { n, exact: exact / n, within1: within1 / n, mae, r };
}

if (import.meta.main) {
  const db = new Database(`${DATA_DIR}/nascar.db`, { readonly: true });
  const races = db
    .query(
      `SELECT r.race_id AS raceId, r.race_name AS name FROM races r
       WHERE r.season = ? AND r.series_id = ? AND r.race_type_id = 1
         AND EXISTS (SELECT 1 FROM lap_times t WHERE t.race_id = r.race_id)
         AND EXISTS (SELECT 1 FROM loop_stats s WHERE s.race_id = r.race_id)
       ORDER BY COALESCE(r.race_date_utc, r.race_date)`,
    )
    .all(season, seriesId) as Array<{ raceId: number; name: string }>;
  console.log(`season ${season}, series ${seriesId}: ${races.length} races with both lap_times and loop_stats`);

  const metrics = ["avgPs", "laps", "leadLaps", "top15Laps", "fastLaps", "passesGf", "passedGf", "qualityPasses"] as const;
  const officialKey: Record<(typeof metrics)[number], string> = {
    avgPs: "avg_ps", laps: "laps", leadLaps: "lead_laps", top15Laps: "top15_laps",
    fastLaps: "fast_laps", passesGf: "passes_gf", passedGf: "passed_gf", qualityPasses: "quality_passes",
  };
  const pairs: Record<string, Pair[]> = Object.fromEntries([...metrics, "passEff"].map((m) => [m, []]));

  for (const race of races) {
    const lapRows = db
      .query(
        `SELECT driver_id AS driverId, lap, lap_time AS lapTime, running_pos AS runningPos
         FROM lap_times WHERE race_id = ?`,
      )
      .all(race.raceId) as LapRow[];
    const cautions = db
      .query(`SELECT start_lap AS s, end_lap AS e FROM cautions WHERE race_id = ?`)
      .all(race.raceId) as Array<{ s: number; e: number }>;
    const cautionLaps = new Set<number>();
    for (const c of cautions) for (let l = c.s; l <= c.e; l++) cautionLaps.add(l);

    const computed = computeFromTiming(lapRows, cautionLaps);
    const official = db
      .query(`SELECT * FROM loop_stats WHERE race_id = ?`)
      .all(race.raceId) as Array<Record<string, number | null>>;
    for (const o of official) {
      const c = computed.get(o.driver_id as number);
      if (!c) continue;
      for (const m of metrics) {
        const off = o[officialKey[m]];
        if (off === null || off === undefined) continue;
        pairs[m]!.push({ computed: c[m], official: off });
      }
      // The ratio that actually feeds adjPE: passes / (passes + passed). Raw
      // pass counts undercount (intra-lap passes are invisible per-lap), but
      // the ratio of two same-scale undercounts may still hold.
      const offPasses = o.passes_gf;
      const offPassed = o.passed_gf;
      if (
        offPasses !== null && offPasses !== undefined &&
        offPassed !== null && offPassed !== undefined &&
        offPasses + offPassed >= 10 && c.passesGf + c.passedGf >= 10
      ) {
        pairs.passEff!.push({
          computed: c.passesGf / (c.passesGf + c.passedGf),
          official: offPasses / (offPasses + offPassed),
        });
      }
    }
  }

  console.log("\nmetric          n      exact   ±1      MAE     r");
  for (const m of [...metrics, "passEff"] as const) {
    const a = agreement(pairs[m]!);
    console.log(
      `${m.padEnd(15)} ${String(a.n).padEnd(6)} ${(a.exact * 100).toFixed(1).padStart(5)}%  ` +
        `${(a.within1 * 100).toFixed(1).padStart(5)}%  ${a.mae.toFixed(3).padStart(7)}  ${a.r.toFixed(3)}`,
    );
  }
}
