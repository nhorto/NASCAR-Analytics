import { sleep } from "../utils/sleep.ts";

export interface CdnFetchResult {
  url: string;
  status: number;
  /** Raw response text when status is 200, otherwise null. */
  body: string | null;
  /** Parsed JSON when status is 200 and the body parses, otherwise null. */
  json: unknown;
}

export interface NascarCdnClient {
  fetchJson(url: string): Promise<CdnFetchResult>;
}

export interface CdnClientOptions {
  delayMs: number;
  retries: number;
  retryBaseDelayMs: number;
  userAgent: string;
  /** Injectable transport for deterministic tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Serialized, rate-limited fetcher for the NASCAR CDN. 4xx responses are
 * returned as-is (missing data is an expected outcome); 5xx and network
 * errors retry with exponential backoff.
 */
export function createNascarCdnClient(opts: CdnClientOptions): NascarCdnClient {
  let lastFetchAt = 0;
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function throttle(): Promise<void> {
    const wait = lastFetchAt + opts.delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastFetchAt = Date.now();
  }

  async function fetchOnce(url: string): Promise<CdnFetchResult> {
    const res = await fetchImpl(url, { headers: { "User-Agent": opts.userAgent } });
    if (res.status !== 200) {
      return { url, status: res.status, body: null, json: null };
    }
    const body = await res.text();
    try {
      return { url, status: 200, body, json: JSON.parse(body) };
    } catch {
      return { url, status: 200, body, json: null };
    }
  }

  return {
    async fetchJson(url: string): Promise<CdnFetchResult> {
      let lastError: unknown;
      let lastResponse: CdnFetchResult | null = null;
      for (let attempt = 0; attempt <= opts.retries; attempt++) {
        if (attempt > 0) await sleep(opts.retryBaseDelayMs * 2 ** (attempt - 1));
        await throttle();
        try {
          const result = await fetchOnce(url);
          if (result.status >= 500) {
            lastResponse = result;
            lastError = new Error(`HTTP ${result.status} for ${url}`);
            continue;
          }
          return result;
        } catch (err) {
          lastError = err;
        }
      }
      // A persistent HTTP response is still a valid observation. Return it so
      // ingestion can record the miss and continue; the next refresh retries it.
      // Transport failures have no status to record and remain fatal.
      if (lastResponse) return lastResponse;
      throw new Error(`CDN fetch failed after ${opts.retries + 1} attempts: ${url}`, {
        cause: lastError,
      });
    },
  };
}
