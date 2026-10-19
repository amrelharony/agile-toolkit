"use client";

import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { getClientId, resetClientId } from "./lww";

/**
 * Supabase realtime payloads carry `eventType` as a string. Narrow it
 * to the discriminated union the adapters consume. If the field is
 * missing (shouldn't happen, but be defensive), infer from whether
 * `new` is null — null `new` means the row was deleted.
 */
function normaliseEventType(
  eventType: string | undefined,
  newRow: Record<string, unknown> | null
): "INSERT" | "UPDATE" | "DELETE" {
  if (eventType === "INSERT" || eventType === "UPDATE" || eventType === "DELETE") {
    return eventType;
  }
  return newRow === null ? "DELETE" : "UPDATE";
}

/**
 * Postgres check-constraint violations and similar permanent errors
 * shouldn't be retried — the payload is malformed and will fail on
 * every attempt. Detect via PostgrestError code so we don't burn
 * exponential time on a doomed retry loop.
 */
function isPermanentFailure(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  if (!code) return false;
  return (
    code === "23514" || // check_violation (size cap, regex, etc.)
    code === "23502" || // not_null_violation
    code === "23505" || // unique_violation
    code === "23503" || // foreign_key_violation
    code === "22P02" // invalid_text_representation
  );
}

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
   *  ignore echoes of its own writes (using the row's client_id) for
   *  UPDATE/INSERT events. For DELETE events the adapter must apply
   *  unconditionally — `row.client_id` from `payload.old` reflects
   *  whoever last upserted, not whoever issued the DELETE. */
  onRemote(row: Record<string, unknown>, eventType: "INSERT" | "UPDATE" | "DELETE"): void;
  /** Mark adapter dirty: schedule a push. */
  hasPendingWrites(): boolean;
  /** Clear all cross-session LWW/diff state (lastPushed snapshots,
   *  timestamps, pending deletes). Called by the engine on stop() so a
   *  different user signing in on the same tab can't inherit the previous
   *  user's sync state. (BUG-S13) */
  resetSyncState?(): void;
}

type EngineState =
  | { kind: "idle" }
  | { kind: "running"; supabase: SupabaseClient; userId: string; channel: RealtimeChannel | null };

class SyncEngine {
  private state: EngineState = { kind: "idle" };
  private adapters = new Map<string, SyncAdapter>();
  private pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Last user this engine ran for; survives `stop()` so `start()` can tell a
   *  same-user restart (token refresh, sign-out/in) from a real user switch
   *  and only wipe per-adapter LWW state for the latter. See BUG-S25. */
  private lastUserId: string | null = null;
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
  /** Bumped by every `start()`; tells a finished start from a superseded one. */
  private startGeneration = 0;
  /** The generation whose initial pull (and drain) has finished. */
  private readyGeneration = 0;
  private readyWaiters: Array<() => void> = [];

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
    // BUG-S25: reset per-adapter LWW/diff state HERE, and only on an actual
    // user CHANGE — not unconditionally in `stop()`. BUG-S13's rationale
    // (don't carry the previous user's lastPushed timestamps into the next
    // user's session) only ever applied to a user switch, but `stop()` also
    // runs on sign-out and on every auth-state change including the roughly
    // hourly TOKEN_REFRESHED. Wiping `dirty`/`pendingDeletes` there threw
    // away any edit still inside its 1s push debounce: the next `start()`
    // saw a clean adapter, pulled the older cloud row over it, and the edit
    // was gone locally too. A deleted entity's tombstone was lost the same
    // way, resurrecting it on every device.
    if (this.lastUserId !== null && this.lastUserId !== userId) {
      this.adapters.forEach((a) => a.resetSyncState?.());
    }
    this.lastUserId = userId;
    this.state = { kind: "running", supabase, userId, channel: null };
    const generation = ++this.startGeneration;
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
    // Still this session (not stopped or restarted meanwhile): local state
    // now reflects the cloud, so whoever waits in whenReady() may proceed.
    if (
      generation === this.startGeneration &&
      this.state.kind === "running" &&
      this.state.userId === userId
    ) {
      this.readyGeneration = generation;
      const waiters = this.readyWaiters;
      this.readyWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
    void this.subscribeRealtime();
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

  /**
   * Resolves once the engine is running and its initial pull has finished,
   * including adapters that registered during it (the drain in `start()`).
   * Immediately when that already happened for the current session;
   * otherwise (idle, starting, or stopped mid-start) at the end of the next
   * start that completes. Never rejects: a pull that fails still counts as
   * finished, as it does for the push guard.
   *
   * For one-off local writes that must not race the first pull (the
   * legacy sprint migration): written before it, they'd be "unpushed local
   * edits" that win over newer cloud rows.
   */
  whenReady(): Promise<void> {
    if (this.state.kind === "running" && this.readyGeneration === this.startGeneration) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.readyWaiters.push(resolve);
    });
  }

  stop(): void {
    if (this.state.kind === "idle") return;
    const { supabase, channel, userId } = this.state;
    if (channel) void supabase.removeChannel(channel);
    // BUG-S3 (broader cleanup): also drop any leaked user-sync channels
    // under a DIFFERENT user-id from a previous session that hasn't
    // finished draining.
    for (const ch of supabase.getChannels()) {
      if (typeof ch.topic === "string" && ch.topic.startsWith("realtime:user-sync:")) {
        void supabase.removeChannel(ch);
      }
    }
    // Best-effort flush of anything still inside its push debounce, using
    // the credentials we're about to drop. Fire-and-forget: `push` takes
    // supabase/userId directly, so it doesn't depend on engine state, and
    // the dirty flags survive below if it doesn't land in time.
    this.adapters.forEach((a) => {
      if (a.hasPendingWrites()) {
        void a.push(supabase, userId).catch(() => {
          /* keep the dirty flag; the next start() re-flushes */
        });
      }
    });
    this.pushTimers.forEach((t) => clearTimeout(t));
    this.pushTimers.clear();
    this.awaitingInitialPull.clear();
    this.starting = false;
    this.detachWakeHandlers();
    // NOTE: `resetSyncState()` deliberately does NOT run here — see BUG-S25
    // in `start()`, which runs it only when the user actually changes so a
    // same-user stop/start can't discard an in-debounce edit.
    // BUG-S5: reset the per-tab client id so the next sign-in (potentially
    // a different user) starts with a fresh echo-suppression identity.
    resetClientId();
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
    // Honour the initial-pull guard here too (BUG-S17): an adapter still
    // awaiting its first pull holds the local DEFAULT state — force-pushing
    // it (e.g. tab closed right after a lazy tool mount) would overwrite
    // newer cloud data with that default. scheduleFlush already blocks
    // these; flushAllNow must not sidestep the same protection.
    await Promise.all(
      Array.from(this.adapters.values())
        .filter((a) => !this.awaitingInitialPull.has(a.id))
        .map((a) => this.runOne(a, "push"))
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
      await Promise.all(Array.from(this.adapters.values()).map((a) => this.runOne(a, "pull")));
    } finally {
      this.pulling = false;
    }
  }

  private async runOne(adapter: SyncAdapter, op: "pull" | "push"): Promise<void> {
    if (this.state.kind !== "running") return;
    const { supabase, userId } = this.state;
    try {
      if (op === "pull") {
        await adapter.pull(supabase, userId);
      } else {
        await adapter.push(supabase, userId);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[sync:${adapter.id}] ${op} failed`, err);
      // Reschedule failed pushes with a backoff — UNLESS the failure was
      // a check-constraint violation (oversize payload, malformed shape).
      // Retrying the same payload every 5s indefinitely is wasteful and
      // never recovers. The Supabase JS client surfaces this as PostgrestError
      // with code "23514". Fall through to a one-shot fail; user can
      // recover by editing the entity to fit the size cap.
      const isPermanent = isPermanentFailure(err);
      if (op === "push" && this.state.kind === "running" && !isPermanent) {
        const t = setTimeout(() => {
          this.pushTimers.delete(adapter.id);
          void this.runOne(adapter, "push");
        }, 5000);
        this.pushTimers.set(adapter.id, t);
      }
    } finally {
      // Always lift the push-block on first pull, whether it succeeded
      // or failed. Without this, a pull failure permanently blocks the
      // adapter from ever pushing, even after the user fixes the cause.
      // Subsequent pulls happen on visibility-change/focus.
      if (op === "pull") {
        this.awaitingInitialPull.delete(adapter.id);
      }
    }
  }

  private async subscribeRealtime(): Promise<void> {
    if (this.state.kind !== "running") return;
    const { supabase, userId } = this.state;
    const channelName = `user-sync:${userId}`;
    // Defensive cleanup: `supabase.channel(name)` is a getOrCreate — if a
    // channel with this name already exists in the client's internal map
    // (e.g. from a HMR-triggered re-`start()` before the previous stop()
    // finished its async removeChannel, or from React StrictMode's
    // double-invoke in dev), the call returns that EXISTING channel
    // rather than a new one. Chaining `.on()` on an already-subscribed
    // channel throws "cannot add postgres_changes callbacks ... after
    // subscribe()" and leaves the sync layer broken until full reload.
    //
    // Remove any stale channel under this name first. removeChannel is
    // idempotent for unknown names so the no-existing-channel path is
    // a cheap no-op. BUG-S3 (broader): also drop any leaked user-sync
    // channels for OTHER user-ids (e.g., previous session that's still
    // draining its async removeChannel).
    const existing = supabase
      .getChannels()
      .filter(
        (ch) =>
          typeof ch.topic === "string" &&
          (ch.topic === `realtime:${channelName}` || ch.topic.startsWith("realtime:user-sync:"))
      );
    // BUG-S16: AWAIT the removals. realtime-js only deletes the topic from
    // the client's internal channel map after the async unsubscribe
    // round-trip resolves, and `supabase.channel()` is getOrCreate by topic
    // — firing-and-forgetting here could hand us the mid-teardown channel,
    // whose `subscribe()` is a silent no-op once the pending teardown
    // closes it: no SUBSCRIBED callback, no postgres_changes, and sync
    // quietly degrades to focus-triggered pulls only.
    if (existing.length > 0) {
      await Promise.all(existing.map((ch) => supabase.removeChannel(ch).catch(() => undefined)));
    }
    // The engine may have been stopped or restarted while we awaited —
    // don't attach a channel to a stale session (a newer subscribeRealtime
    // call owns the current one if `channel` is already set).
    if (this.state.kind !== "running" || this.state.userId !== userId || this.state.channel) {
      return;
    }
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "user_state",
          filter: `user_id=eq.${userId}`,
        },
        (payload: {
          eventType?: string;
          new: Record<string, unknown> | null;
          old: Record<string, unknown> | null;
        }) => {
          const row = payload.new ?? payload.old;
          if (!row) return;
          const ev = normaliseEventType(payload.eventType, payload.new);
          this.adapters.forEach((adapter) => {
            if (adapter.realtimeTable === "user_state") adapter.onRemote(row, ev);
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
        (payload: {
          eventType?: string;
          new: Record<string, unknown> | null;
          old: Record<string, unknown> | null;
        }) => {
          const row = payload.new ?? payload.old;
          if (!row) return;
          const ev = normaliseEventType(payload.eventType, payload.new);
          this.adapters.forEach((adapter) => {
            if (adapter.realtimeTable === "user_entities") adapter.onRemote(row, ev);
          });
        }
      )
      // BUG-S4: pass a status callback so we can recover from
      // CHANNEL_ERROR / TIMED_OUT / CLOSED. Supabase Realtime does NOT
      // replay events that occurred during a disconnect, so when the
      // subscription returns to SUBSCRIBED we trigger a pullAll() to
      // refill any state that drifted while the wire was down.
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !this.starting) {
          void this.pullAll();
        }
        // CHANNEL_ERROR / TIMED_OUT / CLOSED: the supabase client retries
        // the subscribe automatically; we just need to be ready to re-sync
        // when it succeeds.
      });
    this.state = { ...this.state, channel };
  }

  private wakeHandler = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void this.pullAll();
  };

  private beforeUnloadHandler = () => {
    // BUG-S10: the Supabase JS client uses fetch() which the browser
    // aborts on tab close — pending pushes silently vanish. Cancel
    // pending push timers and trigger a synchronous flush via
    // navigator.sendBeacon where adapters support it; otherwise fall
    // back to the best-effort fetch (the canvas tools flush on
    // pointer-up so they're mostly safe; this catches low-frequency
    // text edits that fall inside the debounce window).
    this.pushTimers.forEach((t) => clearTimeout(t));
    this.pushTimers.clear();
    // sendBeacon requires the adapter to know the URL + payload itself;
    // wiring that contract through is a larger refactor. Fire the
    // standard flushAllNow as best-effort — Chromium honours fetches
    // initiated from beforeunload long enough for many of them to
    // commit, especially on fast networks. Documented limitation: a
    // brief debounce-window worth of low-frequency edits can still be
    // lost on a fast tab close.
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
