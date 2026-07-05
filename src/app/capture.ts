// Live-feed capture tool (local/dev ops — NOT shipped to the edge). Polls the
// NASCAR public CDN live feeds during a session and writes timestamped raw
// snapshots to disk, so we can (a) validate the parser against real racing
// conditions and (b) build realistic fixtures — consecutive snapshots with
// position/pit/flag changes — for deriveAlerts. Reuses the live domain's flag
// config so "live vs idle" here means exactly what the app means by it.
//
// Usage: bun run capture [--series 1] [--interval 5] [--ticks N] [--out DIR]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { liveConfig } from "../domains/live/index.ts";
import type { FlagState } from "../domains/live/index.ts";

// A browser User-Agent is MANDATORY — the CDN 403s requests without one.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BASE = "https://cf.nascar.com";

/** Base feed = whatever session is currently on track; series_N = that series only. */
function liveFeedUrl(series?: number): string {
  return series && series !== 1
    ? `${BASE}/live/feeds/series_${series}/live-feed.json`
    : `${BASE}/live/feeds/live-feed.json`;
}
const FLAG_URL = `${BASE}/live/feeds/live-flag-data.json`;
function pitUrl(series: number, raceId: number): string {
  return `${BASE}/cacher/live/series_${series}/${raceId}/live-pit-data.json`;
}

interface Fetched {
  ok: boolean;
  status: number;
  body: string;
}
async function getText(url: string): Promise<Fetched> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
    return { ok: r.ok, status: r.status, body: await r.text() };
  } catch (e) {
    return { ok: false, status: 0, body: String(e) };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface CaptureOptions {
  /** Specific series feed; omit to poll the base "current session" feed. */
  series?: number;
  intervalMs: number;
  /** Stop after this many distinct snapshots; 0 = run until Ctrl-C. */
  ticks: number;
  outDir: string;
  log: { info(m: string): void; warn(m: string): void };
}

export async function captureLive(opts: CaptureOptions): Promise<number> {
  mkdirSync(opts.outDir, { recursive: true });
  let stop = false;
  const onSignal = () => {
    stop = true;
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  opts.log.info(
    `capturing → ${opts.outDir} (every ${opts.intervalMs / 1000}s, ` +
      `${opts.ticks ? `${opts.ticks} snapshots` : "until Ctrl-C"}). Waiting for the feed…`,
  );

  let saved = 0;
  let lastKey = "";
  while (!stop && (opts.ticks === 0 || saved < opts.ticks)) {
    const feedRes = await getText(liveFeedUrl(opts.series));
    if (!feedRes.ok) {
      opts.log.warn(`feed HTTP ${feedRes.status}; retrying in ${opts.intervalMs / 1000}s`);
      await sleep(opts.intervalMs);
      continue;
    }

    let feed: {
      race_id: number;
      series_id: number;
      lap_number: number;
      laps_in_race: number;
      elapsed_time: number;
      flag_state: number;
      run_name?: string;
      vehicles?: Array<{ running_position: number; driver?: { full_name?: string } }>;
    };
    try {
      feed = JSON.parse(feedRes.body);
    } catch {
      opts.log.warn("feed body was not JSON; retrying");
      await sleep(opts.intervalMs);
      continue;
    }

    const flag: FlagState = liveConfig.FLAG_STATES[feed.flag_state] ?? "unknown";
    const isLive = liveConfig.LIVE_FLAG_STATES.has(flag);
    // A snapshot is "new" when race/lap/clock/flag changed — avoids dupes when we
    // poll faster than the ~1–3s CDN refresh.
    const key = `${feed.race_id}:${feed.lap_number}:${feed.elapsed_time}:${feed.flag_state}`;

    if (key !== lastKey) {
      lastKey = key;
      const seq = String(saved).padStart(4, "0");
      const stem = join(opts.outDir, `feed-${seq}-lap${feed.lap_number}`);
      await Bun.write(`${stem}.json`, feedRes.body);
      const flagRes = await getText(FLAG_URL);
      if (flagRes.ok) await Bun.write(`${stem}.flag.json`, flagRes.body);
      const pitRes = await getText(pitUrl(feed.series_id, feed.race_id));
      if (pitRes.ok) await Bun.write(`${stem}.pit.json`, pitRes.body);
      saved++;

      const leader = (feed.vehicles ?? []).find((v) => v.running_position === 1);
      opts.log.info(
        `[${saved}] ${isLive ? "LIVE" : "idle"} ${flag} · lap ${feed.lap_number}/${feed.laps_in_race} · ` +
          `leader ${leader?.driver?.full_name ?? "?"} · ${feed.run_name ?? "session"}`,
      );
    } else {
      opts.log.info(`… no change (lap ${feed.lap_number}, ${flag})`);
    }

    if (!stop && (opts.ticks === 0 || saved < opts.ticks)) {
      // When nothing is on track, back off to keep this cheap while we wait.
      await sleep(isLive ? opts.intervalMs : Math.max(opts.intervalMs, liveConfig.IDLE_POLL_INTERVAL_MS));
    }
  }

  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  opts.log.info(`done — ${saved} snapshot(s) written to ${opts.outDir}`);
  return saved;
}
