/**
 * Current-guest endpoint.
 *
 * GET    — return { profile } if a valid guest cookie is present, else 401.
 * DELETE — sign-out: clear the cookie. Idempotent.
 *
 * GET is what `/guest` (server component) calls to render the home page.
 * The page itself does the cookie check via getGuestSession(); this
 * route exists for client-side polling (e.g. detecting a revocation).
 */

import { getGuestSession, clearGuestSessionCookie } from "@/lib/auth/guest-session";
import { touchProfileLastSeen } from "@/lib/squads/server";

export async function GET() {
  const session = await getGuestSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  // Best-effort last-seen update; do NOT await it on the hot path. The
  // page renders identically with or without the timestamp ticking — and
  // a failed write here must never block the GET.
  void touchProfileLastSeen(session.profileId);
  return Response.json({
    profile: {
      id: session.profileId,
      displayName: session.displayName,
      color: session.color,
      squadId: session.squadId,
    },
  });
}

export async function DELETE() {
  clearGuestSessionCookie();
  return Response.json({ ok: true });
}
