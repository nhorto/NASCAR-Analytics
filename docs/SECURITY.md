# Security Requirements — NASCAR Analytics

> Reflects what is actually built. Anything not built says so.

## Authentication (built 2026-09-07, WS-D)

- Email + password. Hashing is **argon2id** via `Bun.password`; the plaintext
  is never stored, logged, or echoed back.
- Password policy (`domains/accounts`): minimum 10 characters, maximum 200,
  cannot equal the account's email, must not appear in the offline
  common-password set, and — since WS-I — must not appear in the Have I Been
  Pwned corpus (see below).
- Verify (48 h) and reset (30 min) tokens are single-use random 256-bit
  values; only their SHA-256 is stored.
- Sessions are 30-day rolling, `httpOnly` + `SameSite=Lax`, revocable
  individually or all at once ("sign out everywhere").
- CSRF: double-submit cookie on every POST.
- Sliding-window rate limits on sign-in, sign-up and reset (429 +
  `Retry-After`).
- Failure messages never reveal whether an email exists; sign-in against an
  unknown email still runs a dummy verify so timing doesn't either.
- No 2FA and no OAuth in v1 — not in the product spec.

## Breached passwords (built 2026-09-07, WS-I)

- `providers/hibp.ts` queries the HIBP range API in **k-anonymity** mode: only
  the first five characters of the password's SHA-1 leave the process, and
  `Add-Padding: true` makes every response a uniform size so its length leaks
  nothing either. The match happens locally.
- The check **fails open**: a timeout, non-200 or unparseable body is "no
  opinion", never a rejection. A third party's outage must not lock every
  sign-up and reset out of the product; the offline list and length rules are
  the floor in that window.
- It runs at sign-up and password reset only. An existing password is never
  re-checked, so a credential breached after registration is not flagged.

## Response headers

- `Content-Security-Policy`: `default-src 'self'`, **`script-src 'self'`**
  (plus the Plausible host when analytics is enabled), `frame-ancestors
  'none'`, `base-uri 'self'`, `form-action 'self'`, `connect-src` limited to
  self, the live Worker origin and Plausible.
  - There are **no inline scripts and no `on*=` handlers** anywhere in the
    site: page config rides on `<html data-*>` and every handler is delegated
    from `client/boot.js`. `tests/app.csp.test.ts` fails if one comes back.
  - `style-src` still allows `'unsafe-inline'` — several style attributes are
    computed per row (bar widths, team colors). Every value there is a number
    or an entry from our own palette table, never user input.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
  denying camera/microphone/geolocation, and HSTS in production.
- The static export writes the **same** header set to `dist/_headers` from the
  same `securityHeaders()` function, so the Pages deployment and the Bun
  server cannot drift. (The Vercel mirror ignores `_headers` — tracked.)

## Cache privacy

- Any request carrying a session cookie gets `private, no-store` on page and
  data responses; auth routes, unsubscribe, webhooks and `/export/*` are
  never cacheable at all.
- The service worker refuses to cache any response marked `private`/`no-store`
  or carrying `Set-Cookie`/`Authorization` — its cache is shared by everyone
  on the device.

## API keys and secrets

- All secrets come from the environment: `RESEND_API_KEY`,
  `RESEND_WEBHOOK_SECRET`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`,
  `CLOUDFLARE_API_TOKEN`, `LITESTREAM_REPLICA_URL`. None are committed.
- Missing optional secrets degrade loudly (a boot warning) rather than
  silently: mail logs instead of sending, the Resend webhook answers 503
  rather than trusting unsigned input, push is not offered.
- The NASCAR CDN is public and needs no key.

## Input validation

- All user-facing query parameters are validated against allowlists.
- No raw SQL — parameterized queries only (`bun:sqlite`).
- CSV exports guard against formula injection (`= + - @` and tab/CR prefixes).

## Data protection

- The only PII is the account email address. Payments are handled by Stripe
  (WS-E); no card data will be stored.
- Encryption at rest is the host's (Railway volume); the app does not encrypt the
  email column itself.
- Account deletion is immediate and password-confirmed.

## Dependency management

- Exactly **one** production dependency (`hyparquet`). Every addition is a
  thing that can break a deploy at 12:00 UTC on a Monday.
- `wrangler` — the tool that performs the deploy — is pinned to an **exact**
  version, so a release cannot land unannounced on a weekly refresh.
  `tests/repo.deps.test.ts` enforces both invariants.
- Run `bun audit` before each release.

## Not yet done

- The launch security review, dependency + secrets audit against the real
  deployment, rate-limit tuning under real traffic, and the 5× load test are
  WS-I items that need the deployed origin (launch plan A1–A6).
