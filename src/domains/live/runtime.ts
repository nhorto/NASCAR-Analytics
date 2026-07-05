// Live race companion — runtime composition. Still PURE and Workers-safe (no
// bun:sqlite, no node builtins, no Cloudflare APIs): it only sequences the
// service's pure steps into the exact payload the edge Durable Object stores and
// serves. Keeping this here (not in the Worker) means the DO is a thin I/O adapter
// over logic that is unit-tested in Bun.

import {
  computeLiveMetrics,
  deriveAlerts,
  normalizeFeed,
  pitCycleModel,
} from "./service.ts";
import type {
  LiveAlertEvent,
  LiveBaselines,
  LiveDriverRow,
  LiveFeed,
  LivePayload,
  LiveSnapshot,
  PitCyclePrediction,
} from "./types.ts";

export interface ProcessFeedOptions {
  /** League baselines for the live series (null → residual metrics stay null). */
  baselines: LiveBaselines | null;
  /** Previous enriched snapshot, for alert diffing (null on the first tick). */
  prevSnapshot: LiveSnapshot | null;
  /** Rolling alert feed carried over from the previous tick (newest first). */
  prevAlerts?: LiveAlertEvent[];
  /** Cap on the rolling alert feed. */
  maxAlerts?: number;
  /** Wall-clock ms the caller stamps the payload with (DO passes Date.now()). */
  fetchedAt: number;
}

export interface ProcessFeedResult {
  /** The client-facing payload the DO stores under `latest` and /api/live returns. */
  payload: LivePayload;
  /** Enriched snapshot to persist as the next tick's `prevSnapshot`. */
  snapshot: LiveSnapshot;
  /** Just the events newly derived this tick (for logging / future push). */
  newAlerts: LiveAlertEvent[];
}

/**
 * One upstream feed → the full live payload: normalized + enriched leaderboard,
 * a merged rolling alert feed (new events prepended, capped), and pit-cycle
 * predictions. The input snapshot is never mutated.
 */
export function processFeed(feed: LiveFeed, opts: ProcessFeedOptions): ProcessFeedResult {
  const base = normalizeFeed(feed);
  const drivers: LiveDriverRow[] = computeLiveMetrics(base, opts.baselines);
  const snapshot: LiveSnapshot = { ...base, drivers };

  const newAlerts = deriveAlerts(opts.prevSnapshot, snapshot, {});
  const maxAlerts = opts.maxAlerts ?? 40;
  const alerts = [...newAlerts, ...(opts.prevAlerts ?? [])].slice(0, maxAlerts);

  const pitCycles: PitCyclePrediction[] = pitCycleModel(snapshot, feed);

  const payload: LivePayload = {
    ok: true,
    live: snapshot.isLive,
    fetchedAt: opts.fetchedAt,
    snapshot,
    alerts,
    pitCycles,
  };

  return { payload, snapshot, newAlerts };
}
