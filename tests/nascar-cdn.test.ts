import { describe, expect, test } from "bun:test";
import { createNascarCdnClient } from "../src/providers/nascar-cdn.ts";

describe("NASCAR CDN client", () => {
  test("returns an exhausted 5xx response so ingestion can record and skip it", async () => {
    let calls = 0;
    const client = createNascarCdnClient({
      delayMs: 0,
      retries: 2,
      retryBaseDelayMs: 0,
      userAgent: "test",
      fetchImpl: async () => {
        calls++;
        return new Response(null, { status: 503 });
      },
    });

    await expect(client.fetchJson("https://example.test/optional.json")).resolves.toEqual({
      url: "https://example.test/optional.json",
      status: 503,
      body: null,
      json: null,
    });
    expect(calls).toBe(3);
  });

  test("still throws after exhausted transport failures", async () => {
    const client = createNascarCdnClient({
      delayMs: 0,
      retries: 1,
      retryBaseDelayMs: 0,
      userAgent: "test",
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });

    await expect(client.fetchJson("https://example.test/feed.json")).rejects.toThrow(
      "CDN fetch failed after 2 attempts",
    );
  });
});
