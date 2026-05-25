/**
 * Server-side session-invite operations.
 *
 * Owner-side reads/writes can use the authenticated Supabase client
 * (RLS scopes to owner_id) — those happen in /api/sessions/*.
 * Guest-side reads go through this module using the service-role
 * client because guests have no auth.uid().
 */

import "server-only";
import { getSquadAdminClient } from "./server";

export type InviteRole = "editor" | "viewer" | "commenter";

export interface SessionInviteRow {
  id: string;
  owner_id: string;
  squad_id: string;
  tool_id: string;
  entity_id: string;
  role: InviteRole;
  profile_id: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface InviteSummary {
  id: string;
  toolId: string;
  entityId: string;
  role: InviteRole;
  ownerId: string;
  squadId: string;
  pinnedToProfileId: string | null;
  createdAt: string;
  expiresAt: string | null;
}

/**
 * List sessions a guest can join. Returns rows where:
 *   * squad_id matches the guest's squad
 *   * profile_id is null (anyone) OR matches the guest profile id
 *   * not revoked
 *   * not expired
 */
export async function listInvitesForGuest(opts: {
  squadId: string;
  profileId: string;
}): Promise<InviteSummary[]> {
  const admin = getSquadAdminClient();
  if (!admin) return [];
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("session_invites")
    .select(
      "id, owner_id, squad_id, tool_id, entity_id, role, profile_id, created_at, expires_at, revoked_at"
    )
    .eq("squad_id", opts.squadId)
    .is("revoked_at", null)
    .or(`profile_id.is.null,profile_id.eq.${opts.profileId}`)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as SessionInviteRow[]).map(toSummary);
}

/**
 * Resolve a single invite by (toolId, entityId) for a guest. Returns null
 * if the guest has no valid invite — used to gate per-action mutations
 * (e.g. writing a history event scoped to that session).
 */
export async function resolveGuestInvite(opts: {
  squadId: string;
  profileId: string;
  toolId: string;
  entityId: string;
}): Promise<InviteSummary | null> {
  const admin = getSquadAdminClient();
  if (!admin) return null;
  const nowIso = new Date().toISOString();
  // Prefer profile-pinned invite, but accept any-profile invite as fallback.
  // Two queries instead of one OR-with-priority because postgrest's `.or()`
  // doesn't give us an explicit preference ordering.
  const pinned = await admin
    .from("session_invites")
    .select(
      "id, owner_id, squad_id, tool_id, entity_id, role, profile_id, created_at, expires_at, revoked_at"
    )
    .eq("squad_id", opts.squadId)
    .eq("tool_id", opts.toolId)
    .eq("entity_id", opts.entityId)
    .eq("profile_id", opts.profileId)
    .is("revoked_at", null)
    .maybeSingle();
  const pinnedRow = pinned.data as SessionInviteRow | null;
  if (pinnedRow && (!pinnedRow.expires_at || pinnedRow.expires_at > nowIso)) {
    return toSummary(pinnedRow);
  }
  const open = await admin
    .from("session_invites")
    .select(
      "id, owner_id, squad_id, tool_id, entity_id, role, profile_id, created_at, expires_at, revoked_at"
    )
    .eq("squad_id", opts.squadId)
    .eq("tool_id", opts.toolId)
    .eq("entity_id", opts.entityId)
    .is("profile_id", null)
    .is("revoked_at", null)
    .maybeSingle();
  const openRow = open.data as SessionInviteRow | null;
  if (openRow && (!openRow.expires_at || openRow.expires_at > nowIso)) {
    return toSummary(openRow);
  }
  return null;
}

function toSummary(row: SessionInviteRow): InviteSummary {
  return {
    id: row.id,
    toolId: row.tool_id,
    entityId: row.entity_id,
    role: row.role,
    ownerId: row.owner_id,
    squadId: row.squad_id,
    pinnedToProfileId: row.profile_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
