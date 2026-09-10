// The React half of lib/season.ts, kept separate so the fetch stays importable
// from Node-runnable feature modules (see season.ts).
import { useCallback, useEffect, useState } from "react";
import { serverBase } from "./config.ts";
import { fetchLatestSeason } from "./season.ts";

/**
 * Bootstrap hook for screens that need the latest season before they can
 * render their own controls (Compare, the track explorer). Distinguishes
 * "still loading" (`undefined`) from "the fetch failed" (`null`) — without
 * this, a network hiccup on first mount left those screens spinning forever
 * with no way to recover.
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
