/**
 * Owner-side kudos CRUD.
 *
 *   POST /api/kudos                     — upsert a kudos row (idempotent by id)
 *   GET  /api/kudos?limit=&before=      — paginated wall fetch newest-first
 *   GET  /api/kudos?to_profile_id=&limit=
 *                                       — header-beacon "last N received by me"
 *
 * The workspace store is the optimistic source on the hot path; this
 * endpoint is the truth-after-network. A fresh tab on another device
 * boots from here. `cloud-sync.ts` debounces writes from `upsertKudos`.
 */

import type { NextRequest } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth/require-user";
import { parseKudos } from "@/lib/kudos/parse";
import type { Kudos } from "@/lib/stores/workspace-types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 65_536;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function kudosToRow(k: Kudos, ownerId: string): Record<string, unknown> {
  return {
    id: k.id,
    owner_id: ownerId,
    // squad_id is null on owner-authored rows — owners write workspace-
    // wide kudos that aren't scoped to any one squad. The guest path
    // (api/guest/kudos) fills this in from the cookie's squad context.
    squad_id: null,
    // jsonb accepts both strings and objects; preserving the bare-string
    // form for built-in themes keeps the round-trip identity (GET parses
    // back into the same `KudosTheme | string` union the workspace store
    // holds). Wrapping `"awesome"` as `{id:"awesome"}` would survive POST
    // but parseKudos rejects it on the GET (no title/emoji/hex), and
    // getKudosTheme falls through to inline-style rendering with
    // undefined hex.
    theme: k.theme,
    to_name: k.toName,
    to_profile_id: k.toProfileId ?? null,
    from_name: k.fromName,
    from_profile_id: k.fromProfileId ?? null,
    team_name: k.teamName ?? null,
    // The book episode a printed card was written from (migration 0034); its
    // wording is read from the print campaign's data file, never stored.
    episode: k.episode ?? null,
    message: k.message,
    sent_at: k.sentAt,
    version: k.version ?? 1,
    sentiment: k.sentiment ?? null,
    fairness_score_at_send: k.fairnessScoreAtSend ?? null,
    llm_dedup_group: k.llmDedupGroup ?? null,
    reply_to: k.replyTo ?? null,
    // `reactions` is intentionally NOT included. Reactions are appended
    // exclusively through the cap-enforcing, idempotent `kudos_add_reaction`
    // RPC — accepting them here would let a client pre-seed forged
    // reactions on create. Omitting the key ALSO matters for the upsert
    // below: PostgREST only updates columns present in the payload, so an
    // idempotent re-POST of an existing row (cloud-sync retry / backfill)
    // leaves reactions accumulated via the RPC untouched instead of
    // overwriting them; on fresh insert the column default ('[]'::jsonb)
    // applies.
  };
}

export async function POST(req: NextRequest) {
  let user, supabase;
  try {
    ({ user, supabase } = await requireAuthorizedUser());
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const lenHeader = req.headers.get("content-length");
  if (lenHeader) {
    const len = Number(lenHeader);
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
      return Response.json({ error: "body_too_large" }, { status: 413 });
    }
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = parseKudos(raw);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  // UUID-shape validation for fields that land in uuid columns.
  // parseKudos only enforces "string ≤ 64/128 chars", so a malformed id
  // would otherwise reach Postgres and surface as 22P02 → a generic 500
  // (should be a clean 400).
  const k = parsed.kudos;
  if (k.toProfileId && !UUID_RE.test(k.toProfileId)) {
    return Response.json({ error: "invalid_to_profile_id" }, { status: 400 });
  }
  if (k.fromProfileId && !UUID_RE.test(k.fromProfileId)) {
    return Response.json({ error: "invalid_from_profile_id" }, { status: 400 });
  }
  if (k.llmDedupGroup && !UUID_RE.test(k.llmDedupGroup)) {
    return Response.json({ error: "invalid_llm_dedup_group" }, { status: 400 });
  }

  const row = kudosToRow(parsed.kudos, user.id);
  // Upsert by id so the cloud heals after a transient network outage
  // without surfacing a 409 to the client. The hot path is "send →
  // optimistic store → debounced sync"; we'd rather retry-quietly than
  // make the caller reason about duplicate-id semantics.
  const { error } = await supabase.from("kudos").upsert(row, { onConflict: "id" });
  if (error) {
    // Surface the fairness window as a soft 429 so the UI can render a
    // "you've sent a lot to {name} today — pause?" affordance. Other DB
    // errors collapse to a generic 500 (server-logged details only).
    if (error.message?.includes("kudos.fairness_window_exceeded")) {
      return Response.json({ error: "fairness_window_exceeded" }, { status: 429 });
    }
    // eslint-disable-next-line no-console
    console.error("[kudos POST] supabase error", error.code, error.message);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function GET(req: NextRequest) {
  let user, supabase;
  try {
    ({ user, supabase } = await requireAuthorizedUser());
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const beforeParam = url.searchParams.get("before");
  const toProfileParam = url.searchParams.get("to_profile_id");

  let limit = DEFAULT_LIMIT;
  if (limitParam) {
    const n = Number(limitParam);
    if (!Number.isFinite(n) || n < 1) {
      return Response.json({ error: "invalid_limit" }, { status: 400 });
    }
    limit = Math.min(Math.floor(n), MAX_LIMIT);
  }

  let query = supabase
    .from("kudos")
    .select(
      "id, theme, to_name, to_profile_id, from_name, from_profile_id, team_name, " +
        "message, sent_at, version, sentiment, fairness_score_at_send, llm_dedup_group, " +
        "reply_to, reactions, episode"
    )
    .eq("owner_id", user.id)
    // Secondary `id` order so ms-collision rows have a stable
    // tiebreak. Without it a `?before=…` cursor could either
    // duplicate or drop a row at the page boundary when two kudos
    // share the same `sent_at`.
    .order("sent_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (beforeParam) {
    // Cursor: only return rows strictly older than `before` (ISO).
    // Date.parse rejects malformed input — we surface 400 rather than
    // silently dropping the filter and confusing the UI.
    const ms = Date.parse(beforeParam);
    if (!Number.isFinite(ms)) {
      return Response.json({ error: "invalid_before" }, { status: 400 });
    }
    query = query.lt("sent_at", beforeParam);
  }

  if (toProfileParam) {
    if (!UUID_RE.test(toProfileParam)) {
      return Response.json({ error: "invalid_to_profile_id" }, { status: 400 });
    }
    query = query.eq("to_profile_id", toProfileParam);
  }

  const { data, error } = await query;
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[kudos GET] supabase error", error.code, error.message);
    return Response.json({ error: "server_error" }, { status: 500 });
  }

  // Shape the response to match the client `Kudos` interface so the
  // wall component can render without an intermediate mapping. Field
  // names are intentionally camelCase here — the Supabase row is the
  // only snake_case surface and it's confined to this file.
  const rows = (data ?? []) as unknown as ReadonlyArray<Record<string, unknown>>;
  const kudos = rows.map((r) => ({
    id: r.id as string,
    version: r.version as 1 | 2,
    theme: r.theme as unknown,
    toName: r.to_name as string,
    toProfileId: (r.to_profile_id as string | null) ?? undefined,
    fromName: r.from_name as string,
    fromProfileId: (r.from_profile_id as string | null) ?? undefined,
    teamName: (r.team_name as string | null) ?? undefined,
    message: r.message as string,
    sentAt: r.sent_at as string,
    sentiment: (r.sentiment as unknown) ?? undefined,
    fairnessScoreAtSend: (r.fairness_score_at_send as number | null) ?? undefined,
    llmDedupGroup: (r.llm_dedup_group as string | null) ?? undefined,
    replyTo: (r.reply_to as string | null) ?? undefined,
    reactions: r.reactions ?? [],
    episode: (r.episode as number | null) ?? undefined,
  }));

  return Response.json({ kudos });
}
