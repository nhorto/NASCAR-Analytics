// GET /api/me — the one JSON view of the signed-in viewer, added for the
// native mobile client (WS-J). The apps must read entitlement truth from the
// server instead of deciding Pro from a local receipt, and before this route
// that truth was only visible in rendered HTML. Anonymous requests get 401 so
// a client can also use the route as a cheap "is my session still alive"
// probe on launch/resume. Session-cookie requests are already forced to
// `private, no-store` by the server's cache layer, so nothing here caches.
import type { Viewer } from "./viewer.ts";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Handles /api/me; returns null for every other path so the chain moves on. */
export function handleMeRequest(req: Request, url: URL, viewer: Viewer): Response | null {
  if (url.pathname !== "/api/me") return null;
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!viewer.user) return json({ error: "sign_in_required" }, 401);
  return json({
    email: viewer.user.email,
    verifiedAt: viewer.user.verifiedAt,
    pro: viewer.pro,
    proUntil: viewer.proUntil,
    proSource: viewer.proSource,
  });
}
