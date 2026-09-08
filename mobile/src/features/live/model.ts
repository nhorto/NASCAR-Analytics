// Pure view-model for the live board: feed slice in, display strings out.
import type { LiveData, LiveRow } from "./api.ts";

export interface BoardRow {
  key: string;
  position: string;
  carNumber: string;
  driverName: string;
  gap: string;
  lastLap: string;
  lapsLed: string;
  pits: string;
  out: boolean;
}

export interface BoardHeader {
  title: string;
  flag: string;
  lapLine: string;
  stageLine: string | null;
  staleness: string | null;
}

export interface IdleModel {
  kind: "idle";
  headline: string;
  detail: string | null;
}

export interface BoardModel {
  kind: "board";
  header: BoardHeader;
  rows: BoardRow[];
}

export type LiveModel = IdleModel | BoardModel | { kind: "unavailable" };

export function formatGap(row: LiveRow): string {
  if (!row.running) return "OUT";
  if (row.position === 1) return "Leader";
  return `+${row.gapToLeader.toFixed(3)}s`;
}

export function formatStart(startTimeUtc: string | null): string | null {
  if (!startTimeUtc) return null;
  const ms = Date.parse(startTimeUtc);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "as of Ns ago" once the snapshot is older than the poll interval. */
export function staleness(fetchedAt: number, nowMs: number, thresholdMs = 10_000): string | null {
  const age = nowMs - fetchedAt;
  if (fetchedAt <= 0 || age < thresholdMs) return null;
  return `as of ${Math.round(age / 1000)}s ago`;
}

export function liveModel(data: LiveData | null, nowMs: number): LiveModel {
  if (data === null) return { kind: "unavailable" };
  const snap = data.snapshot;
  if (!data.live || !snap || !snap.isLive) {
    if (data.warming) return { kind: "idle", headline: "Live board is warming up…", detail: null };
    const next = data.nextRace;
    const nextName = next?.name ?? "Next Cup session";
    const at = [next?.trackName, formatStart(next?.startTimeUtc ?? null)].filter(Boolean).join(" · ");
    return {
      kind: "idle",
      headline: "No Cup session on track",
      detail: next ? `Next up: ${nextName}${at ? ` — ${at}` : ""}` : null,
    };
  }
  return {
    kind: "board",
    header: {
      title: [snap.runName, snap.trackName].filter(Boolean).join(" · ") || "Live",
      flag: snap.flag.toUpperCase(),
      lapLine: `Lap ${snap.lap}/${snap.lapsInRace} · ${snap.lapsToGo} to go`,
      stageLine: snap.stage ? `Stage ${snap.stage.num} ends lap ${snap.stage.finishAtLap}` : null,
      staleness: staleness(data.fetchedAt, nowMs),
    },
    rows: snap.drivers.map((row) => ({
      key: `${row.driverId}-${row.carNumber}`,
      position: String(row.position),
      carNumber: `#${row.carNumber}`,
      driverName: row.driverName,
      gap: formatGap(row),
      lastLap: row.lastLapSpeed === null ? "—" : `${row.lastLapSpeed.toFixed(1)} mph`,
      lapsLed: row.lapsLed > 0 ? String(row.lapsLed) : "",
      pits: row.pitStopCount > 0 ? String(row.pitStopCount) : "",
      out: !row.running,
    })),
  };
}
