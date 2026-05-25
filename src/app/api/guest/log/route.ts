/**
 * Guest history-event ingestion.
 *
 * The owner's history-store writes directly to Supabase using the
 * authenticated client (RLS keyed on auth.uid()). Guests can't do
 * that — they have no Supabase session. This endpoint accepts a
 * single HistoryEvent from a guest, validates that they have an
 * active invite for the (toolId, entityId), then writes the row
 * with:
 *   * user_id = owner_id from the invite (the workspace the event
 *     happened in — preserves owner-side RLS visibility)
 *   * squad_profile_id = the guest's profile id (Phase 0 column)
 *
 * The owner's history drawer + activity feed read squad_profile_id
 * to display the actual author label.
 */

import type { NextRequest } from "next/server";
import { getGuestSession } from "@/lib/auth/guest-session";
import { resolveGuestInvite } from "@/lib/squads/invites";
import { getSquadAdminClient, touchProfileLastSeen } from "@/lib/squads/server";

const TOOL_ID_RE = /^[a-z0-9_-]{1,64}$/;
const ACTION_RE = /^[a-z0-9_]{1,64}$/;
const SHORT_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

// Role × action allowlist. Editors can emit anything; commenters are
// limited to comment-related actions so a hostile commenter cannot
// write history rows for arbitrary actions like `card_added` or
// `vote_cast`. Viewers can emit nothing — they're read-only.
const COMMENTER_ACTIONS = new Set<string>([
  "comment_added",
  "comment_replied",
  "comment_resolved",
  "comment_reopened",
  "ping",
]);

function isActionAllowed(role: "editor" | "viewer" | "commenter", action: string): boolean {
  if (role === "viewer") return false;
  if (role === "editor") return true;
  return COMMENTER_ACTIONS.has(action);
}

export async function POST(req: NextRequest) {
  const session = await getGuestSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const admin = getSquadAdminClient();
  if (!admin) {
    return Response.json({ error: "service_unavailable" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = (body ?? {}) as {
    toolId?: unknown;
    entityId?: unknown;
    action?: unknown;
    payload?: unknown;
    clientEventId?: unknown;
    clientId?: unknown;
    toolRunId?: unknown;
    occurredAt?: unknown;
    isMilestone?: unknown;
  };

  // Strict shape — refuse anything we don't recognise rather than try
  // to be helpful with malformed input. Guest writes go straight to
  // the audit log; the bar for "valid" is high.
  const toolId = typeof b.toolId === "string" && TOOL_ID_RE.test(b.toolId) ? b.toolId : null;
  // entityId is OPTIONAL — when present, authorize via the matching
  // session_invite (entity-scoped writes via useCollaborativeSession).
  // When absent, fall back to squad-level authorization (any active
  // invite from the same owner) for cross-tool useHistoryLogger calls.
  const entityId =
    typeof b.entityId === "string" && b.entityId.length >= 1 && b.entityId.length <= 200
      ? b.entityId
      : null;
  const action = typeof b.action === "string" && ACTION_RE.test(b.action) ? b.action : null;
  const clientEventId =
    typeof b.clientEventId === "string" && SHORT_ID_RE.test(b.clientEventId)
      ? b.clientEventId
      : null;
  const clientId =
    typeof b.clientId === "string" && SHORT_ID_RE.test(b.clientId) ? b.clientId : null;
  const toolRunId =
    typeof b.toolRunId === "string" && SHORT_ID_RE.test(b.toolRunId) ? b.toolRunId : null;
  const occurredAt = typeof b.occurredAt === "string" ? b.occurredAt : null;
  const isMilestone = b.isMilestone === true;

  if (!toolId || !action || !clientEventId || !clientId || !toolRunId || !occurredAt) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  // Refuse far-future or invalid timestamps; the SQL CHECK on
  // history_events.occurred_at also enforces this, but failing fast
  // here is friendlier than a generic 500 from the DB.
  const occurredAtMs = Date.parse(occurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    return Response.json({ error: "invalid_occurred_at" }, { status: 400 });
  }
  if (occurredAtMs > Date.now() + 5 * 60 * 1000) {
    return Response.json({ error: "occurred_at_future" }, { status: 400 });
  }

  // Authorize. Two paths:
  //   * entity-scoped (entityId supplied) — must have a matching invite
  //     for (toolId, entityId). Role gate decides which actions land.
  //   * squad-scoped (no entityId)        — any active non-revoked
  //     invite from this squad establishes the workspace owner; the
  //     guest then writes under that owner_id. Action allowlist still
  //     applies based on the BEST role available across invites.
  let ownerId: string;
  let role: "editor" | "viewer" | "commenter";
  if (entityId) {
    const invite = await resolveGuestInvite({
      squadId: session.squadId,
      profileId: session.profileId,
      toolId,
      entityId,
    });
    if (!invite) {
      return Response.json({ error: "no_invite" }, { status: 403 });
    }
    ownerId = invite.ownerId;
    role = invite.role;
  } else {
    // Squad-level lookup: pick the most-privileged active invite.
    const nowIso = new Date().toISOString();
    const { data: invites } = await admin
      .from("session_invites")
      .select("owner_id, role, profile_id, expires_at")
      .eq("squad_id", session.squadId)
      .is("revoked_at", null)
      .or(`profile_id.is.null,profile_id.eq.${session.profileId}`)
      .order("created_at", { ascending: false })
      .limit(50);
    if (!invites || invites.length === 0) {
      return Response.json({ error: "no_invite" }, { status: 403 });
    }
    const valid = invites.filter((i) => !i.expires_at || (i.expires_at as string) > nowIso);
    if (valid.length === 0) {
      return Response.json({ error: "no_invite" }, { status: 403 });
    }
    // Pick editor over commenter over viewer; among ties, take first
    // (most recent because of the order-by above).
    const rank: Record<string, number> = { editor: 3, commenter: 2, viewer: 1 };
    valid.sort((a, b) => rank[b.role as string] - rank[a.role as string]);
    ownerId = valid[0].owner_id as string;
    role = valid[0].role as "editor" | "viewer" | "commenter";
  }

  if (!isActionAllowed(role, action)) {
    return Response.json({ error: "role_not_allowed_for_action" }, { status: 403 });
  }

  // Cap payload size + validate object-ness. Postgres JSONB accepts
  // scalars, but the owner-side history readers expect a record shape;
  // a scalar payload would TypeError on first property access.
  const rawPayload = b.payload ?? {};
  if (typeof rawPayload !== "object" || rawPayload === null || Array.isArray(rawPayload)) {
    return Response.json({ error: "payload_must_be_object" }, { status: 400 });
  }
  const payload = rawPayload as Record<string, unknown>;
  let payloadJson: string;
  try {
    payloadJson = JSON.stringify(payload);
  } catch {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (payloadJson.length > 32_000) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  // Two-phase write to avoid the 23505-as-success swallow on a
  // cross-guest clientEventId collision: first SELECT to see if this
  // exact (owner_id, squad_profile_id, client_event_id) already exists.
  // If yes — same author's idempotent retry → return ok+duplicate.
  // If no — INSERT. If THAT 23505s, it's a cross-guest collision under
  // the same owner_id; surface as 409 so the caller can regenerate.
  const { data: existing } = await admin
    .from("history_events")
    .select("client_event_id")
    .eq("user_id", ownerId)
    .eq("client_event_id", clientEventId)
    .eq("squad_profile_id", session.profileId)
    .maybeSingle();
  if (existing) {
    return Response.json({ ok: true, duplicate: true });
  }

  const { error } = await admin.from("history_events").insert({
    user_id: ownerId,
    squad_profile_id: session.profileId,
    tool_id: toolId,
    action,
    payload,
    is_milestone: isMilestone,
    client_id: clientId,
    client_event_id: clientEventId,
    tool_run_id: toolRunId,
    occurred_at: occurredAt,
  });
  if (error) {
    if (error.code === "23505") {
      // (owner_id, client_event_id) unique index hit but it's a
      // DIFFERENT squad_profile_id (otherwise the SELECT above would
      // have caught it). A real collision — tell the caller to retry
      // with a fresh clientEventId rather than silently dropping.
      return Response.json({ error: "client_event_id_conflict" }, { status: 409 });
    }
    // eslint-disable-next-line no-console
    console.error("[guest/log POST] supabase error", error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }

  void touchProfileLastSeen(session.profileId);
  return Response.json({ ok: true });
}
