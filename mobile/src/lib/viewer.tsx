// The app-wide viewer/entitlement state: who is signed in and whether they
// are Pro, refreshed from GET /api/me on launch and after auth actions. The
// app never decides Pro locally (WS-J sub-plan) — a server-side grant, a
// Stripe web purchase, or (later) an IAP all unlock identically through this
// one read.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { fetchMe, type Me } from "./auth.ts";
import { serverBase } from "./config.ts";

export type ViewerState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "offline" }
  | { status: "signed_in"; me: Me };

interface ViewerContextValue {
  viewer: ViewerState;
  refresh(): Promise<void>;
}

const ViewerContext = createContext<ViewerContextValue>({
  viewer: { status: "loading" },
  refresh: async () => {},
});

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [viewer, setViewer] = useState<ViewerState>({ status: "loading" });

  const refresh = useCallback(async () => {
    const base = await serverBase();
    const result = await fetchMe(base);
    if (result.status === "signed_in") setViewer({ status: "signed_in", me: result.me });
    else if (result.status === "anonymous") setViewer({ status: "anonymous" });
    else setViewer({ status: "offline" });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ viewer, refresh }), [viewer, refresh]);
  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export function useViewer(): ViewerContextValue {
  return useContext(ViewerContext);
}

/** Gating hook for Pro screens: locked unless the server says otherwise. */
export function usePro(): boolean {
  const { viewer } = useViewer();
  return viewer.status === "signed_in" && viewer.me.pro;
}
