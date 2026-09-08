// The purchase interface the UI codes against. RevenueCat lands *behind*
// this surface — the stub is the shipped implementation until the owner
// steps exist, and the paywall renders its unavailability honestly.
//
// TODO(WS-J stage 3 — owner steps J1/J2): replace the stub with a RevenueCat
// adapter (react-native-purchases) once the RevenueCat project + IAP
// products exist. Products need the D2 name; do not register placeholder
// ids. After a purchase the server's RevenueCat webhook writes the
// entitlement — the app then re-reads /api/me and must NOT trust the SDK's
// local entitlement flag for gating.
export interface Offering {
  id: string;
  title: string;
  priceLabel: string;
}

export type PurchaseOutcome = { ok: true } | { ok: false; reason: "unavailable" | "cancelled" | "failed" };

export interface PurchasesClient {
  /** False until the RevenueCat adapter ships; the paywall says so. */
  readonly available: boolean;
  offerings(): Promise<Offering[]>;
  purchase(offeringId: string): Promise<PurchaseOutcome>;
  restore(): Promise<PurchaseOutcome>;
}

const stub: PurchasesClient = {
  available: false,
  offerings: async () => [],
  purchase: async () => ({ ok: false, reason: "unavailable" }),
  restore: async () => ({ ok: false, reason: "unavailable" }),
};

export function purchasesClient(): PurchasesClient {
  return stub;
}
