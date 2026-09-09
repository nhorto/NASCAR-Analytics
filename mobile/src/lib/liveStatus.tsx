// App-wide "is a race live" signal, powering the Live tab's red dot badge and
// the Home LIVE banner (2026-09-09 UX realignment). Polls the Worker's cheap
// /api/live/status only while the app is foregrounded — a backgrounded app
// pays nothing, matching the web's tab-only livedot. Never decides Pro or
// anything gated; it is a presentational hint.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import { fetchLiveStatus } from "../features/live/api.ts";

const POLL_MS = 60_000;

const LiveStatusContext = createContext<boolean>(false);

export function LiveStatusProvider({ children }: { children: ReactNode }) {
  const [live, setLive] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const result = await fetchLiveStatus();
      if (!cancelled) setLive(result);
    };
    const start = () => {
      if (timer.current !== null) return;
      void check();
      timer.current = setInterval(check, POLL_MS);
    };
    const stop = () => {
      if (timer.current !== null) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };

    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else stop();
    });

    return () => {
      cancelled = true;
      stop();
      sub.remove();
    };
  }, []);

  return <LiveStatusContext.Provider value={live}>{children}</LiveStatusContext.Provider>;
}

export function useLiveStatus(): boolean {
  return useContext(LiveStatusContext);
}
