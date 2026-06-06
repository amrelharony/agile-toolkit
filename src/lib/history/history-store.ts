"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { HistoryEvent, HistoryStoreShape, SyncStatus } from "./types";

const STORE_KEY = "agile-toolkit:history";
const EVENTS_CAP = 2000;
const EVICTION_BATCH = Math.floor(EVENTS_CAP * 0.25);

interface HistoryActions {
  addEvent: (event: HistoryEvent) => void;
  addEvents: (events: HistoryEvent[]) => void;
  markSynced: (clientEventIds: string[], when: string) => void;
  setSyncStatus: (status: SyncStatus, error?: string | null) => void;
  setLastSyncAt: (when: string) => void;
  setUserOnAnonymousEvents: (userId: string) => HistoryEvent[];
  clearAll: () => void;
  ensureClientId: () => string;
}

export type HistoryStore = HistoryStoreShape & HistoryActions;

const initial: HistoryStoreShape = {
  events: [],
  clientId: null,
  lastSyncAt: null,
  syncStatus: "idle",
  syncError: null,
};

/**
 * Quota-safe localStorage. On QuotaExceededError, the store evicts the oldest
 * 25% of events and retries the write. Cloud retains the full record for
 * signed-in users.
 */
const storage = createJSONStorage(() => {
  if (typeof window === "undefined") {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  return {
    // Wrap reads + removes too — Safari Private Browsing and corporate-
    // managed Chromes throw `SecurityError` on every localStorage access,
    // not just setItem. An unwrapped getItem would crash hydration. Mirrors
    // the pattern in `safe-storage.ts` / `workspace-store.ts`.
    getItem: (key: string) => {
      try {
        return window.localStorage.getItem(key);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[history-store] localStorage.getItem blocked — starting with empty history.",
          err
        );
        return null;
      }
    },
    setItem: (key: string, value: string) => {
      try {
        window.localStorage.setItem(key, value);
      } catch (err) {
        if (err instanceof DOMException && err.name === "QuotaExceededError") {
          try {
            const parsed = JSON.parse(value) as {
              state?: { events?: HistoryEvent[] };
            };
            if (parsed?.state?.events?.length) {
              parsed.state.events = parsed.state.events.slice(EVICTION_BATCH);
              window.localStorage.setItem(key, JSON.stringify(parsed));
              return;
            }
          } catch {
            /* fall through */
          }
        }
        // Don't re-throw — that would crash any caller persisting state.
        // History is best-effort: cloud retains the full record for
        // signed-in users, so failing silently locally is acceptable.
        // eslint-disable-next-line no-console
        console.warn(
          "[history-store] localStorage.setItem failed; history held in memory only.",
          err
        );
      }
    },
    removeItem: (key: string) => {
      try {
        window.localStorage.removeItem(key);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[history-store] localStorage.removeItem blocked.", err);
      }
    },
  };
});

export const useHistoryStore = create<HistoryStore>()(
  persist(
    (set, get) => ({
      ...initial,

      ensureClientId: () => {
        const existing = get().clientId;
        if (existing) return existing;
        const fresh = nanoid();
        set({ clientId: fresh });
        return fresh;
      },

      addEvent: (event) =>
        set((s) => {
          // Dedup by clientEventId so a buggy emitter or HMR re-fire doesn't
          // double-log. The single-event path was previously unguarded —
          // only `addEvents` (cloud pull) deduped — which let local writes
          // accumulate identical events if a logger fired twice in the same
          // tick (e.g. effect runs twice under React StrictMode).
          if (s.events.some((e) => e.clientEventId === event.clientEventId)) {
            return s;
          }
          // Fast path: append if the event is at-or-after the tail. Backfill
          // / clock-skew / `opts.occurredAt` in the past would otherwise
          // append out-of-order, breaking selectors that walk the array
          // backwards (eventCountByDay, selectEvents, signal bridge).
          const last = s.events[s.events.length - 1];
          let next: HistoryEvent[];
          if (!last || event.occurredAt >= last.occurredAt) {
            next = [...s.events, event];
          } else {
            // Linear scan from the tail — backfilled events are rare and the
            // array is capped at EVENTS_CAP. Insert before the first event
            // that occurs strictly after this one, tie-breaking on
            // clientEventId for determinism with addEvents' merge sort.
            next = s.events.slice();
            let i = next.length;
            while (
              i > 0 &&
              (next[i - 1].occurredAt > event.occurredAt ||
                (next[i - 1].occurredAt === event.occurredAt &&
                  next[i - 1].clientEventId > event.clientEventId))
            ) {
              i--;
            }
            next.splice(i, 0, event);
          }
          if (next.length > EVENTS_CAP) next.splice(0, next.length - EVENTS_CAP);
          return { events: next };
        }),

      addEvents: (events) =>
        set((s) => {
          if (events.length === 0) return s;
          // Dedupe by clientEventId — cloud pull may overlap local writes.
          const seen = new Set(s.events.map((e) => e.clientEventId));
          const fresh = events.filter((e) => !seen.has(e.clientEventId));
          if (fresh.length === 0) return s;
          // BUG-HX1: a pure `occurredAt` sort breaks across devices with
          // skewed clocks — a device 30s slow stamps "earlier" events
          // that ought to interleave AFTER faster-device events. Prefer
          // the server-stamped `syncedAt` when an event carries it
          // (cloud-pulled events always do), else fall back to
          // `occurredAt`. Each event contributes ONE sort key — comparing
          // `syncedAt` for some pairs and `occurredAt` for others made the
          // comparator intransitive (A<B, B<C yet A>C), which yields an
          // engine-defined, effectively random order. Tie-break on
          // clientEventId (a nanoid) for full determinism.
          const sortKey = (e: HistoryEvent) => e.syncedAt ?? e.occurredAt;
          const merged = [...s.events, ...fresh].sort((a, b) => {
            const cmp = sortKey(a).localeCompare(sortKey(b));
            if (cmp !== 0) return cmp;
            return a.clientEventId.localeCompare(b.clientEventId);
          });
          if (merged.length > EVENTS_CAP) {
            merged.splice(0, merged.length - EVENTS_CAP);
          }
          return { events: merged };
        }),

      markSynced: (ids, when) =>
        set((s) => {
          const idSet = new Set(ids);
          return {
            events: s.events.map((e) =>
              idSet.has(e.clientEventId) ? { ...e, syncedAt: when } : e
            ),
          };
        }),

      setSyncStatus: (status, error = null) => set({ syncStatus: status, syncError: error }),

      setLastSyncAt: (when) => set({ lastSyncAt: when }),

      /**
       * After sign-in: stamp every anonymous local event with the new userId
       * and return the freshly-stamped events so the sync engine can push them.
       *
       * Computes the new array OUTSIDE the `set` updater so any future
       * StrictMode-style double-invocation of the updater doesn't double-
       * report the stamped list.
       */
      setUserOnAnonymousEvents: (userId) => {
        const current = get().events;
        const stamped: HistoryEvent[] = [];
        const next = current.map((e) => {
          if (e.userId !== null) return e;
          const updated = { ...e, userId };
          stamped.push(updated);
          return updated;
        });
        if (stamped.length === 0) return [];
        set({ events: next });
        return stamped;
      },

      clearAll: () => set({ events: [], lastSyncAt: null }),
    }),
    {
      name: STORE_KEY,
      storage,
      version: 1,
    }
  )
);
