"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { syncEngine, type SyncAdapter } from "./engine";
import { compareIso } from "./lww";
import {
  clearUnsyncedBlob,
  markBlobReconciled,
  mergeBlobPayloads,
  needsBlobReconcile,
  recordUnsyncedBlob,
} from "./unsynced-blobs";

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
 *
 * Edits made while the engine is NOT running (signed out, a visitor, the
 * owner's merge decision pending) are also written to a durable record
 * (unsynced-blobs.ts): the in-memory `dirty` flag doesn't survive a page
 * load. A recorded key is reconciled on its first pull/push of the page
 * session — the cloud row is fetched and `mergeBlobPayloads(local, cloud)`
 * pushed — instead of "remote wins" (a fresh load) or "local wins" (a
 * still-dirty tab), either of which loses one side's rows.
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
    // Nothing will push this edit now, and `dirty` dies with the page:
    // record it so the next sync session merges it instead of losing it.
    if (!syncEngine.isRunning()) recordUnsyncedBlob(this.storeKey);
    syncEngine.scheduleFlush(this.id);
  }

  hasPendingWrites(): boolean {
    return this.dirty;
  }

  async pull(supabase: SupabaseClient, userId: string): Promise<void> {
    // Edited while sync was off: merge with the cloud row (whatever the
    // in-memory dirty flag says — a visitor's tab can still hold it).
    if (needsBlobReconcile(this.storeKey)) {
      await this.reconcile(supabase, userId);
      return;
    }
    // BUG-S14: never apply a pull over unpushed local edits. The timestamp
    // guard below only protects edits that were already PUSHED — a dirty
    // in-debounce edit has no timestamp yet, so any remote row newer than
    // our last push would overwrite it mid-typing, and applyRemote's
    // `dirty = false` then dropped the edit from sync permanently. Keep
    // local; the pending flush pushes it and the server resolves by
    // timestamp (same policy as the entity adapter's unpushed-edit guard).
    if (this.dirty) return;
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
      // Never push a key edited while sync was off over the cloud row
      // unmerged (normally its first pull already reconciled it; this
      // covers a pull that failed or hasn't run).
      if (needsBlobReconcile(this.storeKey)) {
        await this.reconcile(supabase, userId);
        if (!this.dirty) return;
      }
      const payload = this.getSnapshot();
      const payloadJson = JSON.stringify(payload);
      // Skip the network round-trip if nothing actually changed since the
      // last push (the dirty flag is a hint, not a guarantee).
      if (this.lastPushedPayloadJson === payloadJson) {
        this.dirty = false;
        clearUnsyncedBlob(this.storeKey);
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
      clearUnsyncedBlob(this.storeKey);
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
    // Signed-out edits not merged yet: applying the row would overwrite
    // them. The reconcile pull fetches the latest row anyway.
    if (needsBlobReconcile(this.storeKey)) return;
    // For real DELETEs the row's client_id was set by whoever last
    // upserted, not by whoever issued the DELETE, so echo suppression
    // is unreliable. Apply the clear unconditionally — the local default
    // will repopulate naturally on next user edit.
    if (eventType === "DELETE") {
      // BUG-S15: reset the LWW trackers instead of stamping a CLIENT
      // timestamp into a field that is otherwise only compared against
      // server-stamped timestamptz values — a fast local clock silently
      // dropped every remote update for this key until the skew elapsed.
      // With the trackers null, the next pull/push re-establishes
      // server-stamped state.
      this.suppressLocalChange = true;
      try {
        this.setSnapshot(undefined);
      } finally {
        this.suppressLocalChange = false;
      }
      this.lastPushedUpdatedAt = null;
      this.lastPushedPayloadJson = null;
      this.dirty = false;
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
    // BUG-S14 (cont.): same unpushed-edit guard as pull() — a realtime row
    // arriving mid-debounce must not clobber the user's in-flight edit.
    if (this.dirty) return;
    this.applyRemote(row.payload, updatedAt);
  }

  /** Clear all cross-session LWW state. Called by the engine on stop() so
   *  a different user signing in on the same tab can't inherit the previous
   *  user's timestamps (which would suppress the new user's initial pull)
   *  or payload snapshot. (BUG-S13) */
  resetSyncState(): void {
    this.lastPushedUpdatedAt = null;
    this.lastPushedPayloadJson = null;
    this.dirty = false;
    this.pendingFlushAfter = false;
  }

  /**
   * First sync of a key edited while sync was off: fetch the cloud row and
   * leave the store holding `mergeBlobPayloads(local, cloud)`, dirty so the
   * next flush pushes it (the push then clears the record). When the cloud
   * already has everything local has, just take the cloud row.
   */
  private async reconcile(supabase: SupabaseClient, userId: string): Promise<void> {
    const { data, error } = await supabase
      .from("user_state")
      .select("payload, updated_at, client_id")
      .eq("user_id", userId)
      .eq("store_key", this.storeKey)
      .maybeSingle();
    if (error) throw error;
    markBlobReconciled(this.storeKey);
    if (!data) {
      // Nothing in the cloud yet: the local value is the whole story.
      this.lastPushedPayloadJson = null;
      this.dirty = true;
      return;
    }
    const local = this.getSnapshot();
    const merged = mergeBlobPayloads(local, data.payload);
    const mergedJson = JSON.stringify(merged);
    if (mergedJson === JSON.stringify(data.payload)) {
      this.applyRemote(data.payload, data.updated_at as string);
      clearUnsyncedBlob(this.storeKey);
      return;
    }
    if (mergedJson !== JSON.stringify(local)) {
      this.suppressLocalChange = true;
      try {
        this.setSnapshot(merged);
      } finally {
        this.suppressLocalChange = false;
      }
    }
    // Server timestamp of the row we merged with, for realtime LWW; the
    // payload marker stays null so the push isn't skipped as a no-op.
    this.lastPushedUpdatedAt = data.updated_at as string;
    this.lastPushedPayloadJson = null;
    this.dirty = true;
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
