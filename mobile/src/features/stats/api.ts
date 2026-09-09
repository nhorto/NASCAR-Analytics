// Standings + proprietary-metric leaderboards. The season they are read for
// comes from lib/season.ts (which asks /health), so the app never hardcodes a
// year. Fetch + parse only — no React — so these parsers stay testable under
// plain `bun test`.
import { timedFetch } from "../../lib/http.ts";
import { fetchLatestSeason } from "../../lib/season.ts";

export interface StandingRow {
  driverId: number;
  fullName: string;
  points: number;
  wins: number;
  top5s: number;
  avgFinish: number | null;
}

export interface MetricRow {
  driverId: number;
  fullName: string;
  value: number;
  rank: number;
}

export interface StatsData {
  season: number;
  standings: StandingRow[];
  adjPass: MetricRow[];
  closer: MetricRow[];
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function parseStandings(value: unknown): StandingRow[] {
  if (typeof value !== "object" || value === null) return [];
  const list = (value as Record<string, unknown>).standings;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.driverId !== "number" || typeof r.fullName !== "string") return [];
    return [
      {
        driverId: r.driverId,
        fullName: r.fullName,
        points: num(r.points),
        wins: num(r.wins),
        top5s: num(r.top5s),
        avgFinish: typeof r.avgFinish === "number" && Number.isFinite(r.avgFinish) ? r.avgFinish : null,
      },
    ];
  });
}

export function parseMetricBoard(value: unknown, key: "adjPass" | "closer"): MetricRow[] {
  if (typeof value !== "object" || value === null) return [];
  const list = (value as Record<string, unknown>)[key];
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.driverId !== "number" || typeof r.fullName !== "string") return [];
    return [{ driverId: r.driverId, fullName: r.fullName, value: num(r.value), rank: num(r.rank) }];
  });
}

export async function fetchStats(base: string): Promise<StatsData | null> {
  const season = await fetchLatestSeason(base);
  if (season === null) return null;
  try {
    const [standingsRes, metricsRes] = await Promise.all([
      timedFetch(`${base}/api/standings/${season}?series=1`),
      timedFetch(`${base}/api/metrics?series=1&season=${season}`),
    ]);
    if (!standingsRes.ok) return null;
    const standings = parseStandings(await standingsRes.json());
    const metricsBody = metricsRes.ok ? await metricsRes.json() : null;
    return {
      season,
      standings,
      adjPass: parseMetricBoard(metricsBody, "adjPass"),
      closer: parseMetricBoard(metricsBody, "closer"),
    };
  } catch {
    return null;
  }
}
