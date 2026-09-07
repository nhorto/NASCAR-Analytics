// Pure feed-identity canonicalization — no Cloudflare types, so the root test
// program can import it without loading the Durable Object surface.
import type { LiveFeed } from "../src/domains/live/index.ts";

interface ScheduleRecord extends Record<string, unknown> {
  race_id?: number;
  run_type?: number;
  race_name?: string;
  track_id?: number;
  track_name?: string;
}

/**
 * The base feed can partially roll toward the next event while cold (for
 * example, the prior race_id/name paired with the next track). The schedule's
 * race entry is the canonical identity for a known race_id. Live counters stay
 * untouched, and a missing schedule match degrades to the original feed.
 */
export function canonicalizeFeed(feed: LiveFeed, races: unknown[]): LiveFeed {
  const matches = races
    .filter((r): r is ScheduleRecord => Boolean(r && typeof r === "object"))
    .filter((r) => Number(r.race_id) === feed.race_id);
  const race = matches.find((r) => Number(r.run_type) === 3) ?? matches[0];
  if (!race) return feed;
  return {
    ...feed,
    run_name: typeof race.race_name === "string" ? race.race_name : feed.run_name,
    track_id: Number.isFinite(Number(race.track_id)) ? Number(race.track_id) : feed.track_id,
    track_name: typeof race.track_name === "string" ? race.track_name : feed.track_name,
  };
}
