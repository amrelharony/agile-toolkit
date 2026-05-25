/**
 * Guest's list of joinable sessions.
 *
 * Returns invites where the guest's squad matches AND (profile_id is
 * null OR profile_id matches the cookie's profile id), filtered by
 * revoke/expire. The response is intentionally lean — the route
 * mediates all guest data access, so we hand back only what the
 * `/guest` home page needs to render tiles.
 */

import { getGuestSession } from "@/lib/auth/guest-session";
import { listInvitesForGuest } from "@/lib/squads/invites";
import { getSquadAdminClient } from "@/lib/squads/server";

export async function GET() {
  const session = await getGuestSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const invites = await listInvitesForGuest({
    squadId: session.squadId,
    profileId: session.profileId,
  });

  // Best-effort owner-display lookup so the UI can say "shared by Amr"
  // without exposing the owner's email. We tolerate missing rows.
  const ownerIds = Array.from(new Set(invites.map((i) => i.ownerId)));
  const admin = getSquadAdminClient();
  const ownersById: Record<string, { displayName: string }> = {};
  if (admin && ownerIds.length > 0) {
    const { data } = await admin.from("profiles").select("id, display_name").in("id", ownerIds);
    for (const p of data ?? []) {
      ownersById[p.id as string] = {
        displayName: (p.display_name as string) ?? "Workspace owner",
      };
    }
  }

  return Response.json({
    sessions: invites.map((i) => ({
      id: i.id,
      toolId: i.toolId,
      entityId: i.entityId,
      role: i.role,
      sharedBy: ownersById[i.ownerId]?.displayName ?? "Workspace owner",
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    })),
  });
}
