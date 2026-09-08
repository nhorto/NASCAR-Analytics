# WS-J: Native mobile app — implementation plan

**Status:** ACTIVE — build detail for the launch plan's WS-J, created
2026-09-08 from the owner directive that added D19/D20/D21.
**Parent:** [Production + Paid Launch](2026-09-07-production-and-paid-launch.md) §5 WS-J.
**Spec:** [v1 paid product spec](../../product-specs/2026-09-07-v1-paid-product-spec.md)
(§4 tiers, §5 platform as revised 2026-09-08, §7 billing).

## Shape

An Expo/React Native app for iOS and Android that is a **client of the
existing server, not a second product**. It renders the same free/Pro line
from the same server data and the same server entitlements; nothing about
tiers, pricing, or the model changes. Four separable stages, committed in
this order so each is useful without the next:

1. **Shell + free tier** — scaffold, navigation, theming, the Cup live
   board, and the core free screens. Needs no owner accounts.
2. **Accounts + gating** — sign-up/sign-in/reset against the existing server
   auth API; Pro screens render locked states driven by server entitlements.
   Needs no owner accounts.
3. **Billing (RevenueCat)** — native purchase flow in the app, and a
   RevenueCat webhook on the server as the second entitlement writer.
   Owner-gated (J1/J2).
4. **Native push + stores** — APNs/FCM registration, dispatcher reuse, EAS
   builds, TestFlight/internal track, review, release. Owner-gated (J3–J5).

## Decisions taken here (within plan bounds)

- **Placement: a self-contained `mobile/` package at the repo root.** The
  server is deliberately a single package (`src/` with the layer order); the
  app does not join it. `mobile/` has its own `package.json`, lockfile, and
  `node_modules`, is excluded from the root typecheck/test, and its CI leg
  is `tsc` only. No workspace machinery: the app imports nothing from `src/`
  (see the shared-types decision below), so a workspace would buy hoisting
  headaches and nothing else. This is deliberately simpler than the owner's
  Fripp Island arrangement (npm workspaces) because, unlike Fripp, nothing
  is shared between the packages.
- **Expo SDK 57, expo-router, no state library, plain `fetch`** — mirroring
  the owner's Fripp Island app (`apps/mobile` there), which is the house
  convention: file-based routes under `mobile/src/app/`, features under
  `mobile/src/features/<name>/` split into `api.ts` (fetch + parse),
  `model.ts` (pure view-model), and screen components, with colocated
  Node-runnable tests for `api`/`model`. State is hand-rolled hooks;
  AsyncStorage for local prefs.
- **The server API is the contract; types are re-declared, not imported.**
  The app declares the response types it consumes (in each feature's
  `api.ts`) rather than importing server internals across packages. The
  server's e2e tests already pin those shapes; a drift breaks a server test
  before it breaks the app.
- **Auth is the existing email/password API; session held natively.** No
  social sign-in (D11 stands). The web flow is cookie-session +
  CSRF double-submit; React Native's fetch rides the platform cookie jar,
  which is fine for the session cookie but hostile to double-submit (JS
  cannot read the cookie to echo it). If the scaffold proves the existing
  form endpoints unusable as-is from RN, the fix is a **small additive
  endpoint** (a token-authenticated session variant for native clients,
  same argon2id verify, same rate limits, tested like
  `tests/app.auth.test.ts`) — never a relaxation of the web CSRF posture.
- **Entitlement truth lives on the server, and only there.** The app never
  decides Pro from a local receipt. It reads the viewer's entitlement from
  the server (`pro_until`/`pro_source`, same slice WS-D built) and renders
  locked/unlocked from that. RevenueCat's client-side entitlement flag is
  treated as a purchase-in-flight hint, nothing more. Consequence: a manual
  `bun run grant`, a Stripe purchase on web, or an IAP all unlock the app
  identically, with no app update and no store re-review.
- **Purchases sit behind one interface.** `mobile/src/lib/purchases.ts`
  defines the narrow surface the UI uses (offerings, purchase, restore,
  current status). Until J1/J2 exist there is a stub implementation and no
  RevenueCat SDK dependency; the real adapter lands behind the same
  interface once keys exist. Same pattern for push
  (`mobile/src/lib/push.ts`): no APNs/FCM credentials yet, so a stub with
  the registration surface, wired later.
- **Native push supersedes Web Push on mobile; Web Push stays for the web
  PWA.** WS-H (PR #15) remains correct for web. The `notifications` domain
  grows a native-token row type beside web subscriptions; the dispatcher's
  dedup key (endpoint, race, kind, driver, lap) already generalizes to
  device tokens, so one user on web + phone gets each alert once per device
  but the per-device dedup and quiet-hours logic is shared.
- **Store identity follows the placeholder convention.** D2 (naming) is
  still open, so bundle id, scheme, display name, and icons use the LoopLab
  placeholder exactly like the web manifest does. Bundle ids, IAP product
  ids, and store listings are created only after D2 (J2) — ids are
  permanent, so none get registered under the placeholder.

## Billing: two writers, one truth (extends WS-E, does not rewrite it)

WS-E's Stripe webhook state machine (PR #17) stays exactly as built. WS-J
adds a **second entitlement writer**, not a second entitlement model:

- **Single source of truth:** the server-side `entitlements` table
  (`pro_until`, `pro_source`). Clients — web and app — only ever read it.
  Neither Stripe nor RevenueCat state is consulted at request time.
- **Second writer:** `POST /webhooks/revenuecat` (authenticated with the
  RevenueCat webhook auth header), handled by a state machine in the
  `billing` domain beside — not inside — the Stripe one. It maps RevenueCat
  events (initial purchase, trial start/conversion, renewal, cancellation,
  expiration, billing issue, refund) onto the same entitlement writes §7 of
  the spec defines, with `pro_source` values distinguishing the channel
  (`iap_subscription` | `iap_season_pass` joining the existing set).
- **Dedup within a channel:** each writer is idempotent over its own event
  ids — `stripe_events` already does this; a `revenuecat_events` table
  mirrors it (RevenueCat event `id`, delivered-at, outcome). Redelivery of
  either channel's event is a no-op, and out-of-order delivery is guarded
  the same way the Stripe machine guards it.
- **Reconciliation across channels:** a user's effective entitlement is the
  **maximum `pro_until` across active grants from either channel**; a
  writer may extend or (on refund/expiry of *its own* grant) reduce its own
  contribution but never writes over the other channel's grant. Concretely:
  each write records its channel, and the projected `pro_until` is
  recomputed from the surviving grants — so a Stripe refund cannot strip an
  IAP subscriber, a lapsed IAP cannot strip a season-pass web buyer, and a
  user who somehow pays on both channels gets the later expiry (and a flag
  the owner can see, since double-paying is a support case, not a state
  machine problem).
- **Cross-channel purchase prevention is UX, not enforcement:** the app's
  paywall shows "already Pro" instead of offerings when the server says so;
  the web pricing page already does the equivalent. The reconciliation rule
  above makes the race harmless if both still happen.

## Build checklist

### Stage 1 — shell + free tier (owner-free)
- [ ] `mobile/` scaffold: Expo SDK 57, expo-router, TypeScript strict,
      placeholder identity, `lib/http.ts` (timeout fetch + base URL config).
- [ ] Theming to match the web app's dark, mobile-first look.
- [ ] Home, drivers (list + profile), races (index + race page), recap,
      metrics screens over the existing JSON/data endpoints.
- [ ] Live board: running order, gaps, flag, stage, basic counters from the
      live Worker's API; idle state with next session when dark.
- [ ] Settings screen (server URL in dev, about, legal links).
- [ ] Feature tests for `api.ts` parsers and `model.ts` view-models
      (Node-runnable, no native imports).

### Stage 2 — accounts + entitlement gating (owner-free)
- [ ] Sign-up, sign-in, sign-out, reset flows against the existing server
      auth API; session persisted across app restarts.
- [ ] If RN cannot drive the form endpoints: the additive native-session
      endpoint on the server, with tests beside `tests/app.auth.test.ts`
      (negative cases: wrong password, rate limit, revoked session).
- [ ] Viewer/entitlement read on launch and resume; `pro_until` drives
      gating.
- [ ] Pro screens (predictions, DFS, Xfinity/Trucks, compare-4, exports)
      render locked states with real headline content blurred/withheld
      server-side (same teaser rule as web: real rows never sent).
- [ ] Account screen: plan display, sign out (one/everywhere), delete.

### Stage 3 — billing (owner-gated: J1/J2)
- [ ] `lib/purchases.ts` interface + stub (ships in stage 1–2 PRs; TODO
      markers reference J1/J2).
- [ ] RevenueCat SDK adapter behind the interface; paywall screen from
      server-declared tier copy.
- [ ] Server: `revenuecat_events` table, webhook route + state machine,
      reconciliation per the rule above, all with the same test discipline
      as `tests/billing.webhooks.test.ts` (duplicate, out-of-order, refund,
      cross-channel non-interference cases).
- [ ] Sandbox purchases on both stores reflected in `/account` and the app.

### Stage 4 — native push + stores (owner-gated: J3–J5)
- [ ] `lib/push.ts` interface + stub (ships earlier; TODO references J5).
- [ ] Server: native token registration beside web push subscriptions;
      dispatcher sends via APNs/FCM; shared dedup + quiet hours.
- [ ] EAS config, store metadata, privacy labels, review notes
      (subscription terms, data-availability clause).
- [ ] TestFlight / Play internal track builds; owner installs; release.

## Acceptance (launch plan §5 WS-J)

Mirrored in the parent plan; the parent's boxes are authoritative.

## Out of scope (named so it is not silently dropped)

- Tablets/iPad layouts beyond "renders acceptably" (phone-first, like web).
- Offline caching of Pro data in the app (server teaser rule would be
  defeated by a stale cache; revisit post-launch).
- In-app account **creation of purchases on web** (Apple 3.1.1: the app
  must not link out to the web checkout; the paywall is IAP-only and the
  web price is simply not mentioned in-app).
- NASCAR Fantasy Live, lineup optimizer, any v1 out-of-scope item from the
  spec §12 — unchanged.

## Owner steps (tracked in the parent plan as J1–J5)

J1 RevenueCat account/project/keys · J2 IAP products in App Store Connect +
Play Console (blocked on D2 naming) · J3 Play Console enrollment (new) ·
J4 bundle id under the existing Apple Developer enrollment (shared with the
owner's Fripp Island app) · J5 APNs key + FCM project + store listings.
