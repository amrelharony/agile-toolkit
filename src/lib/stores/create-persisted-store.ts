import { create, type StateCreator } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface PersistedStoreActions {
  exportJSON: () => string;
  importJSON: (json: string) => void;
  reset: () => void;
}

/**
 * Strip fields we never want to serialize:
 *   - functions (action methods — re-attached by the slice creator)
 *   - `_tt*` internal keys from the time-travel middleware (in-memory only)
 *
 * Used both ways:
 *   - exportJSON: never serialize action methods or transient stacks
 *     (forward-compatible if new actions get added in subclassed stores).
 *   - importJSON: never let a foreign payload overwrite live action methods
 *     with arbitrary values, or rehydrate a fake snapshot stack.
 */
function stripFunctions<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "function") continue;
    if (k.startsWith("_tt")) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

export function createPersistedStore<T extends object>(
  name: string,
  initialState: T,
  stateCreator?: StateCreator<T & PersistedStoreActions, [], [], T & PersistedStoreActions>
) {
  const storeKey = `agile-toolkit:${name}`;
  const allowedKeys = new Set(Object.keys(initialState));

  return create<T & PersistedStoreActions>()(
    persist(
      stateCreator ??
        ((set, get) => ({
          ...initialState,
          exportJSON: () => {
            const data = stripFunctions(get());
            return JSON.stringify(data, null, 2);
          },
          importJSON: (json: string) => {
            // Parse first; on failure, throw so callers can surface a toast.
            const parsed: unknown = JSON.parse(json);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw new Error("Import payload must be a JSON object");
            }
            // Whitelist: only keys present in initialState are accepted, and
            // functions are dropped. This prevents a malicious or stale
            // export from overwriting action methods on the live store.
            // `_tt*` keys are also rejected — those are runtime-only stacks
            // that should never travel through import/export.
            const sanitized: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
              if (k.startsWith("_tt")) continue;
              if (allowedKeys.has(k) && typeof v !== "function") {
                sanitized[k] = v;
              }
            }
            set(sanitized as Partial<T & PersistedStoreActions>);
          },
          reset: () => set({ ...initialState } as Partial<T & PersistedStoreActions>),
        })),
      {
        name: storeKey,
        storage: createJSONStorage(() => {
          if (typeof window !== "undefined") return localStorage;
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }),
        skipHydration: true,
      }
    )
  );
}
