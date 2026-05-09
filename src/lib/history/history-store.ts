"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { nanoid } from "nanoid";
import type {
  HistoryEvent,
  HistoryStoreShape,
  SyncStatus,
} from "./types";

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
    getItem: (key: string) => window.localStorage.getItem(key),
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
        throw err;
      }
    },
    removeItem: (key: string) => window.localStorage.removeItem(key),
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
          const next = [...s.events, event];
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
          const merged = [...s.events, ...fresh].sort((a, b) =>
            a.occurredAt.localeCompare(b.occurredAt)
          );
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

      setSyncStatus: (status, error = null) =>
        set({ syncStatus: status, syncError: error }),

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
