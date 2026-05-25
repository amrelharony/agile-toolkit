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
  const { error } = await supabase
    .from("session_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[sessions DELETE] supabase error", error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
