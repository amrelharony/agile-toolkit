"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { syncEngine, type SyncAdapter } from "./engine";
import { compareIso } from "./lww";

/**
 * Per-entity sync adapter. One instance per workspace collection
 * (sprints, stories, whiteboards, whiteboardObjects, etc.).
 *
 * Each entity must carry a string `id`. The adapter maintains a
 * last-pushed snapshot keyed by id and diffs against the current state
 * on every push to compute changed/added/deleted ids — only those rows
 * hit the network.
 *
 * Deletion is soft (`deleted: true` in user_entities) so other devices
 * that pull later can reconcile. The adapter itself filters out
 * `deleted=true` rows on pull.
 */

interface EntityAdapterOptions<T extends { id: string }> {
  /** "sprint", "story", "whiteboardObject", etc. Used as the `kind`
   *  column in user_entities. */
  kind: string;
  /** Read the current local array of entities. */
  getEntities: () => readonly T[];
  /** Replace the local array with the supplied entities. The adapter
   *  caller must suppress its own change-listener feedback inside. */
  setEntities: (next: T[]) => void;
  /** Push debounce (ms). Default 1000. Set higher (e.g. 2000) for
   *  high-churn kinds like whiteboardObjects. */
  pushIntervalMs?: number;
}

interface RemoteRow {
  entity_id: string;
  payload: unknown;
  updated_at: string;
  deleted: boolean;
  client_id: string;
}

class EntitySyncAdapter<T extends { id: string }> implements SyncAdapter {
  readonly id: string;
  readonly realtimeTable = "user_entities" as const;
  readonly pushIntervalMs: number;

  private getEntities: EntityAdapterOptions<T>["getEntities"];
  private setEntities: EntityAdapterOptions<T>["setEntities"];

  /** Last-pushed snapshot keyed by id. Used to diff on push. */
  private lastPushed = new Map<string, { json: string; updatedAt: string | null }>();
  /** Tombstones we still need to push. */
  private pendingDeletes = new Set<string>();
  /** Per-id last-known-server timestamp for LWW on realtime receipt. */
  private remoteUpdatedAt = new Map<string, string>();
  /** Snapshot of which ids existed locally at the time of the last
   *  markDirty. Captured eagerly so a pull that races a local delete
   *  doesn't lose the deletion intent. (BUG-S7) */
  private lastSeenLiveIds = new Set<string>();

  private dirty = false;
  private suppressLocalChange = false;
  /** Mutex: true while a push() is awaiting its RPC. Overlapping pushes
   *  cause silent data loss via lastPushed regression. (BUG-S1) */
  private pushInFlight = false;
  /** Set when a markDirty arrives during an in-flight push. Triggers a
   *  re-schedule after the push settles. */
  private pendingFlushAfter = false;

  constructor(private readonly opts: EntityAdapterOptions<T>) {
    this.id = `entity:${opts.kind}`;
    this.getEntities = opts.getEntities;
    this.setEntities = opts.setEntities;
    this.pushIntervalMs = opts.pushIntervalMs ?? 1000;
  }

  get kind(): string {
    return this.opts.kind;
  }

  /** Called by the workspace subscriber whenever the registered slice
   *  may have changed. Cheap — sets a flag and schedules a flush.
   *
   *  Deletion detection is deferred to push() time. The previous
   *  implementation walked lastPushed + getEntities() on EVERY markDirty
   *  call (called per-frame during a canvas drag of 1k+ objects → O(n²)
   *  per second, pinning a CPU). The push loop already iterates all
   *  entities, so detecting deletes there is free. */
  markDirty(): void {
    if (this.suppressLocalChange) return;
    this.dirty = true;
    // BUG-S7: capture deletion intent eagerly. Compare the previous
    // live-id set with the current one — anything that disappeared has
    // its tombstone scheduled NOW, even if a pull later races and
    // re-adds the entity to the merged view. The push diff at fire
    // time previously computed deletes as `lastPushed - liveIds`, which
    // a pull would silently undo.
    const liveNow = new Set(this.getEntities().map((e) => e.id));
    this.lastSeenLiveIds.forEach((prev) => {
      if (!liveNow.has(prev)) this.pendingDeletes.add(prev);
    });
    this.lastSeenLiveIds = liveNow;
    syncEngine.scheduleFlush(this.id);
  }

  hasPendingWrites(): boolean {
    return this.dirty || this.pendingDeletes.size > 0;
  }

  async pull(supabase: SupabaseClient, userId: string): Promise<void> {
    // BUG-S2: keyset pagination, not OFFSET. With OFFSET, a peer device
    // INSERT'ing an entity that sorts BEFORE the current page boundary
    // shifts every subsequent row down by one — we then skip the formerly-
    // last row of the prior page and silently miss an entity. Keyset
    // (where entity_id > last_seen_id) is stable under concurrent inserts.
    const PAGE = 1000;
    const rows: RemoteRow[] = [];
    let lastSeenId: string | null = null;
    for (;;) {
      let q = supabase
        .from("user_entities")
        .select("entity_id, payload, updated_at, deleted, client_id")
        .eq("user_id", userId)
        .eq("kind", this.kind)
        .order("entity_id", { ascending: true })
        .limit(PAGE);
      if (lastSeenId !== null) q = q.gt("entity_id", lastSeenId);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;
      rows.push(...(data as RemoteRow[]));
      lastSeenId = (data[data.length - 1] as RemoteRow).entity_id;
      if (data.length < PAGE) break;
    }
    // Build a merged view: take the live local entities (so unflushed
    // local writes survive) overlaid with any remote rows that are newer.
    const localById = new Map(this.getEntities().map((e) => [e.id, e]));
    const merged = new Map<string, T>(localById);
    for (const row of rows) {
      this.remoteUpdatedAt.set(row.entity_id, row.updated_at);
      if (row.deleted) {
        // Honour remote deletion only if our local copy isn't newer
        // (we tracked local writes via lastPushed.updatedAt).
        const lastPushed = this.lastPushed.get(row.entity_id);
        if (
          !lastPushed ||
          !lastPushed.updatedAt ||
          compareIso(lastPushed.updatedAt, row.updated_at) <= 0
        ) {
          merged.delete(row.entity_id);
        }
        continue;
      }
      const lastPushed = this.lastPushed.get(row.entity_id);
      if (
        lastPushed &&
        lastPushed.updatedAt &&
        compareIso(lastPushed.updatedAt, row.updated_at) >= 0
      ) {
        // Local is at least as fresh; keep local copy.
        continue;
      }
      // Preserve UNPUSHED local edits: if the local copy of this entity
      // exists AND its JSON differs from what we last pushed (or we've
      // never pushed it), the user has made changes that are still in
      // the dirty queue waiting to flush. Don't clobber them with a stale
      // remote row. Without this guard a remote pull during a 2s push
      // throttle window reverts in-flight local edits.
      const localEntity = localById.get(row.entity_id);
      if (localEntity) {
        const localJson = JSON.stringify(localEntity);
        const lastJson = lastPushed?.json;
        if (lastJson !== localJson) {
          // Unpushed local changes — keep local until we've successfully
          // pushed (which will then advance lastPushed).
          continue;
        }
      }
      merged.set(row.entity_id, row.payload as T);
    }
    // BUG-S8: pull does not consult pendingDeletes. Tab A marks X for
    // deletion (markDirty captured X in pendingDeletes); before push
    // throttle fires, a pull arrives carrying the still-live row for X.
    // Without this filter the merged view re-adds X and the user's
    // deletion intent vanishes when the next subscriber render runs.
    if (this.pendingDeletes.size > 0) {
      this.pendingDeletes.forEach((id) => {
        merged.delete(id);
      });
    }
    this.applyRemote(Array.from(merged.values()));
    // After a successful pull, rebuild lastPushed against the merged view
    // so the next push diff is accurate.
    //
    // BUG-S9: only record entities that actually have a server timestamp.
    // A local-only entity (created in the dirty window, not yet pushed) has
    // no `remoteUpdatedAt` entry. The old code still seeded `lastPushed` for
    // it with `json` equal to its current serialisation — so the next push
    // diff (`last.json === json`) treated it as already-synced and skipped
    // it, and push() then cleared `dirty`. A pull racing that first push
    // (realtime SUBSCRIBED, focus, and visibility all trigger pullAll())
    // therefore dropped the brand-new entity from the cloud permanently —
    // it lived only in this device's localStorage and never reached peers.
    // Leaving unpushed locals OUT of lastPushed makes the next push detect
    // them as new; re-arm a flush so that push actually runs.
    this.lastPushed.clear();
    let hasUnpushedLocal = false;
    merged.forEach((e) => {
      const remoteTs = this.remoteUpdatedAt.get(e.id);
      if (remoteTs) {
        this.lastPushed.set(e.id, { json: JSON.stringify(e), updatedAt: remoteTs });
      } else {
        hasUnpushedLocal = true;
      }
    });
    if (hasUnpushedLocal) {
      this.dirty = true;
      syncEngine.scheduleFlush(this.id);
    }
  }

  async push(supabase: SupabaseClient, userId: string): Promise<void> {
    if (!this.dirty && this.pendingDeletes.size === 0) return;
    // BUG-S1: serialise pushes. Overlapping pushes race in the database
    // (server stamps `updated_at` at COMMIT time, so the stale push that
    // commits later wins); the response handler then writes the STALE
    // payload into lastPushed at the newer timestamp → diverges from
    // local truth and from other devices.
    if (this.pushInFlight) {
      this.pendingFlushAfter = true;
      return;
    }
    this.pushInFlight = true;
    const live = this.getEntities();
    const clientId = syncEngine.getClientId();
    const now = new Date().toISOString();
    // Capture the live entity map BEFORE the await so the post-response
    // lastPushed update reflects what we actually sent, not whatever
    // the live state happens to be after a concurrent mutation.
    const liveSnapshot = new Map(live.map((e) => [e.id, e]));

    // Belt-and-braces deletion detection (also done in markDirty for
    // pulls): anything in lastPushed that's no longer live.
    const liveIds = new Set(live.map((e) => e.id));
    this.lastPushed.forEach((_, id) => {
      if (!liveIds.has(id)) this.pendingDeletes.add(id);
    });

    // ──────── upserts: changed or new entities ────────
    const upserts: Array<{
      user_id: string;
      kind: string;
      entity_id: string;
      payload: T;
      client_id: string;
      deleted: false;
      updated_at: string;
    }> = [];
    for (const e of live) {
      const json = JSON.stringify(e);
      const last = this.lastPushed.get(e.id);
      if (last && last.json === json) continue;
      upserts.push({
        user_id: userId,
        kind: this.kind,
        entity_id: e.id,
        payload: e,
        client_id: clientId,
        deleted: false,
        updated_at: now,
      });
    }

    try {
      if (upserts.length > 0) {
        const { data, error } = await supabase
          .from("user_entities")
          .upsert(upserts, { onConflict: "user_id,kind,entity_id" })
          .select("entity_id, updated_at");
        if (error) throw error;
        for (const row of data as Array<{ entity_id: string; updated_at: string }>) {
          // BUG-S1 (cont.): use the pre-await snapshot, not the live state.
          // Using live.find() here would store WHATEVER the entity looked
          // like at response time — a concurrent mutation lands in
          // lastPushed.json under the new server timestamp, then a later
          // pull thinks local IS already on the server.
          const e = liveSnapshot.get(row.entity_id);
          if (e) {
            this.lastPushed.set(row.entity_id, {
              json: JSON.stringify(e),
              updatedAt: row.updated_at,
            });
            this.remoteUpdatedAt.set(row.entity_id, row.updated_at);
          }
        }
      }

      // ──────── deletes: soft-delete tombstones ────────
      if (this.pendingDeletes.size > 0) {
        const tombstones = Array.from(this.pendingDeletes).map((entityId) => ({
          user_id: userId,
          kind: this.kind,
          entity_id: entityId,
          payload: {},
          client_id: clientId,
          deleted: true,
          updated_at: now,
        }));
        const { data, error } = await supabase
          .from("user_entities")
          .upsert(tombstones, { onConflict: "user_id,kind,entity_id" })
          .select("entity_id, updated_at");
        if (error) throw error;
        for (const row of data as Array<{ entity_id: string; updated_at: string }>) {
          this.lastPushed.delete(row.entity_id);
          this.remoteUpdatedAt.set(row.entity_id, row.updated_at);
        }
        this.pendingDeletes.clear();
      }

      this.dirty = false;
      // Refresh the live-id snapshot so the next markDirty diffs against
      // the post-push view.
      this.lastSeenLiveIds = new Set(this.getEntities().map((e) => e.id));
    } finally {
      this.pushInFlight = false;
      // BUG-S1 (cont.): if a markDirty arrived while we were awaiting
      // the RPC, schedule a follow-up flush so its work doesn't sit.
      if (this.pendingFlushAfter) {
        this.pendingFlushAfter = false;
        syncEngine.scheduleFlush(this.id);
      }
    }
  }

  onRemote(row: Record<string, unknown>, eventType: "INSERT" | "UPDATE" | "DELETE"): void {
    if (row.kind !== this.kind) return;
    const entityId = row.entity_id as string;
    // For real DELETEs (hard deletes from Postgres, not soft `deleted=true`
    // updates), `row.client_id` came from `payload.old` and reflects whoever
    // last upserted the row — NOT whoever issued the DELETE. Skipping echo
    // suppression here is safe: we always drop the local copy.
    if (eventType === "DELETE") {
      const current = this.getEntities();
      if (current.some((e) => e.id === entityId)) {
        this.applyRemote(current.filter((e) => e.id !== entityId));
      }
      this.lastPushed.delete(entityId);
      this.remoteUpdatedAt.delete(entityId);
      return;
    }
    if (row.client_id === syncEngine.getClientId()) {
      const updatedAt = row.updated_at as string | undefined;
      if (updatedAt) this.remoteUpdatedAt.set(entityId, updatedAt);
      return;
    }
    const updatedAt = row.updated_at as string;
    const lastSeen = this.remoteUpdatedAt.get(entityId);
    if (lastSeen && compareIso(lastSeen, updatedAt) >= 0) return;
    this.remoteUpdatedAt.set(entityId, updatedAt);

    const current = this.getEntities();
    let next: T[];
    if (row.deleted) {
      next = current.filter((e) => e.id !== entityId);
    } else {
      const payload = row.payload as T;
      const idx = current.findIndex((e) => e.id === entityId);
      if (idx === -1) {
        next = [...current, payload];
      } else {
        next = current.slice();
        next[idx] = payload;
      }
    }
    this.applyRemote(next);
    if (row.deleted) {
      this.lastPushed.delete(entityId);
    } else {
      this.lastPushed.set(entityId, { json: JSON.stringify(row.payload), updatedAt });
    }
  }

  private applyRemote(next: T[]): void {
    this.suppressLocalChange = true;
    try {
      this.setEntities(next);
    } finally {
      this.suppressLocalChange = false;
    }
  }
}

export function makeEntityAdapter<T extends { id: string }>(
  opts: EntityAdapterOptions<T>
): EntitySyncAdapter<T> {
  return new EntitySyncAdapter(opts);
}

export type { EntitySyncAdapter };
