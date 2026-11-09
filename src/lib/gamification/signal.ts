/**
 * Tell the gamification engine that something happened, from code that
 * shouldn't pull the engine (and its stores) into its own chunk: a room
 * joined, an invite created, a backup downloaded. The engine is loaded
 * lazily, the same way sonification/emit.ts and utils/export.ts do it, and
 * a failure to load it is ignored.
 *
 * No "use client": server code may import this module; on the server the
 * call does nothing.
 */

type Dispatch = (name: string, meta?: Record<string, unknown>) => void;
let dispatchRef: Dispatch | null = null;

export function signalGamification(name: string, meta?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  if (dispatchRef) {
    dispatchRef(name, meta);
    return;
  }
  void import("./engine")
    .then((mod) => {
      dispatchRef = (n, m) => mod.dispatch({ name: n, meta: m });
      dispatchRef(name, meta);
    })
    .catch(() => {
      /* engine not loadable — the action itself still worked */
    });
}
