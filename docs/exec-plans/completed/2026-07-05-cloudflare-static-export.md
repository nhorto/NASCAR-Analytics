# Exec Plan: Cloudflare Pages Static Export

**Status:** COMPLETED 2026-07-05
**Created:** 2026-07-05
**Decision:** Nick chose Cloudflare (static export to Pages) as the host.

## Outcome (2026-07-05)

Built and verified locally. `bun run export` generates ~1,813 static pages to `dist/` (19MB) in ~30s. Series moved to path prefixes (`/`, `/xfinity`, `/trucks`); race pages un-prefixed at `/race/{id}`. Compare + track explorer are client-rendered from `dist/data/*.json` — verified in-browser against a Cloudflare-style static server: compare renders driver head-to-heads, the track explorer aggregates/filters/sorts in place with no reload and no console errors. Dev server refactored to the same URL scheme via a shared `render.ts`. 98 tests green. Deploy is Direct Upload (`bunx wrangler pages deploy dist`) so the 160MB DB stays local — steps in [docs/DEPLOY.md](../../DEPLOY.md). The one-time Cloudflare connect needs Nick's login.

## Why static works here

The app is read-only at request time — every page renders from precomputed tables that only change weekly. So we can pre-render the whole site to static HTML and serve it from Cloudflare Pages: free, globally cached, zero servers, zero ops. The weekly refresh is a rebuild (`backfill` → `compute` → `export` → redeploy), which a GitHub Action can automate later.

## The two real changes static hosting forces

1. **Series must live in the URL path, not a query param.** Static files are addressed by path; `/drivers?series=2` would resolve to the same file as `/drivers`. So series becomes a path prefix:
   - Cup (default): `/`, `/drivers`, `/drivers/4030`, `/races`, `/races/5617`
   - Xfinity: `/xfinity/…`  ·  Trucks: `/trucks/…`
   - `withSeries()` becomes a path-prefixer; the dev server routes and every internal link move to this scheme too (keeps dev = prod).
   - Race pages stay un-prefixed (`/races/5617`) — race_id is globally unique and the page derives its own series. Driver profiles ARE prefixed (driver_id repeats across series).

2. **Compare + Track explorer become client-side.** Compare can't pre-generate every driver pairing; the track explorer's filter combinations are large. Both become a static shell + a small shipped JSON + a bit of vanilla JS that reads query params and renders. (Same rendering, moved to the browser.) These stay query-param-driven because JS reads the params — no per-combination files.

## Build: `bun run export` → `dist/`

Reuses the existing pure page-template functions. Emits:
- Static HTML: home, drivers index, driver profiles, races index (per season), race pages — one file per (series-prefix, entity).
- `dist/data/*.json`: season stats per series (compare) and track-type aggregates per series (tracks).
- `dist/compare/index.html`, `dist/tracks/index.html`: client shells.
- `dist/style.css`, `dist/app.js` (client logic), `dist/404.html`.

Rough page counts: ~3 homes, ~3 driver indexes, ~500–700 driver profiles, ~30 races indexes, ~1,000 race pages → a few thousand small files. Trivial for Pages.

## Deploy (Nick's step)

Cloudflare Pages project → build command `bun run export`, output dir `dist`. I'll add the config + a deploy README. The connect-to-account step needs Nick's Cloudflare login, so I build + verify locally (serve `dist/`), then hand off the exact steps.

## Stages
1. Path-based series URLs (server + links + tests still green).
2. Compare + tracks → client-side (server still serves them for local dev).
3. `bun run export` generator; verify by serving `dist/` and clicking through.
4. Pages config + deploy README + docs; commit.

## Verification
- `bun test` + `bunx tsc --noEmit` green throughout.
- Serve `dist/` locally; click every page type across all three series incl. compare + tracks filters.

## Out of scope (future)
- The weekly auto-rebuild GitHub Action (separate plan; Nick flagged auto-sync).
- Custom domain, analytics.
