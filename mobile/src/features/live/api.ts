// Live board data from the looplab-live Worker (CORS-open, unauthenticated;
// launch plan D17). Types re-declare the slice of LivePayload this app
// renders — the server repo's src/domains/live/types.ts is the source shape
// and its tests pin it. The feed is untrusted JSON: parse defensively.
import { LIVE_API_BASE } from "../../lib/config.ts";
import { timedFetch } from "../../lib/http.ts";

export interface LiveRow {
  position: number;
  carNumber: string;
  driverId: number;
  driverName: string;
  gapToLeader: number;
  lastLapSpeed: number | null;
  lapsLed: number;
  pitStopCount: number;
  running: boolean;
}

export interface LiveSnapshotSlice {
  lap: number;
  lapsInRace: number;
  lapsToGo: number;
  flag: string;
  stage: { num: number; finishAtLap: number } | null;
  runName: string | null;
  trackName: string | null;
  isLive: boolean;
  drivers: LiveRow[];
}

export interface NextRace {
  name: string | null;
  trackName: string | null;
  startTimeUtc: string | null;
}

export interface LiveData {
  live: boolean;
  warming: boolean;
  fetchedAt: number;
  snapshot: LiveSnapshotSlice | null;
  nextRace: NextRace | null;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function parseRow(v: unknown): LiveRow | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const position = num(r.position, -1);
  const driverName = str(r.driverName);
  if (position < 1 || !driverName) return null;
  return {
    position,
    carNumber: str(r.carNumber) ?? "—",
    driverId: num(r.driverId, -1),
    driverName,
    gapToLeader: num(r.gapToLeader),
    lastLapSpeed: typeof r.lastLapSpeed === "number" && Number.isFinite(r.lastLapSpeed) ? r.lastLapSpeed : null,
    lapsLed: num(r.lapsLed),
    pitStopCount: num(r.pitStopCount),
    running: r.running !== false,
  };
}

function parseSnapshot(v: unknown): LiveSnapshotSlice | null {
  if (typeof v !== "object" || v === null) return null;
  const s = v as Record<string, unknown>;
  const rawDrivers = Array.isArray(s.drivers) ? s.drivers : [];
  const stage =
    typeof s.stage === "object" && s.stage !== null
      ? {
          num: num((s.stage as Record<string, unknown>).num),
          finishAtLap: num((s.stage as Record<string, unknown>).finishAtLap),
        }
      : null;
  return {
    lap: num(s.lap),
    lapsInRace: num(s.lapsInRace),
    lapsToGo: num(s.lapsToGo),
    flag: str(s.flag) ?? "unknown",
    stage,
    runName: str(s.runName),
    trackName: str(s.trackName),
    isLive: s.isLive === true,
    drivers: rawDrivers
      .map(parseRow)
      .filter((row): row is LiveRow => row !== null)
      .sort((a, b) => a.position - b.position),
  };
}

export function parseLivePayload(value: unknown): LiveData | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.ok !== true) return null;
  const nextRaceRaw =
    typeof v.nextRace === "object" && v.nextRace !== null ? (v.nextRace as Record<string, unknown>) : null;
  return {
    live: v.live === true,
    warming: v.warming === true,
    fetchedAt: num(v.fetchedAt),
    snapshot: parseSnapshot(v.snapshot),
    nextRace: nextRaceRaw
      ? {
          name: str(nextRaceRaw.name),
          trackName: str(nextRaceRaw.trackName),
          startTimeUtc: str(nextRaceRaw.startTimeUtc),
        }
      : null,
  };
}

/** Cup only in the free tier (D16); series stays fixed at 1 here for now. */
export async function fetchLive(): Promise<LiveData | null> {
  try {
    const res = await timedFetch(`${LIVE_API_BASE}/api/live?series=1`);
    if (!res.ok) return null;
    return parseLivePayload(await res.json());
  } catch {
    return null;
  }
}
