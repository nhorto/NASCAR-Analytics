// Billing policy knobs (spec §7). No external imports (architecture rule).

/** Days of Pro kept after a failed renewal; WS-E's webhook writer applies it. */
export const GRACE_DAYS = 3;

export const PRO_SOURCES = ["subscription", "season_pass", "grant"] as const;
