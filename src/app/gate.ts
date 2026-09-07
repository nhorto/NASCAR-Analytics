// Gating decisions (launch plan D4/D16, spec §4/§8): free = Cup + career
// pages; Xfinity/Trucks pages show a teaser to non-Pro viewers, and the JSON
// endpoints that feed them refuse outright so the teaser can't be bypassed by
// fetching payloads directly. Pure functions — the server applies the verdicts.
import type { Viewer } from "./viewer.ts";

const CUP = 1;

/** Pro-only capabilities (spec §4). Consumers arrive with WS-F/notifications. */
export type Feature = "predictions" | "dfs" | "export" | "push" | "compare4";

export function featureEnabled(_feature: Feature, viewer: Pick<Viewer, "pro">): boolean {
  return viewer.pro;
}

/** Series-prefixed HTML pages: non-Cup + non-Pro → teaser. */
export function seriesGated(seriesId: number, viewer: Pick<Viewer, "pro">): boolean {
  return seriesId !== CUP && !viewer.pro;
}

/** Un-prefixed race/recap pages gate on the race's derived series. */
export function raceGated(raceSeriesId: number, viewer: Pick<Viewer, "pro">): boolean {
  return seriesGated(raceSeriesId, viewer);
}

/**
 * JSON endpoints: `/data/*-{series}.json` and `/api/*?series={2,3}` are
 * blocked for non-Pro. Endpoints without a series dimension (career, recap by
 * race id) are handled at their routes, where the series is derivable.
 */
export function jsonRequestBlocked(url: URL, viewer: Pick<Viewer, "pro">): boolean {
  if (viewer.pro) return false;
  const m = url.pathname.match(/^\/data\/[a-z-]+-(\d+)\.json$/);
  if (m) return Number(m[1]) !== CUP;
  if (url.pathname.startsWith("/api/")) {
    const s = Number.parseInt(url.searchParams.get("series") ?? "", 10);
    return Number.isFinite(s) && s !== CUP;
  }
  return false;
}

export const PRO_REQUIRED_BODY = { error: "pro_required", upgrade: "/pricing" };
