# WS-G: Deep Tools and Email — implementation plan

**Status:** ACTIVE — build detail for the launch plan's WS-G (week 6), started
2026-09-07 (WS-B/C/D/F built; WS-E still blocked on the owner's Stripe
account, so the schedule keeps pulling owner-free workstreams forward).
**Parent:** [Production + Paid Launch](2026-09-07-production-and-paid-launch.md) §5 WS-G.
**Spec:** [v1 paid product spec](../../product-specs/2026-09-07-v1-paid-product-spec.md)
(§4 Pro capabilities, §6 accounts, §8 surfaces).

## Shape

No new domain. Three app-layer capabilities plus an accounts slice:

- **CSV export (Pro)** — `src/app/csv.ts`: RFC-4180 encoding + a **dataset
  registry** (one entry per table the site renders), streamed as
  `text/csv` attachments from `/export/{dataset}.csv?…`. Every page that
  renders a table gets an "Export CSV" link that carries the page's own
  filters; the filename names series/season/filter.
- **Deep tools** — track explorer gains a real **to-year** (full range
  control, not just "since"); compare gains **up to four drivers**, across
  **series** and a **season range** (Pro; free stays at two, one series, one
  season).
- **Email** — `src/app/emails.ts` (pure templates: verify, reset, Monday
  recap, Thursday preview) + `src/app/mail.ts` (recipient resolution,
  per-(user, kind, race) idempotency, suppression, dry-run) +
  `src/app/webhooks.ts` (Resend bounce/complaint webhook, Svix-signed).
  Preferences and unsubscribe live in the **accounts** domain
  (`email_prefs`), because they are user-owned settings.

## Decisions taken here (within spec/plan bounds)

- **Export is a route family, not a per-page hack.** One registry keyed by
  dataset id (`standings`, `season-stats`, `race-results`, `driver-log`,
  `track-types`, `metrics`, `compare`, `predictions`, `dfs`, `career`), each
  with an explicit column list (header row = stable public contract) and a
  row builder over the same services the pages use. Adding a table later is
  one registry entry, so "every table" stays true as the site grows.
- **Streaming for real.** Rows are pulled per dataset and pushed through a
  `ReadableStream` in chunks, so the largest export starts sending before it
  is fully built. `withEncoding` currently buffers every compressible body
  (`arrayBuffer()`), which would defeat that — attachments are therefore
  compressed with `CompressionStream("gzip")` (pipe-through, no buffering)
  or sent raw. Excel-compat: **UTF-8 BOM** prefix + CRLF line endings, so
  accented driver names don't mojibake on a double-click open in Excel.
- **Export gating = the JSON gate, not a redirect.** Non-Pro requests get
  `403 {error:"pro_required",upgrade:"/pricing"}` (same body as the series
  JSON gate) and the links only render for Pro; free viewers see a lock hint
  to `/pricing`. Series-dimensioned exports also respect D16 (a non-Pro
  viewer could never reach them anyway, but the check is explicit).
- **Cache class.** `/export/*` is `private, no-store` (per-user, Pro-gated) —
  a new `download` cache class rather than widening the auth regex.
- **Compare-4 stays client-rendered.** The shell ships four slots (Pro) and
  the page fetches `season-stats-{series}.json` for **each series the viewer
  may read** (Cup always; 2/3 only when Pro — a free viewer's fetch would be
  403'd by the existing gate, so the client asks only for what it may have).
  Two-driver comparisons keep the existing head-to-head bars; three or four
  render a driver-per-column table with the best value per metric marked.
  Season **range** aggregation reuses the tracks.js weighting rules: counting
  stats sum; avg finish/start weight by `races`; loop metrics weight by
  `loopRaces` (new field in the season-stats payload — the old payload had
  no way to weight loop metrics correctly across seasons).
- **Email preferences default to OFF for both lists.** Monday recap is
  "free, opt-in" per the plan; Thursday preview is Pro-only *and* opt-in.
  Nothing is ever sent to an unverified address (matching the billing
  guard), and Pro-ness is checked at send time in the app layer (accounts
  may not import billing).
- **Unsubscribe is a GET with a per-user token + explicit list.**
  `/unsubscribe/{token}?list=recap|preview` flips one list off immediately
  and renders an **Undo** button (a scanner prefetch costs an unwanted
  unsubscribe, never a data loss; the reverse — a POST-only flow — costs
  real users their one-tap opt-out and risks spam complaints). Every digest
  email carries the link plus a `List-Unsubscribe` header.
- **Bounce handling suppresses at the address level.** `POST /webhooks/resend`
  verifies the Svix signature (`whsec_` secret, HMAC-SHA256 over
  `{id}.{timestamp}.{body}`, constant-time compare, ±5 min timestamp
  window), records the event, and sets `bounced_at` (hard bounce) or
  `complained_at` (spam report) on the address. Suppressed addresses are
  excluded from every future digest **and** the account page says so, since
  a silently dead address is worse than a visible one. Auth mail (verify /
  reset) is still attempted — a user fixing their address needs it.
- **Sends are idempotent per (user, kind, ref).** `email_sends` is written
  before the send attempt; a re-run of the same refresh/prediction never
  double-sends. Failures are logged with the provider detail and do not
  abort the batch.
- **Digests are wired into the existing crons, gated by an env flag.**
  `refresh` ends with the recap digest; `predict` ends with the preview
  digest; both no-op unless `ENABLE_EMAIL_DIGESTS=1` **and** a real Resend
  client exists (CI's null client logs instead). `bun run email --kind …
  [--dry-run] [--to …]` exists for the owner's test-list acceptance run.

## Build checklist

- [x] `providers/db.ts`: `email_prefs`, `email_events`, `email_sends`.
- [x] `providers/email.ts`: optional per-message `headers` (List-Unsubscribe),
      `verifyWebhookSignature` (Svix), timestamp-window + constant-time compare.
- [x] accounts types/config/repo/service: prefs, unsubscribe tokens,
      suppression, digest-recipient query, send-idempotency claims.
- [x] `app/csv.ts`: `csvCell`/`csvRow` (quoting, CRLF, BOM), dataset registry,
      `streamCsv`, filename builder.
- [x] `app/http.ts`: `download` cache class + stream-safe gzip.
- [x] `app/emails.ts`: verify/reset/recap/preview templates + footer.
- [x] `app/mail.ts`: `sendDigest` orchestration (recipients → suppression →
      idempotency → send → record), dry-run, per-recipient failure isolation.
- [x] `app/webhooks.ts`: `/webhooks/resend` handler.
- [x] `app/server.ts`: `/export/*`, `/unsubscribe/*`, webhook route.
- [x] `app/auth.ts` + `pages/account.ts`: email-preferences form (CSRF'd).
- [x] `client/tracks.js`: to-year control; `client/compare.js`: 4 drivers,
      cross-series, season range; `pages/compare.ts` shell + Pro flag.
- [x] `data.ts`: `loopRaces` in the season-stats payload.
- [x] Export links on every table page (Pro-only rendering).
- [x] `app/index.ts`: `email` command; refresh/predict digest hooks; help.
- [x] `app/env.ts`: `ENABLE_EMAIL_DIGESTS`, `RESEND_WEBHOOK_SECRET`.
- [x] Tests: csv encoding + registry + streaming; email templates; mail
      orchestration (idempotency, suppression, unverified, non-Pro preview);
      webhook signature (valid/tampered/stale/missing); accounts prefs +
      unsubscribe; e2e export gating/filenames/content; compare-4 + tracks
      to-year; `bun test` + both typechecks green.
- [x] Docs: ARCHITECTURE, QUALITY_SCORE, tech-debt, launch-plan boxes.

## Acceptance (launch plan §5 WS-G)

- [x] Export of the largest table completes under 2 s and opens in Excel.
      *(Measured 2026-09-07 against the real Cup db through the streaming
      response: season-stats 495 rows / 92 KB in **18 ms**; slowest of the 14
      datasets **461 ms**. Excel-compat is pinned by tests at the byte level
      (BOM `EF BB BF`), plus CRLF, quoting, and formula-injection guarding;
      the literal double-click-in-Excel check is an owner spot-check.)*
- [ ] Recap email sent to a test list after a real refresh; preview email
      after a real prediction run. **Owner-gated** — needs A4 (Resend account
      + verified sending domain). Everything up to the transport is tested
      with a captured-send client, and both digests were rendered from the
      real database on 2026-09-07 (Southern 500 recap; Gateway preview).

## Out of scope (named so it is not silently dropped)

- Salary import / optimizer for DFS (post-launch backlog).
- HTML (multipart) email bodies — v1 digests are plain text, which renders
  everywhere and cannot leak tracking pixels.
- Per-driver alert emails (that is the WS-H push work).

## Findings

- **A failed send must not burn its idempotency claim.** Running the real CLI
  with no Resend key exposed it: the claim was written, the null client
  reported failure, and the subscriber would then have been skipped *forever*
  for that race — the exact scenario the owner will hit on the first run
  before A4 lands. `claimSend` now re-claims a row whose failure was actually
  *recorded* (`ok = 0 AND detail IS NOT NULL`), while a claim still in flight
  (detail NULL) stays exclusive, so two overlapping runs still can't both
  send. Tested from both directions.
- **`Response.text()` silently strips a leading BOM.** The first Excel test
  passed a BOM-less assertion and would have kept passing if the BOM were
  removed entirely. Tests now decode with `TextDecoder(..., {ignoreBOM:true})`
  and assert the raw `EF BB BF` bytes.
- **Gzip would have un-streamed the exports.** The existing `withEncoding`
  buffers every compressible body via `arrayBuffer()`; left alone it would
  have waited for the last row before sending the first byte. Attachments now
  pipe through `CompressionStream("gzip")` instead, and a test proves the
  gzipped body round-trips to exactly the plain one.
- **Loop metrics needed `loopRaces` in the season-stats payload.** Aggregating
  a season *range* by `races` would drag a driver's rating/adjPE toward zero
  for seasons without loop data (pre-2019). The payload now carries the loop
  race count and compare weights on it.
- Copy caught on real data: "1 laps led" → "1 lap led" (pluralization test added).

## Remaining (owner-gated)

- **A4 (Resend account + verified sending domain)** for the recap/preview
  acceptance run and for `RESEND_WEBHOOK_SECRET` (bounce suppression is inert
  until it is set — the endpoint answers 503 rather than trusting unsigned
  input). `ENABLE_EMAIL_DIGESTS` stays `0` in `.railway/railway.ts` until then.
- A real bounce/complaint replay from the Resend dashboard to confirm the
  payload field names (logged as tech debt).
- A double-click open of one exported CSV in Excel/Numbers (structure is
  test-pinned; this is the human spot-check).
