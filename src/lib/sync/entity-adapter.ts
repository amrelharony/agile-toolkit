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

  private dirty = false;
  private suppressLocalChange = false;

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
    syncEngine.scheduleFlush(this.id);
  }

  hasPendingWrites(): boolean {
    return this.dirty || this.pendingDeletes.size > 0;
  }

  async pull(supabase: SupabaseClient, userId: string): Promise<void> {
    // Paginate via PostgREST .range() — Supabase caps a single query at
    // 1000 rows by default, and even after raising the cap a hard limit
    // silently truncates collections that grow past it (e.g. a whiteboard
    // with 12k objects would lose the tail without warning). Stream pages
    // of 1000 until the server returns fewer than requested.
    const PAGE = 1000;
    const rows: RemoteRow[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("user_entities")
        .select("entity_id, payload, updated_at, deleted, client_id")
        .eq("user_id", userId)
        .eq("kind", this.kind)
        .order("entity_id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      rows.push(...(data as RemoteRow[]));
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
        if (!lastPushed || !lastPushed.updatedAt || compareIso(lastPushed.updatedAt, row.updated_at) <= 0) {
          merged.delete(row.entity_id);
        }
        continue;
      }
      const lastPushed = this.lastPushed.get(row.entity_id);
      if (lastPushed && lastPushed.updatedAt && compareIso(lastPushed.updatedAt, row.updated_at) >= 0) {
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
    this.applyRemote(Array.from(merged.values()));
    // After a successful pull, rebuild lastPushed against the merged view
    // so the next push diff is accurate.
    this.lastPushed.clear();
    merged.forEach((e) => {
      this.lastPushed.set(e.id, {
        json: JSON.stringify(e),
        updatedAt: this.remoteUpdatedAt.get(e.id) ?? null,
      });
    });
  }

  async push(supabase: SupabaseClient, userId: string): Promise<void> {
    if (!this.dirty && this.pendingDeletes.size === 0) return;
    const live = this.getEntities();
    const clientId = syncEngine.getClientId();
    const now = new Date().toISOString();

    // Detect deletions: anything in lastPushed that's no longer live.
    // Done lazily here rather than in markDirty so a 60Hz canvas drag
    // doesn't burn CPU on per-frame O(n) set construction.
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

    if (upserts.length > 0) {
      const { data, error } = await supabase
        .from("user_entities")
        .upsert(upserts, { onConflict: "user_id,kind,entity_id" })
        .select("entity_id, updated_at");
      if (error) throw error;
      for (const row of data as Array<{ entity_id: string; updated_at: string }>) {
        const e = live.find((x) => x.id === row.entity_id);
        if (e) {
          this.lastPushed.set(row.entity_id, { json: JSON.stringify(e), updatedAt: row.updated_at });
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
