/**
 * Owner-side squad mutations.
 *
 * DELETE /api/squads/[id]                — hard-delete the squad (cascades
 *                                          to its profiles AND to any
 *                                          history events authored by
 *                                          those profiles, which keep
 *                                          their user_id pointer to the
 *                                          owner but lose squad_profile_id
 *                                          via the ON DELETE SET NULL
 *                                          rule from migration 0010).
 *
 * PATCH  /api/squads/[id]  { regenerateCode: true }
 *                                        — mint a fresh code, invalidating
 *                                          all prior shares. Existing
 *                                          profiles keep working (the
 *                                          cookie is bound to profile id,
 *                                          not squad code).
 */

import type { NextRequest } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth/require-user";
import { generateSquadCode, sanitizeSquadName } from "@/lib/squads/server";

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
  // RLS already restricts DELETE to owner-owned rows, but the explicit
  // eq("owner_id", user.id) means a misconfigured RLS bug doesn't widen
  // the blast radius.
  const { error } = await supabase.from("squads").delete().eq("id", id).eq("owner_id", user.id);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[squads DELETE] supabase error", error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
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
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = (body ?? {}) as { regenerateCode?: unknown; name?: unknown };

  const update: Record<string, string> = {};
  if (b.regenerateCode === true) update.code = generateSquadCode();
  // Distinguish "field absent" (don't touch) from "field present but
  // invalid" (reject). The prior shape silently dropped a malformed
  // name when paired with regenerateCode, leaving the caller unaware
  // their rename was discarded.
  if (b.name !== undefined) {
    const cleaned = sanitizeSquadName(b.name);
    if (!cleaned) {
      return Response.json({ error: "invalid_name" }, { status: 400 });
    }
    update.name = cleaned;
  }
  if (Object.keys(update).length === 0) {
    return Response.json({ error: "no_changes" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("squads")
    .update(update)
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id, name, code, created_at, revoked_at")
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[squads PATCH] supabase error", error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
  if (!data) {
    // No row updated → the squad doesn't exist or isn't owned by the
    // caller. PostgREST returns no error on .maybeSingle() when 0 rows
    // match; report as 404 for clarity (the DELETE handler uses the
    // same silent-success pattern, but for rename/regen the client
    // needs to know it failed).
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({
    squad: {
      id: data.id,
      name: data.name,
      code: data.code,
      createdAt: data.created_at,
      revokedAt: data.revoked_at,
    },
  });
}
