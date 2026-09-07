// Notifications service (WS-H): subscription lifecycle plus the pure decisions
// that govern whether a given alert reaches a given device — kind filtering,
// followed-driver matching, quiet hours, and dedup.
//
// The dedup rule exists because the live Durable Object can restart mid-race
// and re-derive an alert it already emitted (a known live-domain gap), so the
// sender must be idempotent rather than trusting the feed to be exactly-once.
import type { Providers } from "../../providers/index.ts";
import { ALL_KINDS, DEFAULT_KINDS, GLOBAL_KINDS, MAX_FAILURES } from "./config.ts";
import type {
  CandidateAlert,
  PushAlertKind,
  PushMessage,
  PushSubscriptionInput,
  PushSubscriptionRecord,
} from "./types.ts";
import * as repo from "./repo.ts";

type P = Pick<Providers, "db">;

const KIND_SET = new Set<string>(ALL_KINDS);
const GLOBAL_SET = new Set<string>(GLOBAL_KINDS);

/** Validate a subscription from the client. Returns a user-safe reason or null. */
export function validateSubscription(input: PushSubscriptionInput): string | null {
  if (!input.endpoint || !/^https:\/\//.test(input.endpoint))
    return "Push endpoint must be an https URL.";
  if (input.endpoint.length > 2000) return "Push endpoint is too long.";
  // 65-byte P-256 point and 16-byte auth secret, base64url-encoded.
  if (!input.p256dh || input.p256dh.length < 80) return "Subscription key is missing or malformed.";
  if (!input.auth || input.auth.length < 16) return "Subscription auth secret is missing or malformed.";
  for (const kind of input.kinds ?? []) {
    if (!KIND_SET.has(kind)) return `Unknown alert type "${kind}".`;
  }
  for (const hour of [input.quietFromHour, input.quietToHour]) {
    if (hour === null || hour === undefined) continue;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "Quiet hours must be 0–23.";
  }
  return null;
}

export function subscribe(
  p: P,
  userId: number,
  input: PushSubscriptionInput,
  now: Date,
): PushSubscriptionRecord {
  const record: PushSubscriptionRecord = {
    endpoint: input.endpoint,
    userId,
    p256dh: input.p256dh,
    auth: input.auth,
    followedDriverId: input.followedDriverId ?? null,
    kinds: input.kinds && input.kinds.length > 0 ? input.kinds : DEFAULT_KINDS,
    quietFromHour: input.quietFromHour ?? null,
    quietToHour: input.quietToHour ?? null,
    timezone: input.timezone ?? null,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    failureCount: 0,
  };
  repo.upsertSubscription(p.db, record);
  return repo.subscriptionByEndpoint(p.db, input.endpoint)!;
}

export function unsubscribe(p: P, endpoint: string): boolean {
  return repo.deleteSubscription(p.db, endpoint);
}

export function subscriptionsForUser(p: P, userId: number): PushSubscriptionRecord[] {
  return repo.subscriptionsForUser(p.db, userId);
}

export function allSubscriptions(p: P): PushSubscriptionRecord[] {
  return repo.allSubscriptions(p.db);
}

export function subscriptionByEndpoint(p: P, endpoint: string): PushSubscriptionRecord | null {
  return repo.subscriptionByEndpoint(p.db, endpoint);
}

/** The device's local hour, or null when it never told us its timezone. */
export function localHour(timezone: string | null, at: Date): number | null {
  if (!timezone) return null;
  try {
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(at);
    const parsed = Number.parseInt(hour, 10);
    return Number.isFinite(parsed) ? parsed % 24 : null;
  } catch {
    return null; // an unknown zone must not silence a subscriber forever
  }
}

/**
 * Quiet hours, inclusive of `from` and exclusive of `to`, wrapping midnight
 * (22 → 7 means "10pm until 7am"). Off unless both bounds are set.
 */
export function inQuietHours(sub: PushSubscriptionRecord, at: Date): boolean {
  if (sub.quietFromHour === null || sub.quietToHour === null) return false;
  const hour = localHour(sub.timezone, at);
  if (hour === null) return false;
  const { quietFromHour: from, quietToHour: to } = sub;
  if (from === to) return false; // a zero-width window silences nothing
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/**
 * Whether this device wants this alert. Global alerts (caution, green, stage
 * end) go to everyone subscribed to that kind; per-driver alerts only reach
 * devices following that driver.
 */
export function shouldSend(
  sub: PushSubscriptionRecord,
  alert: CandidateAlert,
  at: Date,
): boolean {
  if (!sub.kinds.includes(alert.kind)) return false;
  if (inQuietHours(sub, at)) return false;
  if (GLOBAL_SET.has(alert.kind)) return true;
  if (alert.driverId === null) return false;
  return sub.followedDriverId === alert.driverId;
}

/**
 * Identity of an alert for dedup. Deliberately excludes the message text so a
 * reworded restart of the same event still collapses.
 */
export function dedupKey(alert: CandidateAlert): string {
  return `${alert.kind}:${alert.driverId ?? "all"}:${alert.atLap}`;
}

export function claimSend(p: P, endpoint: string, alert: CandidateAlert, now: Date): boolean {
  return repo.claimSend(p.db, endpoint, alert.raceId, dedupKey(alert), now.toISOString());
}

/** Turn an alert into the notification a device shows. */
export function messageFor(alert: CandidateAlert, raceName: string): PushMessage {
  const titles: Record<PushAlertKind, string> = {
    pit: "Pit stop",
    caution: "Caution",
    green: "Green flag",
    stage_end: "Stage complete",
    lead_change: "New leader",
    position_gain: "Moving up",
    position_loss: "Losing ground",
    out: "Out of the race",
    finish: "Race finished",
  };
  return {
    title: `${titles[alert.kind]} — ${raceName}`,
    body: alert.message,
    url: "/live",
    // Same tag = the device replaces rather than stacks repeat alerts.
    tag: `looplab-${alert.raceId}-${alert.kind}-${alert.driverId ?? "all"}`,
  };
}

/** Record a delivery outcome; returns true when the endpoint should be dropped. */
export function recordOutcome(
  p: P,
  endpoint: string,
  ok: boolean,
  gone: boolean,
  now: Date,
): boolean {
  if (ok) {
    repo.recordSuccess(p.db, endpoint, now.toISOString());
    return false;
  }
  // 404/410 means the browser threw the subscription away — drop it at once
  // rather than retrying a permanently dead endpoint.
  if (gone) {
    repo.deleteSubscription(p.db, endpoint);
    return true;
  }
  if (repo.recordFailure(p.db, endpoint) >= MAX_FAILURES) {
    repo.deleteSubscription(p.db, endpoint);
    return true;
  }
  return false;
}

export function deleteForUser(p: P, userId: number): void {
  repo.deleteSubscriptionsForUser(p.db, userId);
}

export function sendCountForRace(p: P, raceId: number): number {
  return repo.sendCountForRace(p.db, raceId);
}
