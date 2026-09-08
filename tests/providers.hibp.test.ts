// HIBP k-anonymity client (WS-I). The negative cases are the point: this is a
// third-party network call sitting in the sign-up path, so what it does when
// the third party misbehaves matters more than the happy path.
import { describe, expect, test } from "bun:test";
import { countForSuffix, createHibpClient, createNullHibp } from "../src/providers/hibp.ts";

// SHA-1("password") — the canonical HIBP example.
const PW = "password";
const PREFIX = "5BAA6";
const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";
// A distinctive password for the leak assertions: "password" is a substring of
// api.pwnedpasswords.com, so it cannot distinguish a leak from the hostname.
const SECRET = "orange-gearbox-77";
const SECRET_PREFIX = "5F1C2";
const SECRET_SUFFIX = "E2DF841F3E54D873F8E4771A25D603E2485";

/** A fetch stub that records what it was asked for. */
function stubFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function body(lines: string[]): Response {
  // HIBP returns CRLF-delimited lines.
  return new Response(lines.join("\r\n"), { status: 200 });
}

describe("k-anonymity", () => {
  test("sends only the 5-character prefix — never the suffix, never the password", async () => {
    const fetchStub = stubFetch(() => body([`${SECRET_SUFFIX}:12345`]));
    await createHibpClient({ fetchImpl: fetchStub.impl }).breachCount(SECRET);

    expect(fetchStub.calls).toHaveLength(1);
    const { url, init } = fetchStub.calls[0]!;
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${SECRET_PREFIX}`);
    expect(new URL(url).pathname).toBe(`/range/${SECRET_PREFIX}`);
    const wire = url + JSON.stringify(init);
    expect(wire).not.toContain(SECRET_SUFFIX);
    expect(wire.toLowerCase()).not.toContain(SECRET);
    expect(wire).not.toContain("gearbox");
  });

  test("the canonical HIBP vector hashes to the documented prefix", async () => {
    const fetchStub = stubFetch(() => body([`${SUFFIX}:1`]));
    await createHibpClient({ fetchImpl: fetchStub.impl }).breachCount(PW);
    expect(fetchStub.calls[0]!.url).toEndWith(`/range/${PREFIX}`);
  });

  test("asks for padding so the response length doesn't narrow the bucket", async () => {
    const fetchStub = stubFetch(() => body([`${SUFFIX}:1`]));
    await createHibpClient({ fetchImpl: fetchStub.impl }).breachCount(PW);
    const headers = fetchStub.calls[0]!.init!.headers as Record<string, string>;
    expect(headers["Add-Padding"]).toBe("true");
    expect(headers["User-Agent"]).toBe("looplab-accounts");
  });
});

describe("matching", () => {
  test("returns the count for our suffix, ignoring the rest of the bucket", async () => {
    const client = createHibpClient({
      fetchImpl: stubFetch(() =>
        body(["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:99", `${SUFFIX}:9545824`, "BBB:1"]),
      ).impl,
    });
    expect(await client.breachCount(PW)).toBe(9545824);
  });

  test("matches case-insensitively — the API's casing is not a contract", async () => {
    const client = createHibpClient({
      fetchImpl: stubFetch(() => body([`${SUFFIX.toLowerCase()}:7`])).impl,
    });
    expect(await client.breachCount(PW)).toBe(7);
  });

  test("a suffix that isn't in the bucket is 0, not null — that is a real answer", async () => {
    const client = createHibpClient({
      fetchImpl: stubFetch(() => body(["0000000000000000000000000000000000A:5"])).impl,
    });
    expect(await client.breachCount(PW)).toBe(0);
  });

  test("padding entries (count 0) are not hits", () => {
    expect(countForSuffix(`${SUFFIX}:0`, SUFFIX)).toBe(0);
    expect(countForSuffix(`${SUFFIX}:notanumber`, SUFFIX)).toBe(0);
    expect(countForSuffix("", SUFFIX)).toBe(0);
    expect(countForSuffix("garbage-with-no-colon", SUFFIX)).toBe(0);
  });
});

describe("failing open", () => {
  test("a non-200 is 'no opinion', not 'safe'", async () => {
    for (const status of [400, 429, 500, 503]) {
      const client = createHibpClient({
        fetchImpl: stubFetch(() => new Response("nope", { status })).impl,
      });
      expect(await client.breachCount(PW)).toBeNull();
    }
  });

  test("a thrown fetch is 'no opinion'", async () => {
    const client = createHibpClient({
      fetchImpl: stubFetch(() => {
        throw new Error("getaddrinfo ENOTFOUND");
      }).impl,
    });
    expect(await client.breachCount(PW)).toBeNull();
  });

  test("a slow API is abandoned at the timeout, not waited on", async () => {
    const client = createHibpClient({
      timeoutMs: 10,
      fetchImpl: stubFetch(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init!.signal!;
            // Backstop so a broken abort hangs the test rather than the suite;
            // cleared on abort so no timer outlives the test.
            const backstop = setTimeout(() => reject(new Error("never aborted")), 5_000);
            signal.addEventListener("abort", () => {
              clearTimeout(backstop);
              reject(signal.reason);
            });
          }),
      ).impl,
    });
    const started = Date.now();
    expect(await client.breachCount(PW)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("the null client never has an opinion and never calls out", async () => {
    expect(await createNullHibp().breachCount(PW)).toBeNull();
  });
});
