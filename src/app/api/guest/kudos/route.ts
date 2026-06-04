/**
 * Guest kudos ingestion + reaction append.
 *
 *   POST /api/guest/kudos               — submit a kudos as a squad guest
 *   POST /api/guest/kudos/[id]/reactions — separate route file, see folder
 *
 * The guest cookie is verified via `getGuestSession()` and resolves to
 * a squad-profile id. We require the guest to hold an active invite for
 * the kudos tool (`tool_id = "kudos"`, `entity_id = "workspace"`) so a
 * cookie alone isn't a kudos write key — the same authorisation chain
 * the history-event guest-log route uses.
 *
 * Mirrors `/api/guest/log` for body-size pre-check, rate limit, and
 * service-role write (RLS bypass because guests have no auth.uid()).
 */

import type { NextRequest } from "next/server";
import { getGuestSession } from "@/lib/auth/guest-session";
import { resolveGuestInvite } from "@/lib/squads/invites";
import { getSquadAdminClient, touchProfileLastSeen } from "@/lib/squads/server";
import { parseKudos } from "@/lib/kudos/parse";
import { consumeGuestRateToken } from "../_rate-limit";
import { readBoundedText, PayloadTooLargeError } from "@/lib/mcp/read-bounded";

const MAX_BODY_BYTES = 65_536;
const KUDOS_TOOL_ID = "kudos";
const KUDOS_ENTITY_ID = "workspace";

export async function POST(req: NextRequest) {
  const session = await getGuestSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const admin = getSquadAdminClient();
  if (!admin) {
    return Response.json({ error: "service_unavailable" }, { status: 503 });
  }

  if (!consumeGuestRateToken(session.profileId)) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": "60" } }
    );
  }

  // Cap the body WHILE streaming, independent of Content-Length (a
  // chunked/header-less client otherwise bypasses the size guard).
  let raw: unknown;
  try {
    raw = JSON.parse(await readBoundedText(req, MAX_BODY_BYTES));
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return Response.json({ error: "body_too_large" }, { status: 413 });
    }
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = parseKudos(raw);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  // The invite must exist for (kudos, workspace) and grant editor or
  // commenter — viewers cannot author kudos. The tool-id check is the
  // same per-tool gate we added to `/api/guest/log` after the audit
  // sweep so a canvas-editor guest can't bypass into writing kudos
  // (and vice-versa).
  const invite = await resolveGuestInvite({
    profileId: session.profileId,
    squadId: session.squadId,
    toolId: KUDOS_TOOL_ID,
    entityId: KUDOS_ENTITY_ID,
  });
  if (!invite) {
    return Response.json({ error: "no_active_invite" }, { status: 403 });
  }
  if (invite.role === "viewer") {
    return Response.json({ error: "role_forbidden" }, { status: 403 });
  }

  const k = parsed.kudos;

  // Override the from-identity from the verified cookie so a guest
  // cannot author kudos as another guest by tampering with the
  // payload's `fromProfileId` / `fromName`. The recipient side stays
  // user-controlled (the form lets guests pick or free-text), but when
  // they name a squad profile we verify it belongs to the same squad —
  // a guest in squad A must not be able to target squad B by knowing
  // a profile id from there.
  if (k.toProfileId) {
    const { data: recipient, error: recipientErr } = await admin
      .from("squad_profiles")
      .select("id, squad_id")
      .eq("id", k.toProfileId)
      .maybeSingle();
    if (recipientErr) {
      // eslint-disable-next-line no-console
      console.error(
        "[guest/kudos POST] recipient lookup failed",
        recipientErr.code,
        recipientErr.message
      );
      return Response.json({ error: "server_error" }, { status: 500 });
    }
    if (!recipient || (recipient as { squad_id: string }).squad_id !== session.squadId) {
      return Response.json({ error: "cross_squad_recipient" }, { status: 403 });
    }
  }

  const row = {
    id: k.id,
    owner_id: invite.ownerId,
    squad_id: session.squadId,
    // Bare-string form for built-in themes preserves round-trip identity
    // through the jsonb column; see /api/kudos/route.ts:kudosToRow for
    // the full rationale.
    theme: k.theme,
    to_name: k.toName,
    to_profile_id: k.toProfileId ?? null,
    from_name: session.displayName,
    from_profile_id: session.profileId,
    team_name: k.teamName ?? null,
    message: k.message,
    sent_at: k.sentAt,
    version: k.version ?? 2,
    sentiment: k.sentiment ?? null,
    fairness_score_at_send: k.fairnessScoreAtSend ?? null,
    llm_dedup_group: k.llmDedupGroup ?? null,
    reply_to: k.replyTo ?? null,
    reactions: k.reactions ?? [],
  };

  // Append-only integrity. Guests may only INSERT new kudos — never
  // overwrite an existing row. The previous `upsert(row, {onConflict:"id"})`
  // ran on the RLS-bypassing service-role client, so a client-supplied `id`
  // that already existed turned the write into an UPDATE of THAT row. A
  // guest could therefore rewrite any kudos whose id they knew — e.g. a
  // peer's id learned from the owner-scoped realtime channel
  // (`tool:kudos:room:workspace-${ownerId}` is shared across squads under
  // one owner) — changing its message/author/squad, and it also bypassed
  // the BEFORE INSERT fairness-window trigger entirely. Mirror /api/guest/log:
  // pre-check by id, treat the guest's own id as an idempotent retry, reject
  // a foreign id, and INSERT otherwise (handling the concurrent 23505 race).
  const ownsRow = (row: { from_profile_id?: string | null } | null): boolean =>
    !!row && row.from_profile_id === session.profileId;

  const { data: existing, error: existErr } = await admin
    .from("kudos")
    .select("from_profile_id")
    .eq("id", k.id)
    .maybeSingle();
  if (existErr) {
    // eslint-disable-next-line no-console
    console.error("[guest/kudos POST] existing lookup failed", existErr.code, existErr.message);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
  if (existing) {
    // Same author re-submitting the same id → idempotent ack (append-only:
    // we never mutate the stored row). A different author's id → conflict.
    if (ownsRow(existing as { from_profile_id: string | null })) {
      return Response.json({ ok: true, duplicate: true });
    }
    return Response.json({ error: "id_conflict" }, { status: 409 });
  }

  const { error } = await admin.from("kudos").insert(row);
  if (error) {
    if (error.message?.includes("kudos.fairness_window_exceeded")) {
      return Response.json({ error: "fairness_window_exceeded" }, { status: 429 });
    }
    if (error.code === "23505") {
      // Race: a concurrent insert of the same id landed between our
      // pre-check and this insert. Re-check ownership so the same author's
      // concurrent retry stays idempotent; a foreign id is a hard conflict.
      const { data: postRace } = await admin
        .from("kudos")
        .select("from_profile_id")
        .eq("id", k.id)
        .maybeSingle();
      if (ownsRow((postRace as { from_profile_id: string | null } | null) ?? null)) {
        return Response.json({ ok: true, duplicate: true });
      }
      return Response.json({ error: "id_conflict" }, { status: 409 });
    }
    // eslint-disable-next-line no-console
    console.error("[guest/kudos POST] supabase error", error.code, error.message);
    return Response.json({ error: "server_error" }, { status: 500 });
  }

  await touchProfileLastSeen(session.profileId);
  return Response.json({ ok: true });
}
