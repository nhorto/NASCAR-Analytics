# WS-H: PWA and Push — implementation plan

**Status:** ACTIVE — build detail for the launch plan's WS-H (week 7), started
2026-09-07. WS-B/C/D/F/G are merged to `main`; WS-E still waits on Stripe.
**Parent:** [Production + Paid Launch](2026-09-07-production-and-paid-launch.md) §5 WS-H.
**Spec:** [v1 paid product spec](../../product-specs/2026-09-07-v1-paid-product-spec.md)
(§4 Pro capabilities, §8 surfaces).

## Shape

Two separable halves, built and committed in that order so the first is
useful even if the second slips:

1. **PWA shell** — `manifest.webmanifest`, generated icons, a service worker
   (app-shell cache, network-first data, offline page), install-prompt logic
   with iOS "Add to Home Screen" guidance. Entirely testable locally.
2. **Web Push** — a `notifications` domain (VAPID, RFC 8291 payload
   encryption, per-user dedup, quiet hours), subscription routes on the Live
   page (Pro), and a dispatcher that polls the live Worker during a session
   and pushes a user's followed-driver alerts.

## Decisions taken here (within spec/plan bounds)

- **Icons are generated, not hand-drawn binaries.** `src/utils/png.ts` is a
  tiny dependency-free PNG encoder (Bun's `deflateSync` + IHDR/IDAT/IEND +
  CRC32) and `scripts/gen-icons.ts` rasterizes the Looplab mark into the
  sizes iOS/Android need. Rationale: committing opaque PNG blobs an agent
  can't regenerate is exactly the kind of artifact that rots; this way the
  icon is reproducible from source and the encoder is unit-tested against
  a decoder-independent CRC check. Repo has one runtime dependency
  (`hyparquet`) and this keeps it that way.
- **The service worker must never cache a personalized response.** Pages
  carry `private, no-store` for signed-in viewers (WS-D) and `/export/*` is
  per-user; the SW therefore refuses to cache any response whose
  `Cache-Control` contains `private` or `no-store`, and never caches a
  cross-origin or non-GET request. A shared device that cached one user's
  Pro pages into the SW cache would leak them to the next viewer — this is
  the single most dangerous thing a naive PWA does.
- **Data is network-first, shell is cache-first.** Stats change weekly, but a
  race-day visitor must never see a cached board: `/data/*`, `/api/*`, and
  the live Worker origin are network-first with a cache fallback; the shell
  (CSS, client JS, icons, offline page) is cache-first with a version-keyed
  cache so a deploy evicts cleanly (the existing `ASSET_VERSION` names it).
- **Push payloads are encrypted per RFC 8291**, not sent payload-less. The
  simpler payload-less design (push a ping, have the SW fetch the alert)
  costs a round trip exactly when latency matters (a pit-stop alert) and
  needs an authenticated fetch from a service worker. Encryption is
  implementable with WebCrypto alone (ECDH P-256 → HKDF → AES-128-GCM) and,
  critically, **RFC 8291 §5 publishes a worked example**, so it can be
  verified against a real test vector without a browser.
- **Subscriptions are Pro and per-device.** One row per push endpoint, owned
  by a user, carrying the followed driver + enabled alert kinds (the Live
  page already persists `looplab_follow` locally — the subscription mirrors
  it server-side so the dispatcher knows who wants what).
- **Dedup is per (user, race, kind, lap-bucket).** The live DO can restart
  and re-derive an alert it already sent (a known WS-live gap); the
  dispatcher therefore records what it sent and refuses a duplicate rather
  than trusting the feed to be exactly-once.
- **Quiet hours default OFF** (per the plan) but are stored per user, and a
  suppressed alert is *dropped*, not queued — a caution flag from four hours
  ago is noise, not news.

## Build checklist

### Part 1 — PWA shell
- [ ] `src/utils/png.ts` + tests (CRC32, chunk framing, round-trip size).
- [ ] `scripts/gen-icons.ts` → `src/app/static/icons/` (192, 512, maskable, apple-touch).
- [ ] `src/app/pwa.ts`: manifest builder + offline page content.
- [ ] `src/app/client/sw.js`: install/activate/fetch, cache policy above.
- [ ] `src/app/client/install.js`: `beforeinstallprompt` capture, custom
      button, iOS instructions when standalone-capable but no prompt event.
- [ ] Server routes + `layout.ts` head tags + SW registration.
- [ ] `export.ts`: manifest, sw.js, icons, offline page into `dist/`.
- [ ] Tests: manifest shape/served, SW cache-policy decisions (pure helper),
      offline page, icons served with correct type, cache headers.

### Part 2 — Web Push
- [ ] `providers/db.ts`: `push_subscriptions`, `push_sends`.
- [ ] `src/domains/notifications/`: types, config, repo, service
      (VAPID JWT ES256, RFC 8291 encrypt, dedup, quiet hours).
- [ ] `src/providers/webpush.ts`: POST to the endpoint, 404/410 → prune.
- [ ] `src/app/push.ts`: `/api/push/subscribe|unsubscribe|test` (Pro, CSRF),
      VAPID public key exposure, dispatcher over the live Worker.
- [ ] `client/live.js`: subscribe UI on My Driver (Pro), permission flow.
- [ ] `src/app/client/sw.js`: `push` + `notificationclick` handlers.
- [ ] `env.ts` + fly.toml: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- [ ] Tests: RFC 8291 vector, VAPID JWT shape, dedup, quiet hours, endpoint
      pruning on 410, Pro gating, subscription round trip.

## Acceptance (launch plan §5 WS-H)

- [ ] Installs on iOS and Android; Lighthouse PWA checks pass.
      *(Buildable and structurally verifiable locally — manifest validity,
      icon sizes/purposes, SW registration, offline reachability. The literal
      install on two devices needs the deployed HTTPS origin (A2/A6).)*
- [ ] A test user receives the pit/caution/stage/finish alerts for their
      driver during the soak race with no duplicates.
      **Owner/calendar-gated** — needs the Fly deploy *and* a live race.

## Out of scope (named so it is not silently dropped)

- Background Sync / periodic background sync (poor cross-browser support;
  the dispatcher is server-side instead).
- Native app wrappers. Web push on iOS requires an installed PWA — that is
  the documented path, and the install guidance says so.
