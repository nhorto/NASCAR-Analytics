# WS-I: Launch hardening — implementation plan

**Status:** ACTIVE — build detail for the launch plan's WS-I (week 8), started
2026-09-07. WS-B/C/D/F/G are on `main`; WS-H is in review (PR #15) and this
branch stacks on it.
**Parent:** [Production + Paid Launch](2026-09-07-production-and-paid-launch.md) §5 WS-I.
**Spec:** [v1 paid product spec](../../product-specs/2026-09-07-v1-paid-product-spec.md) §6 (accounts/security).

## Shape

WS-I as written in the launch plan is mostly *owner-and-deploy-gated*: the
security review, load test, restore re-drill, error alerting and the live
launch checklist all need the production origin, Stripe, and Resend. This
sub-plan takes the three hardening items that need **none of that** and can
land now, so week 8 is spent on the parts that genuinely require the deploy.

1. **Close `script-src 'unsafe-inline'`.** The server's CSP currently allows
   any inline script, which is the single biggest gap in the header set: it
   is exactly the injection a CSP is supposed to stop.
2. **Real breached-password check.** Spec §6 asks for one; v1 is an ~85-entry
   offline blocklist. Add a Have I Been Pwned k-anonymity range lookup.
3. **Pin wrangler.** The weekly deploy leg runs `bunx wrangler` with no
   version pin and no local copy — on the production server (D18) that means
   fetching an unknown wrangler version from the registry mid-refresh.

Explicitly *not* in this sub-plan (still WS-I, still owner-gated): dependency
+ secrets audit against the real deployment, rate-limit tuning against real
traffic, backup restore re-drill on the Fly volume, 5× race-day load test,
error alerting to owner email, and the §9 launch checklist walk.

## Decisions taken here (within spec/plan bounds)

- **Eliminate the inline scripts rather than hash them.** The obvious reading
  of the tech-debt row is "add CSP hashes", but the two inline blocks in
  `layout.ts` are *not* constant: one interpolates the series id and the live
  Worker origin. A per-page hash would have to be computed at render time and
  threaded into the response header, and the static export would need a
  per-path `_headers` rule — for `dist/`'s ~627 pages. Moving the config to
  `data-*` attributes on `<html>` and the behavior to `/boot.js` makes
  `script-src 'self'` correct with **no hash bookkeeping at all**, and works
  identically for the Fly server and the Cloudflare Pages export.
- **`<html data-…>`, not `<body data-…>` or a JSON script block.** `boot.js`
  is a blocking `<script src>` in `<head>` so that `window.__LIVE_API__` /
  `__SERIES__` / `__PRO__` exist before any in-body page script runs
  (`compare.js`, `live.js` and `tracks.js` are parser-blocking scripts inside
  `<main>`, so an end-of-body or `defer`ed bootstrap would run *after* them).
  `document.body` does not exist yet at that point; `document.documentElement`
  does. A `<script type="application/json">` block would also work — browsers
  do not apply `script-src` to non-executable script types — but relying on
  that subtlety to satisfy a security header is the wrong kind of clever.
- **`style-src 'unsafe-inline'` stays, and the tech-debt row is narrowed to
  say so.** Several inline styles are genuinely computed per row
  (`width:${w}%` on metric bars, `background:${teamColor(team)}` on car
  badges); moving them to classes is not possible without a `<style>` block
  or a CSS custom property set from an inline style — i.e. the same problem.
  Inline *style* injection is a far weaker primitive than inline *script*
  injection, and every value that reaches these attributes is a number or a
  value from our own palette table, never user input. Closing script-src is
  the security win; claiming style-src too would be theater.
- **The static export gets the security headers as well.** `dist/_headers`
  had no CSP at all, so hardening only the Bun server would leave the
  currently-public Cloudflare Pages site unprotected. `export.ts` now writes
  the headers from the same `securityHeaders()` function the server uses, so
  the two cannot drift.
- **HIBP is a provider and it fails open.** The check is network I/O, so it
  belongs in `src/providers/` (the accounts *service* may import providers,
  not the other way round). It returns `null` — not "safe", not "breached" —
  on any timeout, non-200 or parse failure, and the caller treats `null` as
  "no opinion". Failing *closed* would mean an api.pwnedpasswords.com outage
  locks every new sign-up and password reset out of the product; the offline
  blocklist plus the 10-character minimum still apply in that window.
- **k-anonymity, and the test proves it.** Only the first 5 characters of the
  SHA-1 go over the wire, `Add-Padding: true` is sent so the response length
  leaks nothing about the bucket, and a test asserts the request URL contains
  the 5-character prefix and **never** the suffix or the password itself.
- **Wrangler is pinned exactly (`4.129.1`), not with a caret.** A caret range
  on the one tool that performs the deploy re-introduces the exact failure the
  pin is meant to remove: a wrangler minor release changing `pages deploy`
  behavior would land unannounced on the next Monday refresh.

## Build steps

- [x] `src/app/client/boot.js` — reads `document.documentElement.dataset` into
      `window.__LIVE_API__` / `__SERIES__` / `__PRO__`; registers the service
      worker on `load`; polls the live status for the tab-bar dot on
      `DOMContentLoaded`; delegated handlers for `form[data-confirm]`,
      `select[data-nav]`, `[data-print]`, `form[data-nosubmit]`.
- [x] `layout.ts` — `<html>` carries the data attributes, both inline
      `<script>` blocks are gone, `boot.js` is loaded blocking from `<head>`.
      `page()` gains `pro?: boolean`.
- [x] `render.ts` — passes `pro` into `page()` for every page.
- [x] `pages/compare.ts`, `pages/tracks.ts`, `pages/live.ts` — inline config
      scripts removed (values now come from the shell).
- [x] `pages/races.ts` season select → `data-nav`; `pages/dfs.ts` print link →
      `<button data-print class="linkish">`; `pages/account.ts` confirm
      dialogs → `data-confirm`; `pages/compare.ts` range form → `data-nosubmit`.
- [x] `style.css` — `.linkish` (a real `<button>` styled as a link, so the
      print control stays keyboard-operable) and hide it in `@media print`.
- [x] `http.ts` — `script-src 'self' <plausible>`; no `'unsafe-inline'`.
- [x] `server.ts` + `export.ts` — serve and emit `/boot.js`.
- [x] `export.ts` — `_headers` now carries CSP + the rest of
      `securityHeaders()` for the static site.
- [x] `src/providers/hibp.ts` — k-anonymity client, `createNullHibp()` for
      tests and offline runs, wired into `Providers`.
- [x] `accounts/service.ts` — `checkPassword()` (sync policy, then HIBP) used
      by `signUp` and `resetPassword`; `validatePassword` kept as the sync
      half so its existing callers and tests are unchanged.
- [x] `package.json` — wrangler pinned exactly; `canary.yml` installs with
      `--production` so the daily canary stops downloading it.
- [x] Tests: CSP expectations updated; a rendered-HTML test that asserts no
      page contains an inline `<script>` body or an `on*=` attribute; HIBP
      provider tests (vector, padding, miss, non-200, timeout, no-leak);
      accounts tests for breach rejection and fail-open; a pin test.

## Findings

- **The static export shipped with no CSP whatsoever.** Hardening the Bun
  server's headers would have left the actually-public site (Cloudflare Pages
  + Vercel, per ARCHITECTURE.md) with none. Found only by going looking for
  where else headers are set.
- **Pinning wrangler costs ~150 MB of image.** `@cloudflare/workerd-*` is a
  platform-specific optional dependency of `workerd` and is 145 MB of the
  226 MB that `bun add -d wrangler` adds. It is needed for `wrangler dev`
  only, never for `pages deploy` / `deploy`. The Dockerfile keeps its full
  install (determinism on a machine that may not reach the registry); if the
  image size ever matters, `bun install --omit=optional` is the lever, and
  that trade is recorded in the tech-debt tracker rather than taken silently.

## Remaining (owner/calendar-gated)

- `/security-review` on the branch, dependency + secrets audit, rate-limit
  tuning, restore re-drill, 5× load test, error alerting — all need the
  deployed origin and the real secrets (A1–A6).
- The launch checklist (§9) walked live with the owner.
