"use client";

import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { getClientId } from "./lww";

/**
 * Generic local-first sync engine.
 *
 * One singleton instance services every registered store. The engine
 * doesn't know what a "sprint" or a "canvas blob" is — it sees only the
 * adapter contract:
 *
 *   pull(): pull initial state from Supabase, apply to local
 *   push(): flush pending local changes to Supabase
 *   onRemote(row): apply a single realtime row update to local
 *
 * The engine owns:
 *   - Start/stop lifecycle (tied to auth state)
 *   - Debounced push loop (per-adapter intervals)
 *   - Realtime subscription
 *   - Visibility / focus pulls (handle wake-from-background)
 */

export interface SyncAdapter {
  readonly id: string;
  /** Push interval in ms. Default 1000. Use higher (e.g. 2000) for
   *  high-churn collections like canvas objects. */
  readonly pushIntervalMs?: number;
  /** Realtime table name to subscribe to. */
  readonly realtimeTable: "user_state" | "user_entities";
  /** Pull all rows for this adapter from Supabase and apply to local. */
  pull(supabase: SupabaseClient, userId: string): Promise<void>;
  /** Push any dirty local state to Supabase. Returns when complete. */
  push(supabase: SupabaseClient, userId: string): Promise<void>;
  /** Apply a single realtime update from another tab/device. The row
   *  is guaranteed to belong to this user. The adapter must detect and
   *  ignore echoes of its own writes (using the row's client_id). */
  onRemote(row: Record<string, unknown>): void;
  /** Mark adapter dirty: schedule a push. */
  hasPendingWrites(): boolean;
}

type EngineState =
  | { kind: "idle" }
  | { kind: "running"; supabase: SupabaseClient; userId: string; channel: RealtimeChannel | null };

class SyncEngine {
  private state: EngineState = { kind: "idle" };
  private adapters = new Map<string, SyncAdapter>();
  private pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pulling = false;
  /** Set while a `start()` call is awaiting the initial `pullAll()`.
   *  Subsequent `register()` calls during this window mark adapters as
   *  "needs initial pull" rather than triggering a premature push. */
  private starting = false;
  /** Adapters registered but not yet pulled. While in this set, a push
   *  would write the local DEFAULT state (e.g. `emptyWorkspace`) to
   *  Supabase, wiping any existing cloud data. `scheduleFlush` honours
   *  this guard. After a successful first pull, the adapter is removed
   *  and any pending dirty flag triggers a fresh flush. */
  private awaitingInitialPull = new Set<string>();

  register(adapter: SyncAdapter): void {
    if (this.adapters.has(adapter.id)) return;
    this.adapters.set(adapter.id, adapter);
    if (this.state.kind === "running") {
      // Block pushes for this adapter until its first pull completes.
      this.awaitingInitialPull.add(adapter.id);
      if (!this.starting) {
        // Engine already up — pull this adapter now. If user edits land
        // during the pull, they're held by the guard until pull finishes,
        // then flushed normally.
        void this.runOne(adapter, "pull").finally(() => {
          this.awaitingInitialPull.delete(adapter.id);
          if (adapter.hasPendingWrites()) {
            this.scheduleFlush(adapter.id);
          }
        });
      }
      // Otherwise the start() loop will drain after pullAll().
    }
  }

  unregister(id: string): void {
    this.adapters.delete(id);
    const t = this.pushTimers.get(id);
    if (t) clearTimeout(t);
    this.pushTimers.delete(id);
  }

  async start(supabase: SupabaseClient, userId: string): Promise<void> {
    if (this.state.kind === "running" && this.state.userId === userId) return;
    if (this.state.kind === "running") this.stop();
    this.state = { kind: "running", supabase, userId, channel: null };
    this.starting = true;
    // Mark every currently-registered adapter as awaiting initial pull —
    // pushes are blocked until each adapter's first pull resolves.
    this.adapters.forEach((_, id) => this.awaitingInitialPull.add(id));
    try {
      await this.pullAll();
      // Drain any adapters that registered DURING the bulk pull. Their
      // snapshot is still the local default until pulled.
      let drained = false;
      while (!drained) {
        const stillAwaiting = Array.from(this.awaitingInitialPull);
        if (stillAwaiting.length === 0) {
          drained = true;
          break;
        }
        await Promise.all(
          stillAwaiting.map((id) => {
            const a = this.adapters.get(id);
            return a ? this.runOne(a, "pull") : Promise.resolve();
          })
        );
        // Pulls may have completed between Array.from and here; loop until
        // we observe an empty set in a clean pass.
      }
    } finally {
      this.starting = false;
    }
    this.subscribeRealtime();
    this.attachWakeHandlers();
    // After start completes, flush any adapters that piled up dirty work
    // during the pull window (their flushes were blocked by the guard).
    this.adapters.forEach((a) => {
      if (a.hasPendingWrites()) this.scheduleFlush(a.id);
    });
  }

  /** True while initial pull is in flight. Adapters can consult this to
   *  defer push scheduling (avoid races that overwrite cloud with local
   *  defaults before the first pull populates state). */
  isStarting(): boolean {
    return this.starting;
  }

  stop(): void {
    if (this.state.kind === "idle") return;
    const { supabase, channel } = this.state;
    if (channel) void supabase.removeChannel(channel);
    this.pushTimers.forEach((t) => clearTimeout(t));
    this.pushTimers.clear();
    this.awaitingInitialPull.clear();
    this.starting = false;
    this.detachWakeHandlers();
    this.state = { kind: "idle" };
  }

  /** Mark an adapter dirty — schedules a debounced push.
   *
   *  Skips scheduling for adapters that haven't completed their first
   *  pull: pushing the local default state would overwrite any existing
   *  cloud data. The post-pull hook re-checks `hasPendingWrites()` and
   *  schedules a fresh flush if needed. */
  scheduleFlush(adapterId: string): void {
    if (this.state.kind !== "running") return;
    if (this.awaitingInitialPull.has(adapterId)) return;
    const adapter = this.adapters.get(adapterId);
    if (!adapter) return;
    const interval = adapter.pushIntervalMs ?? 1000;
    const existing = this.pushTimers.get(adapterId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pushTimers.delete(adapterId);
      void this.runOne(adapter, "push");
    }, interval);
    this.pushTimers.set(adapterId, timer);
  }

  /** Force-flush every adapter immediately (e.g. on tab close). */
  async flushAllNow(): Promise<void> {
    if (this.state.kind !== "running") return;
    this.pushTimers.forEach((t) => clearTimeout(t));
    this.pushTimers.clear();
    await Promise.all(
      Array.from(this.adapters.values()).map((a) => this.runOne(a, "push"))
    );
  }

  isRunning(): boolean {
    return this.state.kind === "running";
  }

  getClientId(): string {
    return getClientId();
  }

  // ───────── internals ─────────

  private async pullAll(): Promise<void> {
    if (this.state.kind !== "running" || this.pulling) return;
    this.pulling = true;
    try {
      await Promise.all(
        Array.from(this.adapters.values()).map((a) => this.runOne(a, "pull"))
      );
    } finally {
      this.pulling = false;
    }
  }

  private async runOne(
    adapter: SyncAdapter,
    op: "pull" | "push"
  ): Promise<void> {
    if (this.state.kind !== "running") return;
    const { supabase, userId } = this.state;
    try {
      if (op === "pull") {
        await adapter.pull(supabase, userId);
        // First successful pull lifts the push block.
        this.awaitingInitialPull.delete(adapter.id);
      } else {
        await adapter.push(supabase, userId);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[sync:${adapter.id}] ${op} failed`, err);
      // Reschedule failed pushes with a backoff. Pulls are reattempted on
      // next visibility-change / focus.
      if (op === "push" && this.state.kind === "running") {
        const t = setTimeout(() => {
          this.pushTimers.delete(adapter.id);
          void this.runOne(adapter, "push");
        }, 5000);
        this.pushTimers.set(adapter.id, t);
      }
    }
  }

  private subscribeRealtime(): void {
    if (this.state.kind !== "running") return;
    const { supabase, userId } = this.state;
    const channel = supabase
      .channel(`user-sync:${userId}`)
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "user_state",
          filter: `user_id=eq.${userId}`,
        },
        (payload: { new: Record<string, unknown> | null; old: Record<string, unknown> | null }) => {
          const row = payload.new ?? payload.old;
          if (!row) return;
          this.adapters.forEach((adapter) => {
            if (adapter.realtimeTable === "user_state") adapter.onRemote(row);
          });
        }
      )
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "user_entities",
          filter: `user_id=eq.${userId}`,
        },
        (payload: { new: Record<string, unknown> | null; old: Record<string, unknown> | null }) => {
          const row = payload.new ?? payload.old;
          if (!row) return;
          this.adapters.forEach((adapter) => {
            if (adapter.realtimeTable === "user_entities") adapter.onRemote(row);
          });
        }
      )
      .subscribe();
    this.state = { ...this.state, channel };
  }

  private wakeHandler = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void this.pullAll();
  };

  private beforeUnloadHandler = () => {
    // Best-effort: flush synchronously-ish before the tab closes. The
    // Supabase JS client uses fetch which the browser may abort; we set
    // `keepalive: true` via a fetch override is invasive. Practical
    // mitigation: tools with high-frequency writes (canvas) flush on
    // gesture-end (pointer-up) rather than relying on the debounce, so
    // the worst case loss is the debounce window of low-frequency keys.
    void this.flushAllNow();
  };

  private attachWakeHandlers(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("focus", this.wakeHandler);
    document.addEventListener("visibilitychange", this.wakeHandler);
    window.addEventListener("beforeunload", this.beforeUnloadHandler);
  }

  private detachWakeHandlers(): void {
    if (typeof window === "undefined") return;
    window.removeEventListener("focus", this.wakeHandler);
    document.removeEventListener("visibilitychange", this.wakeHandler);
    window.removeEventListener("beforeunload", this.beforeUnloadHandler);
  }
}

export const syncEngine = new SyncEngine();
