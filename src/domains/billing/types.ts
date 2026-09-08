// Billing domain types (spec §7 entitlement model). Zero runtime imports.

export type ProSource =
  | "subscription"
  | "season_pass"
  | "grant"
  /** Store purchases (WS-J): the RevenueCat channel's two product shapes. */
  | "iap_subscription"
  | "iap_season_pass";

/**
 * Who wrote a grant. Stripe and RevenueCat are independent writers of the same
 * entitlement (WS-J), and `manual` is the tester/support path.
 */
export type GrantChannel = "stripe" | "revenuecat" | "manual";

/** The slot a channel writes into. One per product shape, so a season pass and
 *  a subscription on the same channel cannot overwrite each other. */
export type GrantKind = "subscription" | "season_pass" | "manual";

/**
 * One channel's contribution to a user's Pro. The effective entitlement is the
 * max `proUntil` across a user's grants; a channel may extend or claw back its
 * own slot and nothing else.
 */
export interface EntitlementGrant {
  userId: number;
  channel: GrantChannel;
  kind: GrantKind;
  /** ISO date-time this grant entitles Pro until. */
  proUntil: string;
  /** The source label projected onto the entitlement when this grant wins. */
  proSource: ProSource;
  updatedAt: string;
}

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

/**
 * The user ↔ RevenueCat mapping and the store subscription state (WS-J), the
 * twin of BillingProfile. Entitlement stays separate for the same reason:
 * `pro_until` is the only gating truth, this row is how store events find it.
 */
export interface RevenueCatProfile {
  userId: number;
  /** The id RevenueCat knows this user by; the app sets it to our user id. */
  appUserId: string;
  /** APP_STORE | PLAY_STORE | ... — the store that owns the subscription. */
  store: string | null;
  /** PRODUCTION | SANDBOX. A sandbox grant is real Pro, so it must be visible. */
  environment: string | null;
  productId: string | null;
  /** trialing | active | billing_issue | canceled | expired | refunded. */
  entitlementStatus: string | null;
  /** False once the user turns off renewal; Pro still runs to `expiresAt`. */
  autoRenew: boolean;
  /** Unix ms of the store expiry the entitlement was last written from. */
  expiresAt: number | null;
  /** `event_timestamp_ms` of the newest event applied to this profile — older
   *  events arriving later are skipped (out-of-order delivery guard). */
  lastEventAt: number;
  updatedAt: string;
}

/** What feeding one RevenueCat event through the state machine did. */
export interface RevenueCatOutcome {
  /** False when the event was recorded but changed nothing. */
  applied: boolean;
  /** Machine-readable summary for logs and tests. */
  action:
    | "malformed_event"
    | "duplicate"
    | "stale_event"
    | "unknown_subscriber"
    | "missing_reference"
    | "unhandled_type"
    | "purchase_granted"
    | "season_pass_granted"
    | "subscription_renewed"
    | "cancellation_recorded"
    | "uncancellation_recorded"
    | "product_changed"
    | "billing_issue_grace"
    | "subscription_expired"
    | "refund_revoked"
    | "refund_ignored"
    | "alias_linked"
    | "grant_transferred";
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
