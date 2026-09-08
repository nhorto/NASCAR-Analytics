// DFS projections from GET /api/dfs. Pro-only in full (the web page shows a
// locked card and the JSON view answers 403), so the fetch result is a small
// state machine rather than a nullable: "locked" is a normal outcome that the
// screen renders as the upsell, not an error.
import { timedFetch } from "../../lib/http.ts";

export type DfsPlatform = "dk" | "fd";

export const PLATFORM_LABELS: Record<DfsPlatform, string> = {
  dk: "DraftKings",
  fd: "FanDuel",
};

/** The platform's rules, read by the server from config/dfs/{dk,fd}.json. */
export interface DfsScoring {
  platform: string;
  winPoints: number | null;
  lapLedPoints: number;
  fastLapPoints: number;
  placeDiffPoints: number;
}

export interface DfsRow {
  driverId: number;
  fullName: string;
  projectedStart: number | null;
  projectedPoints: number;
}

export interface DfsData {
  race: { raceId: number; raceName: string; season: number } | null;
  platform: DfsPlatform;
  scoring: DfsScoring | null;
  stage: "thursday" | "saturday" | null;
  generatedAt: string | null;
  rows: DfsRow[];
}

export type DfsResult =
  | { status: "ok"; data: DfsData }
  | { status: "locked" }
  | { status: "error" };

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseScoring(value: unknown): DfsScoring | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.platform !== "string") return null;
  return {
    platform: v.platform,
    winPoints: numOrNull(v.winPoints),
    lapLedPoints: num(v.lapLedPoints),
    fastLapPoints: num(v.fastLapPoints),
    placeDiffPoints: num(v.placeDiffPoints),
  };
}

export function parseDfs(value: unknown, requested: DfsPlatform): DfsData | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.rows)) return null;
  const race =
    typeof v.race === "object" && v.race !== null && typeof (v.race as any).raceId === "number"
      ? {
          raceId: (v.race as any).raceId as number,
          raceName: String((v.race as any).raceName ?? ""),
          season: num((v.race as any).season),
        }
      : null;
  return {
    race,
    platform: v.platform === "fd" ? "fd" : v.platform === "dk" ? "dk" : requested,
    scoring: parseScoring(v.scoring),
    stage: v.stage === "saturday" || v.stage === "thursday" ? v.stage : null,
    generatedAt: typeof v.generatedAt === "string" ? v.generatedAt : null,
    rows: v.rows.flatMap((raw): DfsRow[] => {
      if (typeof raw !== "object" || raw === null) return [];
      const r = raw as Record<string, unknown>;
      if (typeof r.driverId !== "number" || typeof r.fullName !== "string") return [];
      return [
        {
          driverId: r.driverId,
          fullName: r.fullName,
          projectedStart: numOrNull(r.projectedStart),
          projectedPoints: num(r.projectedPoints),
        },
      ];
    }),
  };
}

export async function fetchDfs(base: string, platform: DfsPlatform): Promise<DfsResult> {
  try {
    const res = await timedFetch(`${base}/api/dfs?scoring=${platform}`, {
      credentials: "include",
    });
    if (res.status === 403) return { status: "locked" };
    if (!res.ok) return { status: "error" };
    const data = parseDfs(await res.json(), platform);
    return data ? { status: "ok", data } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}
