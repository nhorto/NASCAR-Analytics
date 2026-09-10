# WS-E (part 2) — Checkout, Portal, and the pricing CTAs

**Status:** ACTIVE — created 2026-09-10.
**Parent:** [Production + Paid Launch](2026-09-07-production-and-paid-launch.md) §5 WS-E.
**Spec:** [v1 paid product spec](../../product-specs/2026-09-07-v1-paid-product-spec.md) §7.

## What already exists (do not rebuild)

PR #17 shipped the **inbound** half of WS-E: the webhook state machine
(`billingService.applyStripeEvent`), `stripe_events` idempotency,
`billing_profiles` with an out-of-order guard, entitlement writes per spec §7,
signature verification, and cancel-on-delete. All of it is tested against
synthetic payloads.

What is missing is the **outbound** half — nothing in the product actually
*sends* a user to Stripe. `/pricing` says "Checkout opens soon".

## Shape

Three routes, one new provider capability each side:

| Route | Method | Does |
|---|---|---|
| `/billing/checkout` | POST | Create a Checkout Session, 303 to Stripe |
| `/billing/portal` | POST | Create a Customer Portal session, 303 to Stripe |
| `/billing/return` | GET | Post-checkout landing; explains the entitlement lag |

The webhook is already the only entitlement writer, so **these routes write
nothing**. That is the whole design: checkout hands off to Stripe, Stripe calls
the webhook, the webhook writes `pro_until`. A user returning from checkout
before the webhook lands sees "activating", not a lie about being Pro.

## Decisions taken here (within plan bounds)

- **Price ids come from the environment, never the repo.** They are
  Stripe-generated and do not exist until E1. `STRIPE_PRICE_MONTHLY` and
  `STRIPE_PRICE_SEASON` join the secret set. This also gives the honest
  definition of "billing is configured": a secret key *and* the price id for
  the plan being bought.
- **Degrade to today's copy, never to a broken button.** With no key or no
  price id, `/pricing` keeps rendering the existing "checkout opens soon"
  note. A button that 500s is worse than no button, and this is the state the
  site is in until the owner finishes E1–E3.
- **`client_reference_id` is our user id, as a decimal string**, and `mode` is
  `subscription` or `payment`. This is not a free choice — `applyCheckoutCompleted`
  already parses exactly that shape, and getting it wrong means a completed
  payment that never becomes Pro. Asserted in tests on both sides.
- **The trial is Stripe's, not ours.** `subscription_data[trial_period_days]=7`
  (D5). We never write a trial entitlement locally; `customer.subscription.created`
  with status `trialing` does it through the existing machine.
- **Portal needs no new state.** `billing_profiles.customerId` already exists
  for anyone who has ever checked out. No profile → no portal button.
- **Reuse the auth module's POST discipline** — CSRF double-submit, 303 PRG,
  rate limit — rather than inventing a second convention. These are money
  endpoints; they get the same guards as sign-in, not fewer.

## Build checklist

- [x] `providers/stripe.ts`: `createCheckoutSession` + `createPortalSession` ✅
      2026-09-10 — form-encoded POST, no SDK; the null client returns a
      `stripe not configured` failure rather than throwing.
- [x] `env.ts`: `stripeSecretKey`, `stripePriceMonthly`, `stripePriceSeason` ✅
      with a boot warning for the in-between state (key present, no price ids).
- [x] `billing/config.ts`: `TRIAL_DAYS = 7` ✅.
- [x] `src/app/billing.ts`: the three routes ✅. `/pricing` moved here from
      `auth.ts` — it is a billing page and now needs the offer set.
- [x] `/pricing`: real CTAs when configured, today's copy when not ✅.
- [x] `/account`: "Manage billing" portal button + past-due banner ✅. The
      button is hidden without a Stripe customer, so an IAP subscriber is not
      sent to a portal that has never heard of them.
- [x] `server.ts`: handler wired ahead of `handleAuthRequest` ✅. The Stripe
      client was already built from `STRIPE_SECRET_KEY` in `providers()`.
- [x] Tests ✅ — 17 e2e in `tests/app.billing.test.ts` (CSRF miss, signed out,
      unverified, already Pro, unknown plan, Stripe unconfigured, Stripe down,
      portal without a profile, customer reuse) plus 6 wire-format tests in
      `tests/providers.stripe.test.ts` pinning the exact form encoding.

## Acceptance

- [x] A configured server sends a signed-in verified user to a real Checkout
      URL for both plans, with `client_reference_id` = their user id. ✅
- [x] An unconfigured server renders `/pricing` with no purchase button and
      never 500s. ✅ (asserted against a second server built with the null
      client — the state the product is actually in today)
- [x] The post-checkout landing does not claim Pro before the webhook lands. ✅
- [x] `bun test` green including architecture tests. ✅ 903 pass / 0 fail.
- [ ] **Owner-gated (E1–E3):** a real Stripe test-mode run — trial signup, card
      update, cancel, pass purchase — each reflected on `/account` within one
      webhook. This is the launch plan's existing unticked box; the code below
      is what makes it runnable.

## Out of scope

- Proration/plan switching (portal handles it; we do not model it).
- Coupons, referrals, gift passes.
- Dunning email (Stripe's own dunning is on; our banner covers the in-app half).
