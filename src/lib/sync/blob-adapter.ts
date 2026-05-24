"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { syncEngine, type SyncAdapter } from "./engine";
import { compareIso } from "./lww";

/**
 * Per-blob sync adapter. One adapter instance per registered store key.
 *
 * The store is identified by `storeKey` (e.g. "agile-toolkit:retro-board").
 * The adapter owns:
 *   - `getSnapshot()` — read the current state as JSON-serialisable payload
 *   - `setSnapshot(next)` — write a remote-sourced snapshot into the store
 *
 * Local mutations call `markDirty()` to schedule a push.
 *
 * LWW: each pull/push carries `updated_at` (Postgres-stamped on the
 * server). On realtime receipt, the adapter compares against its
 * last-known-server timestamp and skips the apply if the local update
 * is fresher.
 */

interface BlobAdapterOptions {
  /** Stable key used as the primary-key fragment in user_state. */
  storeKey: string;
  /** Read the current in-memory state, prepared for JSON serialisation. */
  getSnapshot: () => unknown;
  /** Apply a remote snapshot to the in-memory state. The adapter caller
   *  must NOT trigger its own change-listener feedback while inside this
   *  function — use a flag in the caller's subscriber to ignore. */
  setSnapshot: (next: unknown) => void;
  /** Push debounce (ms). Default 1000. */
  pushIntervalMs?: number;
}

class BlobSyncAdapter implements SyncAdapter {
  readonly id: string;
  readonly realtimeTable = "user_state" as const;
  readonly pushIntervalMs: number;

  private getSnapshot: BlobAdapterOptions["getSnapshot"];
  private setSnapshot: BlobAdapterOptions["setSnapshot"];

  private dirty = false;
  private lastPushedUpdatedAt: string | null = null;
  private lastPushedPayloadJson: string | null = null;
  private suppressLocalChange = false;
  /** Mutex against overlapping pushes. See entity-adapter for the
   *  failure-mode write-up. (BUG-S1) */
  private pushInFlight = false;
  private pendingFlushAfter = false;

  constructor(opts: BlobAdapterOptions) {
    this.id = `blob:${opts.storeKey}`;
    this.getSnapshot = opts.getSnapshot;
    this.setSnapshot = opts.setSnapshot;
    this.pushIntervalMs = opts.pushIntervalMs ?? 1000;
  }

  get storeKey(): string {
    return this.id.slice("blob:".length);
  }

  markDirty(): void {
    if (this.suppressLocalChange) return;
    this.dirty = true;
    syncEngine.scheduleFlush(this.id);
  }

  hasPendingWrites(): boolean {
    return this.dirty;
  }

  async pull(supabase: SupabaseClient, userId: string): Promise<void> {
    const { data, error } = await supabase
      .from("user_state")
      .select("payload, updated_at, client_id")
      .eq("user_id", userId)
      .eq("store_key", this.storeKey)
      .maybeSingle();
    if (error) throw error;
    if (!data) return; // nothing remote yet — keep local default
    // Skip apply if our locally-tracked update timestamp is newer than the
    // remote one (the local edit hasn't been pushed yet and would be
    // overwritten by a stale pull).
    if (
      this.lastPushedUpdatedAt &&
      compareIso(this.lastPushedUpdatedAt, data.updated_at as string) >= 0
    ) {
      return;
    }
    this.applyRemote(data.payload, data.updated_at as string);
  }

  async push(supabase: SupabaseClient, userId: string): Promise<void> {
    if (!this.dirty) return;
    // BUG-S1: serialise pushes.
    if (this.pushInFlight) {
      this.pendingFlushAfter = true;
      return;
    }
    this.pushInFlight = true;
    try {
      const payload = this.getSnapshot();
      const payloadJson = JSON.stringify(payload);
      // Skip the network round-trip if nothing actually changed since the
      // last push (the dirty flag is a hint, not a guarantee).
      if (this.lastPushedPayloadJson === payloadJson) {
        this.dirty = false;
        return;
      }
      const clientId = syncEngine.getClientId();
      const { data, error } = await supabase
        .from("user_state")
        .upsert(
          {
            user_id: userId,
            store_key: this.storeKey,
            payload,
            client_id: clientId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,store_key" }
        )
        .select("updated_at")
        .single();
      if (error) throw error;
      this.lastPushedUpdatedAt = data.updated_at as string;
      // Record the JSON we ACTUALLY sent (captured before await), not
      // whatever the snapshot looks like at response time.
      this.lastPushedPayloadJson = payloadJson;
      this.dirty = false;
    } finally {
      this.pushInFlight = false;
      if (this.pendingFlushAfter) {
        this.pendingFlushAfter = false;
        syncEngine.scheduleFlush(this.id);
      }
    }
  }

  onRemote(row: Record<string, unknown>, eventType: "INSERT" | "UPDATE" | "DELETE"): void {
    if (row.store_key !== this.storeKey) return;
    // For real DELETEs the row's client_id was set by whoever last
    // upserted, not by whoever issued the DELETE, so echo suppression
    // is unreliable. Apply the clear unconditionally — the local default
    // will repopulate naturally on next user edit.
    if (eventType === "DELETE") {
      this.applyRemote(undefined, new Date().toISOString());
      return;
    }
    // Echo suppression: ignore rows we wrote ourselves.
    if (row.client_id === syncEngine.getClientId()) {
      // Still update our local LWW tracker so subsequent pulls don't
      // try to re-apply this row.
      const updatedAt = row.updated_at as string | undefined;
      if (updatedAt) this.lastPushedUpdatedAt = updatedAt;
      return;
    }
    const updatedAt = row.updated_at as string | undefined;
    if (!updatedAt) return;
    if (this.lastPushedUpdatedAt && compareIso(this.lastPushedUpdatedAt, updatedAt) >= 0) {
      return;
    }
    this.applyRemote(row.payload, updatedAt);
  }

  private applyRemote(payload: unknown, updatedAt: string): void {
    this.suppressLocalChange = true;
    try {
      this.setSnapshot(payload);
    } finally {
      this.suppressLocalChange = false;
    }
    this.lastPushedUpdatedAt = updatedAt;
    this.lastPushedPayloadJson = JSON.stringify(payload);
    this.dirty = false;
  }
}

export function makeBlobAdapter(opts: BlobAdapterOptions): BlobSyncAdapter {
  return new BlobSyncAdapter(opts);
}

export type { BlobSyncAdapter };
