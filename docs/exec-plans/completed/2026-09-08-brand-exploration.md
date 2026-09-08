# Naming and logo exploration

Status: COMPLETE — exploration delivered; brand selection remains open
Date: 2026-09-08

## Request

Explore names and logos for the existing Looplab racing analytics app, including a tire with sidewall lettering, general brand lockups, and phone app icons. Deliver a reviewable HTML mockup; the name is undecided.

## Approach

Create a self-contained, offline-capable HTML concept gallery in `docs/design-docs/`. Draw editable SVG marks directly in the document. Include six visual directions, naming rationale and tradeoffs, current charcoal/yellow and alternate palettes, a custom-name control, small-size previews, a phone home screen, a sample app header, and SVG/PNG concept downloads. Keep production branding unchanged until a direction is selected. Label names as creative candidates with availability unverified and store previews as conceptual.

## Steps

- [x] Read architecture, plans, design tokens, product positioning, and existing PWA icon work.
- [x] Build the responsive concept gallery and interactions.
- [x] Review desktop/mobile rendering, keyboard controls, name editing, palette changes, and downloads.
- [x] Run the full Bun suite including architecture tests.
- [x] Record results, link the artifact in the design index, and complete this plan.

## Validation

Use the browser to inspect desktop/mobile layouts and exercise controls. Run `bun test`; no new production behavior or implementation-mirroring tests are required for this design artifact.

## Result

Delivered [the standalone HTML studio](../../design-docs/2026-09-08-brand-exploration.html). Six directions: Looplab sidewall badge, Looplab telemetry loop, Stint split-sector S, Racetrace lap signature, Draftline drafting pair, and Turnwise informed turn. Each has a naming rationale and tradeoff; custom names can be paired with any mark. Palette controls include the existing yellow plus ice blue and warm coral. Full logos support dark, light, and one-color treatments; icon exports have a square opaque canvas, with rounded previews in the mockups.

Browser validation used headless Chrome through a temporary Playwright installation outside the repo because the collaborative preview host was unavailable. Verified all concept selectors, all palettes and treatments, custom-name escaping, reset and shortlist navigation, keyboard focus, direct file opening without a server, and all 18 downloads (12 valid SVGs and six 1024 × 1024 PNGs). Visually reviewed desktop and mobile screenshots. Fixed long-word clipping and 320px overflow; checked 390px and 320px layouts. No browser script errors.

`bun test`: **664 pass, 0 fail**, 2,146 assertions across 36 files, including architecture tests. Installed the existing dependencies with `bun install --frozen-lockfile`; no package changes. No production behavior, capability guarantees, or quality grades changed, and no technical debt was introduced. Architecture documentation now locates the concept artifact. Final brand selection, name availability research, and a production App Store asset package are subsequent work.
