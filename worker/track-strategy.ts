// GENERATED — do not edit by hand.
// Baked per-track strategy calibration (fuel window + tire falloff) for the edge
// live model, copied from dist/data/track-strategy.json (emitted by
// `bun run calibrate`, which reads the historical backfill). Like baselines,
// these are tiny and change ~weekly.
//
// This checked-in stub is EMPTY: calibration must run where the NASCAR CDN /
// backfill are reachable (locally), then regenerate this file and redeploy.
// With an empty table the live model falls back to DEFAULT_STINT_LAPS — correct,
// just uncalibrated. Regenerate with:  bun run calibrate  (then redeploy worker).
import type { TrackStrategyTable } from "../src/domains/live/index.ts";

export const TRACK_STRATEGY: TrackStrategyTable = {
  byTrackId: {},
  byTrackType: {},
};

/** Per-track strategy with a track-type fallback; null when neither is known. */
export function strategyFor(trackId: number, trackType?: string | null) {
  const byId = TRACK_STRATEGY.byTrackId[String(trackId)];
  if (byId) return byId;
  if (trackType && TRACK_STRATEGY.byTrackType[trackType]) return TRACK_STRATEGY.byTrackType[trackType];
  return null;
}
