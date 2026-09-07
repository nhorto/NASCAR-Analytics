// A minimal PNG encoder (WS-H). Icons are *generated* from source rather than
// committed as opaque binaries an agent can neither read nor regenerate, and
// the repo keeps its single-runtime-dependency posture — so this writes the
// handful of PNG chunks we need by hand: 8-bit RGBA, non-interlaced, one IDAT.
//
// Format reference: PNG spec (RFC 2083). Structure is
//   signature | IHDR | IDAT (zlib of filtered scanlines) | IEND
// where every chunk is length | type | data | CRC32(type + data).
//
// IDAT must be a *zlib* stream (RFC 1950: 2-byte header + deflate + Adler-32),
// NOT raw deflate. `Bun.deflateSync` returns raw deflate, which lenient tools
// (file(1), macOS sips) still report as a valid PNG while browsers and strict
// decoders reject it — so this uses node:zlib, whose deflateSync wraps.
import { deflateSync } from "node:zlib";

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC-32 (IEEE 802.3), the variant PNG chunks use. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]!;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

/** One PNG chunk: length, type, data, CRC over (type + data). */
export function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

/**
 * Encode 8-bit RGBA pixels (row-major, 4 bytes per pixel) as a PNG.
 * Every scanline uses filter type 0 (None) — the images are flat shapes, so
 * the compression win from predictive filters is not worth the code.
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const expected = width * height * 4;
  if (rgba.length !== expected)
    throw new Error(`encodePng: expected ${expected} bytes for ${width}x${height}, got ${rgba.length}`);

  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const idat = new Uint8Array(deflateSync(raw));
  const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}
