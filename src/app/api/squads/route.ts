/**
 * Owner-side squads list + create.
 *
 * GET  → returns the current owner's squads with profile counts.
 * POST { name } → creates a new squad with a fresh invite code.
 *
 * Auth: standard requireAuthorizedUser — the owner must be the
 * allowlisted Google account. Guests cannot reach these routes
 * (they're outside the /api/guest bypass).
 */

import type { NextRequest } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth/require-user";
import { generateSquadCode } from "@/lib/squads/server";

export async function GET() {
  let user, supabase;
  try {
    ({ user, supabase } = await requireAuthorizedUser());
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const { data, error } = await supabase
    .from("squads")
    .select("id, name, code, created_at, revoked_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[squads GET] supabase error", error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }

  // Annotate each squad with an active-profile count. Doing one
  // aggregate query instead of N saves a round-trip per row.
  const squadIds = (data ?? []).map((s) => s.id);
  const countsByid: Record<string, number> = {};
  if (squadIds.length > 0) {
    const { data: profiles } = await supabase
      .from("squad_profiles")
      .select("squad_id")
      .in("squad_id", squadIds)
      .is("revoked_at", null);
    for (const p of profiles ?? []) {
      const sid = p.squad_id as string;
      countsByid[sid] = (countsByid[sid] ?? 0) + 1;
    }
  }
  return Response.json({
    squads: (data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      createdAt: s.created_at,
      revokedAt: s.revoked_at,
      profileCount: countsByid[s.id] ?? 0,
    })),
  });
}

export async function POST(req: NextRequest) {
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
  const b = (body ?? {}) as { name?: unknown };
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
  if (!name) {
    return Response.json({ error: "name_required" }, { status: 400 });
  }

  const code = generateSquadCode();
  const { data, error } = await supabase
    .from("squads")
    .insert({ owner_id: user.id, name, code })
    .select("id, name, code, created_at, revoked_at")
    .single();
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[squads POST] supabase error", error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }

  return Response.json({
    squad: {
      id: data.id,
      name: data.name,
      code: data.code,
      createdAt: data.created_at,
      revokedAt: data.revoked_at,
      profileCount: 0,
    },
  });
}
