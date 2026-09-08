// Generates the PWA icon set from source (WS-H). Run: `bun run gen:icons`.
//
// The mark is the "loop" of Looplab: an accent-colored oval track on the app's
// dark background, drawn as an analytic shape (an elliptical annulus) so it is
// resolution-independent and reproducible — no binary blobs in git that nobody
// can regenerate. Colors come from docs/DESIGN.md via style.css tokens.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodePng } from "../src/utils/png.ts";

const BG = { r: 0x0a, g: 0x0c, b: 0x10 }; // --bg
const ACCENT = { r: 0xff, g: 0xd2, b: 0x3f }; // --accent
// fileURLToPath, not `.pathname` — a repo path containing a space (this one
// does) comes back percent-encoded from `.pathname` and silently writes the
// icons into a phantom "NASCAR%20Analytics" directory.
const OUT_DIR = fileURLToPath(new URL("../src/app/static/icons/", import.meta.url));

interface IconSpec {
  file: string;
  size: number;
  /** Maskable icons must keep the mark inside the safe zone (inner 80%). */
  maskable: boolean;
}

const ICONS: IconSpec[] = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
  // iOS ignores the manifest for the home-screen icon and uses this one; it
  // also composites on an opaque background, so it must not be transparent.
  { file: "apple-touch-icon.png", size: 180, maskable: false },
];

/** Coverage of the pixel at (px,py) by the elliptical annulus, 0..1, 4x4 supersampled. */
function coverage(px: number, py: number, cx: number, cy: number, rx: number, ry: number, thickness: number): number {
  let hits = 0;
  const samples = 4;
  for (let sy = 0; sy < samples; sy++) {
    for (let sx = 0; sx < samples; sx++) {
      const x = px + (sx + 0.5) / samples;
      const y = py + (sy + 0.5) / samples;
      const outer = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      const inner = ((x - cx) / (rx - thickness)) ** 2 + ((y - cy) / (ry - thickness)) ** 2;
      if (outer <= 1 && inner >= 1) hits++;
    }
  }
  return hits / (samples * samples);
}

function render(size: number, maskable: boolean): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  // Maskable icons get cropped to a circle by the launcher, so keep the mark
  // inside the inner 80% safe zone; standard icons can use more of the canvas.
  const span = maskable ? 0.32 : 0.40;
  const rx = size * span;
  const ry = size * span * 0.68; // an oval — a speedway, not a circle
  const thickness = Math.max(2, size * (maskable ? 0.075 : 0.09));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = coverage(x, y, cx, cy, rx, ry, thickness);
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(BG.r + (ACCENT.r - BG.r) * a);
      rgba[i + 1] = Math.round(BG.g + (ACCENT.g - BG.g) * a);
      rgba[i + 2] = Math.round(BG.b + (ACCENT.b - BG.b) * a);
      rgba[i + 3] = 255; // opaque: iOS composites on white otherwise
    }
  }
  return rgba;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const spec of ICONS) {
  const png = encodePng(spec.size, spec.size, render(spec.size, spec.maskable));
  await Bun.write(OUT_DIR + spec.file, png);
  console.log(`${spec.file.padEnd(26)} ${spec.size}x${spec.size}  ${(png.length / 1024).toFixed(1)} KB${spec.maskable ? "  (maskable)" : ""}`);
}
console.log(`\n${ICONS.length} icons written to src/app/static/icons/`);
