// Standings + proprietary-metric leaderboards. The latest season comes from
// /health (the server exposes it there), so the app never hardcodes a year.
import { useCallback, useEffect, useState } from "react";
import { serverBase } from "../../lib/config.ts";
import { timedFetch } from "../../lib/http.ts";

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

export async function fetchLatestSeason(base: string): Promise<number | null> {
  try {
    const res = await timedFetch(`${base}/health`);
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    return typeof body.latestSeason === "number" ? body.latestSeason : null;
  } catch {
    return null;
  }
}

/**
 * Bootstrap hook for screens that need the latest season before they can
 * render their own controls (Compare, the track explorer). Distinguishes
 * "still loading" from "the fetch failed" — without this, a network hiccup
 * on first mount left those screens spinning forever with no way to recover.
 */
export function useLatestSeason(): { season: number | null | undefined; retry: () => void } {
  const [season, setSeason] = useState<number | null | undefined>(undefined);

  const retry = useCallback(() => {
    setSeason(undefined);
    void (async () => setSeason(await fetchLatestSeason(await serverBase())))();
  }, []);

  useEffect(() => {
    retry();
  }, [retry]);

  return { season, retry };
}

/**
 * "locked" = the server 403'd this series for a non-Pro viewer (defense in
 * depth; SeriesPills normally prevents a free viewer from asking).
 * "empty"  = the server answered, but this series has not been ingested yet
 * (404). Distinct from `null` (unreachable) so the screen can say which one
 * is true instead of blaming the network for missing data.
 */
export type StatsResult = StatsData | null | "locked" | "empty";

export async function fetchStats(base: string, seriesId = 1): Promise<StatsResult> {
  const season = await fetchLatestSeason(base);
  if (season === null) return null;
  try {
    const [standingsRes, metricsRes] = await Promise.all([
      timedFetch(`${base}/api/standings/${season}?series=${seriesId}`),
      timedFetch(`${base}/api/metrics?series=${seriesId}&season=${season}`),
    ]);
    if (standingsRes.status === 403) return "locked";
    if (standingsRes.status === 404) return "empty";
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
