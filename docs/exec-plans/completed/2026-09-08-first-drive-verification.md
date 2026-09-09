# First-Drive Verification — Web + Native

**Status:** COMPLETE
**Created:** 2026-09-08

## Why

Everything through WS-J was built and unit-tested, but nothing has ever been
*run and driven by a human or agent*. Unit tests prove the pieces; they do not
prove the product opens, renders, and responds to taps. This plan is one
end-to-end manual drive of both surfaces, recording every defect found.

## Environment

- DB: 165 MB `data/nascar.db` copied from worktree `t3code-55f179b7`
  (327 Cup races 2019–2026, 11,199 results, 2.3 M lap times, 0 users).
- Server: `bun run src/app/index.ts serve --port 3000`.
- Web driver: Playwright (Chromium, iPhone 13 viewport) with console/network capture.
- Native: Expo SDK 57 app in `mobile/`, iOS Simulator, AXe for UI input.

## Scope

1. **Web, signed out** — every route: home, drivers, driver profile, races,
   race recap, metrics, career, compare, tracks, live, predictions, dfs,
   methodology, pricing, signup, signin, 404, offline, manifest, service worker.
2. **Web, signed in (free)** — account creation, verification, gating teasers.
3. **Web, signed in (Pro)** — CLI `grant`, then re-walk every gated surface,
   plus CSV export downloads.
4. **API** — `/api/me`, `/api/predictions`, `/api/dfs`, `/api/drivers`,
   `/api/tracks`, `/api/metrics` in each entitlement state.
5. **Native** — build/launch on the simulator, walk all 15 routes, point it at
   the local server, sign in, verify free vs Pro rendering.

## Rules of engagement

Per the owner: fix small/obvious defects in place; stop and ask on anything
architectural or ambiguous. Findings are recorded in the Findings section
below as they are hit.

## Findings

Severity: **P1** blocks a paying user, **P2** wrong/misleading output, **P3** polish.

| # | P | Surface | What | Status |
| - | - | ------- | ---- | ------ |
| 1 | P1 | native | Sign-in reported failure on success. Server authenticated and created a session; the app showed "Check your email and password." and stayed signed out until a full app restart. | **fixed** |
| 2 | P1 | web | A **Pro** viewer opening `/xfinity/` or `/trucks/` got developer shell instructions: "Run `bun run backfill` then `bun run compute`". | **fixed** |
| 3 | P2 | web | Signup and resend-verify always reported "we sent you an email", even when the send failed. | **fixed** |
| 4 | P2 | web | Every CSV export wrote raw unrounded floats (`avg_finish 11.25925925925926`). | **fixed** |
| 5 | P2 | both | `fmtDate` rendered date-only values one day early west of UTC: `2027-12-31` → "Dec 30, 2027". | **fixed** |
| 6 | P3 | web | No `<h1>` on any page — every page's top heading was an `<h3>`. | **fixed** |
| 7 | — | data | The database held Cup only. Xfinity and Trucks are now backfilled 2019–2026 (264 + 187 races). | **resolved** |
| 8 | — | repo | A fresh worktree fails 1 test until `bun install` is run at the root (`hyparquet` missing). | noted |

### Finding 1 — evidence

Server log for one native sign-in with correct credentials:

```
GET  /signin        200
POST /auth/signin   303   <- authenticated, Set-Cookie: session
GET  /account       303   <- cookie not applied yet, bounces to /signin
GET  /signin        200
```

`sessions` grew a row per attempt (3 rows for user 2). After restarting the
app, that same account renders **PRO until 12/30/2027**, proving the session
was valid the whole time.

Cause: `classifyAuthResponse` (mobile/src/lib/auth.ts) treats "final path is
/account" as the success signal, but React Native's cookie jar has not applied
the `Set-Cookie` from the 303 by the time fetch issues the redirect hop, so
`/account` is anonymous and bounces to `/signin`. The app then classifies a
successful sign-in as `rejected`.

## What was verified working

- Web: 25 routes signed out, all 200, zero console/page errors, real data.
- Web auth: signup, session, sign-out/sign-in round trip, CSRF POST → 403,
  no user enumeration on sign-in, neutral reset copy, rate limiting.
- Web Pro: entitlement grant, all gated pages, 12 CSV exports, series JSON gate.
- Web interaction: compare (2 free / 4 + season range Pro), track-type filters,
  driver search, tab-bar navigation, live board.
- Native: all 15 routes render real data from the local server; free/locked
  states correct (top-3 predictions + "39 more drivers with Pro"); Pro unlocks
  DFS, 4-slot compare, Xfinity/Trucks track types; deep links work.

### Finding 5 — fix applied

`src/app/html.ts` `fmtDate` and a new `mobile/src/lib/dates.ts` `fmtProUntil`
now format `YYYY-MM-DD` strings in UTC so the calendar date survives; full
timestamps still render local. Regression tests: `tests/app.html.test.ts`,
`mobile/src/lib/__tests__/dates.test.ts`. Verified live — the account page
went from "PRO until Dec 30, 2027" to "PRO until Dec 31, 2027" for a
`pro_until` of `2027-12-31`. Root suite 859 pass / 0 fail, mobile 88 pass /
0 fail, both typechecks clean.


## Fixes

**1 — native sign-in.** `mobile/src/lib/auth.ts`: sign-in and sign-up now go
through `postSessionForm`, which confirms an inconclusive POST against
`/api/me` instead of trusting the followed redirect. A conclusive server
refusal (401/429/403, or any response carrying the server's own form-error
text) is still returned as-is, so a taken email while another session is live
cannot be mistaken for success. Verified on the simulator — the server log
still shows the underlying RN behaviour, and the app now recovers:

```
POST /auth/signin  303   <- authenticated
GET  /account      303   <- cookie still not applied, bounces
GET  /signin       200   <- previously reported as a failure
GET  /api/me       200   <- the fix: ask the server
```

Sign-in lands on Home and `/dfs` renders full Pro projections with no restart.

**2 — empty state.** `src/app/pages/home.ts` now renders a series-aware
customer message ("No Xfinity Series data yet — we haven't loaded this series
yet") with a link back to Cup, instead of shell commands. Additionally the
underlying gap is closed: Xfinity and Trucks are backfilled and computed, so
the state is no longer reachable for them.

**3 — email honesty.** `sendAuthEmail` returns whether the message left.
Sign-up redirects to `?m=check-email-failed` and resend-verify to
`?m=verify-failed` when it did not, rendered through the account page's error
slot (⚠, `role="alert"`) rather than a green check. `reset-request` keeps its
neutral "if that email has an account" copy deliberately — reporting a send
failure there would leak whether the address exists. `createNullEmailClient`
now logs the message body, so verify/reset links are usable in local dev
(previously the whole paid flow was untestable without a Resend key).

**4 — CSV precision.** `csvCell` rounds non-integer numbers to
`CSV_DECIMALS = 6`, re-parsed so trailing zeros drop and integers stay
integers. Six places is far past what the integer inputs support but well
beyond the site's one-decimal display, so no real signal is lost.

**5 — dates.** `fmtDate` and `mobile/src/lib/dates.ts` format `YYYY-MM-DD` in
UTC; timestamps still render local.

**6 — headings.** The page shell emits a visually-hidden `<h1>` carrying the
page title (`.sr-only`), and every card header moved `h3` → `h2` — templates,
the `card()` helper, and the client-side renderers in `src/app/client/`. The
design is unchanged; only the CSS selector moved.

## Verification

Full sweep re-run after the fixes: every page carries exactly one `<h1>`, zero
`<h3>`; Xfinity/Trucks render real races, standings and 282 Xfinity drivers;
CSVs carry no 15-digit floats; the account page reads "PRO until Dec 31, 2027".
Native: date reads 12/31/2027, sign-out → sign-in → Pro content all work in one
session. 865 root tests, 92 mobile tests, 0 failures, both typechecks clean.

## Done when

Every route above has been opened and interacted with, each finding is either
fixed or logged with a reproduction, and the plan moves to `completed/`.
