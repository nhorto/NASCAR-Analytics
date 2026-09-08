// RevenueCat provider (WS-J) — webhook authorization verification only.
//
// Unlike Stripe, there is no outbound REST client here: RevenueCat cannot
// cancel a live App Store/Play Store subscription on our command (only the
// subscriber can, from the store itself), so there is nothing analogous to
// `stripe.cancelSubscription` to build. Account deletion instead drops the
// user's local RevenueCat-channel grant (billingService.revoke), which is
// the entitlement truth that actually matters (see src/app/auth.ts).
//
// RevenueCat's webhook auth model is a static shared secret, not a computed
// signature: whatever string is configured in the RevenueCat dashboard is
// echoed back verbatim in every delivery's Authorization header. A missing
// or mismatched header is refused before the body is parsed as anything
// meaningful, same posture as the Stripe and Resend webhooks.

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify the `Authorization` header against the configured shared secret.
 * Accepts either the bare secret or a `Bearer <secret>` value, since both
 * conventions appear in RevenueCat dashboard configs.
 */
export function verifyRevenueCatAuthorization(opts: { secret: string; header: string | null }): boolean {
  if (!opts.header) return false;
  const bearer = opts.header.startsWith("Bearer ") ? opts.header.slice("Bearer ".length) : opts.header;
  return constantTimeEqual(bearer, opts.secret) || constantTimeEqual(opts.header, opts.secret);
}
