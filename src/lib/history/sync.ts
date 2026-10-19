"use client";

import { getAuthBrowserClient } from "@/lib/auth/supabase-browser";
import { ownerFeedChannel } from "@/lib/realtime/private-rooms";
import type { HistoryEvent } from "./types";
import type { RealtimeChannel } from "@supabase/supabase-js";

// ──────────────────────────────────────────────────────────────────────
// Row shape — mirrors supabase/migrations/0002_auth_history.sql
// ──────────────────────────────────────────────────────────────────────
interface HistoryEventRow {
  id?: string;
  user_id: string;
  tool_id: string;
  action: string;
  payload: Record<string, unknown>;
  before_state?: unknown;
  after_state?: unknown;
  is_milestone: boolean;
  client_id: string;
  client_event_id: string;
  tool_run_id: string;
  occurred_at: string;
  created_at?: string;
  squad_profile_id?: string | null;
}

function toRow(e: HistoryEvent, userId: string): HistoryEventRow {
  return {
    user_id: userId,
    tool_id: e.toolId,
    action: e.action,
    payload: (e.payload ?? {}) as Record<string, unknown>,
    before_state: e.isMilestone ? e.beforeState : undefined,
    after_state: e.isMilestone ? e.afterState : undefined,
    is_milestone: e.isMilestone,
    client_id: e.clientId,
    client_event_id: e.clientEventId,
    tool_run_id: e.toolRunId,
    occurred_at: e.occurredAt,
    squad_profile_id: e.squadProfileId ?? null,
  };
}

function fromRow(row: HistoryEventRow): HistoryEvent {
  return {
    id: row.client_event_id,
    clientEventId: row.client_event_id,
    clientId: row.client_id,
    toolRunId: row.tool_run_id,
    userId: row.user_id,
    squadProfileId: row.squad_profile_id ?? null,
    toolId: row.tool_id,
    action: row.action,
    payload: row.payload as Record<string, unknown>,
    beforeState: row.before_state,
    afterState: row.after_state,
    isMilestone: row.is_milestone,
    occurredAt: row.occurred_at,
    syncedAt: row.created_at ?? new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Push / pull
// ──────────────────────────────────────────────────────────────────────

/**
 * Bulk-push events to cloud. Idempotent — uses (user_id, client_event_id) as
 * the conflict key, so re-pushing the same event is a no-op.
 *
 * Returns the client_event_ids that were successfully written (or already
 * existed). On error, throws — the caller should mark sync status.
 */
export async function pushEvents(events: HistoryEvent[], userId: string): Promise<string[]> {
  if (events.length === 0) return [];
  const supabase = getAuthBrowserClient();
  if (!supabase) throw new Error("auth_disabled");

  const rows = events.map((e) => toRow(e, userId));
  const writtenIds = new Set<string>();

  // Chunk to avoid 50KB payload limit on Supabase REST.
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    // Two-phase write so we know which rows the server actually persisted:
    //   1. SELECT existing rows by client_event_id — already-written, mark synced.
    //   2. UPSERT the rest. Only ids returned by .select() are confirmed writes.
    const sliceIds = slice.map((r) => r.client_event_id);
    // Scope the existing-check to owner-authored rows only — a guest-
    // authored row that happens to share a client_event_id would otherwise
    // swallow our local owner-authored event silently (added to
    // writtenIds without ever being persisted).
    const { data: existing, error: existErr } = await supabase
      .from("history_events")
      .select("client_event_id")
      .eq("user_id", userId)
      .is("squad_profile_id", null)
      .in("client_event_id", sliceIds);
    if (existErr) throw existErr;
    const existingArr = ((existing as { client_event_id: string }[]) ?? []).map(
      (r) => r.client_event_id
    );
    const existingSet = new Set(existingArr);
    for (const id of existingArr) writtenIds.add(id);

    const toInsert = slice.filter((r) => !existingSet.has(r.client_event_id));
    if (toInsert.length === 0) continue;

    const { data, error } = await supabase
      .from("history_events")
      .upsert(toInsert, {
        onConflict: "user_id,client_event_id",
        ignoreDuplicates: true,
      })
      .select("client_event_id");
    if (error) throw error;
    for (const r of (data as { client_event_id: string }[]) ?? []) {
      writtenIds.add(r.client_event_id);
    }
  }

  return Array.from(writtenIds);
}

export const PULL_LIMIT = 2000;

/**
 * Pull history events newer than `since` (or all events if undefined).
 *
 * Ordered NEWEST-first (`created_at` descending). The cap matches the local
 * EVENTS_CAP, so on the initial bootstrap (`since` null) of an account with
 * more than `PULL_LIMIT` events we fetch the most recent ones the user can
 * actually hold — the old ascending order fetched the OLDEST 2000 and, paired
 * with the cursor advancing to "now", left everything newer permanently
 * invisible. The store de-dupes + re-sorts on insert, so order doesn't affect
 * the merged view.
 */
export async function pullEvents(userId: string, since: string | null): Promise<HistoryEvent[]> {
  const supabase = getAuthBrowserClient();
  if (!supabase) throw new Error("auth_disabled");

  let query = supabase
    .from("history_events")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(PULL_LIMIT);
  if (since) query = query.gt("created_at", since);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r) => fromRow(r as HistoryEventRow));
}

/**
 * Compute the next pull cursor: the newest SERVER `created_at` among the
 * pulled events (carried as `syncedAt`), never the client wall-clock.
 *
 * A wall-clock cursor is wrong under clock skew: if the client runs ahead of
 * the Supabase server, setting the cursor to client-now makes the next
 * `created_at > since` backfill skip every event whose server timestamp falls
 * between server-now and the inflated client clock — exactly the reconnect
 * window the backfill exists to cover. Returns `prev` unchanged when nothing
 * was pulled, and never moves the cursor backward.
 */
export function nextPullCursor(events: HistoryEvent[], prev: string | null): string | null {
  let maxMs = -Infinity;
  let maxIso: string | null = null;
  for (const e of events) {
    if (!e.syncedAt) continue;
    const ms = Date.parse(e.syncedAt);
    if (Number.isFinite(ms) && ms > maxMs) {
      maxMs = ms;
      maxIso = e.syncedAt;
    }
  }
  if (maxIso === null) return prev;
  if (prev) {
    const prevMs = Date.parse(prev);
    if (Number.isFinite(prevMs) && prevMs >= maxMs) return prev;
  }
  return maxIso;
}

/**
 * Hard-delete every history event for the current user. Used by the
 * privacy/data page.
 */
export async function deleteAllEvents(userId: string): Promise<void> {
  const supabase = getAuthBrowserClient();
  if (!supabase) throw new Error("auth_disabled");
  const { error } = await supabase.from("history_events").delete().eq("user_id", userId);
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────────────────
// Realtime subscription
// ──────────────────────────────────────────────────────────────────────

interface RealtimeOptions {
  userId: string;
  onInsert: (event: HistoryEvent) => void;
  /** Fired when the channel transitions from a non-subscribed state back to
   *  SUBSCRIBED — caller should re-pull events that may have arrived during
   *  the disconnect window. */
  onResubscribe?: () => void;
  onError?: (err: unknown) => void;
}

export function subscribeToHistory(opts: RealtimeOptions): () => void {
  const supabase = getAuthBrowserClient();
  if (!supabase) return () => {};
  let hadDisconnect = false;
  // Private with NEXT_PUBLIC_PRIVATE_ROOMS=1 (the owner's session JWT on
  // this client passes the realtime policy for `history:<their id>`).
  const channel: RealtimeChannel = ownerFeedChannel(supabase, `history:${opts.userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "history_events",
        filter: `user_id=eq.${opts.userId}`,
      },
      (payload) => {
        try {
          const row = payload.new as HistoryEventRow;
          opts.onInsert(fromRow(row));
        } catch (err) {
          opts.onError?.(err);
        }
      }
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        hadDisconnect = true;
      } else if (status === "SUBSCRIBED" && hadDisconnect) {
        hadDisconnect = false;
        // Reconnected after a gap — refetch to backfill any events delivered
        // while we were offline. Realtime does not replay past inserts.
        opts.onResubscribe?.();
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

// Re-export for tests / introspection.
export { toRow, fromRow };
