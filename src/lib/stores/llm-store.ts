"use client";

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import type { ProviderId } from "@/lib/llm/types";

/**
 * BYOK LLM key storage.
 *
 * Deliberately NOT built on `createPersistedStore` — that helper exposes
 * `exportJSON` / `importJSON` actions, and we never want API keys to ride
 * along with a tool's data export. This store has no export action at all.
 *
 * The persistence storage is dual-routed:
 *   - storageMode = "session"  →  sessionStorage  (cleared on tab close)
 *   - storageMode = "device"   →  localStorage    (survives reload)
 *
 * Default is "session" — strongest privacy posture against XSS (which can
 * read both storages from this origin, but at least an attacker doesn't
 * inherit a long-lived key from a previous browsing session).
 */

const STORE_KEY = "agile-toolkit:llm";

interface ProviderConfigStored {
  apiKey: string;
  model: string;
}

interface LlmState {
  storageMode: "session" | "device";
  activeProvider: ProviderId | null;
  providers: Partial<Record<ProviderId, ProviderConfigStored>>;
  /** Max output tokens per call. Keeps cost bounded even on accidental
   *  long-running requests. */
  maxOutputTokens: number;
}

interface LlmActions {
  setStorageMode: (mode: "session" | "device") => void;
  setProvider: (id: ProviderId, apiKey: string, model: string) => void;
  removeProvider: (id: ProviderId) => void;
  setActiveProvider: (id: ProviderId | null) => void;
  setMaxOutputTokens: (n: number) => void;
  /** Wipes every provider key + active selection. Storage mode preference
   *  is preserved. */
  clearAll: () => void;
}

const initial: LlmState = {
  storageMode: "session",
  activeProvider: null,
  providers: {},
  maxOutputTokens: 1024,
};

/**
 * Storage adapter that switches between sessionStorage and localStorage
 * based on the CURRENT `storageMode` field of the state being written.
 *
 * Why on-demand routing? When the user toggles Session ↔ Device we want
 * the NEXT write to go to the new storage AND we want to migrate any
 * existing value across. The `setStorageMode` action handles the migration
 * explicitly; this adapter just makes sure the routine reads/writes use
 * the right storage in steady state.
 *
 * `getItem` peeks at both storages and returns whichever has a value —
 * sessionStorage first (it's the default, and a value here wins over a
 * stale localStorage copy from a previous device-mode session that the
 * user has since switched out of).
 */
function nullStorage(): StateStorage {
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

const adaptiveStorage: StateStorage = {
  getItem: (name: string) => {
    if (typeof window === "undefined") return null;
    // BUG-W15: prefer the blob whose internal `storageMode` matches its
    // location. The previous "sessionStorage first" rule meant a stale
    // session-mode blob (e.g. leftover from a previous tab) would shadow
    // the newer localStorage value the user explicitly migrated to.
    const fromSession = (() => {
      try {
        return sessionStorage.getItem(name);
      } catch {
        return null;
      }
    })();
    const fromLocal = (() => {
      try {
        return localStorage.getItem(name);
      } catch {
        return null;
      }
    })();
    const modeOf = (raw: string | null): "session" | "device" | "unknown" => {
      if (!raw) return "unknown";
      try {
        const m = (JSON.parse(raw) as { state?: { storageMode?: string } })?.state?.storageMode;
        return m === "device" ? "device" : m === "session" ? "session" : "unknown";
      } catch {
        return "unknown";
      }
    };
    const sMode = modeOf(fromSession);
    const lMode = modeOf(fromLocal);
    // If session blob is genuinely session-mode, prefer it.
    if (fromSession && sMode === "session") return fromSession;
    // If local blob is genuinely device-mode, prefer it.
    if (fromLocal && lMode === "device") return fromLocal;
    // Mixed/unknown — fall back to first available.
    return fromSession ?? fromLocal;
  },
  setItem: (name: string, value: string) => {
    if (typeof window === "undefined") return;
    // Determine target storage from the value we're about to write.
    let mode: "session" | "device" = "session";
    try {
      const parsed = JSON.parse(value) as { state?: { storageMode?: string } };
      if (parsed?.state?.storageMode === "device") mode = "device";
    } catch {
      /* keep default */
    }
    const target = mode === "session" ? sessionStorage : localStorage;
    const other = mode === "session" ? localStorage : sessionStorage;
    try {
      target.setItem(name, value);
      // Remove from the other storage so we don't keep a stale copy that
      // would resurrect on next rehydrate if the user clears the active one.
      other.removeItem(name);
    } catch {
      /* quota / unavailable — silent best effort */
    }
  },
  removeItem: (name: string) => {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(name);
    localStorage.removeItem(name);
  },
};

export const useLlmStore = create<LlmState & LlmActions>()(
  persist(
    (set, get) => ({
      ...initial,

      setStorageMode: (mode) => {
        const prev = get().storageMode;
        if (prev === mode) return;
        // BUG-W15: synchronous migration. The old flow was: setState
        // (state with new mode), THEN removeItem from old, THEN persist
        // middleware async-writes to new. Between steps 2 and 3 both
        // storages were empty — a fast tab-close in that window lost the
        // user's keys entirely. New order:
        //   1. Read the current persisted blob from the OLD storage.
        //   2. Patch the storageMode inside it.
        //   3. Write the patched blob to the NEW storage.
        //   4. Remove from OLD storage.
        //   5. setState so future writes route to NEW storage.
        // Each step is synchronous; no empty-both window.
        if (typeof window !== "undefined") {
          const oldStorage = prev === "device" ? localStorage : sessionStorage;
          const newStorage = mode === "device" ? localStorage : sessionStorage;
          try {
            const raw = oldStorage.getItem(STORE_KEY);
            if (raw) {
              let patched = raw;
              try {
                const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
                if (parsed?.state) {
                  parsed.state.storageMode = mode;
                  patched = JSON.stringify(parsed);
                }
              } catch {
                /* keep raw if not parseable */
              }
              newStorage.setItem(STORE_KEY, patched);
              oldStorage.removeItem(STORE_KEY);
            }
          } catch {
            /* quota / private mode — proceed; the persist write below
               will still attempt to populate the new storage. */
          }
        }
        // Update the in-memory state so the next persist cycle aligns.
        set({ storageMode: mode });
      },

      setProvider: (id, apiKey, model) => {
        const trimmed = apiKey.trim();
        if (!trimmed) return;
        set((s) => ({
          providers: { ...s.providers, [id]: { apiKey: trimmed, model } },
          // If this is the first configured provider, auto-activate it so the
          // user doesn't need a second click to get the Run button to appear.
          activeProvider: s.activeProvider ?? id,
        }));
      },

      removeProvider: (id) => {
        set((s) => {
          const nextProviders = { ...s.providers };
          delete nextProviders[id];
          return {
            providers: nextProviders,
            // If we just removed the active provider, fall back to whatever
            // else is configured (deterministic by insertion order) or null.
            activeProvider:
              s.activeProvider === id
                ? ((Object.keys(nextProviders)[0] as ProviderId | undefined) ?? null)
                : s.activeProvider,
          };
        });
      },

      setActiveProvider: (id) => {
        // Reject activating a provider the user hasn't configured — keeps
        // the run path from racing into a "no key" error.
        if (id !== null && !get().providers[id]) return;
        set({ activeProvider: id });
      },

      setMaxOutputTokens: (n) => {
        if (!Number.isFinite(n)) return;
        set({ maxOutputTokens: Math.max(64, Math.min(8192, Math.floor(n))) });
      },

      clearAll: () => {
        set({ providers: {}, activeProvider: null });
      },
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") return nullStorage();
        return adaptiveStorage;
      }),
      // Hydrated explicitly from AppShell after mount so the eager bundle
      // never reads window-only storage on the server pass.
      skipHydration: true,
    }
  )
);

/** Convenience selector — returns the effective config for the active
 *  provider, or null if none. Used by the run panel and status chip. */
export function getActiveConfig(): {
  provider: ProviderId;
  apiKey: string;
  model: string;
} | null {
  const s = useLlmStore.getState();
  if (!s.activeProvider) return null;
  const cfg = s.providers[s.activeProvider];
  if (!cfg || !cfg.apiKey) return null;
  return { provider: s.activeProvider, apiKey: cfg.apiKey, model: cfg.model };
}
