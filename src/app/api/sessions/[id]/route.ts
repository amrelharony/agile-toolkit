/**
 * Revoke a session invite. Soft-revokes by setting revoked_at; the row
 * stays for audit. The unique index is partial on `revoked_at is null`
 * so a fresh invite can be issued for the same (squad, tool, entity,
 * profile) tuple after revoke.
 */

import type { NextRequest } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth/require-user";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }) {
  const id = ctx.params.id;
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "invalid_id" }, { status: 400 });
  }
  let user, supabase;
  try {
    ({ user, supabase } = await requireAuthorizedUser());
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  // `.is("revoked_at", null)` ensures a second DELETE on an already-
  // revoked invite is a no-op rather than overwriting the original
  // revocation timestamp. The `.select("id, ...")` returns the rows
  // that were actually modified so we can distinguish:
  //   * non-existent / not-owned    → 404
  //   * already revoked             → 200 ok (idempotent re-revoke)
  //   * freshly revoked             → 200 ok + audit log
  const { data: updated, error } = await supabase
    .from("session_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id)
    .is("revoked_at", null)
    .select("id, squad_id, tool_id, entity_id, role, profile_id");
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[sessions DELETE] supabase error", error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    // Either no row matched (404) or the row was already revoked (200).
    // Tell them apart with a second cheap lookup so the client can show
    // "already revoked" instead of "not found".
    const { data: existing } = await supabase
      .from("session_invites")
      .select("id")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!existing) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return Response.json({ ok: true, alreadyRevoked: true });
  }

  // Audit-log the revocation (one row per actually-revoked invite).
  // Owner-authored, best-effort — same pattern as the create-side log.
  const revoked = updated[0];
  void supabase
    .from("history_events")
    .insert({
      user_id: user.id,
      tool_id: revoked.tool_id,
      action: "invite_revoked",
      payload: {
        toolId: revoked.tool_id,
        entityId: revoked.entity_id,
        role: revoked.role,
        squadId: revoked.squad_id,
        profileId: revoked.profile_id,
        inviteId: revoked.id,
      },
      is_milestone: false,
      client_id: "server",
      client_event_id: `invite_revoke_${revoked.id}`,
      tool_run_id: `invite_${revoked.id}`,
      occurred_at: new Date().toISOString(),
    })
    .then(({ error: auditErr }) => {
      if (auditErr) {
        // eslint-disable-next-line no-console
        console.error("[sessions DELETE] audit insert failed", auditErr.code);
      }
    });

  return Response.json({ ok: true });
}
