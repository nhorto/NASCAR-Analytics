// Deep tools data. Both tools reuse endpoints that already existed — the
// track-type leaderboard aggregates server-side at /api/tracks (much cheaper
// on a phone than the web page's whole-payload fetch), and compare reads one
// driver's seasons at a time from /api/drivers/:id/stats.
import { timedFetch } from "../../lib/http.ts";

export const TRACK_TYPES = [
  { value: "superspeedway", label: "Super" },
  { value: "intermediate", label: "Interm" },
  { value: "short", label: "Short" },
  { value: "road", label: "Road" },
  { value: "dirt", label: "Dirt" },
] as const;

export type TrackType = (typeof TRACK_TYPES)[number]["value"];

export interface TrackLeaderRow {
  driverId: number;
  fullName: string;
  starts: number;
  wins: number;
  top5s: number;
  avgFinish: number | null;
  avgRating: number | null;
  adjPassEfficiency: number | null;
  closerScore: number | null;
}

export interface TrackBoard {
  trackType: string;
  fromSeason: number;
  toSeason: number;
  minStarts: number;
  leaders: TrackLeaderRow[];
}

export type TrackResult =
  | { status: "ok"; board: TrackBoard }
  | { status: "locked" }
  | { status: "error" };

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function parseTrackBoard(value: unknown): TrackBoard | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.leaders)) return null;
  return {
    trackType: typeof v.trackType === "string" ? v.trackType : "unknown",
    fromSeason: num(v.fromSeason),
    toSeason: num(v.toSeason),
    minStarts: num(v.minStarts),
    leaders: v.leaders.flatMap((raw): TrackLeaderRow[] => {
      if (typeof raw !== "object" || raw === null) return [];
      const r = raw as Record<string, unknown>;
      if (typeof r.driverId !== "number" || typeof r.fullName !== "string") return [];
      return [
        {
          driverId: r.driverId,
          fullName: r.fullName,
          starts: num(r.starts),
          wins: num(r.wins),
          top5s: num(r.top5s),
          avgFinish: numOrNull(r.avgFinish),
          avgRating: numOrNull(r.avgRating),
          adjPassEfficiency: numOrNull(r.adjPassEfficiency),
          closerScore: numOrNull(r.closerScore),
        },
      ];
    }),
  };
}

export async function fetchTrackBoard(
  base: string,
  opts: { seriesId: number; trackType: string; from: number; to: number; min: number },
): Promise<TrackResult> {
  const query = `series=${opts.seriesId}&type=${encodeURIComponent(opts.trackType)}&from=${opts.from}&to=${opts.to}&min=${opts.min}`;
  try {
    const res = await timedFetch(`${base}/api/tracks?${query}`, { credentials: "include" });
    // Xfinity/Trucks are Pro-gated at the JSON layer (D16); the screen shows
    // its lock rather than an error for that one status.
    if (res.status === 403) return { status: "locked" };
    if (!res.ok) return { status: "error" };
    const board = parseTrackBoard(await res.json());
    return board ? { status: "ok", board } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}
