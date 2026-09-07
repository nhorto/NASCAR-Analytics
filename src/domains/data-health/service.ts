// Data-health domain — the canary check runner and reusable shape validators.
//
// Pure with respect to I/O: `runChecks` takes a fetcher, so tests inject a fake
// and the app layer injects the real CDN client. Validators are small and
// composable; the app layer builds the concrete check list from the ingestion
// and live domains' URL builders and normalizers.

import type {
  CanaryReport,
  CheckResult,
  FallbackDriverRef,
  FallbackMapping,
  FallbackRaceRef,
  FallbackResultRow,
  FeedOutage,
  FeedStatusRow,
  FetchedJson,
  HealthCheck,
  NascarDataRow,
  ShapeValidator,
} from "./types.ts";
import type { Providers } from "../../providers/index.ts";
import {
  CONSECUTIVE_FAILURES_TO_ALERT,
  FALLBACK_DRIVER_ALIASES,
  FALLBACK_TRACK_ALIASES,
} from "./config.ts";
import * as repo from "./repo.ts";

export type JsonFetcher = (url: string) => Promise<FetchedJson>;

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/** Payload must be an array with at least `min` elements. */
export function expectArray(min = 1): ShapeValidator {
  return (json) => {
    if (!Array.isArray(json)) return `expected an array, got ${describe(json)}`;
    if (json.length < min) return `expected ≥ ${min} element(s), got ${json.length}`;
    return null;
  };
}

/** Payload must be a plain object carrying every listed key (value may be anything but undefined). */
export function expectKeys(keys: string[]): ShapeValidator {
  return (json) => {
    if (!isRecord(json)) return `expected an object, got ${describe(json)}`;
    const missing = keys.filter((k) => json[k] === undefined);
    return missing.length ? `missing key(s): ${missing.join(", ")}` : null;
  };
}

/** Payload must be an object whose `key` is an array with at least `min` elements. */
export function expectArrayAt(key: string, min = 1): ShapeValidator {
  return (json) => {
    if (!isRecord(json)) return `expected an object, got ${describe(json)}`;
    const v = json[key];
    if (!Array.isArray(v)) return `expected "${key}" to be an array, got ${describe(v)}`;
    if (v.length < min) return `expected "${key}" to have ≥ ${min} element(s), got ${v.length}`;
    return null;
  };
}

/** Run validators in order; the first problem wins. */
export function all(...validators: ShapeValidator[]): ShapeValidator {
  return (json) => {
    for (const v of validators) {
      const problem = v(json);
      if (problem) return problem;
    }
    return null;
  };
}

/**
 * Wrap a normalizer as a validator: the payload is acceptable when the
 * normalizer runs without throwing and yields at least `min` rows. This is how
 * the canary reuses the ingestion/live domains' own parsers without importing
 * their internals here — the app layer passes the function in.
 */
export function expectNormalizes<T>(
  normalize: (json: unknown) => T[],
  min = 1,
): ShapeValidator {
  return (json) => {
    let rows: T[];
    try {
      rows = normalize(json);
    } catch (err) {
      return `normalizer threw: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (rows.length < min) return `normalizer produced ${rows.length} row(s), expected ≥ ${min}`;
    return null;
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** Execute every check sequentially (the CDN is rate-limited; we stay polite). */
export async function runChecks(
  checks: HealthCheck[],
  fetchJson: JsonFetcher,
  now: () => number = Date.now,
): Promise<CanaryReport> {
  const results: CheckResult[] = [];
  for (const check of checks) results.push(await runOne(check, fetchJson, now));
  return summarize(results, new Date(now()).toISOString());
}

async function runOne(check: HealthCheck, fetchJson: JsonFetcher, now: () => number): Promise<CheckResult> {
  const started = now();
  const base = { id: check.id, label: check.label, url: check.url };
  try {
    const { status, json } = await fetchJson(check.url);
    const ms = now() - started;
    if (status !== 200) return { ...base, status, ok: false, problem: `HTTP ${status}`, ms };
    const problem = check.validate(json);
    return { ...base, status, ok: problem === null, problem, ms };
  } catch (err) {
    const ms = now() - started;
    const problem = `transport: ${err instanceof Error ? err.message : String(err)}`;
    return { ...base, status: 0, ok: false, problem, ms };
  }
}

export function summarize(results: CheckResult[], at: string): CanaryReport {
  const failures = results.filter((r) => !r.ok).length;
  return { at, results, failures, healthy: failures === 0 };
}

/** Plain-text report, one line per check, for CLI output and alert emails. */
export function formatReport(report: CanaryReport): string {
  const lines = report.results.map((r) => {
    const mark = r.ok ? "✓" : "✗";
    const detail = r.ok ? `${r.status} in ${r.ms} ms` : `${r.problem} (${r.ms} ms)`;
    return `${mark} ${r.label.padEnd(22)} ${detail}\n    ${r.url}`;
  });
  const verdict = report.healthy
    ? `all ${report.results.length} checks healthy`
    : `${report.failures} of ${report.results.length} checks FAILED`;
  return [`canary ${report.at}`, ...lines, verdict].join("\n");
}

// ---------------------------------------------------------------------------
// feed_status: persistence, streaks, outages, alerting (canary v1, WS-C)
// ---------------------------------------------------------------------------

type Db = Pick<Providers, "db">;

/** Persist one canary run (one feed_status row per check). */
export function recordReport(p: Db, report: CanaryReport): void {
  repo.recordReport(p.db, report);
}

/** Length of the failing streak at the head of a newest-first run list. */
export function consecutiveFailures(runs: FeedStatusRow[]): number {
  let n = 0;
  for (const run of runs) {
    if (run.ok) break;
    n++;
  }
  return n;
}

function outageFrom(runs: FeedStatusRow[], threshold: number): FeedOutage | null {
  const streak = consecutiveFailures(runs);
  if (streak < threshold) return null;
  const firstFailing = runs[streak - 1]!;
  return {
    checkId: firstFailing.checkId,
    consecutiveFailures: streak,
    since: firstFailing.runAt,
    problem: runs[0]!.problem,
  };
}

/** Checks currently in outage: their latest `threshold`+ runs all failed. */
export function activeOutages(
  p: Db,
  threshold: number = CONSECUTIVE_FAILURES_TO_ALERT,
): FeedOutage[] {
  const outages: FeedOutage[] = [];
  for (const id of repo.checkIds(p.db)) {
    // threshold+1 runs: enough to know whether the streak is exactly at threshold.
    const outage = outageFrom(repo.latestRuns(p.db, id, threshold + 1), threshold);
    if (outage) outages.push(outage);
  }
  return outages;
}

/**
 * Outages that crossed the threshold with the most recent run — the streak is
 * exactly `threshold` long. Alerting on the crossing (not on every failing
 * day) means one outage sends one email; a recovery followed by a new streak
 * alerts again.
 */
export function newlyAlertableOutages(
  p: Db,
  threshold: number = CONSECUTIVE_FAILURES_TO_ALERT,
): FeedOutage[] {
  return activeOutages(p, threshold).filter((o) => o.consecutiveFailures === threshold);
}

/** Owner-alert email for one or more outages. */
export function formatAlertEmail(
  outages: FeedOutage[],
  report: CanaryReport,
): { subject: string; text: string } {
  const ids = outages.map((o) => o.checkId).join(", ");
  const lines = outages.map(
    (o) =>
      `- ${o.checkId}: ${o.consecutiveFailures} consecutive failures since ${o.since}` +
      (o.problem ? ` (latest: ${o.problem})` : ""),
  );
  return {
    subject: `[looplab canary] upstream feed outage: ${ids}`,
    text: [
      `The daily canary has now failed ${CONSECUTIVE_FAILURES_TO_ALERT}+ consecutive runs for:`,
      ...lines,
      "",
      "Runbook: docs/runbooks/feed-loss.md",
      "",
      formatReport(report),
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Fallback adapter: nascaR.data release rows -> our result rows (pure).
// The release has no CDN ids, so the caller supplies the joins: our points
// races in season order (ordinal) and our known drivers (name index).
// ---------------------------------------------------------------------------

/** Case/punctuation/diacritic-insensitive driver-name key ("A.J." == "AJ"). */
export function canonicalDriverName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\((?:i|r)\)|[#*]/g, "") // entry markers some sources append
    .replace(/[.,'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalTrackName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Alias maps, canonicalized once so lookups are spelling-insensitive.
const TRACK_ALIAS_CANON = new Map(
  Object.entries(FALLBACK_TRACK_ALIASES).map(([from, to]) => [
    canonicalTrackName(from),
    canonicalTrackName(to),
  ]),
);
const DRIVER_ALIAS_CANON = new Map(
  Object.entries(FALLBACK_DRIVER_ALIASES).map(([from, to]) => [
    canonicalDriverName(from),
    canonicalDriverName(to),
  ]),
);

/** Loose equality guarding the ordinal join — a prefix either way passes
 * ("Bristol Motor Speedway" vs "Bristol Motor Speedway Dirt"), and known
 * renames (config aliases) resolve first. */
export function trackNamesMatch(a: string, b: string): boolean {
  const resolve = (n: string) => {
    const c = canonicalTrackName(n);
    return TRACK_ALIAS_CANON.get(c) ?? c;
  };
  const ca = resolve(a);
  const cb = resolve(b);
  return ca === cb || ca.startsWith(cb) || cb.startsWith(ca);
}

export function mapFallbackResults(
  rows: NascarDataRow[],
  races: FallbackRaceRef[],
  drivers: FallbackDriverRef[],
): FallbackMapping {
  const raceByOrdinal = new Map(races.map((r) => [r.ordinal, r]));
  const driverByName = new Map(drivers.map((d) => [canonicalDriverName(d.fullName), d.driverId]));

  const byOrdinal = new Map<number, NascarDataRow[]>();
  for (const row of rows) {
    const group = byOrdinal.get(row.race);
    if (group) group.push(row);
    else byOrdinal.set(row.race, [row]);
  }

  const mapping: FallbackMapping = { races: [], unmatchedDrivers: [], skippedRaces: [] };
  const unmatched = new Set<string>();
  for (const [ordinal, group] of [...byOrdinal.entries()].sort(([a], [b]) => a - b)) {
    const ref = raceByOrdinal.get(ordinal);
    if (!ref) {
      mapping.skippedRaces.push({ ordinal, reason: "no matching points race in our schedule" });
      continue;
    }
    const releaseTrack = group[0]!.track;
    if (!trackNamesMatch(ref.trackName, releaseTrack)) {
      // An ordinal misalignment (e.g. a points race our db lacks a weekend
      // feed for) would silently attach results to the wrong race — refuse.
      mapping.skippedRaces.push({
        ordinal,
        reason: `track mismatch: ours "${ref.trackName}" vs release "${releaseTrack}"`,
      });
      continue;
    }
    const mapped: FallbackResultRow[] = [];
    for (const row of group) {
      const canonical = canonicalDriverName(row.driver);
      const driverId =
        driverByName.get(canonical) ?? driverByName.get(DRIVER_ALIAS_CANON.get(canonical) ?? "");
      if (driverId === undefined) {
        unmatched.add(row.driver);
        continue;
      }
      mapped.push({
        raceId: ref.raceId,
        driverId,
        finishingPosition: row.finish,
        startingPosition: row.start,
        carNumber: row.car,
        teamName: row.team,
        lapsLed: row.led,
        carMake: row.make,
        pointsEarned: row.points,
        lapsCompleted: row.laps,
        finishingStatus: row.status,
      });
    }
    mapping.races.push({ raceId: ref.raceId, ordinal, rows: mapped });
  }
  mapping.unmatchedDrivers = [...unmatched].sort();
  return mapping;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array[${v.length}]`;
  return typeof v;
}
