/**
 * Owner-side session-invite CRUD.
 *
 * GET  /api/sessions?toolId=…&entityId=…   — list active invites for one
 *                                            (tool, entity). With no query
 *                                            params, lists every invite
 *                                            the owner has issued.
 * POST /api/sessions { squadId, toolId, entityId, role, profileId?, ttlDays? }
 *                                          — create an invite.
 */

import type { NextRequest } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth/require-user";
import { inviteAuditKeys } from "@/lib/squads/audit-keys";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOOL_ID_RE = /^[a-z0-9_-]{1,64}$/;
const ROLES = new Set(["editor", "viewer", "commenter"]);

export async function GET(req: NextRequest) {
  let user, supabase;
  try {
    ({ user, supabase } = await requireAuthorizedUser());
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const url = new URL(req.url);
  const toolId = url.searchParams.get("toolId");
  const entityId = url.searchParams.get("entityId");

  const nowIso = new Date().toISOString();
  let query = supabase
    .from("session_invites")
    .select(
      "id, squad_id, tool_id, entity_id, role, profile_id, created_at, expires_at, revoked_at"
    )
    .eq("owner_id", user.id)
    .is("revoked_at", null)
    // Drop expired invites from the listing — guests have stopped being
    // able to use them since `resolveGuestInvite` enforces the same
    // predicate, so showing them as "active" in the owner UI misleads.
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: false });
  if (toolId) {
    if (!TOOL_ID_RE.test(toolId)) {
      return Response.json({ error: "invalid_tool_id" }, { status: 400 });
    }
    query = query.eq("tool_id", toolId);
  }
  if (entityId) {
    if (entityId.length < 1 || entityId.length > 200) {
      return Response.json({ error: "invalid_entity_id" }, { status: 400 });
    }
    query = query.eq("entity_id", entityId);
  }
  const { data, error } = await query;
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[sessions GET] supabase error", error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }

  // Hydrate profile display names so the UI can label pinned invites
  // without a second round-trip per row.
  const profileIds = Array.from(
    new Set((data ?? []).map((d) => d.profile_id).filter((p): p is string => typeof p === "string"))
  );
  const profileNamesById: Record<string, { displayName: string; color: string }> = {};
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("squad_profiles")
      .select("id, display_name, color")
      .in("id", profileIds);
    for (const p of profiles ?? []) {
      profileNamesById[p.id as string] = {
        displayName: p.display_name as string,
        color: p.color as string,
      };
    }
  }

  return Response.json({
    invites: (data ?? []).map((d) => ({
      id: d.id,
      squadId: d.squad_id,
      toolId: d.tool_id,
      entityId: d.entity_id,
      role: d.role,
      profileId: d.profile_id,
      profile: d.profile_id ? (profileNamesById[d.profile_id] ?? null) : null,
      createdAt: d.created_at,
      expiresAt: d.expires_at,
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
  const b = (body ?? {}) as {
    squadId?: unknown;
    toolId?: unknown;
    entityId?: unknown;
    role?: unknown;
    profileId?: unknown;
    ttlDays?: unknown;
  };

  const squadId = typeof b.squadId === "string" && UUID_RE.test(b.squadId) ? b.squadId : null;
  const toolId = typeof b.toolId === "string" && TOOL_ID_RE.test(b.toolId) ? b.toolId : null;
  const entityId =
    typeof b.entityId === "string" && b.entityId.length >= 1 && b.entityId.length <= 200
      ? b.entityId
      : null;
  const role = typeof b.role === "string" && ROLES.has(b.role) ? (b.role as string) : null;
  if (!squadId || !toolId || !entityId || !role) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  const profileId =
    typeof b.profileId === "string" && UUID_RE.test(b.profileId) ? b.profileId : null;

  let expiresAt: string | null = null;
  if (typeof b.ttlDays === "number" && Number.isFinite(b.ttlDays) && b.ttlDays > 0) {
    // Cap at 365 days. The DB CHECK allows `created_at + 366 days` as
    // a safety buffer; the JS API stays one day inside that to give
    // PostgreSQL's interval arithmetic + clock skew breathing room.
    const days = Math.min(365, Math.max(1, Math.floor(b.ttlDays)));
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    expiresAt = d.toISOString();
  }

  // Confirm the squad belongs to this owner BEFORE inserting — RLS would
  // catch it but a friendly 403 is better than a generic supabase error.
  const { data: squad, error: squadErr } = await supabase
    .from("squads")
    .select("id")
    .eq("id", squadId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (squadErr || !squad) {
    return Response.json({ error: "squad_not_found" }, { status: 404 });
  }

  // If a profile_id was supplied, confirm it belongs to this squad AND
  // is still active. Without the revoked_at filter, the invite is
  // created pinned to a dead profile that can never claim it — the
  // invite then sits as a permanent zombie occupying the unique-index
  // slot until manually cleaned.
  if (profileId) {
    const { data: profile } = await supabase
      .from("squad_profiles")
      .select("id")
      .eq("id", profileId)
      .eq("squad_id", squadId)
      .is("revoked_at", null)
      .maybeSingle();
    if (!profile) {
      return Response.json({ error: "profile_not_in_squad" }, { status: 400 });
    }
  }

  const insertRow = {
    owner_id: user.id,
    squad_id: squadId,
    tool_id: toolId,
    entity_id: entityId,
    role,
    profile_id: profileId,
    expires_at: expiresAt,
  };

  // First attempt.
  let inserted = await supabase
    .from("session_invites")
    .insert(insertRow)
    .select("id, squad_id, tool_id, entity_id, role, profile_id, created_at, expires_at")
    .single();

  if (inserted.error) {
    if (inserted.error.code === "23505") {
      // Unique-index violation: an active invite for this exact (squad,
      // tool, entity, profile) already exists.
      //
      // PostgREST `.is(col, val)` only accepts boolean | null — for a
      // non-null UUID match we must use `.eq()`. Falling back to `.is`
      // with a UUID makes the lookup return zero rows and the route
      // returned 500 even though the request was a legitimate idempotent
      // retry of a pinned-profile invite.
      let lookup = supabase
        .from("session_invites")
        .select("id, squad_id, tool_id, entity_id, role, profile_id, created_at, expires_at")
        .eq("squad_id", squadId)
        .eq("tool_id", toolId)
        .eq("entity_id", entityId)
        .is("revoked_at", null);
      lookup = profileId ? lookup.eq("profile_id", profileId) : lookup.is("profile_id", null);
      const { data: existing } = await lookup.maybeSingle();
      if (existing) {
        return Response.json({ invite: rowToInvite(existing), existed: true });
      }
      // Recovery SELECT found nothing — the conflicting row must have
      // been revoked between our INSERT attempt and this lookup, freeing
      // the partial-unique slot. Retry the INSERT once; if it conflicts
      // again something is genuinely wrong (e.g. a concurrent peer
      // inserted between the lookup and this retry, which the next
      // 23505 surfaces as 500 rather than spin-looping).
      inserted = await supabase
        .from("session_invites")
        .insert(insertRow)
        .select("id, squad_id, tool_id, entity_id, role, profile_id, created_at, expires_at")
        .single();
      if (inserted.error) {
        // eslint-disable-next-line no-console
        console.error("[sessions POST] retry failed", inserted.error);
        return Response.json({ error: "server_error" }, { status: 500 });
      }
    } else {
      // eslint-disable-next-line no-console
      console.error("[sessions POST] supabase error", inserted.error);
      return Response.json({ error: "server_error" }, { status: 500 });
    }
  }

  const inviteRow = inserted.data;
  if (!inviteRow) {
    return Response.json({ error: "server_error" }, { status: 500 });
  }

  // Audit-log the issuance so the owner's activity feed can reconstruct
  // when a guest gained access. Best-effort — failure here does NOT
  // roll back the invite (the invite is the source of truth; the log
  // row is reconstructable from squad_profiles/session_invites if
  // needed). Owner-authored (squad_profile_id = NULL).
  //
  // client_event_id / tool_run_id are capped at 32 chars by the
  // history_events CHECK constraints (0002_auth_history.sql); a full
  // 36-char UUID overflows them. inviteAuditKeys() derives a short,
  // unique key that fits.
  const auditKeys = inviteAuditKeys(inviteRow.id, "create");
  void supabase
    .from("history_events")
    .insert({
      user_id: user.id,
      tool_id: toolId,
      action: "invite_created",
      payload: {
        toolId,
        entityId,
        role,
        squadId,
        profileId,
        inviteId: inviteRow.id,
      },
      is_milestone: false,
      client_id: "server",
      client_event_id: auditKeys.clientEventId,
      tool_run_id: auditKeys.toolRunId,
      occurred_at: new Date().toISOString(),
    })
    .then(({ error: auditErr }) => {
      if (auditErr) {
        // eslint-disable-next-line no-console
        console.error("[sessions POST] audit insert failed", auditErr.code);
      }
    });

  return Response.json({ invite: rowToInvite(inviteRow), existed: false });
}

function rowToInvite(d: {
  id: string;
  squad_id: string;
  tool_id: string;
  entity_id: string;
  role: string;
  profile_id: string | null;
  created_at: string;
  expires_at: string | null;
}) {
  return {
    id: d.id,
    squadId: d.squad_id,
    toolId: d.tool_id,
    entityId: d.entity_id,
    role: d.role,
    profileId: d.profile_id,
    createdAt: d.created_at,
    expiresAt: d.expires_at,
  };
}
