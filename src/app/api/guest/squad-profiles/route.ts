/**
 * List squad profiles visible to the calling guest.
 *
 * Scope: ONLY the guest's own squad. A guest in squad "Engineering"
 * cannot enumerate "Marketing" profiles even if the same owner runs
 * both. Used by the guest Kudos client to populate the "send kudos
 * to" picker.
 *
 * Uses service-role under the hood (guests have no `auth.uid()` →
 * direct RLS can't gate them) — the authorization here is "valid
 * guest cookie + matching squad_id". The cookie's profileId is
 * filtered out of the response so the picker doesn't offer "send
 * kudos to yourself".
 */

import { getGuestSession } from "@/lib/auth/guest-session";
import { getSquadAdminClient, touchProfileLastSeen } from "@/lib/squads/server";

export async function GET() {
  const session = await getGuestSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const admin = getSquadAdminClient();
  if (!admin) {
    return Response.json({ error: "service_unavailable" }, { status: 503 });
  }

  // Confirm the parent squad isn't soft-revoked before we hand out a
  // member list. A revoked squad shouldn't be addressable even by its
  // own surviving cookies.
  const { data: squad } = await admin
    .from("squads")
    .select("id, revoked_at")
    .eq("id", session.squadId)
    .maybeSingle();
  if (!squad || squad.revoked_at) {
    return Response.json({ error: "squad_revoked" }, { status: 403 });
  }

  const { data, error } = await admin
    .from("squad_profiles")
    .select("id, display_name, color, last_seen_at")
    .eq("squad_id", session.squadId)
    .is("revoked_at", null)
    // Exclude the caller from their own picker — server-side filter so
    // any future consumer of this endpoint inherits the behaviour
    // without having to re-implement the self-filter client-side
    // (review #14).
    .neq("id", session.profileId)
    .order("created_at", { ascending: false });
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[guest/squad-profiles GET] supabase error", error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }

  // Best-effort last-seen update for the caller — keeps the owner's
  // squad-management UI honest about who's actively in the toolkit.
  void touchProfileLastSeen(session.profileId);

  return Response.json({
    profiles: (data ?? []).map((p) => ({
      id: p.id as string,
      displayName: p.display_name as string,
      color: p.color as string,
      lastSeenAt: (p.last_seen_at as string | null) ?? null,
    })),
  });
}
