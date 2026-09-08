// Set-Cookie parsing for the auth flow. React Native merges repeated
// Set-Cookie headers into one comma-joined string; the server's cookies use
// Max-Age (never Expires), so no cookie value contains a comma and splitting
// on `,` before a `name=` token is exact. Pure — unit tested under Bun.

/** Split a possibly comma-merged Set-Cookie header into individual cookies. */
export function splitSetCookie(header: string): string[] {
  return header
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** `name=value` pairs from a Set-Cookie header, attributes dropped. */
export function parseSetCookie(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const cookie of splitSetCookie(header)) {
    const first = cookie.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    out[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
  }
  return out;
}
