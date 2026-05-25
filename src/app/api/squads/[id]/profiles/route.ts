/**
 * List profiles in a squad (owner-only).
 *
 * Used by the session-share modal to populate the "pin to profile"
 * dropdown. Returns only active (non-revoked) profiles.
 */

import { requireAuthorizedUser } from "@/lib/auth/require-user";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const squadId = ctx.params.id;
  if (!UUID_RE.test(squadId)) {
    return Response.json({ error: "invalid_id" }, { status: 400 });
  }
  let user, supabase;
  try {
    ({ user, supabase } = await requireAuthorizedUser());
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  // Confirm squad belongs to this owner — RLS does this, but a friendly
  // 404 beats a generic supabase error.
  const { data: squad } = await supabase
    .from("squads")
    .select("id")
    .eq("id", squadId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!squad) {
    return Response.json({ error: "squad_not_found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("squad_profiles")
    .select("id, display_name, color, last_seen_at")
    .eq("squad_id", squadId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[squad profiles GET] supabase error", error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
  return Response.json({
    profiles: (data ?? []).map((p) => ({
      id: p.id,
      displayName: p.display_name,
      color: p.color,
      lastSeenAt: p.last_seen_at,
    })),
  });
}
