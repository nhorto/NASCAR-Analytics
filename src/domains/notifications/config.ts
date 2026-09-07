// Push policy knobs (WS-H). No external imports (architecture rule).
import type { PushAlertKind } from "./types.ts";

/** Sent when a device subscribes without naming its own preferences. */
export const DEFAULT_KINDS: PushAlertKind[] = ["pit", "caution", "stage_end", "finish"];

export const ALL_KINDS: PushAlertKind[] = [
  "lead_change", "position_gain", "position_loss", "pit",
  "caution", "green", "stage_end", "out", "finish",
];

/** Alerts that are about the race itself, not any one driver. */
export const GLOBAL_KINDS: PushAlertKind[] = ["caution", "green", "stage_end"];

/** Quiet hours are opt-in (launch plan WS-H: "quiet hours off by default"). */
export const QUIET_HOURS_DEFAULT = null;

/** Consecutive failures tolerated before an endpoint is dropped. */
export const MAX_FAILURES = 3;

/** How long a push service may hold an undelivered message, seconds. */
export const PUSH_TTL_SECONDS = 900; // 15 min — a stale race alert is noise

/** VAPID JWTs are short-lived; push services reject anything beyond 24 h. */
export const VAPID_JWT_TTL_SECONDS = 12 * 60 * 60;
