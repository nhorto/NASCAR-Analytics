// Per-request viewer resolution + cookie/CSRF plumbing. This is the app-layer
// composition point for accounts (who is signed in) and billing (are they
// Pro) — domain runtimes may not import each other's services, so the join
// happens here.
import type { Providers } from "../providers/index.ts";
import { accountsService, accountsConfig, type User } from "../domains/accounts/index.ts";
import { billingService, type ProStatus } from "../domains/billing/index.ts";

type P = Pick<Providers, "db">;

export interface Viewer extends ProStatus {
  user: User | null;
  /** Raw session token from the cookie (for sign-out); null when anonymous. */
  sessionToken: string | null;
}

export const ANONYMOUS: Viewer = {
  user: null,
  sessionToken: null,
  pro: false,
  proUntil: null,
  proSource: null,
};

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

export function resolveViewer(p: P, req: Request, now: Date): Viewer {
  const raw = parseCookies(req.headers.get("cookie"))[accountsConfig.SESSION_COOKIE];
  if (!raw) return ANONYMOUS;
  const user = accountsService.resolveSession(p, raw, now);
  if (!user) return ANONYMOUS;
  return { user, sessionToken: raw, ...billingService.proStatus(p, user.userId, now) };
}

/** True when the request even claims a session — used for cache privacy. */
export function hasSessionCookie(req: Request): boolean {
  return accountsConfig.SESSION_COOKIE in parseCookies(req.headers.get("cookie"));
}

// --- cookie builders ---

function cookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  const flags = [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAgeSeconds}`];
  if (secure) flags.push("Secure");
  return `${name}=${value}; ${flags.join("; ")}`;
}

export function sessionCookie(rawToken: string, secure: boolean): string {
  return cookie(accountsConfig.SESSION_COOKIE, rawToken, accountsConfig.SESSION_TTL_MS / 1000, secure);
}

export function clearSessionCookie(secure: boolean): string {
  return cookie(accountsConfig.SESSION_COOKIE, "", 0, secure);
}

// --- CSRF: double-submit cookie ---
// Every form embeds the csrf cookie's value as a hidden field; POST handlers
// require the pair to match. The cookie is httpOnly (the server injects the
// field at render time), on top of SameSite=Lax.

const CSRF_TTL_SECONDS = 12 * 60 * 60;

function randomCsrfToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toBase64({ alphabet: "base64url", omitPadding: true });
}

/** Existing csrf token, or a fresh one plus the Set-Cookie that installs it. */
export function ensureCsrf(req: Request, secure: boolean): { token: string; setCookie: string | null } {
  const existing = parseCookies(req.headers.get("cookie"))[accountsConfig.CSRF_COOKIE];
  if (existing) return { token: existing, setCookie: null };
  const token = randomCsrfToken();
  return { token, setCookie: cookie(accountsConfig.CSRF_COOKIE, token, CSRF_TTL_SECONDS, secure) };
}

export function csrfOk(req: Request, formToken: string | null): boolean {
  const cookieToken = parseCookies(req.headers.get("cookie"))[accountsConfig.CSRF_COOKIE];
  return !!cookieToken && !!formToken && cookieToken === formToken;
}

/** Fly injects fly-client-ip; fall back to the first x-forwarded-for hop. */
export function clientIp(req: Request): string {
  return (
    req.headers.get("fly-client-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}
