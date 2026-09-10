// Stripe provider (WS-E) — webhook signature verification plus a minimal REST
// client (plain fetch, no SDK; the repo's one-production-dependency rule
// holds). The null client is the explicit "Stripe not configured" value so
// account deletion and other callers stay unconditional before the owner's
// Stripe account exists.

const STRIPE_API_BASE = "https://api.stripe.com";

/** Stripe's documented default replay window for webhook signatures. */
export const STRIPE_SIG_TOLERANCE_SECONDS = 300;

export type StripeSigVerdict = { ok: true } | { ok: false; reason: string };

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** HMAC-SHA256 hex of `${timestamp}.${body}` — Stripe's v1 signing scheme. */
export function signStripePayload(secret: string, timestamp: string, body: string): string {
  return new Bun.CryptoHasher("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Verify a `Stripe-Signature` header (`t=<unix>,v1=<hex>[,v1=...]`). Rejects a
 * missing/malformed header, a timestamp outside the replay window, and any
 * signature mismatch (constant-time compare). Multiple v1 entries occur while
 * the endpoint secret is being rolled; any one match passes.
 */
export function verifyStripeSignature(opts: {
  secret: string;
  header: string | null;
  body: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}): StripeSigVerdict {
  if (!opts.header) return { ok: false, reason: "missing signature header" };
  let timestamp: string | null = null;
  const v1s: string[] = [];
  for (const part of opts.header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = value;
    if (key === "v1") v1s.push(value);
  }
  if (timestamp === null || v1s.length === 0)
    return { ok: false, reason: "malformed signature header" };
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || String(ts) !== timestamp)
    return { ok: false, reason: "malformed timestamp" };
  const tolerance = opts.toleranceSeconds ?? STRIPE_SIG_TOLERANCE_SECONDS;
  if (Math.abs(opts.nowSeconds - ts) > tolerance)
    return { ok: false, reason: "timestamp outside tolerance" };
  const expected = signStripePayload(opts.secret, timestamp, opts.body);
  for (const candidate of v1s) if (constantTimeEqual(candidate, expected)) return { ok: true };
  return { ok: false, reason: "signature mismatch" };
}

/** A hosted Stripe URL to redirect the buyer to, or why we could not make one. */
export type StripeSessionResult =
  | { ok: true; url: string }
  | { ok: false; detail: string };

export interface CheckoutSessionRequest {
  /** Stripe Price id. Comes from the environment — these ids do not exist
   *  until the owner creates the products (launch plan E1). */
  priceId: string;
  /** `subscription` (monthly, with the trial) or `payment` (season pass).
   *  `applyCheckoutCompleted` branches on this exact string. */
  mode: "subscription" | "payment";
  /** Our user id. Stripe echoes it back on the completed event, and it is the
   *  ONLY link from a payment to an account — a wrong value here is a
   *  successful charge that never becomes Pro. */
  clientReferenceId: string;
  /** Reuse the customer we already know, so a second purchase does not create
   *  a duplicate customer record at Stripe. */
  customerId?: string | null;
  /** Prefill for a first-time buyer (ignored by Stripe when customerId is set). */
  customerEmail?: string | null;
  trialPeriodDays?: number | null;
  successUrl: string;
  cancelUrl: string;
}

export interface StripeClient {
  /** True when a real API key is configured (the null client returns false). */
  readonly configured: boolean;
  /** Cancel a subscription immediately. An already-gone subscription counts
   *  as success — the goal (no future charges) is met either way. */
  cancelSubscription(subscriptionId: string): Promise<{ ok: boolean; detail: string }>;
  /** Hosted Checkout. We never take card details ourselves (spec §7). */
  createCheckoutSession(req: CheckoutSessionRequest): Promise<StripeSessionResult>;
  /** Hosted Customer Portal — card updates, cancellation, invoices. */
  createPortalSession(req: { customerId: string; returnUrl: string }): Promise<StripeSessionResult>;
}

export interface StripeOptions {
  secretKey: string;
  fetchImpl?: typeof fetch;
}

/**
 * Stripe's API is form-encoded, including nested keys as `a[b][c]`. Building
 * that by hand (rather than adding the SDK) keeps the one-production-dependency
 * rule; the shapes used here are small and pinned by tests.
 */
function form(fields: Record<string, string | number | undefined | null>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields))
    if (value !== undefined && value !== null && value !== "") body.set(key, String(value));
  return body;
}

export function createStripeClient(opts: StripeOptions): StripeClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function postForm(path: string, body: URLSearchParams): Promise<StripeSessionResult> {
    try {
      const res = await fetchImpl(`${STRIPE_API_BASE}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!res.ok) return { ok: false, detail: `stripe HTTP ${res.status}: ${await res.text()}` };
      const parsed = (await res.json()) as { url?: unknown };
      if (typeof parsed.url !== "string" || parsed.url === "")
        return { ok: false, detail: "stripe returned no session url" };
      return { ok: true, url: parsed.url };
    } catch (err) {
      return { ok: false, detail: `stripe transport: ${String(err)}` };
    }
  }

  return {
    configured: true,
    async cancelSubscription(subscriptionId) {
      try {
        const res = await fetchImpl(
          `${STRIPE_API_BASE}/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${opts.secretKey}` } },
        );
        if (res.ok) return { ok: true, detail: `canceled ${subscriptionId}` };
        if (res.status === 404)
          return { ok: true, detail: `subscription ${subscriptionId} already gone` };
        return { ok: false, detail: `stripe HTTP ${res.status}: ${await res.text()}` };
      } catch (err) {
        return { ok: false, detail: `stripe transport: ${String(err)}` };
      }
    },

    createCheckoutSession(req) {
      return postForm(
        "/v1/checkout/sessions",
        form({
          mode: req.mode,
          "line_items[0][price]": req.priceId,
          "line_items[0][quantity]": 1,
          client_reference_id: req.clientReferenceId,
          customer: req.customerId,
          // Stripe rejects customer_email together with customer.
          customer_email: req.customerId ? null : req.customerEmail,
          success_url: req.successUrl,
          cancel_url: req.cancelUrl,
          // The trial is Stripe's; we never write one locally. Only meaningful
          // for mode=subscription, and omitted entirely otherwise.
          "subscription_data[trial_period_days]":
            req.mode === "subscription" ? req.trialPeriodDays : null,
          // Stripe Tax (spec §7, owner step E2). Harmless before it is enabled.
          "automatic_tax[enabled]": "true",
        }),
      );
    },

    createPortalSession(req) {
      return postForm(
        "/v1/billing_portal/sessions",
        form({ customer: req.customerId, return_url: req.returnUrl }),
      );
    },
  };
}

/** No key configured: nothing exists at Stripe to cancel, so succeed. */
export function createNullStripe(): StripeClient {
  return {
    configured: false,
    async cancelSubscription(subscriptionId) {
      return { ok: true, detail: `stripe not configured; skipped cancel of ${subscriptionId}` };
    },
    // Failing rather than throwing keeps every caller unconditional: the
    // routes turn this into "checkout isn't available yet", which is the true
    // state of the product until the owner finishes E1-E3.
    async createCheckoutSession() {
      return { ok: false, detail: "stripe not configured" };
    },
    async createPortalSession() {
      return { ok: false, detail: "stripe not configured" };
    },
  };
}
