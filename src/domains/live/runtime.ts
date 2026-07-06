// Live race companion — runtime composition. Still PURE and Workers-safe (no
// bun:sqlite, no node builtins, no Cloudflare APIs): it only sequences the
// service's pure steps into the exact payload the edge Durable Object stores and
// serves, plus the rolling history the edge persists between ticks. Keeping this
// here (not in the Worker) means the DO is a thin I/O adapter over tested logic.

import {
  attachTrends,
  computeLiveMetrics,
  deriveAlerts,
  deriveBattles,
  deriveFieldLeaders,
  deriveMovers,
  normalizeFeed,
  pitCycleModel,
  updateHistory,
} from "./service.ts";
import type {
  LiveAlertEvent,
  LiveBaselines,
  LiveDriverRow,
  LiveFeed,
  LiveHistory,
  LivePayload,
  LiveSnapshot,
  NextRace,
  NormalizedPitStop,
  PitCyclePrediction,
  TrackStrategy,
} from "./types.ts";

export interface ProcessFeedOptions {
  /** League baselines for the live series (null → residual metrics stay null). */
  baselines: LiveBaselines | null;
  /** Previous enriched snapshot, for alert diffing + battle "closing" (null on tick 1). */
  prevSnapshot: LiveSnapshot | null;
  /** Rolling alert feed carried over from the previous tick (newest first). */
  prevAlerts?: LiveAlertEvent[];
  /** Cap on the rolling alert feed. */
  maxAlerts?: number;
  /** Rolling per-lap history from the previous tick (reset automatically on a new race). */
  prevHistory?: LiveHistory | null;
  /** Next scheduled session for the idle "Next Up" card. */
  nextRace?: NextRace | null;
  /**
   * Authoritative pit stops from live-pit-data.json (green-flag aware). When
   * present, supersedes the coarse/placeholder-zeroed live-feed pit_stops.
   */
  pitStops?: NormalizedPitStop[];
  /** Per-track strategy calibration (fuel window). Null ⇒ default stint. */
  trackStrategy?: TrackStrategy | null;
  /** Wall-clock ms the caller stamps the payload with (DO passes Date.now()). */
  fetchedAt: number;
}

export interface ProcessFeedResult {
  /** The client-facing payload the DO stores under `latest` and /api/live returns. */
  payload: LivePayload;
  /** Enriched snapshot to persist as the next tick's `prevSnapshot`. */
  snapshot: LiveSnapshot;
  /** Updated rolling history to persist for the next tick. */
  history: LiveHistory;
  /** Just the events newly derived this tick (for logging / future push). */
  newAlerts: LiveAlertEvent[];
}

/**
 * One upstream feed → the full live payload: normalized + metric-enriched +
 * trend-enriched leaderboard, a merged rolling alert feed, pit-cycle predictions,
 * and Race-Overview derivations (movers / battles / field loop leaders). Also
 * advances the rolling history. The inputs are never mutated.
 */
export function processFeed(feed: LiveFeed, opts: ProcessFeedOptions): ProcessFeedResult {
  const base = normalizeFeed(feed);
  const withMetrics: LiveDriverRow[] = computeLiveMetrics(base, opts.baselines);

  // History resets when the race changes; otherwise extends the prior buffer.
  const sameRace = opts.prevSnapshot ? opts.prevSnapshot.raceId === base.raceId : false;
  const history = updateHistory(
    sameRace ? (opts.prevHistory ?? null) : null,
    { ...base, drivers: withMetrics },
  );

  const drivers = attachTrends(withMetrics, history);
  const snapshot: LiveSnapshot = { ...base, drivers };

  const newAlerts = deriveAlerts(opts.prevSnapshot, snapshot, {});
  const maxAlerts = opts.maxAlerts ?? 40;
  const alerts = [...newAlerts, ...(opts.prevAlerts ?? [])].slice(0, maxAlerts);

  const pitCycles: PitCyclePrediction[] = pitCycleModel(snapshot, {
    pitStops: opts.pitStops,
    feed,
    trackStrategy: opts.trackStrategy ?? null,
  });
  const movers = deriveMovers(drivers);
  const battles = deriveBattles(drivers, opts.prevSnapshot?.drivers ?? null);
  const fieldLeaders = deriveFieldLeaders(drivers);

  const payload: LivePayload = {
    ok: true,
    live: snapshot.isLive,
    fetchedAt: opts.fetchedAt,
    snapshot,
    alerts,
    pitCycles,
    movers,
    battles,
    fieldLeaders,
    nextRace: opts.nextRace ?? null,
  };

  return { payload, snapshot, history, newAlerts };
}
