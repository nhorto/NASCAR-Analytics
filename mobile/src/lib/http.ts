// fetch with a timeout — the entire HTTP client (mirrors the Fripp app's
// lib/http.ts). Race-day cell coverage makes a hung request the common
// failure, and RN's fetch has no default timeout.
export const DEFAULT_TIMEOUT_MS = 10_000;

export async function timedFetch(
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
