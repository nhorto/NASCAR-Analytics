// PNG encoder (WS-H). The icons are generated from source, so the encoder has
// to produce bytes a *strict* decoder accepts — lenient tools like file(1) and
// macOS sips only sniff the header and will happily bless a broken PNG.
import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { chunk, crc32, encodePng } from "../src/utils/png.ts";

describe("crc32", () => {
  test("matches the published IEEE 802.3 check value", () => {
    // "123456789" → 0xCBF43926 is the standard CRC-32 test vector.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  test("empty input is zero and a one-byte change alters the result", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(new Uint8Array([1, 2, 3]))).not.toBe(crc32(new Uint8Array([1, 2, 4])));
  });
});

describe("chunk framing", () => {
  test("length, type, data and CRC are laid out per the spec", () => {
    const data = new Uint8Array([0xaa, 0xbb]);
    const out = chunk("IEND", data);
    expect(out.length).toBe(4 + 4 + 2 + 4);
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 2]); // big-endian length
    expect(new TextDecoder().decode(out.slice(4, 8))).toBe("IEND");
    // CRC covers type + data, not the length field.
    const expected = crc32(new Uint8Array([...new TextEncoder().encode("IEND"), ...data]));
    // layout: length(4) + type(4) + data(2) → CRC begins at byte 10
    const actual = new DataView(out.buffer, out.byteOffset + 10, 4).getUint32(0);
    expect(actual).toBe(expected);
  });
});

describe("encodePng", () => {
  const W = 4;
  const H = 3;
  function solid(r: number, g: number, b: number, a = 255): Uint8Array {
    const px = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = a;
    }
    return px;
  }

  test("starts with the PNG signature", () => {
    const png = encodePng(W, H, solid(255, 0, 0));
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test("IHDR declares 8-bit RGBA, non-interlaced, at the right size", () => {
    const png = encodePng(W, H, solid(1, 2, 3));
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(W); // after sig(8) + len(4) + "IHDR"(4)
    expect(view.getUint32(20)).toBe(H);
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(6); // color type RGBA
    expect(png[28]).toBe(0); // interlace: none
  });

  test("IDAT is a real zlib stream that inflates to filtered scanlines", () => {
    // The bug this guards: Bun.deflateSync emits RAW deflate, which browsers
    // reject even though file(1)/sips call the result a valid PNG.
    const png = encodePng(W, H, solid(10, 20, 30));
    let offset = 8;
    let idat = new Uint8Array(0);
    const view = new DataView(png.buffer, png.byteOffset);
    while (offset < png.length) {
      const len = view.getUint32(offset);
      const type = new TextDecoder().decode(png.slice(offset + 4, offset + 8));
      if (type === "IDAT") idat = png.slice(offset + 8, offset + 8 + len);
      offset += 12 + len;
    }
    const raw = new Uint8Array(inflateSync(idat)); // throws if not zlib-wrapped
    expect(raw.length).toBe((W * 4 + 1) * H);
    expect(raw[0]).toBe(0); // filter type None on every scanline
    expect(raw[W * 4 + 1]).toBe(0);
    // Pixel data survives the round trip.
    expect([...raw.slice(1, 5)]).toEqual([10, 20, 30, 255]);
  });

  test("every chunk's CRC verifies, and the file ends with IEND", () => {
    const png = encodePng(W, H, solid(0, 0, 0));
    const view = new DataView(png.buffer, png.byteOffset);
    let offset = 8;
    const types: string[] = [];
    while (offset < png.length) {
      const len = view.getUint32(offset);
      const body = png.slice(offset + 4, offset + 8 + len);
      const stored = view.getUint32(offset + 8 + len);
      expect(crc32(body)).toBe(stored);
      types.push(new TextDecoder().decode(png.slice(offset + 4, offset + 8)));
      offset += 12 + len;
    }
    expect(types).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(offset).toBe(png.length); // no trailing garbage
  });

  test("a pixel buffer of the wrong size is rejected, not silently truncated", () => {
    expect(() => encodePng(4, 3, new Uint8Array(10))).toThrow(
      "encodePng: expected 48 bytes for 4x3, got 10",
    );
  });
});
