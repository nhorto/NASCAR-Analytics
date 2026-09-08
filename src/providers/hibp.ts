// Have I Been Pwned "Pwned Passwords" range API in k-anonymity mode — the
// breached-password check the product spec (§6) asks for, replacing the
// offline blocklist in accounts/config.ts as the primary signal.
//
// Only the first five characters of the password's SHA-1 ever leave this
// process. The API answers with every suffix sharing that prefix (~800 of
// them) and the match happens locally, so neither Cloudflare nor HIBP can
// learn the password or even which bucket entry we were asking about.
// `Add-Padding: true` makes every response a uniform size, so the response
// LENGTH doesn't narrow the bucket for a network observer either.
//
// The check FAILS OPEN. Any timeout, non-200, or unparseable body yields
// `null` — "no opinion" — never "safe" and never "breached". An outage at
// api.pwnedpasswords.com must not lock every new sign-up and password reset
// out of the product; the length rules and the offline blocklist still apply
// in that window. Failing closed would convert a third party's downtime into
// our own.

export const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range";
export const HIBP_TIMEOUT_MS = 2_000;

export interface HibpClient {
  /**
   * How many times this password appears in the breach corpus. `0` means the
   * corpus has never seen it; `null` means the check could not be performed.
   */
  breachCount(password: string): Promise<number | null>;
}

export interface HibpOptions {
  /** Range endpoint, without a trailing slash. Overridable for tests. */
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

function sha1Hex(password: string): string {
  return new Bun.CryptoHasher("sha1").update(password).digest("hex").toUpperCase();
}

/**
 * Count for `suffix` in a range response, or 0 when the bucket doesn't hold
 * it. Padding entries are real-looking hashes with a count of 0, so a zero (or
 * malformed) count is "not found", never a hit.
 */
export function countForSuffix(body: string, suffix: string): number {
  const wanted = suffix.toUpperCase();
  for (const line of body.split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    if (line.slice(0, sep).trim().toUpperCase() !== wanted) continue;
    const count = Number.parseInt(line.slice(sep + 1).trim(), 10);
    return Number.isFinite(count) && count > 0 ? count : 0;
  }
  return 0;
}

export function createHibpClient(opts: HibpOptions = {}): HibpClient {
  const baseUrl = (opts.baseUrl ?? HIBP_RANGE_URL).replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? HIBP_TIMEOUT_MS;
  const doFetch = opts.fetchImpl ?? fetch;
  const userAgent = opts.userAgent ?? "looplab-accounts";
  return {
    async breachCount(password: string): Promise<number | null> {
      const hash = sha1Hex(password);
      const prefix = hash.slice(0, 5);
      const suffix = hash.slice(5);
      try {
        const res = await doFetch(`${baseUrl}/${prefix}`, {
          headers: { "Add-Padding": "true", "User-Agent": userAgent },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return null;
        return countForSuffix(await res.text(), suffix);
      } catch {
        return null;
      }
    },
  };
}

/** Always "no opinion" — tests, offline runs, and anywhere the check is off. */
export function createNullHibp(): HibpClient {
  return { breachCount: async () => null };
}
