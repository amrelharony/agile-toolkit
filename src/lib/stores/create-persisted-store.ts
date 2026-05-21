import { create, type StateCreator } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface PersistedStoreActions {
  exportJSON: () => string;
  importJSON: (json: string) => void;
  reset: () => void;
}

/** Cap to avoid OOM on hostile/oversized imports. 5MB covers every realistic
 *  tool export — a workspace with thousands of stories is well under 1MB. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** JSON.parse reviver that strips dangerous keys, defending against
 *  prototype pollution from a crafted nested payload like
 *  `{"stories": [{"__proto__": {"polluted": true}}]}`. */
function safeJsonReviver(key: string, value: unknown): unknown {
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    return undefined;
  }
  return value;
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

/** Loose type-check: does `actual` match the shape of `expected`? Only the
 *  top-level kind matters (array vs object vs primitive). */
function shapeMatches(expected: unknown, actual: unknown): boolean {
  if (expected === null || expected === undefined) return true; // permissive
  if (Array.isArray(expected)) return Array.isArray(actual);
  const eType = typeof expected;
  if (eType === "object") return typeof actual === "object" && actual !== null && !Array.isArray(actual);
  return typeof actual === eType;
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
            // Reject obvious DoS payloads before invoking the parser; a 200MB
            // string in JSON.parse will freeze the UI thread for seconds.
            if (typeof json !== "string" || json.length > MAX_IMPORT_BYTES) {
              throw new Error(
                `Import payload too large (max ${MAX_IMPORT_BYTES} bytes)`
              );
            }
            // Parse first; on failure, throw so callers can surface a toast.
            // The reviver drops __proto__/constructor/prototype keys to
            // defend against prototype-pollution via nested payloads.
            const parsed: unknown = JSON.parse(json, safeJsonReviver);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw new Error("Import payload must be a JSON object, not an array or primitive");
            }
            // Whitelist: only keys present in initialState are accepted, the
            // value's top-level shape must match initialState's, and
            // functions are dropped. `_tt*` keys are also rejected — those
            // are runtime-only stacks that should never travel through
            // import/export.
            const sanitized: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
              if (k.startsWith("_tt")) continue;
              if (!allowedKeys.has(k)) continue;
              if (typeof v === "function") continue;
              const expected = (initialState as Record<string, unknown>)[k];
              if (!shapeMatches(expected, v)) continue;
              sanitized[k] = v;
            }
            // Replace, not merge: an "Import JSON" UX implies the importer
            // expects the file to be the new authoritative state. Untouched
            // keys revert to their default rather than keeping prior session
            // data the user thought they'd overwritten.
            set({ ...initialState, ...sanitized } as Partial<T & PersistedStoreActions>);
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
