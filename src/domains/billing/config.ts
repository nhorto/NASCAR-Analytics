// Billing policy knobs (spec §7). No external imports (architecture rule).

/** Days of Pro kept after a failed renewal; WS-E's webhook writer applies it. */
export const GRACE_DAYS = 3;

export const PRO_SOURCES = ["subscription", "season_pass", "grant"] as const;

/**
 * Where a season pass entitles Pro until (spec §4 / decision D5): passes sold
 * in the 2026 launch window are 2027 season passes and include the rest of
 * 2026 free, so one fixed end date covers both. The 2027 championship race is
 * in November; the owner revisits this (and renewal email copy) before any
 * 2028 sales.
 */
export const SEASON_PASS_UNTIL = "2027-11-30T23:59:59Z";

/** Subscription statuses that keep the entitlement extending (past_due keeps
 *  Pro through the grace window; Stripe's retries may still recover it). */
export const ENTITLING_SUB_STATUSES = ["trialing", "active", "past_due"] as const;
