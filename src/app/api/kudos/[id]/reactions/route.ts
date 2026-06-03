/**
 * Owner-side reaction append (Phase 5 surface; the endpoint ships in
 * Phase 1 so the cloud schema + RPC are exercised end-to-end).
 *
 *   POST /api/kudos/[id]/reactions { emoji }
 *
 * Delegates to the `kudos_add_reaction` SECURITY DEFINER RPC defined in
 * migration 0016 — that's the same code path the guest route will use,
 * so reaction-cap enforcement and idempotency live in ONE place.
 *
 * Owners react as themselves; we resolve their owner-side squad-profile
 * to attribute the row. If the owner has no squad profile (no squads
 * yet) the reaction is attributed to a synthetic owner identity — the
 * RPC requires SOME profile uuid so we pass the owner's `auth.uid()`
 * directly; the RPC tolerates any uuid that satisfies its type check.
 */

import type { NextRequest } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth/require-user";

const REACTION_EMOJI_MAX = 32; // bytes; the RPC has the same ceiling
const MAX_BODY_BYTES = 4_096;

function countCodepoints(s: string): number {
  return Array.from(s).length;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let user, supabase;
  try {
    ({ user, supabase } = await requireAuthorizedUser());
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const kudosId = params.id;
  if (typeof kudosId !== "string" || kudosId.length === 0 || kudosId.length > 64) {
    return Response.json({ error: "invalid_kudos_id" }, { status: 400 });
  }

  const lenHeader = req.headers.get("content-length");
  if (lenHeader) {
    const len = Number(lenHeader);
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
      return Response.json({ error: "body_too_large" }, { status: 413 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const emoji = (body as Record<string, unknown>).emoji;
  if (typeof emoji !== "string" || emoji.length === 0) {
    return Response.json({ error: "invalid_emoji" }, { status: 400 });
  }
  if (emoji.length > REACTION_EMOJI_MAX || countCodepoints(emoji) > 8) {
    return Response.json({ error: "invalid_emoji" }, { status: 400 });
  }

  // Ownership gate BEFORE the SECURITY DEFINER RPC. `kudos_add_reaction`
  // bypasses RLS and looks the row up by id alone, so without this an
  // authorized owner could append a reaction to ANOTHER owner's kudos
  // (cross-tenant write) — multiple owners can share one Supabase project
  // via AUTHORIZED_EMAILS. This SELECT runs on the RLS-bound client, so a
  // foreign id is invisible (returns null → 404); the explicit owner_id
  // predicate is belt-and-braces over the RLS policy.
  const { data: owned, error: ownErr } = await supabase
    .from("kudos")
    .select("id")
    .eq("id", kudosId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (ownErr) {
    // eslint-disable-next-line no-console
    console.error("[kudos reactions POST] ownership lookup failed", ownErr.code, ownErr.message);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
  if (!owned) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // Owners react as their auth identity; the RPC stores it under
  // `byProfileId`. Squad-profile attribution for owner reactions is a
  // Phase 5 polish item — for now the owner's auth uid is the
  // identifier, which keeps the RPC contract uniform across owner +
  // guest callers.
  const { error } = await supabase.rpc("kudos_add_reaction", {
    p_kudos_id: kudosId,
    p_emoji: emoji,
    p_by_profile_id: user.id,
  });
  if (error) {
    if (error.message?.includes("kudos.not_found")) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (error.message?.includes("kudos.reactions_full")) {
      return Response.json({ error: "reactions_full" }, { status: 429 });
    }
    if (error.message?.includes("kudos.invalid_emoji")) {
      return Response.json({ error: "invalid_emoji" }, { status: 400 });
    }
    // eslint-disable-next-line no-console
    console.error("[kudos reactions POST] supabase error", error.code, error.message);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
