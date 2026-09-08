# Brand exploration V3 — generated tire and track concepts

Status: COMPLETE — concepts delivered; final name and brand selection remain open

## Request and references

Review the Downloads V2 gallery, three real tire JPEGs, and the two 12:30 Spotter PNGs. The user likes the sidewall lettering concept but rejects the flat PNG execution. Generate new raster artwork and a revised HTML gallery; keep name selection open and deliver to Downloads.

## Approach

Use the imagegen skill's built-in image tool. Real tire photos are material/proportion references only; do not reuse the rejected Spotter artwork. Generate four distinct assets: a realistic lettered black wheel/tire, a graphic yellow steel wheel/tire, a blank front-on tire master with editable HTML sidewall lettering, and a refined oval-track symbol. Looplab is a placeholder only. Preserve useful earlier SVG track/naming exploration by linking a bundled copy of the original gallery. Create a self-contained V3 gallery with embedded generated artwork, a name/tagline editor over the blank master, size and phone previews, and downloads. Save original generated PNGs and prompt provenance alongside the gallery in the workspace and a versioned Downloads folder.

## Steps

- [x] Inspect V2, all five image references, and imagegen instructions.
- [x] Generate, inspect, and save the four raster concepts.
- [x] Build V3 gallery and editable sidewall composition.
- [x] Browser-check desktop/mobile, name and tagline editing, and image downloads.
- [x] Run full Bun tests and update plan/design documentation.
- [x] Deliver V3 HTML and original PNGs to Downloads.

## Boundaries

This is brand exploration. Baked lettering in generated images is labeled as a sample; the blank master permits text changes. No name availability claims are inherited from V2. Original Downloads and production branding remain intact.

## Results and verification

- Four 1254 × 1254 original PNGs generated through the built-in tool and preserved in `docs/design-docs/brand-v3-assets/`; exact prompts and reference filenames are in `PROMPTS.md`. An initial image-service 500 interrupted the first generation group; missing outputs succeeded on retry. All four outputs were visually inspected, including sample text spelling and the unlettered master's clear sidewall.
- `scripts/build-brand-v3.ts` embeds the four originals and a downloadable copy of the earlier studio into the standalone HTML. The generated tire is preserved as raster artwork; the workbench adds editable curved SVG text and exports SVG or a 1600 × 1600 PNG composition. The PNG is an upscale of the underlying 1254px tire image, not a newly generated higher-resolution original.
- Headless Chrome review through a temporary Playwright installation outside the repository after both native preview status and open explicitly reported no automation host. All four images load directly from a file URL. Verified all original PNG downloads, enlarged-image dialog/Escape dismissal, name/tagline escaping with punctuation, all phone artwork selections, color/type/size controls, long text, editable SVG download, and composed PNG download. Visually inspected the exported PNG. No browser errors or overflow at 390px and 320px.
- Visual review caught literal Unicode escapes from Bun's handling of the raw template; switched to a normal template. Increased sidewall type size and used a narrower system face for better lettering placement. Final desktop/mobile screenshots reviewed.
- `bun test`: **664 pass, 0 fail**, 2,146 assertions across 36 files, including architecture tests. Builder syntax compiled successfully; `git diff --check` clean. No production capabilities or quality grades changed.
- Delivered `/Users/nicholashorton/Downloads/NASCAR-Logo-and-Naming-Concepts-v3.html` plus `/Users/nicholashorton/Downloads/NASCAR-Brand-Concepts-V3/` containing `OPEN-GALLERY.html`, the four original PNGs, prompts, and the earlier gallery. SHA-256 confirmed both delivered V3 HTML copies match the workspace artifact.
