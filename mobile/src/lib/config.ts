// Where the app points. There is no product domain yet (decision D2), so the
// default is the dev server; Settings can override it, persisted locally.
// The live Worker is a separate, CORS-open origin (launch plan D17).
import { getItem, setItem } from "./storage.ts";

export const DEFAULT_SERVER_BASE = "http://localhost:3000";
export const LIVE_API_BASE = "https://looplab-live.nhorton.workers.dev";

const SERVER_KEY = "looplab.serverBase";

/** Trailing-slash-free base URL, or null when it does not parse. */
export function normalizeBase(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "") return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

export async function serverBase(): Promise<string> {
  const stored = await getItem(SERVER_KEY);
  return (stored && normalizeBase(stored)) || DEFAULT_SERVER_BASE;
}

export async function setServerBase(raw: string): Promise<boolean> {
  const normalized = normalizeBase(raw);
  if (!normalized) return false;
  await setItem(SERVER_KEY, normalized);
  return true;
}
