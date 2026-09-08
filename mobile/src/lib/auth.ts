// Email/password auth against the existing server endpoints (no new server
// auth surface — launch plan D11, WS-J sub-plan). The web flow is
// form-encoded + PRG + CSRF double-submit; this client rides the platform
// cookie jar for the session (credentials: "include") and echoes the csrf
// cookie it read from an auth GET's Set-Cookie header. RN cannot reliably do
// manual redirects, so success is classified from the *final* response after
// the 303 is followed (a redirect to /account or /signin?m=…).
//
// Pure helpers (classifyAuthResponse, extractFormError) are unit tested; the
// fetch wrappers are thin.
import { timedFetch } from "./http.ts";
import { parseSetCookie } from "./cookies.ts";
import { getItem, setItem } from "./storage.ts";

const CSRF_KEY = "looplab.csrf";

export type AuthFailure = "invalid_credentials" | "rejected" | "rate_limited" | "csrf" | "network";
export type AuthResult = { ok: true } | { ok: false; reason: AuthFailure; detail: string | null };

/** The server's error paragraph: `<p class="note form-error" …>⚠ reason</p>`. */
export function extractFormError(html: string): string | null {
  const match = /<p class="note form-error"[^>]*>\s*(?:⚠\s*)?([^<]+)</.exec(html);
  const text = match?.[1]?.trim();
  return text ? text : null;
}

/**
 * Map the final response of a followed auth POST onto an outcome. `finalPath`
 * is the pathname fetch landed on after redirects ("" when unavailable).
 */
export function classifyAuthResponse(
  status: number,
  finalPath: string,
  formError: string | null,
): AuthResult {
  if (status === 303 || (status === 200 && formError === null && finalPath.startsWith("/account"))) {
    return { ok: true };
  }
  if (status === 401) return { ok: false, reason: "invalid_credentials", detail: formError };
  if (status === 429) return { ok: false, reason: "rate_limited", detail: "Too many attempts — try again later." };
  if (status === 403) return { ok: false, reason: "csrf", detail: null };
  if (status === 400 || status === 200) return { ok: false, reason: "rejected", detail: formError };
  return { ok: false, reason: "network", detail: `Unexpected response (${status}).` };
}

/**
 * Read the csrf token: GET an auth page and capture its Set-Cookie. When the
 * platform jar already holds a valid csrf cookie the server sets nothing new,
 * so the last-seen value is kept in storage as the fallback. If both are
 * stale the POST fails with reason "csrf" and the caller retries once.
 */
async function csrfToken(base: string): Promise<string | null> {
  try {
    const res = await timedFetch(`${base}/signin`, { credentials: "include" });
    const fresh = parseSetCookie(res.headers.get("set-cookie")).csrf;
    if (fresh) {
      await setItem(CSRF_KEY, fresh);
      return fresh;
    }
  } catch {
    // fall through to the stored value
  }
  return getItem(CSRF_KEY);
}

async function postForm(base: string, path: string, fields: Record<string, string>): Promise<AuthResult> {
  const token = await csrfToken(base);
  if (!token) return { ok: false, reason: "network", detail: "Could not reach the server." };
  try {
    const res = await timedFetch(`${base}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf: token, ...fields }).toString(),
    });
    const finalPath = res.url ? new URL(res.url).pathname : "";
    const contentType = res.headers.get("content-type") ?? "";
    const formError = contentType.includes("text/html") ? extractFormError(await res.text()) : null;
    return classifyAuthResponse(res.status, finalPath, formError);
  } catch {
    return { ok: false, reason: "network", detail: "Could not reach the server." };
  }
}

/** One retry on csrf failure: the jar and our echoed token can drift. */
async function postFormWithRetry(base: string, path: string, fields: Record<string, string>): Promise<AuthResult> {
  const first = await postForm(base, path, fields);
  if (first.ok || first.reason !== "csrf") return first;
  return postForm(base, path, fields);
}

export function signIn(base: string, email: string, password: string): Promise<AuthResult> {
  return postFormWithRetry(base, "/auth/signin", { email, password });
}

export function signUp(base: string, email: string, password: string): Promise<AuthResult> {
  return postFormWithRetry(base, "/auth/signup", { email, password });
}

export function requestReset(base: string, email: string): Promise<AuthResult> {
  return postFormWithRetry(base, "/auth/reset-request", { email });
}

export function signOut(base: string): Promise<AuthResult> {
  return postFormWithRetry(base, "/auth/signout", {});
}

export function signOutEverywhere(base: string): Promise<AuthResult> {
  return postFormWithRetry(base, "/auth/signout-all", {});
}

// ---- viewer state (GET /api/me) ----

export interface Me {
  email: string;
  verifiedAt: string | null;
  pro: boolean;
  proUntil: string | null;
  proSource: "subscription" | "season_pass" | "grant" | null;
}

export type MeResult =
  | { status: "signed_in"; me: Me }
  | { status: "anonymous" }
  | { status: "unreachable" };

export function parseMe(value: unknown): Me | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.email !== "string" || typeof v.pro !== "boolean") return null;
  return {
    email: v.email,
    verifiedAt: typeof v.verifiedAt === "string" ? v.verifiedAt : null,
    pro: v.pro,
    proUntil: typeof v.proUntil === "string" ? v.proUntil : null,
    proSource:
      v.proSource === "subscription" || v.proSource === "season_pass" || v.proSource === "grant"
        ? v.proSource
        : null,
  };
}

/** Entitlement truth lives on the server; this is the app's only read of it. */
export async function fetchMe(base: string): Promise<MeResult> {
  try {
    const res = await timedFetch(`${base}/api/me`, { credentials: "include" });
    if (res.status === 401) return { status: "anonymous" };
    if (!res.ok) return { status: "unreachable" };
    const me = parseMe(await res.json());
    return me ? { status: "signed_in", me } : { status: "unreachable" };
  } catch {
    return { status: "unreachable" };
  }
}
