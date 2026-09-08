// Every screen that loads data already owns a `load()` callback (for the
// initial fetch and its own error-retry button); pull-to-refresh is just that
// same callback wired to a spinner. One hook so each screen adds three lines
// instead of re-deriving refreshing-state bookkeeping per file.
import { useCallback, useState } from "react";

export function useReload(load: () => Promise<void>): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);
  return { refreshing, onRefresh };
}
