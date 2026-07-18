# PWA: Installable Site + My-Driver Notifications

**Status:** ACTIVE
**Started:** 2026-07-18
**Owner ask:** "Eventually I want a real app — for now, PWA-ify it" (2026-07-18).

## Goal

Make the existing mobile-first site installable to a phone home screen (the
"turn it into an app" step that doesn't require an app store), and surface
my-driver alerts as real device notifications while the live page is open.

## Scope

1. **Manifest + icons.** `manifest.webmanifest` (name Looplab, dark theme,
   standalone display), generated PNG icons (192 / 512 / maskable 512 /
   apple-touch 180) checked in under `src/app/assets/` (generated once by
   `scripts/gen-icons.ts` — pure-pixel PNG writer, no image deps).
2. **Head wiring** in `layout.ts`: manifest link, `theme-color`,
   apple-touch-icon, iOS standalone metas, service-worker registration.
3. **Service worker** (`sw.js`): network-first for navigations with cache
   fallback (site works offline on visited pages), stale-while-revalidate for
   same-origin static assets (`/style.css`, `/*.js`, `/data/*`, icons).
   Cross-origin (the live Worker API) is never intercepted — live data must
   stay live. Cache name keyed by the existing content-hash `ASSET_VERSION` so
   deploys invalidate cleanly.
4. **My-driver notifications** on the Live page: an opt-in 🔔 toggle in the
   My Driver panel (requests `Notification` permission); new alert-feed events
   for the followed driver (plus green/caution flag changes) raise a device
   notification via the service-worker registration while the page is open.
5. `export.ts` emits manifest/sw/icons; `server.ts` serves them in dev.

## Non-goals (logged as follow-ups)

- **True background Web Push** (notifications with the site closed). Needs
  VAPID keys as secrets, a subscription store (DO), and push encryption in the
  Worker — a real phase of its own, and the natural next step toward "a real
  app". Logged in the tech-debt tracker as a follow-up, not debt.
- App-store packaging (TWA / Capacitor) — future, after PWA traction.

## Verify

- `bun test` green; export emits manifest/sw/icons; Lighthouse-style manual
  check of manifest validity; SW never caches the live API.
