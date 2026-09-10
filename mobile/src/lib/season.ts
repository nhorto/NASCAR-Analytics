// Which season the app is showing. The server publishes the latest ingested
// season on /health, so the app never hardcodes a year and never goes stale a
// January behind the sport.
//
// Deliberately React-free: feature `api.ts` modules import this, and those
// stay Node-runnable so their parser tests run under the root `bun test`
// without React Native's dependency tree. The hook that wraps it lives next
// door in useLatestSeason.ts (guarded in tests/repo.deps.test.ts).
import { timedFetch } from "./http.ts";

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
