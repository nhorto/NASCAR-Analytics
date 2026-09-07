// Data-health domain — the canary check runner and reusable shape validators.
//
// Pure with respect to I/O: `runChecks` takes a fetcher, so tests inject a fake
// and the app layer injects the real CDN client. Validators are small and
// composable; the app layer builds the concrete check list from the ingestion
// and live domains' URL builders and normalizers.

import type {
  CanaryReport,
  CheckResult,
  FetchedJson,
  HealthCheck,
  ShapeValidator,
} from "./types.ts";

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
