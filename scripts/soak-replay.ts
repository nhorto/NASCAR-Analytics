// Phase 4 full-race soak — the "captured replay" substitute the launch plan's
// risk table allows in place of a live feed (see
// docs/exec-plans/completed/2026-07-05-live-race-companion.md, Phase 4 item 5, and
// docs/exec-plans/active/2026-09-07-production-and-paid-launch.md §10).
//
// Rebuilds one archived race lap-by-lap (src/app/replay.ts) and drives it
// through the SAME composition the edge Durable Object runs each tick —
// including the real `worker/canonicalize.ts`, `worker/baselines.ts`, and
// `worker/track-strategy.ts` this script imports directly (replay.ts itself
// never does, so it stays importable from Bun/tests without Cloudflare
// concerns — see its SoakDeps comment).
//
//   bun run soak [--season 2022] [--series 1] [--race 5177] [--json out.json]
//
// Defaults to race 5177 (2022 AutoTrader EchoPark Automotive 500, Texas) — the
// archived race with the most complete real pit_reports (574 stops) and the
// most caution segments (16) of any race with lap-times.json, i.e. the one
// candidate that exercises every state transition Phase 4 needs to see:
// green, 16 cautions/restarts, two stage ends, ~600 pit stops, retirements,
// and the checkered. Reads only static archive JSON already on disk — no
// network, no writes to data/nascar.db.
import { buildReplay, prepareRace, runSoak, formatSoakReport } from "../src/app/replay.ts";
import type { ArchivedRace, SoakDeps } from "../src/app/replay.ts";
import { canonicalizeFeed } from "../worker/canonicalize.ts";
import { BASELINES } from "../worker/baselines.ts";
import { strategyFor } from "../worker/track-strategy.ts";

const DATA_DIR = process.env.NASCAR_DATA_DIR ?? "data";

function argValue(flag: string, fallback: number): number {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  const parsed = Number.parseInt(process.argv[idx + 1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function argString(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx === -1 ? null : (process.argv[idx + 1] ?? null);
}

const season = argValue("--season", 2022);
const series = argValue("--series", 1);
const raceId = argValue("--race", 5177);
const jsonOut = argString("--json");
const ticksPerLap = argString("--ticks-per-lap");

async function readJson<T>(path: string): Promise<T | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return (await file.json()) as T;
}

async function main(): Promise<void> {
  const raceDir = `${DATA_DIR}/raw/${season}/${series}/${raceId}`;
  const weekendFeed = await readJson<{ weekend_race?: unknown[] }>(`${raceDir}/weekend-feed.json`);
  const lapTimes = await readJson<ArchivedRace["lapTimes"]>(`${raceDir}/lap-times.json`);
  if (!weekendFeed || !lapTimes) {
    console.error(
      `Missing archive for season ${season} series ${series} race ${raceId} under ${raceDir}\n` +
        `(need weekend-feed.json + lap-times.json — both written by \`bun run backfill\`).`,
    );
    process.exit(1);
  }
  const runs = Array.isArray(weekendFeed.weekend_race) ? weekendFeed.weekend_race : [];
  const weekend =
    (runs.find((r) => (r as { run_type?: number }).run_type === 3) as ArchivedRace["weekend"] | undefined) ??
    (runs[0] as ArchivedRace["weekend"] | undefined);
  if (!weekend) {
    console.error(`weekend-feed.json for race ${raceId} has no weekend_race entries`);
    process.exit(1);
  }

  const schedule = (await readJson<unknown[]>(`${DATA_DIR}/raw/${season}/${series}/schedule-feed.json`)) ?? [];

  const race: ArchivedRace = { weekend, lapTimes };
  const prep = prepareRace(race); // fail fast on a malformed archive before spending time on ticks
  console.log(
    `Replaying ${weekend.race_name ?? raceId} (${weekend.track_name ?? "?"}) — ` +
      `${prep.drivers.length} cars, ${prep.finalLap}/${prep.lapsInRace} laps, ` +
      `${(weekend.pit_reports ?? []).length} archived pit stops\n`,
  );

  const deps: SoakDeps = {
    canonicalize: (feed) => canonicalizeFeed(feed, schedule),
    baselinesFor: (seriesId) => BASELINES[seriesId] ?? BASELINES[1] ?? null,
    strategyFor: (seriesId, trackId) => strategyFor(seriesId, trackId, null),
  };

  const ticks = buildReplay(race, {
    ticksPerLap: ticksPerLap === "auto" || ticksPerLap === null ? "auto" : Number.parseInt(ticksPerLap, 10),
  });
  const report = runSoak(ticks, deps);
  console.log(formatSoakReport(report));

  if (jsonOut) await Bun.write(jsonOut, JSON.stringify(report, null, 2));
  if (report.violations.length > 0) process.exit(1);
}

await main();
