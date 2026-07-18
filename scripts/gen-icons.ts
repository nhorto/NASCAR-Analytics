// Generates the PWA icon set as PNGs with zero image dependencies — pure pixel
// math (SDF shapes + 1px anti-aliasing) and node:zlib for the PNG deflate.
// Run once:  bun run scripts/gen-icons.ts
// Outputs are committed under src/app/assets/ and copied to dist/icons/ by the
// exporter. Design: Looplab dark tile, the yellow "loop" ring, a live-green dot
// on the ring (the live-dot motif from the nav) — matches style.css tokens.
import { deflateSync } from "node:zlib";

const OUT_DIR = "src/app/assets";

const BG: Rgb = [10, 12, 16]; // --bg #0a0c10
const YELLOW: Rgb = [255, 210, 63]; // --accent #ffd23f
const GREEN: Rgb = [52, 211, 153]; // --pos #34d399

type Rgb = [number, number, number];

// ---- tiny PNG encoder (8-bit RGBA, filter 0) ----

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const body = out.subarray(4, 8 + data.length);
  dv.setUint32(8 + data.length, crc32(body));
  return out;
}

function encodePng(size: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size);
  dv.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10..12: compression/filter/interlace = 0
  const raw = new Uint8Array(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter: none
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (1 + size * 4) + 1);
  }
  const idat = new Uint8Array(deflateSync(raw, { level: 9 }));
  const sig = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---- drawing: signed distances + 1px anti-alias ----

/** Coverage from a signed distance (px): 1 well inside, 0 outside, ~1px ramp. */
const cov = (d: number) => Math.max(0, Math.min(1, 0.5 - d));

/** Signed distance to a rounded square filling the canvas (radius r px). */
function roundedSquareDist(x: number, y: number, size: number, r: number): number {
  const hx = Math.abs(x - size / 2) - (size / 2 - r);
  const hy = Math.abs(y - size / 2) - (size / 2 - r);
  const ax = Math.max(hx, 0);
  const ay = Math.max(hy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(hx, hy), 0) - r;
}

/**
 * Render one icon. `fullBleed` fills the whole square (maskable / apple-touch);
 * otherwise the tile is a rounded square with transparent corners. `k` scales
 * the artwork toward the center (maskable safe zone).
 */
function drawIcon(size: number, opts: { fullBleed: boolean; k: number }): Uint8Array {
  const { fullBleed, k } = opts;
  const c = size / 2;
  const ringR = 0.3 * size * k;
  const ringHalf = 0.057 * size * k;
  const dotAngle = -0.9; // upper right of the ring
  const dotX = c + Math.cos(dotAngle) * ringR;
  const dotY = c + Math.sin(dotAngle) * ringR;
  const dotR = 0.088 * size * k;
  const dotGap = 0.03 * size * k; // dark separation ring around the dot
  const cornerR = 0.225 * size;

  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x + 0.5;
      const fy = y + 0.5;
      const tile = fullBleed ? 1 : cov(roundedSquareDist(fx, fy, size, cornerR));
      if (tile <= 0) continue;

      // Paint order: bg → yellow ring → bg gap ring → green dot.
      let [r, g, b] = BG;
      const dRing = Math.abs(Math.hypot(fx - c, fy - c) - ringR) - ringHalf;
      const aRing = cov(dRing);
      if (aRing > 0) {
        r = r + (YELLOW[0] - r) * aRing;
        g = g + (YELLOW[1] - g) * aRing;
        b = b + (YELLOW[2] - b) * aRing;
      }
      const dDot = Math.hypot(fx - dotX, fy - dotY);
      const aGap = cov(dDot - (dotR + dotGap));
      if (aGap > 0) {
        r = r + (BG[0] - r) * aGap;
        g = g + (BG[1] - g) * aGap;
        b = b + (BG[2] - b) * aGap;
      }
      const aDot = cov(dDot - dotR);
      if (aDot > 0) {
        r = r + (GREEN[0] - r) * aDot;
        g = g + (GREEN[1] - g) * aDot;
        b = b + (GREEN[2] - b) * aDot;
      }

      const i = (y * size + x) * 4;
      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(tile * 255);
    }
  }
  return px;
}

const targets: Array<{ file: string; size: number; fullBleed: boolean; k: number }> = [
  { file: "icon-192.png", size: 192, fullBleed: false, k: 1 },
  { file: "icon-512.png", size: 512, fullBleed: false, k: 1 },
  // Maskable: full-bleed with the artwork inside the ~80% safe zone.
  { file: "icon-maskable-512.png", size: 512, fullBleed: true, k: 0.76 },
  // iOS home screen: opaque square (iOS rounds it itself).
  { file: "apple-touch-icon.png", size: 180, fullBleed: true, k: 0.85 },
];

for (const t of targets) {
  const png = encodePng(t.size, drawIcon(t.size, t));
  await Bun.write(`${OUT_DIR}/${t.file}`, png);
  console.log(`wrote ${OUT_DIR}/${t.file} (${t.size}×${t.size}, ${png.length} bytes)`);
}
