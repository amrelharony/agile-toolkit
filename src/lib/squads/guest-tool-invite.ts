/**
 * Does a guest hold ANY live invite for a tool, whatever its entity?
 *
 * Most rooms are per entity (a Poker room code, a canvas board id) and are
 * checked with `resolveGuestInvite`. The kudos wall is the exception: there
 * is one kudos room per workspace, and the guest kudos page
 * (`/guest/kudos/[entityId]`) hands out that room's key to the holder of a
 * kudos invite for whichever entity its route names. Room-token minting has
 * to grant the same set of guests, so it asks this instead.
 *
 * Same filters as `resolveGuestInvite`, minus the entity: the guest's squad,
 * not revoked, parent squad not revoked, open to anyone or pinned to this
 * profile, not expired.
 */

import "server-only";
import { getSquadAdminClient } from "./server";

export async function hasGuestToolInvite(opts: {
  squadId: string;
  profileId: string;
  toolId: string;
}): Promise<boolean> {
  const admin = getSquadAdminClient();
  if (!admin) return false;
  const now = Date.now();
  // The profile id is a UUID (getGuestSession checks its shape), so it is
  // safe inside the PostgREST `or` filter. Expiry is checked in JS, like
  // /api/guest/log does, over the most recent invites.
  const { data, error } = await admin
    .from("session_invites")
    .select("profile_id, expires_at, squad:squads!inner(revoked_at)")
    .eq("squad_id", opts.squadId)
    .eq("tool_id", opts.toolId)
    .is("revoked_at", null)
    .is("squad.revoked_at", null)
    .or(`profile_id.is.null,profile_id.eq.${opts.profileId}`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return false;
  return (data as Array<{ profile_id: string | null; expires_at: string | null }>).some(
    (row) =>
      (row.profile_id === null || row.profile_id === opts.profileId) &&
      (!row.expires_at || Date.parse(row.expires_at) > now)
  );
}
