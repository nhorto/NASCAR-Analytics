// Billing domain types (spec §7 entitlement model). Zero runtime imports.

export type ProSource = "subscription" | "season_pass" | "grant";

export interface Entitlement {
  userId: number;
  /** ISO date-time; Pro is on iff this is in the future. */
  proUntil: string;
  proSource: ProSource;
  updatedAt: string;
}

/** What the viewer/gating layers need to know about a user's plan. */
export interface ProStatus {
  pro: boolean;
  proUntil: string | null;
  proSource: ProSource | null;
}
