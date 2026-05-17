/**
 * Shared zustand-persist-compatible storage that swallows DOMException
 * from localStorage. The persist middleware does not catch synchronous
 * exceptions, so without this wrapper:
 *
 *   - Safari Private Browsing throws SecurityError on every
 *     `localStorage.getItem` and `.setItem` → page-load crash during
 *     `persist.rehydrate()`.
 *   - Origins over the 5 MB quota throw QuotaExceededError on every
 *     write → React error boundary catches it but the user loses the
 *     in-memory state.
 *   - Locked-down corporate Chromes can throw the same SecurityError.
 *
 * Usage:
 *
 *   persist(stateCreator, {
 *     name: "agile-toolkit:my-tool",
 *     storage: safeJSONStorage("my-tool"),
 *   })
 *
 * Mirrors the wrappers in `lib/stores/workspace-store.ts` and
 * `app/(tools)/canvas/use-canvas-store.ts` but as a one-liner for the
 * many tool-local stores that previously relied on the default
 * localStorage adapter.
 */

import { createJSONStorage } from "zustand/middleware";

// R8: log every blocked-storage warning AT MOST ONCE per label. iOS
// Safari Private Browsing throws on every read/write, and zustand's
// persist re-reads on every subscribe → previously flooded the console
// with thousands of warnings per page load.
const warnedLabels = new Set<string>();
function warnOnce(label: string, msg: string, err: unknown): void {
  if (warnedLabels.has(label)) return;
  warnedLabels.add(label);
  // eslint-disable-next-line no-console
  console.warn(`[${label}] ${msg}`, err);
}

export function safeJSONStorage(label: string) {
  return createJSONStorage(() => {
    if (typeof window === "undefined") {
      return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    }
    return {
      getItem: (k: string) => {
        try {
          return localStorage.getItem(k);
        } catch (err) {
          warnOnce(label, "localStorage.getItem blocked — starting with defaults.", err);
          return null;
        }
      },
      setItem: (k: string, v: string) => {
        try {
          localStorage.setItem(k, v);
        } catch (err) {
          warnOnce(label, "localStorage write failed (quota / private mode) — state held in memory only.", err);
        }
      },
      removeItem: (k: string) => {
        try {
          localStorage.removeItem(k);
        } catch (err) {
          warnOnce(label, "localStorage.removeItem blocked.", err);
        }
      },
    };
  });
}
