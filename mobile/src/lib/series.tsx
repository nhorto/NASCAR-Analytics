// Selected national series (Cup/Xfinity/Trucks), persisted locally (2026-09-09
// UX realignment). The server already serves every series to the app's
// endpoints via ?series=N and gates non-Cup for free viewers (403
// pro_required); this just lets the app ASK for 2/3 instead of hardcoding 1.
// It never decides entitlement — SeriesPills locks the pills for free viewers
// so a locked tap opens the upsell sheet rather than firing a doomed request.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getItem, setItem } from "./storage.ts";

export type SeriesId = 1 | 2 | 3;

export const SERIES: ReadonlyArray<{ id: SeriesId; label: string; short: string }> = [
  { id: 1, label: "Cup Series", short: "Cup" },
  { id: 2, label: "Xfinity Series", short: "Xfinity" },
  { id: 3, label: "Truck Series", short: "Trucks" },
];

/** Cup is the free tier (D16); 2 and 3 require Pro. */
export function seriesRequiresPro(id: SeriesId): boolean {
  return id !== 1;
}

const KEY = "looplab.series";

interface SeriesContextValue {
  series: SeriesId;
  setSeries(id: SeriesId): void;
}

const SeriesContext = createContext<SeriesContextValue>({ series: 1, setSeries: () => {} });

export function SeriesProvider({ children }: { children: ReactNode }) {
  const [series, setSeriesState] = useState<SeriesId>(1);

  useEffect(() => {
    void (async () => {
      const stored = Number(await getItem(KEY));
      if (stored === 1 || stored === 2 || stored === 3) setSeriesState(stored);
    })();
  }, []);

  const setSeries = useCallback((id: SeriesId) => {
    setSeriesState(id);
    void setItem(KEY, String(id));
  }, []);

  const value = useMemo(() => ({ series, setSeries }), [series, setSeries]);
  return <SeriesContext.Provider value={value}>{children}</SeriesContext.Provider>;
}

export function useSeries(): SeriesContextValue {
  return useContext(SeriesContext);
}
