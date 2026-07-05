# Deploying to Cloudflare Pages

The site is a **static export** served from Cloudflare Pages. Every page is pre-rendered from the local database; the two interactive pages (compare, track explorer) run client-side from shipped JSON. No server, no runtime, free hosting.

## Why we upload the build (not let Cloudflare build it)

The site is generated from `data/nascar.db` — a ~160MB SQLite file that is **gitignored** (it's regenerable, and too big for the repo). Cloudflare's git-integrated build clones only the repo, so it can't regenerate the data. Instead we **build locally and upload the finished `dist/`** via Cloudflare Pages Direct Upload. The database never leaves your machine.

## One-time setup

1. Have the data locally (if `data/nascar.db` doesn't exist yet):
   ```sh
   bun run backfill            # all 3 series; ~30 min, hits the public CDN
   bun run backfill --series 2
   bun run backfill --series 3
   bun run compute             # Cup
   bun run compute --series 2  # Xfinity
   bun run compute --series 3  # Trucks
   ```
2. Install Wrangler is not required globally — `bunx wrangler` works on demand.
3. Create the Pages project once (interactive; asks you to log in to Cloudflare):
   ```sh
   bun run export
   bunx wrangler pages deploy dist --project-name=looplab
   ```
   The first run creates the `looplab` project and prints the live URL
   (`https://looplab.pages.dev`). Wrangler opens a browser to authenticate — that
   login is yours; it can't be automated here.

## Every update (after a race weekend)

```sh
bun run sync                 # pull the latest completed races (all series: also --series 2 / 3)
bun run compute              # recompute (also --series 2 / 3)
bun run export               # regenerate dist/  (~1,800 pages, ~30s)
bunx wrangler pages deploy dist --project-name=looplab
```

That's the whole loop. A GitHub Action could automate it later, but it would need to run the full backfill in CI (the DB isn't in the repo) — tracked as a future item.

## What gets deployed

- `dist/index.html`, `dist/xfinity/…`, `dist/trucks/…` — series in the path.
- `dist/drivers/{id}/`, `dist/race/{id}/`, `dist/races/{year}/` — pretty URLs via `index.html`.
- `dist/compare/`, `dist/tracks/` — client shells; `dist/compare.js`, `dist/tracks.js`.
- `dist/data/*.json` — the data the client pages fetch.
- `dist/style.css`, `dist/404.html`, `dist/_headers` (caching).

## Custom domain

In the Cloudflare Pages dashboard → the `looplab` project → Custom domains, add your domain and follow the DNS prompt. Nothing in the build changes.

## Local preview of the exported site

`bun run serve` runs the dynamic dev server (same URLs). To preview the actual
static output exactly as Cloudflare serves it, any static server that resolves
`/path` → `/path/index.html` works (e.g. `bunx wrangler pages dev dist`).
