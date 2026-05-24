import { requireAuthorizedUser } from "@/lib/auth/require-user";

/**
 * Revoke a personal access token. Soft (sets revoked_at) by default;
 * hard delete via `?hard=1` for full audit-trail removal.
 */
export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  let supabase, user;
  try {
    ({ user, supabase } = await requireAuthorizedUser());
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  const id = ctx.params.id;
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  const url = new URL(req.url);
  const hard = url.searchParams.get("hard") === "1";

  if (hard) {
    const { error } = await supabase
      .from("access_tokens")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return new Response(null, { status: 204 });
  }

  // BUG-X10: only stamp revoked_at on the FIRST revocation. Re-revoking
  // an already-revoked row would otherwise overwrite the original
  // timestamp with "now", corrupting any forensic claim about when
  // access was actually cut.
  const { error } = await supabase
    .from("access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("revoked_at", null);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return new Response(null, { status: 204 });
}
