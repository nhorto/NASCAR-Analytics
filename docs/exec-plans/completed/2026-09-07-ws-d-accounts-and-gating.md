# WS-D: Accounts and Gating — implementation plan

**Status:** COMPLETED 2026-09-07 — build detail for the launch plan's WS-D
(week 3, delivered in week 1; no owner-gated acceptance items). 354 tests /
0 fail, both typechecks green at completion.
**Parent:** [Production + Paid Launch](../active/2026-09-07-production-and-paid-launch.md) §5 WS-D.
**Spec:** [v1 paid product spec](../../product-specs/2026-09-07-v1-paid-product-spec.md) §4 (tiers), §6 (accounts), §7 (entitlement model), §8 (page behaviour).

Started 2026-09-07 while owner-side steps (A1–A6) remain blocked — WS-D needs no
external accounts: password auth is `Bun.password` (argon2id), emails go through
the existing `EmailClient` (null client until Resend/A4 exists), and gating is
pure server logic.

## Shape

Two new domains plus app-layer composition, respecting the layer rules:

- **`src/domains/accounts/`** — users, sessions, verification/reset tokens,
  rate-limit attempts. Owns `users`, `sessions`, `auth_tokens`, `auth_attempts`.
  Service is the only writer; argon2id via `Bun.password` (spec §6); session
  cookies hold a random 256-bit token, the db stores only its SHA-256.
- **`src/domains/billing/` (minimal, WS-D slice)** — the entitlement model of
  spec §7 only: `entitlements(user_id, pro_until, pro_source)`, `isPro`,
  `grantPro` (manual grants for testers — pulled forward from WS-E's build list
  because gating is untestable without a way to become Pro), `canPurchase`
  (verified-email guard the WS-E checkout will call). The Stripe webhook state
  machine, portal links, and `stripe_events` idempotency remain WS-E.
- **App layer** — `viewer.ts` (cookie → session → entitlement → one `Viewer`
  object per request; CSRF double-submit helpers; client IP), `gate.ts` (pure
  gating decisions), `auth.ts` (auth routes), `pages/{auth,account,pricing,teaser}.ts`,
  server wiring, private cache-control for cookie-bearing requests.

Cross-domain composition (accounts + billing → viewer) happens in the app
layer; domain runtimes can't import each other's services.

## Decisions taken here (within spec/register bounds)

- **Sessions:** 30-day rolling expiry (spec §6) implemented as: refresh
  `expires_at` when the session was last refreshed >24 h ago. httpOnly,
  SameSite=Lax, Secure in production, path=/.
- **CSRF:** double-submit cookie (`csrf` httpOnly cookie + hidden form field,
  compared on every POST) on top of SameSite=Lax. Works for anonymous forms
  (sign-up/sign-in) too.
- **Rate limits** (spec §6 "rate limits on sign-in, sign-up, and reset"):
  sliding-window counts in `auth_attempts` — sign-in 10/15 min per IP **and**
  per email, sign-up 5/h per IP, reset request 3/h per email + 10/h per IP.
  429 with Retry-After. IP = `fly-client-ip` header, else first
  `x-forwarded-for` hop, else "local".
- **Breached-password check:** v1 is an in-config common-password blocklist
  (top ~100) + min 10 chars + password≠email. A live HIBP k-anonymity lookup
  is logged as tech debt, not a launch blocker (the spec's intent — refusing
  garbage passwords — is met; the list is offline and deterministic).
- **Email enumeration:** sign-in failure is a generic "invalid email or
  password" (with a dummy-hash verify to equalize timing); reset requests
  always answer "if that email exists, we sent a link".
- **Verify links are GET** (`/verify/{token}`, single-use, 48 h expiry) — one
  tap from the email. Reset links land on a form (GET shows it, POST consumes
  the 30-minute single-use token and revokes all sessions).
- **Gating matrix** (spec §4/§8, D4/D16): free = Cup pages + Cup live + career
  pages (`/driver/{id}` shows cross-series *totals* by spec). Non-Pro requests
  to Xfinity/Trucks HTML pages get the **teaser** (headline card real, table
  blurred decoration, one-tap `/pricing`); un-prefixed `/race/{id}` and
  `/recap/{id}` gate on the race's derived series; `/data/*-{2,3}.json` and
  `/api/*?series={2,3}` return 403 JSON `{error:"pro_required"}` so the teaser
  can't be bypassed by fetching the payloads directly.
- **Feature gate helper** (`predictions`/`dfs`/`export`/`push`/`compare4`)
  ships now with tests; its consumers arrive with WS-F (predictions/DFS pages,
  compare-4, CSV export) and the notifications work.
- **`/pricing` v0** is the tier table + sign-up CTA with "checkout opens soon"
  — WS-E replaces the buttons with Stripe Checkout.
- **Cache privacy:** any request carrying a session cookie → responses are
  `private, no-store`; auth/account routes are always no-store. Anonymous Cup
  pages keep the public per-class headers (acceptance requires exactly this
  split). Anonymous teasers stay public-cacheable (they contain no user data).
- **Account deletion** (spec §6): self-serve on `/account`, password + CSRF
  confirmed, deletes user/sessions/tokens/entitlement immediately. The
  "cancels any subscription" hook is a WS-E TODO (no subscriptions exist yet).
- **Env:** `APP_BASE_URL` (absolute links in verify/reset emails) — malformed
  or missing in production is a boot **problem** (fail-fast posture); dev
  falls back to `http://localhost:{port}`.
- **Static export untouched:** the exported static site still contains all
  three series. It is today's live free site; restricting the export to Cup
  happens at launch cutover (logged in tech debt), not mid-playoffs.

## Build checklist

- [x] Schema: `users`, `sessions`, `auth_tokens`, `auth_attempts`,
      `entitlements` in providers/db.ts
- [x] `domains/accounts` types/config/repo/service (+ barrel)
- [x] `domains/billing` types/config/repo/service (+ barrel)
- [x] App: `viewer.ts` (viewer resolution, cookies, CSRF, client IP)
- [x] App: `gate.ts` (series/race/data/feature gates, pure)
- [x] Pages: sign-up, sign-in, reset request/confirm, verify landing,
      account v0, pricing v0, teaser
- [x] App: `auth.ts` route handlers (GET pages + POST actions, PRG redirects)
- [x] Server wiring: viewer per request, auth routes, gating, private
      cache-control, appbar Account link
- [x] `http.ts`: auth cache class + private override (removes the WS-B
      "lands in WS-D" comment)
- [x] Env: `APP_BASE_URL` in env.ts + fly.toml
- [x] CLI: `grant` command (manual Pro grants/revokes for testers)
- [x] Styles: forms, teaser blur/lock
- [x] Tests: accounts service (negative-heavy), billing entitlement
      boundaries, gate matrix, e2e auth + gating + cache headers via real
      server
- [x] Docs: ARCHITECTURE.md, QUALITY_SCORE.md, tech-debt-tracker, launch-plan
      acceptance boxes, PLANS.md

## Acceptance mapping (launch plan WS-D)

- Negative tests (wrong password, reused reset token, expired token,
  unverified user attempting checkout, rate limit trip, CSRF miss) →
  `tests/accounts.service.test.ts`, `tests/billing.service.test.ts`,
  `tests/app.auth.test.ts`. ✅ all six scenarios covered 2026-09-07.
- Teaser/Pro/cache-header behaviour → `tests/app.auth.test.ts` (e2e over a
  real server: anonymous `/xfinity/drivers/…` → teaser; granted Pro → real
  page; anonymous Cup → public cache headers; gated/signed-in → private). ✅
- Architecture tests still green with the new domains. ✅ (they sweep
  `src/**` automatically; both new domains follow the layer rules)

## Findings / deviations

- `grantPro` pulled forward from WS-E (documented above).
- `/pricing` exists early (teaser needs a destination); WS-E owns its final
  form.
- Common-password blocklist instead of a live breached-password API for v1
  (tech-debt logged).
