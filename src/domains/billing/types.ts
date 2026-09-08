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

/**
 * The user ↔ Stripe mapping plus subscription state the UI shows (past-due
 * banner, "cancels at period end"). Entitlement stays separate: `pro_until`
 * is the single source of gating truth, this row is how webhooks find it.
 */
export interface BillingProfile {
  userId: number;
  customerId: string;
  subscriptionId: string | null;
  /** Stripe's status string (trialing | active | past_due | canceled | ...). */
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  /** Unix seconds; the entitlement written from it includes the grace days. */
  currentPeriodEnd: number | null;
  /** `created` of the newest Stripe event applied to this profile — older
   *  events that arrive later are skipped (out-of-order delivery guard). */
  lastEventCreated: number;
  updatedAt: string;
}

/** What feeding one Stripe event through the state machine did. */
export interface WebhookOutcome {
  /** False when the event was recorded but changed nothing. */
  applied: boolean;
  /** Machine-readable summary for logs and tests. */
  action:
    | "malformed_event"
    | "duplicate"
    | "stale_event"
    | "unknown_customer"
    | "missing_reference"
    | "unhandled_type"
    | "checkout_linked"
    | "season_pass_granted"
    | "subscription_synced"
    | "invoice_paid"
    | "payment_failed_grace"
    | "subscription_ended"
    | "refund_revoked"
    | "refund_ignored";
}
