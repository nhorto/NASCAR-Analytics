# Design System — NASCAR Analytics

## Design Principles

1. **Mobile-first** — Design for phone screens first, then scale up to desktop
2. **Data density without clutter** — Show lots of data but make it scannable
3. **Dark mode default** — Racing fans are used to dark UIs (NASCAR app, sim racing)
4. **Color = meaning** — Green for positive/gains, red for negative/losses, accent color for highlights
5. **Fast** — Page load under 1 second. No loading spinners for cached data.

## Color Palette

Defined 2026-07-05 via the [Phase 3 mockup](design-docs/2026-07-05-phase3-ui-mockup.html) (source of truth for look & feel):

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#0a0c10` | Page background |
| `--surface` | `#12151c` | Cards |
| `--surface-2` | `#191d26` | Nested surfaces (bars, segmented controls) |
| `--border` | `#262c38` | Card borders, table rules |
| `--text` | `#e9edf4` | Primary text |
| `--muted` | `#8b95a6` | Labels, secondary text |
| `--accent` | `#ffd23f` | Caution-flag yellow. Highlights ONLY: active nav, section ticks, hero numbers |
| `--pos` | `#34d399` | Gains / good — never decorative |
| `--neg` | `#f87171` | Losses / bad — never decorative |

## Typography

- **Display** (headlines, big numbers): `"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", system-ui` — bold, uppercase, slight letter-spacing. Motorsport feel without webfont downloads.
- **Body**: system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`).
- **All numbers**: `font-variant-numeric: tabular-nums` so columns align.

## Component Patterns

Established in the mockup; UI code must reuse these rather than invent new ones:

- **Card** — surface + border + 16px radius; header = accent tick + uppercase muted condensed label, optional "more →" link right
- **Stat chips** — 4-up grid; big condensed number over tiny uppercase label
- **Tables** — tight rows, uppercase micro headers, right-aligned numerics, ▲/▼ position deltas in pos/neg colors
- **Number badge** — rounded square with car number, team-colored background
- **Split bars** — label / horizontal bar / value rows (track-type splits, loop insights)
- **Compare rows** — value / mirrored bar / metric label / bar / value; winning side's bar in `--pos`
- **Sparkline** — inline SVG polyline, green stroke, dot + value on latest point
- **Segmented control** — pill container, active segment filled with accent
- **Trend pill** — small rounded badge, ▲/▼ with tinted background
- **Phone chrome** — top app bar (wordmark + season pill), bottom 5-tab bar (Home / Live / Picks / Stats / Account) with inline-SVG icons; a red pulsing dot on Live when a race is on track
- **Desktop chrome (≥900px)** — a left sidenav replaces the app bar + tab bar: wordmark, series switch, grouped nav (Race weekend / Results / Stats / Tools), and an account/Go-Pro footer. Content widens; Home flows into two columns. See [UX realignment](design-docs/2026-09-09-ux-realignment.md).
- **Series switcher** — a segmented control (Cup / Xfinity / Trucks) directly under the app bar. This is the *primary* navigation axis (which garage), orthogonal to the section tabs (which view). Reuses `.seg`; active segment filled with accent. Carried in the URL via `?series=`.

## Two navigation axes

The app has two independent axes, and the layout keeps them visually separate so neither is mistaken for the other:
- **Series** (Cup / Xfinity / Trucks) — top, segmented, under the app bar (or at the top of the desktop sidenav).
- **Section** — the five mobile tabs (Home / Live / Picks / Stats / Account) or, on desktop, the full grouped sidenav. The five tabs are groups: Picks holds Predictions ⇄ DFS; Stats is a hub landing (`/stats`) linking Recap, Races, Drivers, Metrics, Compare, Track types. Each page maps to one tab-group for highlighting (`TAB_GROUP` in layout.ts); the desktop sidenav highlights the exact page.
Switching series lands on the same section's index for the new series; switching section preserves the current series.

Series lives in the URL **path** (`/`, `/xfinity`, `/trucks`), not a query param, so the site exports to static files (one per series) for Cloudflare Pages. The two interactive views — Compare and Track Explorer — render client-side from shipped JSON but reuse these exact component classes, so they look identical to the server-rendered pages.

## Layout Rules

- Cards for driver/race data
- Tables for detailed comparisons (sortable, filterable)
- Charts for trends and visualizations
- Responsive grid: 1 column mobile, 2-3 columns tablet, 4 columns desktop
