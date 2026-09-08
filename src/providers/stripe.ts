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

export interface StripeClient {
  /** True when a real API key is configured (the null client returns false). */
  readonly configured: boolean;
  /** Cancel a subscription immediately. An already-gone subscription counts
   *  as success — the goal (no future charges) is met either way. */
  cancelSubscription(subscriptionId: string): Promise<{ ok: boolean; detail: string }>;
}

export interface StripeOptions {
  secretKey: string;
  fetchImpl?: typeof fetch;
}

export function createStripeClient(opts: StripeOptions): StripeClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
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
  };
}

/** No key configured: nothing exists at Stripe to cancel, so succeed. */
export function createNullStripe(): StripeClient {
  return {
    configured: false,
    async cancelSubscription(subscriptionId) {
      return { ok: true, detail: `stripe not configured; skipped cancel of ${subscriptionId}` };
    },
  };
}
